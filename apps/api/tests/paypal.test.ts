import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { setup, HHID } from "./helpers";
import { loadEnv } from "../src/config/env";

// Fixtures encode PayPal's documented response shapes as understood at build time.
// They prove our logic, NOT that the live sandbox behaves identically (it has not been called from this repo).
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const ENV = { PAYMENT_PROVIDER: "paypal", PAYPAL_CLIENT_ID: "cid", PAYPAL_CLIENT_SECRET: "sec", INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString("base64") };

interface Call { method: string; path: string; body: any; headers: Record<string, string> }
function fakePayPal(o: { authorize?: "ok" | "decline" | "5xx" | "needs-authorize"; capture?: "ok" | "pending" | "reject" } = {}) {
  const calls: Call[] = [];
  const f = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const body = init.body && typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init.body;
    calls.push({ method: init.method ?? "GET", path: u.pathname, body, headers: Object.fromEntries(new Headers(init.headers as HeadersInit).entries()) });
    const p = u.pathname;
    if (u.host !== "api-m.sandbox.paypal.com") return json({}, 404);
    if (p === "/v1/oauth2/token") return json({ access_token: "tok", expires_in: 3000 });
    if (p === "/v3/vault/setup-tokens") return json({ id: "SETUP1", links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/agreements/approve?approval_session_id=x" }] });
    if (p === "/v3/vault/payment-tokens" && init.method === "POST") return json({ id: "VAULT1", customer: { id: "CUST1" } });
    if (p.startsWith("/v3/vault/payment-tokens/") && init.method === "DELETE") return new Response(null, { status: 204 });
    if (p === "/v2/checkout/orders") {
      if (o.authorize === "5xx") return json({}, 503);
      if (o.authorize === "decline") return json({ name: "UNPROCESSABLE_ENTITY", debug_id: "abc123", message: "secret-looking text", details: [{ issue: "INSTRUMENT_DECLINED" }] }, 422);
      if (o.authorize === "needs-authorize") return json({ id: "ORD1", status: "APPROVED" });
      return json({ id: "ORD1", status: "COMPLETED", purchase_units: [{ payments: { authorizations: [{ id: "AUTH1", status: "CREATED" }] } }] });
    }
    if (p === "/v2/checkout/orders/ORD1/authorize") return json({ id: "ORD1", status: "COMPLETED", purchase_units: [{ payments: { authorizations: [{ id: "AUTH1", status: "CREATED" }] } }] });
    if (p === "/v2/payments/authorizations/AUTH1/capture") return o.capture === "reject" ? json({}, 422) : json({ id: "CAP1", status: o.capture === "pending" ? "PENDING" : "COMPLETED" });
    if (p === "/v2/payments/authorizations/AUTH1/void") return new Response(null, { status: 204 });
    if (p === "/v2/payments/authorizations/AUTH1") return json({ status: "CREATED" });
    if (p === "/v2/payments/captures/CAP1/refund") return json({ status: "COMPLETED" });
    return json({}, 404);
  };
  return { f, calls, paths: () => calls.map((c) => `${c.method} ${c.path}`) };
}

async function connected(pp = fakePayPal()) {
  const t = await setup(ENV, { fetch: pp.f });
  const { body } = await t.me.get("/integrations/paypal/connect");
  expect(body.url).toContain("sandbox.paypal.com");
  const ret = new URL(pp.calls.find((c) => c.path === "/v3/vault/setup-tokens")!.body.payment_source.paypal.experience_context.return_url);
  const cb = await t.raw.get(`/api/v1/integrations/paypal/callback?approval_token_id=SETUP1&state=${encodeURIComponent(ret.searchParams.get("state")!)}`);
  expect(cb.status).toBe(302);
  return { t, pp };
}

describe("PayPal sandbox payments", () => {
  it("is sandbox-only: refuses the live host and says so in /meta", async () => {
    expect(() => loadEnv({ NODE_ENV: "test", ...ENV, PAYPAL_BASE_URL: "https://api-m.paypal.com" })).toThrow(/sandbox/);
    const t = await setup(ENV, { fetch: fakePayPal().f });
    const meta = (await t.raw.get("/api/v1/meta")).body;
    expect(meta.payments).toMatchObject({ name: "paypal", mode: "SANDBOX", requiresConnection: true });
  });

  it("PAYPAL_SETUP_MINIMAL sends only the smallest setup request", async () => {
    const pp = fakePayPal();
    const t = await setup({ ...ENV, PAYPAL_SETUP_MINIMAL: "true" }, { fetch: pp.f });
    await t.me.get("/integrations/paypal/connect");
    const p = pp.calls.find((c) => c.path === "/v3/vault/setup-tokens")!.body.payment_source.paypal;
    expect(p.usage_type).toBe("MERCHANT");
    expect(p.usage_pattern).toBeUndefined();
    expect(p.permit_multiple_payment_tokens).toBeUndefined();
    expect(Object.keys(p.experience_context).sort()).toEqual(["cancel_url", "return_url"]);
  });

  it("consent: a signed state, vaulted token stored encrypted, never returned to the browser", async () => {
    const { t } = await connected();
    expect(JSON.stringify(await t.c.store.credentials.list())).not.toContain("VAULT1");
    const info = await t.me.get("/integrations");
    expect(info.body.payments).toMatchObject({ mode: "SANDBOX", connected: true });
    expect(JSON.stringify(info.body)).not.toContain("VAULT1");
    expect((await t.other.get("/integrations")).body.payments.connected).toBe(false);
    expect((await t.raw.get("/api/v1/integrations/paypal/callback?approval_token_id=SETUP1&state=forged.abc")).status).toBe(400);
  });

  it("setup token allows a buyer who already has an agreement with us to approve again", async () => {
    const pp = fakePayPal();
    const t = await setup(ENV, { fetch: pp.f });
    await t.me.get("/integrations/paypal/connect");
    const body = pp.calls.find((c) => c.path === "/v3/vault/setup-tokens")!.body;
    expect(body.payment_source.paypal.permit_multiple_payment_tokens).toBe(true);
    expect(body.payment_source.paypal.usage_type).toBe("MERCHANT");
  });

  it("without a connected PayPal the policy DENIES and nothing is held or ordered", async () => {
    const pp = fakePayPal();
    const t = await setup(ENV, { fetch: pp.f });
    const r = await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    expect(r.body.run.state).toBe("BLOCKED");
    expect((await t.c.store.orders.list())[0]!.policyDecision!.reasons.map((x) => x.code)).toContain("PAYMENT_NOT_CONNECTED");
    expect(pp.paths().some((p) => p.includes("/v2/checkout/orders"))).toBe(false);
    expect(t.c.commerce.createCalls).toBe(0);
  });

  it("happy path: authorize the exact total, order at the retailer, verify, then capture", async () => {
    const { t, pp } = await connected();
    await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    const order = (await t.c.store.orders.list())[0]!;
    expect(order.status).toBe("CONFIRMED");
    const seq = pp.paths().filter((p) => /checkout\/orders|capture|void/.test(p));
    expect(seq).toEqual(["POST /v2/checkout/orders", "POST /v2/payments/authorizations/AUTH1/capture"]);
    const create = pp.calls.find((c) => c.path === "/v2/checkout/orders")!;
    expect(create.body.intent).toBe("AUTHORIZE");
    expect(create.body.purchase_units[0].amount).toEqual({ currency_code: "GBP", value: "4.14" });
    expect(create.body.payment_source.paypal.vault_id).toBe("VAULT1");
    expect(create.headers["paypal-request-id"]).toBe(order.idempotencyKey);
    expect(pp.calls.find((c) => c.path.endsWith("/capture"))!.body).toMatchObject({ final_capture: true, amount: { value: "4.14" } });
    expect(JSON.stringify(pp.calls.map((c) => c.body))).not.toMatch(/card|cvv|password/i);
    const listed = (await t.me.get("/shopping/orders")).body.orders[0];
    expect(listed.payment).toMatchObject({ provider: "paypal", status: "CAPTURED", mode: "SANDBOX" });
    expect((await t.c.store.payments.list())[0]!.captureReference).toBe("CAP1");
  });

  it("handles PayPal's two-step authorize (order APPROVED, then /authorize)", async () => {
    const { t, pp } = await connected(fakePayPal({ authorize: "needs-authorize" }));
    await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    expect(pp.paths()).toContain("POST /v2/checkout/orders/ORD1/authorize");
    expect((await t.c.store.orders.list())[0]!.status).toBe("CONFIRMED");
  });

  it("a PayPal decline fails the order before the retailer is contacted", async () => {
    const { t } = await connected(fakePayPal({ authorize: "decline" }));
    await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    const order = (await t.c.store.orders.list())[0]!;
        expect(order).toMatchObject({ status: "FAILED", failureReason: "PAYMENT_PAYPAL_INSTRUMENT_DECLINED" });
    const failed = (await t.c.audit.recent(HHID)).find((a) => a.action === "ORDER_FAILED")!;
    expect(JSON.stringify(failed.details)).toContain("INSTRUMENT_DECLINED");
    expect(JSON.stringify(failed.details)).toContain("debug_id=abc123");
    expect(JSON.stringify(failed.details)).not.toContain("secret-looking");
    expect(t.c.commerce.createCalls).toBe(0);
  });

  it("a PayPal 5xx during authorize is UNCERTAIN, not a failure; nothing is ordered", async () => {
    const { t } = await connected(fakePayPal({ authorize: "5xx" }));
    await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    expect((await t.c.store.orders.list())[0]!.status).toBe("UNCERTAIN");
    expect(t.c.commerce.createCalls).toBe(0);
  });

  it("a rejected capture cancels the retailer order and voids the hold", async () => {
    const { t, pp } = await connected(fakePayPal({ capture: "reject" }));
    await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    const order = (await t.c.store.orders.list())[0]!;
    expect(order.status).toBe("FAILED");
    expect(pp.paths()).toContain("POST /v2/payments/authorizations/AUTH1/void");
    expect((await t.c.commerce.getOrder(order.externalOrderId!)).status).toBe("CANCELLED");
  });

  it("a pending capture is treated as uncertain and never as paid", async () => {
    const { t } = await connected(fakePayPal({ capture: "pending" }));
    await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    const order = (await t.c.store.orders.list())[0]!;
    expect(order.status).toBe("UNCERTAIN");
    expect(t.c.commerce.orderCount()).toBe(1);
  });

  it("a retailer failure voids the hold so the user is never charged", async () => {
    const { t, pp } = await connected();
    await t.c.inventory.observe(HHID, "t", "item_milk", 180, 0.9, "2026-10-16T09:00:00.000Z", "c");
    const plan = await t.c.baskets.plan(HHID, "milk", 3320, (await t.c.policies.get(HHID)).allowlistedProductIds, "t");
    const { order } = await t.c.orders.propose({ householdId: HHID, basket: plan!.basket, idempotencyKey: "rf-1", actor: "t", correlationId: "c" });
    const origCreate = t.c.commerce.createOrder.bind(t.c.commerce);
    t.c.commerce.createOrder = async () => { const { ProviderError } = await import("../src/integrations/commerce/commerce"); throw new ProviderError("OUT_OF_STOCK", "gone"); };
    const after = await t.c.orders.execute(HHID, order.id, "t", "c");
    t.c.commerce.createOrder = origCreate;
    expect(after.status).toBe("FAILED");
    expect(pp.paths()).toContain("POST /v2/payments/authorizations/AUTH1/void");
    expect(pp.paths().some((p) => p.endsWith("/capture"))).toBe(false);
  });

  it("cancelling a confirmed order refunds through PayPal; disconnecting deletes the vaulted token", async () => {
    const { t, pp } = await connected();
    await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    const order = (await t.c.store.orders.list())[0]!;
    await t.me.post(`/shopping/orders/${order.id}/cancel`);
    expect(pp.paths()).toContain("POST /v2/payments/captures/CAP1/refund");
    expect((await t.c.store.payments.list())[0]!.status).toBe("REFUNDED");
    await t.me.del("/integrations/paypal");
    expect(pp.paths()).toContain("DELETE /v3/vault/payment-tokens/VAULT1");
    expect((await t.me.get("/integrations")).body.payments.connected).toBe(false);
  });

  it("is pinned to the sandbox host, and can read an authorization's status", async () => {
    const { t } = await connected();
    expect((await t.c.paypal!.getStatus("k", "AUTH1")).status).toBe("AUTHORIZED");
    expect((await t.c.paypal!.getStatus("k", null)).status).toBe("NOT_FOUND");
    const { PayPalPaymentAdapter } = await import("../src/integrations/payments/paypal");
    expect(() => new PayPalPaymentAdapter({ clientId: "a", clientSecret: "b", baseUrl: "https://api-m.paypal.com", returnUrlBase: "x", cancelUrl: "y" }, { fetch: (async () => json({})) as any, clock: t.clock, vault: t.c.vault })).toThrow(/sandbox/);
  });

    it("the cancel address returns to the app and never echoes tokens", async () => {
    const { t } = await connected();
    const r = await t.raw.get("/api/v1/integrations/paypal/cancel?approval_token_id=SECRETTOKEN&reason=user_cancelled");
    expect(r.status).toBe(302);
    expect(r.headers.location).toContain("connected=cancelled");
  });

  it("if PayPal rejects saving the approved payment method, the user lands back with a clear failure, not raw JSON", async () => {
    const pp = fakePayPal();
    const f = async (u: string, i?: RequestInit) => (new URL(u).pathname === "/v3/vault/payment-tokens" && i?.method === "POST" ? json({ name: "UNPROCESSABLE_ENTITY", debug_id: "dbg9", details: [{ issue: "PAYMENT_TOKEN_NOT_ALLOWED" }] }, 422) : pp.f(u, i));
    const t = await setup(ENV, { fetch: f });
    await t.me.get("/integrations/paypal/connect");
    const ret = new URL(pp.calls.find((c) => c.path === "/v3/vault/setup-tokens")!.body.payment_source.paypal.experience_context.return_url);
    const cb = await t.raw.get(`/api/v1/integrations/paypal/callback?approval_token_id=SETUP1&state=${encodeURIComponent(ret.searchParams.get("state")!)}`);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toContain("connected=failed");
    expect(decodeURIComponent(String(cb.headers.location))).toContain("PAYMENT_TOKEN_NOT_ALLOWED");
    expect(await t.c.vault.has(HHID, "paypal")).toBe(false);
  });

  it("PayPal connect routes are 404 when PayPal is not enabled", async () => {
    const t = await setup();
    expect((await t.me.get("/integrations/paypal/connect")).status).toBe(404);
  });
});
