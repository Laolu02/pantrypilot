import type { Product, StoreProduct, Currency } from "@pantrypilot/contracts";

export interface CatalogEntry { product: Product; offer: StoreProduct }
export interface ProductSearchQuery { text?: string; canonicalKey?: string }
export type ProviderOrderStatus = "PLACED" | "CONFIRMED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED";
export interface CreateOrderInput {
  /** Our idempotency key. Providers must return the same order for a repeated reference. */
  reference: string;
  currency: Currency;
  lines: { externalId: string; quantity: number; unitPriceMinor: number }[];
  totalMinor: number;
}
export interface ExternalOrder {
  externalOrderId: string; reference: string; status: ProviderOrderStatus;
  totalMinor: number; currency: Currency; lines: CreateOrderInput["lines"];
}
export class ProviderError extends Error {
  /** Sanitised provider reason (name/issue/debug id only; never bodies, tokens or headers). */
  constructor(public code: string, message: string, public detail?: { name?: string; issue?: string; debugId?: string }) { super(message); }
}

/** What a provider genuinely supports. Never claim more than its API grants. */
export interface Capabilities {
  search: boolean;
  /** Can an API call place AND pay for an order with no human step? Almost no public retailer API can. */
  placeOrder: boolean;
  /** Can we prepare a cart / list for the owner to finish checkout? */
  cartHandoff: boolean;
}
export interface HandoffInput {
  householdId: string;
  reference: string;
  lines: { externalId: string; name: string; quantity: number; unitPriceMinor: number; url?: string }[];
}
export interface HandoffResult { reference: string; links: { label: string; url: string }[]; note: string }

/** Read side + fees + capability flags. Every provider implements this. */
export interface CommerceAdapter {
  readonly name: string;
  readonly label: string;
  readonly mode: "MOCK" | "LIVE";
  readonly currency: Currency;
  readonly capabilities: Capabilities;
  searchProducts(q: ProductSearchQuery): Promise<CatalogEntry[]>;
  getProduct(externalId: string): Promise<CatalogEntry>;
  checkAvailability(externalId: string): Promise<{ available: boolean; checkedAt: string }>;
  getFees(subtotalMinor: number): { deliveryMinor: number; taxMinor: number };
  /** Providers without placeOrder prepare a cart/list instead. Moves no money. */
  prepareHandoff?(input: HandoffInput): Promise<HandoffResult>;
}
/** Only providers whose API can really place an order implement this. */
export interface OrderingAdapter extends CommerceAdapter {
  createOrder(input: CreateOrderInput): Promise<ExternalOrder>;
  getOrder(externalOrderId: string): Promise<ExternalOrder>;
  findByReference(reference: string): Promise<ExternalOrder | null>;
  cancelOrder?(externalOrderId: string): Promise<void>;
}
