import type { Clock } from "../../lib/clock";
import { UncertainOutcomeError } from "../../lib/errors";
import { httpJson, type FetchLike } from "../http";
import { ProviderError } from "../commerce/commerce";
import { CredentialVault } from "../../modules/shopping/credentialVault";
import type { AuthorizeInput, CaptureInput, PaymentAdapter, PaymentResult } from "./payments";

export interface PayPalConfig { clientId: string; clientSecret: string; returnUrlBase: string; cancelUrl: string; baseUrl?: string; minimalSetup?: boolean }
const SANDBOX_HOST = "api-m.sandbox.paypal.com";

const reject = (e: ProviderError): PaymentResult => ({
  status: "FAILED", reference: null,
  failureCode: e.detail?.issue ? `PAYPAL_${e.detail.issue}` : "PAYPAL_REJECTED",
  detail: [e.code, e.detail?.name, e.detail?.issue, e.detail?.debugId && `debug_id=${e.detail.debugId}`].filter(Boolean).join(" "),
});
const money = (minor: number) => (minor / 100).toFixed(2);

/**
 * PayPal SANDBOX only (the host is pinned; live PayPal is deliberately not enabled in this build).
 * Flow: Vault v3 consent (setup token -> user approves in PayPal -> payment token) -> Orders v2 with
 * intent AUTHORIZE and the vaulted token -> capture only after the retailer order is verified -> void on failure.
 * Paths and bodies follow PayPal's public docs; NOT exercised against the live sandbox from this repo.
 */
export class PayPalPaymentAdapter implements PaymentAdapter {
  readonly name = "paypal";
  readonly label = "PayPal (sandbox)";
  readonly mode = "SANDBOX" as const;
  readonly requiresConnection = true;
  private base: string;
  private tok: { v: string; exp: number } | null = null;

  constructor(private cfg: PayPalConfig, private deps: { fetch: FetchLike; clock: Clock; vault: CredentialVault; sleep?: (ms: number) => Promise<void> }) {
    this.base = cfg.baseUrl ?? `https://${SANDBOX_HOST}`;
    if (new URL(this.base).host !== SANDBOX_HOST) throw new Error(`PayPal base URL must be ${SANDBOX_HOST}; live PayPal is not enabled in this build`);
  }

  private async token(): Promise<string> {
    const now = this.deps.clock.now().getTime();
    if (this.tok && this.tok.exp > now + 30_000) return this.tok.v;
    const r = await httpJson<any>(this.deps.fetch, `${this.base}/v1/oauth2/token`, {
      method: "POST", headers: { authorization: "Basic " + Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    }, { allowedHosts: [SANDBOX_HOST], ...(this.deps.sleep ? { sleep: this.deps.sleep } : {}) });
    if (!r?.access_token) throw new ProviderError("AUTH", "PayPal did not return an access token");
    this.tok = { v: r.access_token, exp: now + (r.expires_in ?? 300) * 1000 };
    return this.tok.v;
  }

  /** Money-moving POSTs are never retried here; an unclear outcome is surfaced as UNCERTAIN, not as success or failure. */
  private async post<T = any>(path: string, body: unknown, requestId?: string): Promise<T | null> {
    const headers: Record<string, string> = { authorization: `Bearer ${await this.token()}`, "content-type": "application/json", prefer: "return=representation" };
    if (requestId) headers["paypal-request-id"] = requestId;
    try {
      return await httpJson<T>(this.deps.fetch, `${this.base}${path}`, { method: "POST", headers, body: body === undefined ? "{}" : JSON.stringify(body) }, { allowedHosts: [SANDBOX_HOST], ...(this.deps.sleep ? { sleep: this.deps.sleep } : {}) });
    } catch (e) {
      if (e instanceof ProviderError && (e.code === "NETWORK" || e.code.startsWith("HTTP_5") || e.code === "HTTP_429")) throw new UncertainOutcomeError(`PayPal outcome unknown (${e.code})`);
      throw e;
    }
  }

  // ---- consent (Vault v3) -------------------------------------------------
  async createSetupToken(state: string): Promise<{ setupTokenId: string; approveUrl: string }> {
    const ctx = { return_url: `${this.cfg.returnUrlBase}?state=${encodeURIComponent(state)}`, cancel_url: this.cfg.cancelUrl };
    const paypal = this.cfg.minimalSetup
      ? { usage_type: "MERCHANT", experience_context: ctx }
      : {
          usage_type: "MERCHANT", usage_pattern: "UNSCHEDULED_POSTPAID",
          // Lets the same PayPal buyer approve again even if PayPal already holds an earlier agreement with us (e.g. our copy was lost).
          permit_multiple_payment_tokens: true,
          experience_context: { brand_name: "PantryPilot", shipping_preference: "NO_SHIPPING", vault_instruction: "ON_PAYER_APPROVAL", ...ctx },
        };
    const r = await this.post<any>("/v3/vault/setup-tokens", { payment_source: { paypal } });
    const link = (r?.links ?? []).find((l: any) => ["approve", "payer-action"].includes(l.rel));
    if (!r?.id || !link?.href) throw new ProviderError("BAD_RESPONSE", "PayPal did not return an approval link");
    return { setupTokenId: r.id as string, approveUrl: link.href as string };
  }
  async completeSetup(householdId: string, setupTokenId: string): Promise<void> {
    const r = await this.post<any>("/v3/vault/payment-tokens", { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } });
    if (!r?.id) throw new ProviderError("BAD_RESPONSE", "PayPal did not return a payment token");
    await this.deps.vault.put(householdId, "paypal", { vaultId: r.id, customerId: r.customer?.id ?? null, connectedAt: this.deps.clock.now().toISOString() });
  }
  async disconnect(householdId: string): Promise<void> {
    const cred = await this.deps.vault.get<{ vaultId: string }>(householdId, "paypal");
    if (cred) {
      try { await httpJson(this.deps.fetch, `${this.base}/v3/vault/payment-tokens/${encodeURIComponent(cred.vaultId)}`, { method: "DELETE", headers: { authorization: `Bearer ${await this.token()}` } }, { allowedHosts: [SANDBOX_HOST] }); } catch { /* removing our copy matters most */ }
    }
    await this.deps.vault.delete(householdId, "paypal");
  }
  isConnected(householdId: string) { return this.deps.vault.has(householdId, "paypal"); }

