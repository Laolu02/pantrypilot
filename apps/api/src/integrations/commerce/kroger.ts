import type { Clock } from "../../lib/clock";
import { httpJson, type FetchLike } from "../http";
import { CredentialVault } from "../../modules/shopping/credentialVault";
import { ProviderError, type CatalogEntry, type CommerceAdapter, type HandoffInput, type HandoffResult, type ProductSearchQuery } from "./commerce";
import { parsePackSize } from "./packSize";
import { matchesTerm, termFor } from "./searchTerms";

export interface KrogerConfig { clientId: string; clientSecret: string; locationId: string; redirectUri: string; baseUrl?: string }
const HOSTS = ["api.kroger.com"];
const SCOPES = "product.compact cart.basic:write";

/**
 * Kroger Public API. Product search and add-to-cart only: there is NO checkout endpoint, so this
 * adapter can prepare a cart but the owner must complete the purchase in Kroger's own app/site.
 * Request/response shapes follow Kroger's public docs as understood at build time and have NOT been
 * exercised against the live API from this repo (see context.md).
 */
export class KrogerAdapter implements CommerceAdapter {
  readonly name = "kroger";
  readonly label = "Kroger";
  readonly mode = "LIVE" as const;
  readonly currency = "USD" as const;
  readonly capabilities = { search: true, placeOrder: false, cartHandoff: true };
  private base: string;
  private app: { token: string; exp: number } | null = null;

  constructor(private cfg: KrogerConfig, private deps: { fetch: FetchLike; clock: Clock; vault: CredentialVault; sleep?: (ms: number) => Promise<void> }) {
    this.base = cfg.baseUrl ?? "https://api.kroger.com/v1";
  }
  private http<T>(url: string, init: RequestInit = {}) {
    return httpJson<T>(this.deps.fetch, url, init, { allowedHosts: HOSTS, ...(this.deps.sleep ? { sleep: this.deps.sleep } : {}) });
  }
  private basic() { return "Basic " + Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64"); }

  private async appToken(): Promise<string> {
    const now = this.deps.clock.now().getTime();
    if (this.app && this.app.exp > now + 30_000) return this.app.token;
    const r = await this.http<any>(`${this.base}/connect/oauth2/token`, {
      method: "POST", headers: { authorization: this.basic(), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "product.compact" }),
    });
    if (!r?.access_token) throw new ProviderError("AUTH", "Kroger did not return an access token");
    this.app = { token: r.access_token, exp: now + (r.expires_in ?? 1800) * 1000 };
    return this.app.token;
  }

