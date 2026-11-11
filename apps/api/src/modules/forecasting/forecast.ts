import type { InventoryItem } from "@pantrypilot/contracts";
import type { ReplenishmentProfile } from "../../store/store";

export interface Forecast {
  canonicalKey: string;
  usableOnHand: number;
  inbound: number;
  dailyConsumption: number;
  /** True when consumption is a configured fallback, not learned from history. */
  estimated: boolean;
  daysOfSupply: number | null;
  reorderPoint: number;
  targetQty: number;
  shortfall: number;
  needsReplenishment: boolean;
  status: "OK" | "LOW" | "OUT" | "UNKNOWN";
  confidence: number;
}

/** Expired stock is not usable. */
export function usableQuantity(item: InventoryItem, now: Date): number {
  if (item.status !== "ACTIVE") return 0;
  if (item.expiresAt && new Date(item.expiresAt).getTime() <= now.getTime()) return 0;
  return item.quantity;
}

/**
 * daysOfSupply = usable / daily
 * reorderPoint = daily * (leadTime + safety)
 * Replenish when usable <= reorderPoint. These are heuristics, not predictions.
 */
export function forecastStock(args: {
  profile: Pick<ReplenishmentProfile, "canonicalKey" | "dailyConsumption" | "consumptionSource" | "leadTimeDays" | "safetyDays" | "targetDays">;
  usableOnHand: number;
  inbound: number;
  confidence: number;
}): Forecast {
  const { profile: p, usableOnHand, inbound, confidence } = args;
  const base = {
    canonicalKey: p.canonicalKey, usableOnHand, inbound, dailyConsumption: p.dailyConsumption,
    estimated: p.consumptionSource === "FALLBACK", confidence,
  };
  if (!(p.dailyConsumption > 0)) {
    return { ...base, daysOfSupply: null, reorderPoint: 0, targetQty: 0, shortfall: 0, needsReplenishment: false, status: "UNKNOWN" };
  }
  const reorderPoint = p.dailyConsumption * (p.leadTimeDays + p.safetyDays);
  const targetQty = p.dailyConsumption * p.targetDays;
  const needs = usableOnHand <= reorderPoint;
  return {
    ...base,
    daysOfSupply: usableOnHand / p.dailyConsumption,
    reorderPoint, targetQty,
    shortfall: Math.max(0, targetQty - usableOnHand - inbound),
    needsReplenishment: needs,
    status: usableOnHand <= 0 ? "OUT" : needs ? "LOW" : "OK",
  };
}
