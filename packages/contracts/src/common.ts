import { z } from "zod";

export const CurrencySchema = z.enum(["GBP", "USD"]);
export type Currency = z.infer<typeof CurrencySchema>;

/** Quantities are always stored in base units. */
export const UnitSchema = z.enum(["ml", "g", "count"]);
export type Unit = z.infer<typeof UnitSchema>;

export const StorageSchema = z.enum(["FRIDGE", "FREEZER", "PANTRY"]);
export type Storage = z.infer<typeof StorageSchema>;

export const MinorUnitsSchema = z.number().int().nonnegative();
export const IsoDateSchema = z.string().datetime();

export const ALLERGENS = [
  "milk", "egg", "peanut", "tree_nut", "gluten", "soy", "fish", "shellfish", "sesame",
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const ErrorBodySchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string(),
  details: z.unknown().optional(),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

export function formatMoney(minor: number, currency: Currency): string {
  const symbol = currency === "GBP" ? "£" : "$";
  return `${symbol}${(minor / 100).toFixed(2)}`;
}
