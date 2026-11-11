export interface Forecast { daysOfSupply: number | null; reorderPoint: number; targetQty: number; shortfall: number; needsReplenishment: boolean; status: "OK" | "LOW" | "OUT" | "UNKNOWN"; estimated: boolean }
export interface Item {
  id: string; canonicalKey: string; name: string; quantity: number; unit: "ml" | "g" | "count"; storage: "FRIDGE" | "FREEZER" | "PANTRY";
  expiresAt: string | null; confidence: number; source: "OBSERVED" | "MANUAL" | "ESTIMATED" | "DELIVERED"; observedAt: string;
  forecast: Forecast | null; inboundQty: number; usableQty: number;
}
export interface Reason { code: string; severity: "DENY" | "REVIEW"; message: string }
export interface Decision { decision: "ALLOW" | "DENY" | "REVIEW"; reasons: Reason[]; policyVersion: number }
export interface BasketLine { storeProductId?: string; productId?: string; name: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number; priceCheckedAt: string; canonicalKey: string }
export interface Order {
  id: string; status: string; mock: boolean; provider: string; createdAt: string; externalOrderId: string | null; failureReason: string | null;
  payment?: { provider: string; status: string; mode: "MOCK" | "SANDBOX" | "LIVE" } | null;
  handoff: { links: { label: string; url: string }[]; note: string; preparedAt: string } | null;
  basket: { currency: "GBP" | "USD"; lines: BasketLine[]; subtotalMinor: number; deliveryMinor: number; taxMinor: number; totalMinor: number; reason: string };
  policyDecision: Decision | null; history: { status: string; at: string; note?: string }[];
}
export interface Run { id: string; correlationId: string; state: string; outcome: string | null; summary: string | null; orderId: string | null; startedAt: string; finishedAt: string | null; error: string | null; trigger: { type: string } }
export interface Audit { id: string; action: string; stage: string; outcome: "OK" | "WARN" | "FAIL"; reason?: string; correlationId: string; at: string; seq: number; details: any; actor: string }
export interface Device { id: string; name: string; provider: string; externalId: string; status: "ONLINE" | "STALE" | "OFFLINE"; lastSeenAt: string | null }
export interface Policy {
  version: number; enabled: boolean; mode: "ALWAYS_CONFIRM" | "BOUNDED_AUTONOMY"; killSwitch: boolean; allowlistedProductIds: string[];
  perItemCapMinor: number; perOrderCapMinor: number; weeklyBudgetMinor: number; cooldownHours: number; maxOrdersPerWeek: number; minConfidence: number; maxPriceAgeMinutes: number;
}
export interface Store { name: string; label: string; mode: "MOCK" | "LIVE"; currency: "GBP" | "USD"; capabilities: { search: boolean; placeOrder: boolean; cartHandoff: boolean }; connected?: boolean | null }
export interface Meta { commerce: { name: string; mode: string }; payments: { name: string; label: string; mode: "MOCK" | "SANDBOX" | "LIVE"; requiresConnection: boolean }; devices: { mode: string }; demoControls: boolean; globalKillSwitch: boolean; stores: Store[]; instacart: boolean; anyLive: boolean }
export interface Ingredient { key: string; name: string; allergenDataKnown: boolean; unit: "ml" | "g" | "count"; storage: "FRIDGE" | "FREEZER" | "PANTRY"; shelfLifeDays: number | null }
export interface RecipeIng { canonicalKey: string; name: string; required: number; unit: string; optional: boolean; have: number; missing: number }
export interface Recipe {
  id: string; name: string; cuisine: string; servings: number; steps: string[]; tags: string[]; ingredients: RecipeIng[]; missingIngredients: string[];
  usesExpiringSoon: string[]; feasible: boolean; score: number; explanation: string;
  nutritionPerServing: { kcal: number; proteinG: number; carbsG: number; fatG: number; note: string };
  validation: { status: "PASS" | "REVIEW" | "REJECTED"; violations: { ingredient: string; kind: string; detail: string }[]; unknownAllergenData: string[]; disclaimer: string };
}
export interface CatalogEntry { product: { id: string; name: string; packLabel: string; packSize: number; unit: string; brand: string; category: string }; offer: { provider: string; currency: "GBP" | "USD"; priceMinor: number; available: boolean; checkedAt: string; url: string } }
