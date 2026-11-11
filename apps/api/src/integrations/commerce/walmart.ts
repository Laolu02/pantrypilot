import { createSign } from "node:crypto";
import type { Clock } from "../../lib/clock";
import { httpJson, type FetchLike } from "../http";
import { ProviderError, type CatalogEntry, type CommerceAdapter, type HandoffInput, type HandoffResult, type ProductSearchQuery } from "./commerce";
import { parsePackSize } from "./packSize";
import { matchesTerm, termFor } from "./searchTerms";

export interface WalmartConfig { consumerId: string; keyVersion: string; privateKeyPem: string; baseUrl?: string }
const HOSTS = ["developer.api.walmart.com"];

/**
 * Walmart.io Affiliate (catalogue) API. CATALOGUE ONLY. Walmart documents no consumer checkout or
 * ordering API, so this adapter reads prices and hands the owner product links; it never buys.
 * Endpoint paths and field names are from memory of Walmart's affiliate docs and have NOT been
 * exercised live from this repo. Access requires an approved Walmart.io affiliate account.
 */
export class WalmartAdapter implements CommerceAdapter {
  readonly name = "walmart";
  readonly label = "Walmart";
  readonly mode = "LIVE" as const;
  readonly currency = "USD" as const;
  readonly capabilities = { search: true, placeOrder: false, cartHandoff: true };
  private base: string;
  constructor(private cfg: WalmartConfig, private deps: { fetch: FetchLike; clock: Clock; sleep?: (ms: number) => Promise<void> }) {
    this.base = cfg.baseUrl ?? "https://developer.api.walmart.com/api-proxy/service/affil/product/v2";
  }
  /** RSA-SHA256 signature over "consumerId\ntimestamp\nkeyVersion\n", base64. */
  private headers() {
    const ts = String(this.deps.clock.now().getTime());
    const sig = createSign("RSA-SHA256").update(`${this.cfg.consumerId}\n${ts}\n${this.cfg.keyVersion}\n`).sign(this.cfg.privateKeyPem, "base64");
    return { "WM_CONSUMER.ID": this.cfg.consumerId, "WM_CONSUMER.INTIMESTAMP": ts, "WM_SEC.KEY_VERSION": this.cfg.keyVersion, "WM_SEC.AUTH_SIGNATURE": sig, accept: "application/json" };
  }
  private get<T>(path: string) {
    return httpJson<T>(this.deps.fetch, `${this.base}${path}`, { headers: this.headers() }, { allowedHosts: HOSTS, ...(this.deps.sleep ? { sleep: this.deps.sleep } : {}) });
  }
  private toEntry(p: any, canonicalKey?: string): CatalogEntry | null {
    const price = p?.salePrice ?? p?.msrp;
    if (!p?.itemId || typeof price !== "number") return null;
    const size = parsePackSize(p.size) ?? parsePackSize(p.name);
    return {
      product: { id: `walmart_${p.itemId}`, canonicalKey: canonicalKey ?? "unknown", name: p.name ?? "Walmart item", brand: p.brandName ?? "Walmart", category: p.categoryPath ?? "grocery", packSize: size?.packSize ?? 0, unit: size?.unit ?? "count", packLabel: p.size ?? size ? `${size?.packSize} ${size?.unit}` : "size unknown", allergens: null, tags: [] },
      offer: { id: `walmart:${p.itemId}`, productId: `walmart_${p.itemId}`, provider: "walmart", externalId: String(p.itemId), priceMinor: Math.round(price * 100), currency: "USD", available: p.availableOnline !== false && p.stock !== "Not available", url: p.productUrl ?? `https://www.walmart.com/ip/${p.itemId}`, checkedAt: this.deps.clock.now().toISOString() },
    };
  }
  async searchProducts(q: ProductSearchQuery): Promise<CatalogEntry[]> {
    const term = termFor(q);
    if (!term) return [];
    const r = await this.get<any>(`/search?${new URLSearchParams({ query: term, numItems: "12" })}`);
    return (r?.items ?? []).filter((p: any) => matchesTerm(p.name ?? "", q.canonicalKey)).map((p: any) => this.toEntry(p, q.canonicalKey)).filter(Boolean) as CatalogEntry[];
  }
  async getProduct(externalId: string): Promise<CatalogEntry> {
    const r = await this.get<any>(`/items?${new URLSearchParams({ ids: externalId })}`);
    const e = r?.items?.[0] ? this.toEntry(r.items[0]) : null;
    if (!e) throw new ProviderError("PRODUCT_NOT_FOUND", `Walmart item ${externalId} unavailable`);
    return e;
  }
  async checkAvailability(id: string) { const e = await this.getProduct(id); return { available: e.offer.available, checkedAt: e.offer.checkedAt }; }
  getFees() { return { deliveryMinor: 0, taxMinor: 0 }; }
  /** No cart API: hand the owner the product pages. */
  async prepareHandoff(input: HandoffInput): Promise<HandoffResult> {
    return {
      reference: input.reference,
      links: input.lines.map((l) => ({ label: `${l.name} × ${l.quantity}`, url: l.url ?? `https://www.walmart.com/ip/${l.externalId}` })),
      note: "Walmart has no ordering API. Open each item on walmart.com, add it to your cart and check out there. Fees and tax are added by Walmart. Nothing has been bought.",
    };
  }
}
