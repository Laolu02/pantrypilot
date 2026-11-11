import type { Currency } from "@pantrypilot/contracts";
import type { Basket, BasketLine, Cart, Store } from "../../store/store";
import type { Clock } from "../../lib/clock";
import { newId } from "../../lib/ids";
import { AppError, notFound } from "../../lib/errors";
import type { CatalogEntry } from "../../integrations/commerce/commerce";
import type { CommerceRegistry } from "../../integrations/commerce/registry";

export interface ProductOption {
  provider: string; mode: "MOCK" | "LIVE"; currency: Currency;
  storeProductId: string; productId: string; name: string; packLabel: string; packSize: number; unit: string;
  priceMinor: number; available: boolean; allowlisted: boolean;
  /** false when the size could not be normalised or the currency differs from the household's: shown, never auto-selected. */
  eligible: boolean; ineligibleReason?: string;
  unitPricePer100: number | null; quantityNeeded: number; totalCostMinor: number; overshoot: number; checkedAt: string; url: string;
}

const line = (e: CatalogEntry, quantity: number, currency: Currency): BasketLine => ({
  storeProductId: e.offer.id, productId: e.product.id, canonicalKey: e.product.canonicalKey, name: `${e.product.name} ${e.product.packLabel}`.trim(),
  packLabel: e.product.packLabel, quantity, unitPriceMinor: e.offer.priceMinor, lineTotalMinor: e.offer.priceMinor * quantity,
  priceCheckedAt: e.offer.checkedAt, available: e.offer.available, allergens: e.product.allergens, tags: e.product.tags,
  category: e.product.category, packSize: e.product.packSize, unit: e.product.unit, url: e.offer.url, currency,
});

export class BasketService {
  constructor(private store: Store, private clock: Clock, private registry: CommerceRegistry) {}

  private split(storeProductId: string) {
    const i = storeProductId.indexOf(":");
    return i < 0 ? { provider: "marketfield-mock", externalId: storeProductId } : { provider: storeProductId.slice(0, i), externalId: storeProductId.slice(i + 1) };
  }

  price(provider: string, lines: BasketLine[], reason: string): Basket {
    const a = this.registry.get(provider);
    const subtotalMinor = lines.reduce((s, l) => s + l.lineTotalMinor, 0);
    const fees = a.getFees(subtotalMinor);
    return { provider: a.name, currency: a.currency, reason, lines, subtotalMinor, deliveryMinor: fees.deliveryMinor, taxMinor: fees.taxMinor, totalMinor: subtotalMinor + fees.deliveryMinor + fees.taxMinor };
  }

  providers() {
    return this.registry.list().map((a) => ({ name: a.name, label: a.label, mode: a.mode, currency: a.currency, capabilities: a.capabilities }));
  }
  async search(q: { text?: string; canonicalKey?: string }) { return this.registry.search(q); }

  /** Compare pack sizes across every enabled store. Ranking: eligible, allowlisted, cheapest total to cover the need, least overshoot. */
  async compare(canonicalKey: string, need: number, allowlist: string[], currency: Currency = "GBP") {
    const { entries, errors } = await this.registry.search({ canonicalKey });
    const options: ProductOption[] = entries.map((e) => {
      const a = this.registry.get(e.offer.provider);
      const qty = e.product.packSize > 0 ? Math.max(1, Math.ceil(need / e.product.packSize)) : 1;
      const reason = e.offer.currency !== currency ? `Priced in ${e.offer.currency}, household uses ${currency}` : e.product.packSize <= 0 ? "Pack size could not be read from the catalogue" : undefined;
      return {
        provider: a.name, mode: a.mode, currency: e.offer.currency, storeProductId: e.offer.id, productId: e.product.id, name: e.product.name,
        packLabel: e.product.packLabel, packSize: e.product.packSize, unit: e.product.unit, priceMinor: e.offer.priceMinor, available: e.offer.available,
        allowlisted: allowlist.includes(e.product.id), eligible: !reason, ...(reason ? { ineligibleReason: reason } : {}),
        unitPricePer100: e.product.packSize > 0 ? (e.offer.priceMinor / e.product.packSize) * 100 : null, quantityNeeded: qty,
        totalCostMinor: qty * e.offer.priceMinor, overshoot: e.product.packSize > 0 ? qty * e.product.packSize - need : 0, checkedAt: e.offer.checkedAt, url: e.offer.url,
      };
    }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || Number(b.allowlisted) - Number(a.allowlisted) || a.totalCostMinor - b.totalCostMinor || a.overshoot - b.overshoot);
    return { options, errors };
  }

  /** Server-side pricing from fresh provider data. Client-supplied totals are never trusted. One store per basket. */
  async rebuild(lines: { storeProductId: string; quantity: number; canonicalKey?: string }[], reason: string): Promise<Basket> {
    const providers = new Set(lines.map((l) => this.split(l.storeProductId).provider));
    if (providers.size !== 1) throw new AppError(422, "MIXED_PROVIDERS", "A basket can only contain items from one store");
    const provider = [...providers][0]!;
    const adapter = this.registry.get(provider);
    const built: BasketLine[] = [];
    for (const l of lines) {
      let entry: CatalogEntry;
      try { entry = await adapter.getProduct(this.split(l.storeProductId).externalId); }
      catch { throw new AppError(422, "UNKNOWN_PRODUCT", `Unknown product ${l.storeProductId}`); }
      // Live catalogues do not know our canonical keys; keep the one the plan was built for so duplicate/cooldown checks still match.
      if (l.canonicalKey && entry.product.canonicalKey === "unknown") entry = { ...entry, product: { ...entry.product, canonicalKey: l.canonicalKey } };
      built.push(line(entry, l.quantity, adapter.currency));
    }
    return this.price(provider, built, reason);
  }

  async plan(householdId: string, canonicalKey: string, shortfall: number, allowlist: string[], reason: string): Promise<{ basket: Basket; options: ProductOption[] } | null> {
    const hh = await this.store.households.get(householdId);
    const { options } = await this.compare(canonicalKey, shortfall, allowlist, hh?.currency ?? "GBP");
    const best = options.find((o) => o.available && o.eligible);
    if (!best) return null;
    const basket = await this.rebuild([{ storeProductId: best.storeProductId, quantity: best.quantityNeeded, canonicalKey }], reason);
    return { basket, options };
  }

  async createCart(householdId: string, reason: string, lines: { storeProductId: string; quantity: number }[]): Promise<Cart> {
    const basket = await this.rebuild(lines, reason);
    return this.store.carts.insert({ id: newId("cart"), householdId, basket, createdAt: this.clock.now().toISOString() });
  }
  async getCart(householdId: string, id: string): Promise<Cart> {
    const c = await this.store.carts.get(id);
    if (!c || c.householdId !== householdId) throw notFound("Cart");
    return c;
  }
}
