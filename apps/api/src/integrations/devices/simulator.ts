import type { DeviceEventInput, SimulateScenario } from "@pantrypilot/contracts";
import type { Clock } from "../../lib/clock";
import { newId } from "../../lib/ids";
import { signDeviceEvent } from "../../lib/signing";

export interface DeviceStatus { provider: string; externalId: string; connected: boolean }
export type NormalizedDeviceEvent = DeviceEventInput;
export interface DeviceAdapter {
  connect(): Promise<void>;
  getStatus(): Promise<DeviceStatus[]>;
  subscribe(handler: (e: NormalizedDeviceEvent) => Promise<void>): Promise<() => Promise<void>>;
}

export const SIM_FRIDGE = "fridge-kitchen-01";
export const SIM_PANTRY = "pantry-scale-01";

/** Produces realistic, correctly signed events. Used by the demo and tests. */
export class SimulatorDeviceAdapter implements DeviceAdapter {
  private handler: ((e: NormalizedDeviceEvent) => Promise<void>) | null = null;
  lastEvent: NormalizedDeviceEvent | null = null;
  constructor(private clock: Clock, private secret: string) {}
  async connect() {}
  async getStatus() {
    return [SIM_FRIDGE, SIM_PANTRY].map((externalId) => ({ provider: "simulator", externalId, connected: true }));
  }
  async subscribe(handler: (e: NormalizedDeviceEvent) => Promise<void>) {
    this.handler = handler;
    return async () => { this.handler = null; };
  }
  build(scenario: SimulateScenario): NormalizedDeviceEvent {
    if (scenario === "REPLAY_LAST") {
      if (!this.lastEvent) throw new Error("No previous event to replay");
      return structuredClone(this.lastEvent);
    }
    const now = this.clock.now();
    const base = { provider: "simulator", eventId: newId("evt"), type: "QUANTITY_OBSERVED" as const, observedAt: now.toISOString() };
    const spec: Record<Exclude<SimulateScenario, "REPLAY_LAST">, Omit<DeviceEventInput, "signature" | "eventId" | "provider" | "type" | "observedAt"> & { observedAt?: string }> = {
      LOW_MILK: { deviceId: SIM_FRIDGE, canonicalKey: "milk", quantity: 180, unit: "ml", confidence: 0.92 },
      LOW_OLIVE_OIL: { deviceId: SIM_PANTRY, canonicalKey: "olive_oil", quantity: 40, unit: "ml", confidence: 0.9 },
      IMPLAUSIBLE_MILK: { deviceId: SIM_FRIDGE, canonicalKey: "milk", quantity: 40000, unit: "ml", confidence: 0.9 },
      LOW_CONFIDENCE_MILK: { deviceId: SIM_FRIDGE, canonicalKey: "milk", quantity: 150, unit: "ml", confidence: 0.3 },
      STALE_MILK: { deviceId: SIM_FRIDGE, canonicalKey: "milk", quantity: 900, unit: "ml", confidence: 0.9, observedAt: new Date(now.getTime() - 2 * 86400000).toISOString() },
    };
    const s = spec[scenario];
    const unsigned = { ...base, ...s, observedAt: s.observedAt ?? base.observedAt } as Omit<DeviceEventInput, "signature">;
    const event = { ...unsigned, signature: signDeviceEvent(this.secret, unsigned) };
    this.lastEvent = event;
    return event;
  }
  async emit(scenario: SimulateScenario) {
    const e = this.build(scenario);
    if (this.handler) await this.handler(e);
    return e;
  }
}