  authorizeUrl(state: string) {
    const q = new URLSearchParams({ scope: SCOPES, response_type: "code", client_id: this.cfg.clientId, redirect_uri: this.cfg.redirectUri, state });
    return `${this.base}/connect/oauth2/authorize?${q}`;
  }
  async exchangeCode(householdId: string, code: string) {
    const r = await this.http<any>(`${this.base}/connect/oauth2/token`, {
      method: "POST", headers: { authorization: this.basic(), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: this.cfg.redirectUri }),
    });
    if (!r?.access_token || !r.refresh_token) throw new ProviderError("AUTH", "Kroger did not return user tokens");
    await this.deps.vault.put(householdId, "kroger", { accessToken: r.access_token, refreshToken: r.refresh_token, exp: this.deps.clock.now().getTime() + (r.expires_in ?? 1800) * 1000 });
  }
  private async userToken(householdId: string): Promise<string> {
    const cred = await this.deps.vault.get<{ accessToken: string; refreshToken: string; exp: number }>(householdId, "kroger");
    if (!cred) throw new ProviderError("NOT_CONNECTED", "Connect your Kroger account first");
    if (cred.exp > this.deps.clock.now().getTime() + 30_000) return cred.accessToken;
    const r = await this.http<any>(`${this.base}/connect/oauth2/token`, {
      method: "POST", headers: { authorization: this.basic(), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: cred.refreshToken }),
    });
    if (!r?.access_token) throw new ProviderError("AUTH", "Kroger refresh failed; reconnect your account");
    await this.deps.vault.put(householdId, "kroger", { accessToken: r.access_token, refreshToken: r.refresh_token ?? cred.refreshToken, exp: this.deps.clock.now().getTime() + (r.expires_in ?? 1800) * 1000 });
    return r.access_token;
  }

  private toEntry(p: any, canonicalKey?: string): CatalogEntry | null {
    const item = p?.items?.[0];
    const price = item?.price?.promo > 0 ? item.price.promo : item?.price?.regular;
    const upc = p?.upc ?? p?.productId;
    if (!upc || typeof price !== "number") return null;
    const size = parsePackSize(item?.size);
    const oos = item?.inventory?.stockLevel === "TEMPORARILY_OUT_OF_STOCK";
    return {
      product: {
        id: `kroger_${upc}`, canonicalKey: canonicalKey ?? "unknown", name: p.description ?? "Kroger item", brand: p.brand ?? "Kroger",
        category: p.categories?.[0] ?? "grocery", packSize: size?.packSize ?? 0, unit: size?.unit ?? "count", packLabel: item?.size ?? "size unknown",
        allergens: null, // the public catalogue gives no reliable allergen data: fail closed to REVIEW
        tags: [],
      },
      offer: {
        id: `kroger:${upc}`, productId: `kroger_${upc}`, provider: "kroger", externalId: upc, priceMinor: Math.round(price * 100), currency: "USD",
        available: !oos && !!(item?.fulfillment?.curbside || item?.fulfillment?.delivery || item?.fulfillment?.inStore),
        url: `https://www.kroger.com/p/${encodeURIComponent(p.description ?? "item")}/${upc}`, checkedAt: this.deps.clock.now().toISOString(),
      },
    };
  }
  async searchProducts(q: ProductSearchQuery): Promise<CatalogEntry[]> {
    const term = termFor(q);
    if (!term) return [];
    const params = new URLSearchParams({ "filter.term": term, "filter.locationId": this.cfg.locationId, "filter.limit": "12" });
    const r = await this.http<any>(`${this.base}/products?${params}`, { headers: { authorization: `Bearer ${await this.appToken()}`, accept: "application/json" } });
    return (r?.data ?? []).filter((p: any) => matchesTerm(p.description ?? "", q.canonicalKey)).map((p: any) => this.toEntry(p, q.canonicalKey)).filter(Boolean) as CatalogEntry[];
  }
  async getProduct(externalId: string): Promise<CatalogEntry> {
    const params = new URLSearchParams({ "filter.locationId": this.cfg.locationId });
    const r = await this.http<any>(`${this.base}/products/${encodeURIComponent(externalId)}?${params}`, { headers: { authorization: `Bearer ${await this.appToken()}`, accept: "application/json" } });
    const e = r?.data ? this.toEntry(r.data) : null;
    if (!e) throw new ProviderError("PRODUCT_NOT_FOUND", `Kroger product ${externalId} unavailable`);
    return e;
  }
  async checkAvailability(externalId: string) { const e = await this.getProduct(externalId); return { available: e.offer.available, checkedAt: e.offer.checkedAt }; }
  /** Kroger fees and tax are applied at its own checkout and are not exposed by the public API. */
  getFees() { return { deliveryMinor: 0, taxMinor: 0 }; }

  async prepareHandoff(input: HandoffInput): Promise<HandoffResult> {
    const token = await this.userToken(input.householdId);
    await this.http(`${this.base}/cart/add`, {
      method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ items: input.lines.map((l) => ({ upc: l.externalId, quantity: l.quantity, modality: "PICKUP" })) }),
    });
    return { reference: input.reference, links: [{ label: "Review and check out at Kroger", url: "https://www.kroger.com/cart" }], note: "Items were added to your Kroger cart. Kroger's API has no checkout, so fees, tax and payment happen on kroger.com or the app. Nothing has been bought." };
  }
}
