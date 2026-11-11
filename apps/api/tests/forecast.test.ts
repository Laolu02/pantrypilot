import { describe, expect, it } from "vitest";
import { forecastStock, usableQuantity } from "../src/modules/forecasting/forecast";

const profile = { canonicalKey: "milk", dailyConsumption: 500, consumptionSource: "HISTORY" as const, leadTimeDays: 1, safetyDays: 2, targetDays: 7 };

describe("forecast", () => {
  it("does not trigger above the reorder point", () => {
    const f = forecastStock({ profile, usableOnHand: 1501, inbound: 0, confidence: 0.9 });
    expect(f.reorderPoint).toBe(1500);
    expect(f.needsReplenishment).toBe(false);
    expect(f.status).toBe("OK");
  });
  it("triggers at or below the reorder point and sizes the shortfall to target days", () => {
    const f = forecastStock({ profile, usableOnHand: 1500, inbound: 0, confidence: 0.9 });
    expect(f.needsReplenishment).toBe(true);
    expect(f.daysOfSupply).toBe(3);
    expect(f.targetQty).toBe(3500);
    expect(f.shortfall).toBe(2000);
  });
  it("counts inbound toward the shortfall but not toward on-hand", () => {
    const f = forecastStock({ profile, usableOnHand: 180, inbound: 3408, confidence: 0.9 });
    expect(f.needsReplenishment).toBe(true);
    expect(f.shortfall).toBe(0);
  });
  it("flags fallback consumption as an estimate", () =>
    expect(forecastStock({ profile: { ...profile, consumptionSource: "FALLBACK" }, usableOnHand: 10, inbound: 0, confidence: 1 }).estimated).toBe(true));
  it("returns UNKNOWN without a positive consumption rate instead of guessing", () => {
    const f = forecastStock({ profile: { ...profile, dailyConsumption: 0 }, usableOnHand: 0, inbound: 0, confidence: 1 });
    expect(f.status).toBe("UNKNOWN");
    expect(f.needsReplenishment).toBe(false);
  });
  it("treats expired stock as unusable", () => {
    const item: any = { quantity: 1000, status: "ACTIVE", expiresAt: "2026-10-15T00:00:00.000Z" };
    expect(usableQuantity(item, new Date("2026-10-16T00:00:00Z"))).toBe(0);
    expect(usableQuantity({ ...item, expiresAt: "2026-10-17T00:00:00.000Z" }, new Date("2026-10-16T00:00:00Z"))).toBe(1000);
  });
});
