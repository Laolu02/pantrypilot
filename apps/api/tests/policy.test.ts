import { describe, expect, it } from "vitest";
import type { PurchasePolicy } from "@pantrypilot/contracts";
import { evaluatePolicy, type PolicyContext } from "../src/modules/shopping/policyEngine";
import type { Basket } from "../src/store/store";

const now = new Date("2026-10-16T09:00:00.000Z");
const policy: PurchasePolicy = {
  householdId: "h", version: 3, enabled: true, mode: "BOUNDED_AUTONOMY", killSwitch: false,
  allowlistedProductIds: ["p_milk_6pt"], allowlistedCategories: [], perItemCapMinor: 1500, perOrderCapMinor: 2500,
  weeklyBudgetMinor: 4000, currency: "GBP", cooldownHours: 24, maxOrdersPerWeek: 3, minConfidence: 0.6, maxPriceAgeMinutes: 60,
};
const basket = (over: Partial<Basket["lines"][number]> = {}, totalMinor = 414): Basket => ({
  provider: "mock", currency: "GBP", reason: "t", subtotalMinor: 215, deliveryMinor: 199, taxMinor: 0, totalMinor,
  lines: [{ storeProductId: "mock:p_milk_6pt", productId: "p_milk_6pt", canonicalKey: "milk", name: "Milk", packLabel: "6pt", quantity: 1, unitPriceMinor: 215, lineTotalMinor: 215, priceCheckedAt: now.toISOString(), available: true, allergens: ["milk"], tags: ["dairy"], category: "dairy_staples", packSize: 3408, unit: "ml", ...over }],
});
const ctx = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  policy, globalKillSwitch: false, autonomyGloballyEnabled: true, basket: basket(),
  household: { currency: "GBP", allergies: ["peanut"], dietaryRestrictions: [] },
  inventoryConfidence: { milk: 0.9 }, orders: [], now, ...over,
});
const codes = (c: PolicyContext) => evaluatePolicy(c).reasons.map((r) => r.code);
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600000).toISOString();

