import { z } from "zod";
import { IsoDateSchema, UnitSchema } from "./common";

export const DeviceEventInputSchema = z.object({
  eventId: z.string().min(1),
  provider: z.string().min(1),
  deviceId: z.string().min(1),
  type: z.literal("QUANTITY_OBSERVED"),
  canonicalKey: z.string().min(1),
  quantity: z.number(),
  unit: UnitSchema,
  confidence: z.number().min(0).max(1),
  observedAt: IsoDateSchema,
  signature: z.string().min(1),
});
export type DeviceEventInput = z.infer<typeof DeviceEventInputSchema>;

export const DeviceEventStatusSchema = z.enum([
  "APPLIED", "DUPLICATE", "STALE", "NEEDS_RECONCILIATION", "REJECTED",
]);
export type DeviceEventStatus = z.infer<typeof DeviceEventStatusSchema>;

export const RegisterDeviceSchema = z.object({
  provider: z.string().min(1),
  externalId: z.string().min(1),
  name: z.string().min(1),
});

export const SimulateScenarioSchema = z.enum([
  "LOW_MILK", "LOW_OLIVE_OIL", "REPLAY_LAST", "IMPLAUSIBLE_MILK", "LOW_CONFIDENCE_MILK", "STALE_MILK",
]);
export const SimulateRequestSchema = z.object({ scenario: SimulateScenarioSchema });
export type SimulateScenario = z.infer<typeof SimulateScenarioSchema>;
