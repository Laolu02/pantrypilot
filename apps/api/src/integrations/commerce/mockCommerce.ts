import type { Clock } from "../../lib/clock";
import { UncertainOutcomeError } from "../../lib/errors";
import { newId } from "../../lib/ids";
import { MOCK_CATALOG, type CatalogRow } from "./catalog";
import {
  ProviderError, type CatalogEntry, type OrderingAdapter, type CreateOrderInput,
  type ExternalOrder, type ProductSearchQuery, type ProviderOrderStatus,
} from "./commerce";

export type CreateOutcome = "OK" | "TIMEOUT_AFTER_COMMIT" | "TIMEOUT_BEFORE_COMMIT";

/** Simulated retailer. Everything it returns is DEMO/MOCK data. Never touches a network. */
export class MockCommerceAdapter implements OrderingAdapter {
  readonly name = "marketfield-mock";
  readonly label = "Marketfield (mock)";
  readonly mode = "MOCK" as const;
  readonly currency = "GBP" as const;
  readonly capabilities = { search: true, placeOrder: true, cartHandoff: false };
  private rows = new Map<string, CatalogRow>();
  private orders = new Map<string, ExternalOrder>();
  private byRef = new Map<string, string>();
  private outcomes: CreateOutcome[] = [];
  createCalls = 0;

  constructor(private clock: Clock, catalog: CatalogRow[] = MOCK_CATALOG) {
    this.reset(catalog);
  }
  reset(catalog: CatalogRow[] = MOCK_CATALOG) {
    this.rows = new Map(catalog.map((r) => [r.product.id, structuredClone(r)]));
    this.orders.clear(); this.byRef.clear(); this.outcomes = []; this.createCalls = 0;
  }
  // test/demo controls
  setPrice(externalId: string, priceMinor: number) { this.row(externalId).priceMinor = priceMinor; }
  setAvailable(externalId: string, available: boolean) { this.row(externalId).available = available; }
  queueCreateOutcome(o: CreateOutcome) { this.outcomes.push(o); }
  advance(externalOrderId: string, status: ProviderOrderStatus) {
    const o = this.orders.get(externalOrderId);
    if (!o) throw new ProviderError("NOT_FOUND", "Unknown order");
    o.status = status;
  }
  orderCount() { return this.orders.size; }

  private row(id: string) {
    const r = this.rows.get(id);
    if (!r) throw new ProviderError("PRODUCT_NOT_FOUND", `Unknown product ${id}`);
    return r;
  }
  private entry(r: CatalogRow): CatalogEntry {
    return {
      product: structuredClone(r.product),
      offer: {
        id: `${this.name}:${r.product.id}`, productId: r.product.id, provider: this.name,
        externalId: r.product.id, priceMinor: r.priceMinor, currency: "GBP", available: r.available,
        url: `https://mock.marketfield.invalid/p/${r.product.id}`, checkedAt: this.clock.now().toISOString(),
      },
    };
  }
  async searchProducts(q: ProductSearchQuery) {
    const t = q.text?.toLowerCase();
    return [...this.rows.values()]
      .filter((r) => (!q.canonicalKey || r.product.canonicalKey === q.canonicalKey) && (!t || r.product.name.toLowerCase().includes(t)))
      .map((r) => this.entry(r));
  }
  async getProduct(externalId: string) { return this.entry(this.row(externalId)); }
  async checkAvailability(externalId: string) {
    return { available: this.row(externalId).available, checkedAt: this.clock.now().toISOString() };
  }
  getFees(subtotalMinor: number) {
    return { deliveryMinor: subtotalMinor >= 2500 || subtotalMinor === 0 ? 0 : 199, taxMinor: 0 };
  }
  async createOrder(input: CreateOrderInput): Promise<ExternalOrder> {
    this.createCalls++;
    const existingId = this.byRef.get(input.reference);
    if (existingId) return structuredClone(this.orders.get(existingId)!);
    const outcome = this.outcomes.shift() ?? "OK";
    if (outcome === "TIMEOUT_BEFORE_COMMIT") throw new UncertainOutcomeError("Provider timed out (request may not have arrived)");
    // Server-side price check, like a real retailer would do.
    let subtotal = 0;
    for (const l of input.lines) {
      const r = this.row(l.externalId);
      if (!r.available) throw new ProviderError("OUT_OF_STOCK", `${r.product.name} is out of stock`);
      if (r.priceMinor !== l.unitPriceMinor) throw new ProviderError("PRICE_CHANGED", `Price for ${r.product.name} changed`);
      subtotal += r.priceMinor * l.quantity;
    }
    const fees = this.getFees(subtotal);
    if (subtotal + fees.deliveryMinor + fees.taxMinor !== input.totalMinor) throw new ProviderError("TOTAL_MISMATCH", "Order total mismatch");
    const order: ExternalOrder = {
      externalOrderId: newId("mkf"), reference: input.reference, status: "PLACED",
      totalMinor: input.totalMinor, currency: input.currency, lines: structuredClone(input.lines),
    };
    this.orders.set(order.externalOrderId, order);
    this.byRef.set(input.reference, order.externalOrderId);
    if (outcome === "TIMEOUT_AFTER_COMMIT") throw new UncertainOutcomeError("Provider timed out after the order may have been committed");
    return structuredClone(order);
  }
  async getOrder(externalOrderId: string) {
    const o = this.orders.get(externalOrderId);
    if (!o) throw new ProviderError("NOT_FOUND", "Unknown order");
    return structuredClone(o);
  }
  async findByReference(reference: string) {
    const id = this.byRef.get(reference);
    return id ? structuredClone(this.orders.get(id)!) : null;
  }
  async cancelOrder(externalOrderId: string) {
    const o = this.orders.get(externalOrderId);
    if (!o) throw new ProviderError("NOT_FOUND", "Unknown order");
    if (o.status === "DELIVERED") throw new ProviderError("TOO_LATE", "Already delivered");
    o.status = "CANCELLED";
  }
}
