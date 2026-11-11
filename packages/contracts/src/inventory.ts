import { z } from "zod";
import { IsoDateSchema, StorageSchema, UnitSchema } from "./common";

export const InventorySourceSchema = z.enum(["OBSERVED", "MANUAL", "ESTIMATED", "DELIVERED"]);
export type InventorySource = z.infer<typeof InventorySourceSchema>;

export const InventoryItemSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  canonicalKey: z.string(),
  name: z.string(),
  quantity: z.number().nonnegative(),
  unit: UnitSchema,
  storage: StorageSchema,
  expiresAt: IsoDateSchema.nullable(),
  opened: z.boolean(),
  confidence: z.number().min(0).max(1),
  source: InventorySourceSchema,
  observedAt: IsoDateSchema,
  status: z.enum(["ACTIVE", "REMOVED"]),
});
export type InventoryItem = z.infer<typeof InventoryItemSchema>;

export const CreateInventoryItemSchema = z.object({
  /** Optional: derived from the name when omitted (custom items). */
  canonicalKey: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(80),
  /** Optional rough daily use in base units; creates an ESTIMATED consumption profile so the item can be forecast. */
  dailyUse: z.number().positive().optional(),
  quantity: z.number().positive(),
  unit: UnitSchema,
  storage: StorageSchema,
  expiresAt: IsoDateSchema.nullable().optional(),
  opened: z.boolean().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const PatchInventoryItemSchema = z
  .object({
    quantity: z.number().nonnegative(),
    expiresAt: IsoDateSchema.nullable(),
    storage: StorageSchema,
    confidence: z.number().min(0).max(1),
    opened: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

export const InventoryEventTypeSchema = z.enum([
  "ADD", "REMOVE", "CONSUME", "OBSERVE", "ADJUST", "DELIVER",
]);

export const InventoryEventSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  itemId: z.string(),
  canonicalKey: z.string(),
  type: InventoryEventTypeSchema,
  quantityDelta: z.number(),
  quantityAfter: z.number(),
  source: InventorySourceSchema,
  occurredAt: IsoDateSchema,
  correlationId: z.string(),
  note: z.string().optional(),
});
export type InventoryEvent = z.infer<typeof InventoryEventSchema>;

export const ReconciliationRequestSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  itemId: z.string().nullable(),
  canonicalKey: z.string(),
  observedQuantity: z.number(),
  currentQuantity: z.number().nullable(),
  reason: z.enum(["LOW_CONFIDENCE", "IMPLAUSIBLE_QUANTITY", "UNKNOWN_ITEM"]),
  status: z.enum(["OPEN", "RESOLVED"]),
  deviceEventId: z.string(),
  createdAt: IsoDateSchema,
});
export type ReconciliationRequest = z.infer<typeof ReconciliationRequestSchema>;

export const ResolveReconciliationSchema = z.object({
  requestId: z.string(),
  resolution: z.enum(["ACCEPT_OBSERVED", "KEEP_CURRENT", "SET"]),
  quantity: z.number().nonnegative().optional(),
});