  // ---- hold / capture / void ------------------------------------------------
  async authorize(i: AuthorizeInput): Promise<PaymentResult> {
    const cred = await this.deps.vault.get<{ vaultId: string }>(i.householdId, "paypal");
    if (!cred) return { status: "FAILED", reference: null, failureCode: "NOT_CONNECTED" };
    let order: any;
    try {
      order = await this.post<any>("/v2/checkout/orders", {
        intent: "AUTHORIZE",
        purchase_units: [{ reference_id: i.orderReference, custom_id: i.orderReference, amount: { currency_code: i.currency, value: money(i.amountMinor) } }],
        payment_source: { paypal: { vault_id: cred.vaultId, stored_credential: { payment_initiator: "MERCHANT", usage: "SUBSEQUENT" } } },
      }, i.idempotencyKey);
      if (order?.status === "APPROVED") order = await this.post<any>(`/v2/checkout/orders/${encodeURIComponent(order.id)}/authorize`, {}, `${i.idempotencyKey}:authorize`);
    } catch (e) {
      if (e instanceof ProviderError && e.code.startsWith("HTTP_4")) return reject(e);
      throw e;
    }
    const auth = order?.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (auth?.id && ["CREATED", "PENDING"].includes(auth.status ?? "CREATED")) return { status: "AUTHORIZED", reference: auth.id as string };
    return { status: "FAILED", reference: null, failureCode: order?.status ? `PAYPAL_ORDER_${String(order.status).replace(/[^A-Z_]/g, "")}` : "NOT_AUTHORIZED", detail: `order status ${order?.status ?? "unknown"}, authorization ${auth?.status ?? "none"}` };
  }
  async capture(i: CaptureInput): Promise<PaymentResult> {
    try {
      const r = await this.post<any>(`/v2/payments/authorizations/${encodeURIComponent(i.authorizationRef)}/capture`, { final_capture: true, amount: { currency_code: i.currency, value: money(i.amountMinor) } }, `${i.idempotencyKey}:capture`);
      if (r?.status === "COMPLETED") return { status: "CAPTURED", reference: r.id as string };
      if (r?.status === "PENDING") throw new UncertainOutcomeError("PayPal capture is pending");
      return { status: "FAILED", reference: null, failureCode: "CAPTURE_NOT_COMPLETED" };
    } catch (e) {
      if (e instanceof ProviderError && e.code.startsWith("HTTP_4")) return reject(e);
      throw e;
    }
  }
  async voidAuthorization(i: { idempotencyKey: string; authorizationRef: string }): Promise<PaymentResult> {
    try {
      await this.post(`/v2/payments/authorizations/${encodeURIComponent(i.authorizationRef)}/void`, undefined, `${i.idempotencyKey}:void`);
      return { status: "VOIDED", reference: i.authorizationRef };
    } catch (e) {
      if (e instanceof ProviderError && e.code.startsWith("HTTP_4")) return { status: "FAILED", reference: null, failureCode: "VOID_REJECTED" };
      throw e;
    }
  }
  async getStatus(_key: string, ref?: string | null): Promise<PaymentResult> {
    // PayPal cannot be queried by our request id; without an authorization id we cannot know, so report NOT_FOUND
    // and let the caller decide (re-sending the same PayPal-Request-Id is idempotent).
    if (!ref) return { status: "NOT_FOUND", reference: null };
    const r = await httpJson<any>(this.deps.fetch, `${this.base}/v2/payments/authorizations/${encodeURIComponent(ref)}`, { headers: { authorization: `Bearer ${await this.token()}` } }, { allowedHosts: [SANDBOX_HOST], ...(this.deps.sleep ? { sleep: this.deps.sleep } : {}) });
    const map: Record<string, PaymentResult["status"]> = { CREATED: "AUTHORIZED", PENDING: "AUTHORIZED", CAPTURED: "CAPTURED", PARTIALLY_CAPTURED: "CAPTURED", VOIDED: "VOIDED", DENIED: "FAILED", EXPIRED: "FAILED" };
    return { status: map[r?.status] ?? "FAILED", reference: ref };
  }
  async refund(i: { idempotencyKey: string; captureRef: string; amountMinor: number; currency: "GBP" | "USD" }) {
    const r = await this.post<any>(`/v2/payments/captures/${encodeURIComponent(i.captureRef)}/refund`, { amount: { currency_code: i.currency, value: money(i.amountMinor) } }, `${i.idempotencyKey}:refund`);
    return { refunded: ["COMPLETED", "PENDING"].includes(r?.status) };
  }
}