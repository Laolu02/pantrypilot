import { createHash } from "node:crypto";
import { DeviceEventInputSchema, type DeviceEventInput, type DeviceEventStatus } from "@pantrypilot/contracts";
import type { Store, Device } from "../../store/store";
import type { Clock } from "../../lib/clock";
import { AppError, UniqueViolationError, notFound } from "../../lib/errors";
import { newId } from "../../lib/ids";
import { verifyDeviceEvent } from "../../lib/signing";
import { AuditService } from "../audit/auditService";
import { InventoryService } from "../inventory/inventoryService";

export interface IngestResult {
  status: DeviceEventStatus;
  householdId: string;
  correlationId: string;
  itemId?: string;
  canonicalKey?: string;
  ledgerEventId?: string;
  reconciliationId?: string;
  detail?: string;
}

const MIN_OBSERVE_CONFIDENCE = 0.5;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const ONLINE_MS = 15 * 60 * 1000;

export class DeviceService {
  constructor(private store: Store, private clock: Clock, private audit: AuditService, private inventory: InventoryService, private secret: string) {}

  async list(householdId: string) {
    const now = this.clock.now().getTime();
    const devices = await this.store.devices.list((d) => d.householdId === householdId);
    return devices.map((d) => ({
      ...d,
      status: !d.lastSeenAt ? "OFFLINE" : now - new Date(d.lastSeenAt).getTime() < ONLINE_MS ? "ONLINE" : "STALE",
    }));
  }
  async register(householdId: string, input: { provider: string; externalId: string; name: string }): Promise<Device> {
    if (input.provider !== "simulator") throw new AppError(422, "UNSUPPORTED_PROVIDER", `Provider "${input.provider}" is not supported in this build`);
    return this.store.devices.insert({ id: newId("dev"), householdId, ...input, connected: true, lastSeenAt: null });
  }