describe("purchase policy engine", () => {
  it("ALLOWs a clean, allowlisted, in-budget basket and records the policy version", () => {
    const d = evaluatePolicy(ctx());
    expect(d.decision).toBe("ALLOW");
    expect(d.reasons).toEqual([]);
    expect(d.policyVersion).toBe(3);
  });
  it("DENYs a product that is not allowlisted", () => expect(codes(ctx({ policy: { ...policy, allowlistedProductIds: [] } }))).toContain("PRODUCT_NOT_ALLOWLISTED"));
  it("allows an explicitly allowlisted category", () => expect(evaluatePolicy(ctx({ policy: { ...policy, allowlistedProductIds: [], allowlistedCategories: ["dairy_staples"] } })).decision).toBe("ALLOW"));
  it("DENYs unavailable products", () => expect(codes(ctx({ basket: basket({ available: false }) }))).toContain("PRODUCT_UNAVAILABLE"));
  it("DENYs invalid quantities", () => expect(codes(ctx({ basket: basket({ quantity: 0 }) }))).toContain("QUANTITY_INVALID"));
  it("enforces the per-item cap", () => expect(codes(ctx({ basket: basket({ unitPriceMinor: 1501 }) }))).toContain("ITEM_PRICE_CAP_EXCEEDED"));
  it("enforces the order cap including delivery fees", () => {
    expect(codes(ctx({ basket: basket({}, 2501) }))).toContain("ORDER_CAP_EXCEEDED");
    expect(codes(ctx({ basket: basket({}, 2500) }))).not.toContain("ORDER_CAP_EXCEEDED");
  });
  it("enforces the weekly budget including committed orders but not failed ones", () => {
    const committed = { id: "o1", status: "CONFIRMED" as const, totalMinor: 3700, createdAt: hoursAgo(30), canonicalKeys: ["eggs"] };
    expect(codes(ctx({ orders: [committed] }))).toContain("WEEKLY_BUDGET_EXCEEDED");
    expect(codes(ctx({ orders: [{ ...committed, status: "FAILED" as const }] }))).not.toContain("WEEKLY_BUDGET_EXCEEDED");
    expect(codes(ctx({ orders: [{ ...committed, createdAt: hoursAgo(24 * 8) }] }))).not.toContain("WEEKLY_BUDGET_EXCEEDED");
  });
  it("DENYs when an equivalent order is already in flight", () =>
    expect(codes(ctx({ orders: [{ id: "o1", status: "IN_TRANSIT", totalMinor: 400, createdAt: hoursAgo(2), canonicalKeys: ["milk"] }] }))).toContain("DUPLICATE_PENDING_ORDER"));
  it("ignores the order being evaluated (excludeOrderId)", () =>
    expect(codes(ctx({ excludeOrderId: "o1", orders: [{ id: "o1", status: "PROPOSED", totalMinor: 414, createdAt: hoursAgo(0), canonicalKeys: ["milk"] }] }))).toEqual([]));
  it("applies the cooldown to the same item only", () => {
    const o = { id: "o1", status: "DELIVERED" as const, totalMinor: 400, createdAt: hoursAgo(5), canonicalKeys: ["milk"] };
    expect(codes(ctx({ orders: [o] }))).toContain("COOLDOWN_ACTIVE");
    expect(codes(ctx({ orders: [{ ...o, canonicalKeys: ["eggs"] }] }))).not.toContain("COOLDOWN_ACTIVE");
    expect(codes(ctx({ orders: [{ ...o, createdAt: hoursAgo(25) }] }))).not.toContain("COOLDOWN_ACTIVE");
  });
  it("enforces max order frequency", () => {
    const orders = [1, 2, 3].map((i) => ({ id: `o${i}`, status: "DELIVERED" as const, totalMinor: 100, createdAt: hoursAgo(30 + i), canonicalKeys: ["x" + i] }));
    expect(codes(ctx({ orders }))).toContain("ORDER_FREQUENCY_EXCEEDED");
  });
  it("sends low inventory confidence to REVIEW, and unknown confidence too", () => {
    expect(evaluatePolicy(ctx({ inventoryConfidence: { milk: 0.4 } })).decision).toBe("REVIEW");
    expect(codes(ctx({ inventoryConfidence: {} }))).toContain("LOW_INVENTORY_CONFIDENCE");
  });
  it("sends stale prices to REVIEW", () => {
    const d = evaluatePolicy(ctx({ basket: basket({ priceCheckedAt: new Date(now.getTime() - 61 * 60000).toISOString() }) }));
    expect(d.decision).toBe("REVIEW");
    expect(d.reasons[0]?.code).toBe("STALE_PRICE");
  });
  it("DENYs allergen violations and fails closed to REVIEW on unknown allergen data", () => {
    expect(evaluatePolicy(ctx({ household: { currency: "GBP", allergies: ["milk"], dietaryRestrictions: [] } })).decision).toBe("DENY");
    expect(evaluatePolicy(ctx({ basket: basket({ allergens: null }) })).decision).toBe("REVIEW");
  });
  it("DENYs dietary violations", () =>
    expect(codes(ctx({ household: { currency: "GBP", allergies: [], dietaryRestrictions: ["vegan"] } }))).toContain("DIETARY_VIOLATION"));
  it("DENYs currency mismatches", () =>
    expect(codes(ctx({ household: { currency: "USD", allergies: [], dietaryRestrictions: [] } }))).toContain("CURRENCY_MISMATCH"));
  it("DENYs an empty basket", () => expect(codes(ctx({ basket: { ...basket(), lines: [] } }))).toContain("EMPTY_BASKET"));
  it("requires review when autonomy is off or the mode is ALWAYS_CONFIRM", () => {
    expect(evaluatePolicy(ctx({ policy: { ...policy, enabled: false } })).decision).toBe("REVIEW");
    expect(evaluatePolicy(ctx({ autonomyGloballyEnabled: false })).decision).toBe("REVIEW");
    expect(evaluatePolicy(ctx({ policy: { ...policy, mode: "ALWAYS_CONFIRM" } })).decision).toBe("REVIEW");
  });
  it("kill switches DENY, household and global", () => {
    expect(codes(ctx({ policy: { ...policy, killSwitch: true } }))).toContain("KILL_SWITCH_ON");
    expect(codes(ctx({ globalKillSwitch: true }))).toContain("GLOBAL_KILL_SWITCH_ON");
  });
  it("owner approval clears REVIEW but can never clear DENY", () => {
    const review = ctx({ policy: { ...policy, mode: "ALWAYS_CONFIRM" } });
    expect(evaluatePolicy({ ...review, approved: true }).decision).toBe("ALLOW");
    expect(evaluatePolicy({ ...review, approved: true, policy: { ...review.policy, killSwitch: true } }).decision).toBe("DENY");
    expect(evaluatePolicy({ ...review, approved: true, basket: basket({ unitPriceMinor: 9999 }) }).decision).toBe("DENY");
  });
  it("is deterministic", () => expect(evaluatePolicy(ctx())).toEqual(evaluatePolicy(ctx())));
});
