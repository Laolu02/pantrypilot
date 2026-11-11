import { z } from "zod";
import { CurrencySchema, MinorUnitsSchema } from "./common";

export const ApprovalModeSchema = z.enum(["ALWAYS_CONFIRM", "BOUNDED_AUTONOMY"]);

export const PurchasePolicySchema = z.object({
  householdId: z.string(),
  version: z.number().int().positive(),
  enabled: z.boolean(),
  mode: ApprovalModeSchema,
  killSwitch: z.boolean(),
  allowlistedProductIds: z.array(z.string()),
  allowlistedCategories: z.array(z.string()),
  perItemCapMinor: MinorUnitsSchema,
  perOrderCapMinor: MinorUnitsSchema,
  weeklyBudgetMinor: MinorUnitsSchema,
  currency: CurrencySchema,
  cooldownHours: z.number().nonnegative(),
  maxOrdersPerWeek: z.number().int().positive(),
  minConfidence: z.number().min(0).max(1),
  maxPriceAgeMinutes: z.number().positive(),
});
export type PurchasePolicy = z.infer<typeof PurchasePolicySchema>;

export const UpdatePolicySchema = PurchasePolicySchema.omit({
  householdId: true, version: true, killSwitch: true,
}).partial();

export const PolicyReasonCodeSchema = z.enum([
  "AUTONOMY_DISABLED", "APPROVAL_REQUIRED", "KILL_SWITCH_ON", "GLOBAL_KILL_SWITCH_ON",
  "PRODUCT_NOT_ALLOWLISTED", "PRODUCT_UNAVAILABLE", "QUANTITY_INVALID",
  "ALLERGEN_VIOLATION", "DIETARY_VIOLATION", "ALLERGEN_UNKNOWN",
  "ITEM_PRICE_CAP_EXCEEDED", "ORDER_CAP_EXCEEDED", "WEEKLY_BUDGET_EXCEEDED",
  "LOW_INVENTORY_CONFIDENCE", "DUPLICATE_PENDING_ORDER", "COOLDOWN_ACTIVE",
  "ORDER_FREQUENCY_EXCEEDED", "PAYMENT_NOT_CONNECTED", "STALE_PRICE", "CURRENCY_MISMATCH", "EMPTY_BASKET",
]);
export type PolicyReasonCode = z.infer<typeof PolicyReasonCodeSchema>;

export const PolicyDecisionSchema = z.object({
  decision: z.enum(["ALLOW", "DENY", "REVIEW"]),
  reasons: z.array(
    z.object({
      code: PolicyReasonCodeSchema,
      severity: z.enum(["DENY", "REVIEW"]),
      message: z.string(),
      data: z.record(z.unknown()).optional(),
    }),
  ),
  policyVersion: z.number().int(),
  evaluatedAt: z.string(),
});
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
