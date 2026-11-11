import type { Currency, PolicyDecision, PolicyReasonCode, PurchasePolicy, OrderStatus } from "@pantrypilot/contracts";
import type { Basket } from "../../store/store";
import { checkAgainstProfile } from "../recipes/diet";

export interface OrderLite { id: string; status: OrderStatus; totalMinor: number; createdAt: string; canonicalKeys: string[] }

export const COMMITTED: OrderStatus[] = ["APPROVED", "SUBMITTING", "UNCERTAIN", "HANDOFF", "CONFIRMED", "IN_TRANSIT", "DELIVERED"];
export const OPEN: OrderStatus[] = ["PROPOSED", "PENDING_REVIEW", "APPROVED", "SUBMITTING", "UNCERTAIN", "HANDOFF", "CONFIRMED", "IN_TRANSIT"];
const WEEK_MS = 7 * 24 * 3600 * 1000;

export interface PolicyContext {
  policy: PurchasePolicy;
  globalKillSwitch: boolean;
  autonomyGloballyEnabled: boolean;
  basket: Basket;
  household: { currency: Currency; allergies: string[]; dietaryRestrictions: string[] };
  inventoryConfidence: Record<string, number | undefined>;
  orders: OrderLite[];
  now: Date;
  excludeOrderId?: string;
  /** A valid, unexpired owner approval for this order. Downgrades REVIEW only; never DENY. */
  approved?: boolean;
  /** False when the payment provider needs the household to connect an account and it has not. Undefined = not required. */
  paymentConnected?: boolean;
}

type Reason = PolicyDecision["reasons"][number];

