import { z } from "zod";
import { CurrencySchema, UnitSchema } from "./common";

export const OrderStatusSchema = z.enum([
  "PROPOSED", "BLOCKED", "PENDING_REVIEW", "APPROVED", "SUBMITTING", "UNCERTAIN", "HANDOFF",
  "CONFIRMED", "IN_TRANSIT", "DELIVERED", "FAILED", "CANCELLED",
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const ProductSchema = z.object({
  id: z.string(),
  canonicalKey: z.string(),
  name: z.string(),
  brand: z.string(),
  category: z.string(),
  packSize: z.number().positive(),
  unit: UnitSchema,
  packLabel: z.string(),
  /** null = allergen data unknown (fail closed / review). */
  allergens: z.array(z.string()).nullable(),
  tags: z.array(z.string()),
});
export type Product = z.infer<typeof ProductSchema>;

export const StoreProductSchema = z.object({
  id: z.string(),
  productId: z.string(),
  provider: z.string(),
  externalId: z.string(),
  priceMinor: z.number().int().nonnegative(),
  currency: CurrencySchema,
  available: z.boolean(),
  url: z.string(),
  checkedAt: z.string(),
});
export type StoreProduct = z.infer<typeof StoreProductSchema>;

export const CreateCartSchema = z.object({
  reason: z.string().default("Manual cart"),
  lines: z.array(z.object({ storeProductId: z.string(), quantity: z.number().int().positive() })).min(1),
});

export const CreateOrderSchema = z.object({ cartId: z.string() });
