import type { Currency } from "@pantrypilot/contracts";
import type { BasketService } from "../shopping/basketService";

export interface DeliveryNeed { canonicalKey: string; shortfall: number }
export interface DeliveryPick { storeProductId: string; quantity: number; canonicalKey: string }

/** One store per delivery: the first item's best option fixes the store. Items it cannot supply are reported, never silently swapped. */
export async function pickDeliveryLines(baskets: BasketService, allowlist: string[], currency: Currency, needs: DeliveryNeed[]) {
  const picks: DeliveryPick[] = [];
  const skipped: string[] = [];
  let provider: string | null = null;
  for (const n of needs) {
    const { options } = await baskets.compare(n.canonicalKey, n.shortfall, allowlist, currency);
    const best = options.find((o) => o.available && o.eligible && (provider === null || o.provider === provider));
    if (!best) { skipped.push(n.canonicalKey); continue; }
    provider = best.provider;
    picks.push({ storeProductId: best.storeProductId, quantity: best.quantityNeeded, canonicalKey: n.canonicalKey });
  }
  return { picks, skipped };
}