  /**
   * Authenticated by event signature (not a user token). Household is derived from the
   * registered device, never from the payload.
   */
  async ingest(raw: unknown): Promise<IngestResult> {
    const parsed = DeviceEventInputSchema.safeParse(raw);
    if (!parsed.success) throw new AppError(400, "INVALID_EVENT", "Device event failed validation", parsed.error.flatten());
    const e: DeviceEventInput = parsed.data;
    const device = await this.store.devices.find((d) => d.provider === e.provider && d.externalId === e.deviceId);
    if (!device) throw new AppError(403, "UNKNOWN_DEVICE", "Device is not registered");
    const householdId = device.householdId;
    const correlationId = newId("cor");
    const reject = async (code: string, status: number, message: string) => {
      await this.audit.record({ householdId, actor: `device:${device.id}`, action: "DEVICE_EVENT_REJECTED", resourceType: "DeviceEvent", resourceId: e.eventId, correlationId, stage: "DEVICE", outcome: "FAIL", reason: code, details: { eventId: e.eventId } });
      return new AppError(status, code, message);
    };

    if (!verifyDeviceEvent(this.secret, e)) throw await reject("BAD_SIGNATURE", 401, "Invalid device signature");
    const now = this.clock.now();
    if (new Date(e.observedAt).getTime() - now.getTime() > MAX_FUTURE_SKEW_MS) throw await reject("EVENT_FROM_FUTURE", 422, "observedAt is in the future");
    if (e.quantity < 0) throw await reject("NEGATIVE_QUANTITY", 422, "Quantity cannot be negative");

    // Deduplicate: the unique (provider, eventId) constraint is the source of truth.
    const record = async (status: DeviceEventStatus, detail?: string) =>
      this.store.deviceEvents.insert({
        id: newId("de"), householdId, provider: e.provider, eventId: e.eventId, deviceId: device.id,
        payloadHash: createHash("sha256").update(JSON.stringify({ ...e, signature: undefined })).digest("hex"),
        status, receivedAt: now.toISOString(), correlationId, ...(detail ? { detail } : {}),
      });
    try {
      await record("APPLIED", "received");
    } catch (err) {
      if (err instanceof UniqueViolationError) {
        const prior = await this.store.deviceEvents.find((r) => r.provider === e.provider && r.eventId === e.eventId);
        await this.audit.record({ householdId, actor: `device:${device.id}`, action: "DEVICE_EVENT_DUPLICATE", resourceType: "DeviceEvent", resourceId: e.eventId, correlationId, stage: "DEVICE", outcome: "WARN", details: { firstSeenAt: prior?.receivedAt } });
        return { status: "DUPLICATE", householdId, correlationId, detail: "Event already processed; nothing applied" };
      }
      throw err;
    }
    const finish = async (r: IngestResult) => {
      const row = await this.store.deviceEvents.find((x) => x.provider === e.provider && x.eventId === e.eventId);
      if (row) await this.store.deviceEvents.update(row.id, { status: r.status, ...(r.detail ? { detail: r.detail } : {}) });
      return r;
    };
    await this.store.devices.update(device.id, { lastSeenAt: now.toISOString(), connected: true });
    await this.audit.record({ householdId, actor: `device:${device.id}`, action: "DEVICE_EVENT_RECEIVED", resourceType: "DeviceEvent", resourceId: e.eventId, correlationId, stage: "DEVICE", details: { canonicalKey: e.canonicalKey, quantity: e.quantity, unit: e.unit, confidence: e.confidence } });

    const item = await this.inventory.findByKey(householdId, e.canonicalKey);
    const openRecon = async (reason: "LOW_CONFIDENCE" | "IMPLAUSIBLE_QUANTITY" | "UNKNOWN_ITEM") => {
      const rec = await this.store.reconciliations.insert({
        id: newId("rec"), householdId, itemId: item?.id ?? null, canonicalKey: e.canonicalKey,
        observedQuantity: e.quantity, currentQuantity: item?.quantity ?? null, reason, status: "OPEN",
        deviceEventId: e.eventId, createdAt: now.toISOString(),
      });
      await this.audit.record({ householdId, actor: `device:${device.id}`, action: "RECONCILIATION_REQUESTED", resourceType: "ReconciliationRequest", resourceId: rec.id, correlationId, stage: "INVENTORY", outcome: "WARN", reason, details: { observed: e.quantity, current: item?.quantity ?? null } });
      return finish({ status: "NEEDS_RECONCILIATION", householdId, correlationId, reconciliationId: rec.id, ...(item ? { itemId: item.id } : {}), canonicalKey: e.canonicalKey, detail: reason });
    };

    if (!item) return openRecon("UNKNOWN_ITEM");
    if (new Date(e.observedAt).getTime() <= new Date(item.observedAt).getTime()) {
      await this.audit.record({ householdId, actor: `device:${device.id}`, action: "DEVICE_EVENT_STALE", resourceType: "DeviceEvent", resourceId: e.eventId, correlationId, stage: "DEVICE", outcome: "WARN", details: { eventObservedAt: e.observedAt, itemObservedAt: item.observedAt } });
      return finish({ status: "STALE", householdId, correlationId, itemId: item.id, canonicalKey: e.canonicalKey, detail: "Older than current inventory state; ignored" });
    }
    const profile = await this.store.profiles.find((p) => p.householdId === householdId && p.canonicalKey === e.canonicalKey);
    if (e.confidence < MIN_OBSERVE_CONFIDENCE) return openRecon("LOW_CONFIDENCE");
    if (profile && e.quantity > profile.maxPlausibleQty) return openRecon("IMPLAUSIBLE_QUANTITY");
    if (e.unit !== item.unit) throw await reject("UNIT_MISMATCH", 422, `Expected unit ${item.unit}`);

    const { event } = await this.inventory.observe(householdId, `device:${device.id}`, item.id, e.quantity, e.confidence, e.observedAt, correlationId);
    return finish({ status: "APPLIED", householdId, correlationId, itemId: item.id, canonicalKey: e.canonicalKey, ledgerEventId: event.id });
  }

  async getOwnedDevice(householdId: string, id: string) {
    const d = await this.store.devices.get(id);
    if (!d || d.householdId !== householdId) throw notFound("Device");
    return d;
  }
}