/** Pure and deterministic. No I/O, no LLM. */
export function evaluatePolicy(ctx: PolicyContext): PolicyDecision {
  const { policy, basket, now } = ctx;
  const reasons: Reason[] = [];
  const add = (code: PolicyReasonCode, severity: "DENY" | "REVIEW", message: string, data?: Record<string, unknown>) =>
    reasons.push({ code, severity, message, ...(data ? { data } : {}) });
  const fmt = (m: number) => (m / 100).toFixed(2);

  // 14. kill switches (hard stop, even with approval)
  if (policy.killSwitch) add("KILL_SWITCH_ON", "DENY", "Household purchase kill switch is on");
  if (ctx.globalKillSwitch) add("GLOBAL_KILL_SWITCH_ON", "DENY", "Global purchase kill switch is on");

  // 1. autonomy / approval mode
  if (!policy.enabled || !ctx.autonomyGloballyEnabled) add("AUTONOMY_DISABLED", "REVIEW", "Autonomous purchasing is disabled; owner approval needed");
  else if (policy.mode === "ALWAYS_CONFIRM") add("APPROVAL_REQUIRED", "REVIEW", "Approval mode is ALWAYS_CONFIRM");

  if (ctx.paymentConnected === false) add("PAYMENT_NOT_CONNECTED", "DENY", "No payment method is connected. Connect one before anything can be bought");

  if (basket.lines.length === 0) add("EMPTY_BASKET", "DENY", "Basket has no lines");

  // 12. currency
  if (basket.currency !== ctx.household.currency || basket.currency !== policy.currency)
    add("CURRENCY_MISMATCH", "DENY", `Basket currency ${basket.currency} does not match household/policy currency`);

  const profile = { allergies: ctx.household.allergies, dietaryRestrictions: ctx.household.dietaryRestrictions };
  for (const l of basket.lines) {
    const data = { canonicalKey: l.canonicalKey, productId: l.productId };
    // 3. validity
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) add("QUANTITY_INVALID", "DENY", `Invalid quantity for ${l.name}`, data);
    if (!l.available) add("PRODUCT_UNAVAILABLE", "DENY", `${l.name} is unavailable`, data);
    // 2. allowlist
    const allowed = policy.allowlistedProductIds.includes(l.productId) || policy.allowlistedCategories.includes(l.category);
    if (!allowed) add("PRODUCT_NOT_ALLOWLISTED", "DENY", `${l.name} is not allowlisted`, data);
    // 4. allergens / diet
    const chk = checkAgainstProfile([{ key: l.canonicalKey, allergens: l.allergens, tags: l.tags }], profile);
    for (const v of chk.violations)
      add(v.kind === "ALLERGEN" ? "ALLERGEN_VIOLATION" : "DIETARY_VIOLATION", "DENY", `${l.name}: ${v.detail}`, data);
    if (chk.unknown.length) add("ALLERGEN_UNKNOWN", "REVIEW", `${l.name} has unknown allergen data`, data);
    // 5. per-item cap
    if (l.unitPriceMinor > policy.perItemCapMinor)
      add("ITEM_PRICE_CAP_EXCEEDED", "DENY", `${l.name} costs ${fmt(l.unitPriceMinor)} per pack; cap is ${fmt(policy.perItemCapMinor)}`, { ...data, priceMinor: l.unitPriceMinor, capMinor: policy.perItemCapMinor });
    // 11. freshness
    const ageMin = (now.getTime() - new Date(l.priceCheckedAt).getTime()) / 60000;
    if (ageMin > policy.maxPriceAgeMinutes) add("STALE_PRICE", "REVIEW", `Price for ${l.name} is ${Math.round(ageMin)} min old`, data);
    // 8. confidence
    const conf = ctx.inventoryConfidence[l.canonicalKey];
    if (conf === undefined || conf < policy.minConfidence)
      add("LOW_INVENTORY_CONFIDENCE", "REVIEW", `Stock confidence for ${l.canonicalKey} is ${conf ?? "unknown"}; minimum is ${policy.minConfidence}`, data);
  }

  // 6. order cap (includes known fees and tax)
  if (basket.totalMinor > policy.perOrderCapMinor)
    add("ORDER_CAP_EXCEEDED", "DENY", `Order total ${fmt(basket.totalMinor)} exceeds cap ${fmt(policy.perOrderCapMinor)}`, { totalMinor: basket.totalMinor, capMinor: policy.perOrderCapMinor });

  const others = ctx.orders.filter((o) => o.id !== ctx.excludeOrderId);
  const weekAgo = now.getTime() - WEEK_MS;
  const committedWeek = others.filter((o) => COMMITTED.includes(o.status) && new Date(o.createdAt).getTime() >= weekAgo);
  // 7. weekly budget incl. committed/pending
  const spent = committedWeek.reduce((s, o) => s + o.totalMinor, 0);
  if (spent + basket.totalMinor > policy.weeklyBudgetMinor)
    add("WEEKLY_BUDGET_EXCEEDED", "DENY", `Weekly spend ${fmt(spent)} + ${fmt(basket.totalMinor)} exceeds budget ${fmt(policy.weeklyBudgetMinor)}`, { spentMinor: spent, totalMinor: basket.totalMinor, budgetMinor: policy.weeklyBudgetMinor });

  const keys = new Set(basket.lines.map((l) => l.canonicalKey));
  // 9. equivalent order already in flight
  const dup = others.find((o) => OPEN.includes(o.status) && o.canonicalKeys.some((k) => keys.has(k)));
  if (dup) add("DUPLICATE_PENDING_ORDER", "DENY", "An equivalent replenishment order is already pending", { orderId: dup.id });

  // 10. cooldown and frequency
  const cooldownMs = policy.cooldownHours * 3600 * 1000;
  const cool = others.find((o) => COMMITTED.includes(o.status) && now.getTime() - new Date(o.createdAt).getTime() < cooldownMs && o.canonicalKeys.some((k) => keys.has(k)));
  if (cool) add("COOLDOWN_ACTIVE", "DENY", `Cooldown of ${policy.cooldownHours}h is active for this item`, { orderId: cool.id });
  if (committedWeek.length >= policy.maxOrdersPerWeek)
    add("ORDER_FREQUENCY_EXCEEDED", "DENY", `Already ${committedWeek.length} orders in the last 7 days (max ${policy.maxOrdersPerWeek})`);

  const final = ctx.approved ? reasons.filter((r) => r.severity === "DENY") : reasons;
  const decision = final.some((r) => r.severity === "DENY") ? "DENY" : final.some((r) => r.severity === "REVIEW") ? "REVIEW" : "ALLOW";
  return { decision, reasons: final, policyVersion: policy.version, evaluatedAt: now.toISOString() };
}
