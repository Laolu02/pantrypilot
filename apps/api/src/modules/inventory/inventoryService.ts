import type { InventoryItem, InventoryEvent, ReconciliationRequest, Storage, Unit } from "@pantrypilot/contracts";
import type { Store, ShoppingOrder } from "../../store/store";
import type { Clock } from "../../lib/clock";
import { newId } from "../../lib/ids";
import { notFound, unprocessable } from "../../lib/errors";
import { AuditService } from "../audit/auditService";
import { slugify } from "../recipes/diet";
import { forecastStock, usableQuantity, type Forecast } from "../forecasting/forecast";

const INBOUND_STATUSES = ["APPROVED", "SUBMITTING", "UNCERTAIN", "CONFIRMED", "IN_TRANSIT"];

export interface ItemView extends InventoryItem {
  forecast: Forecast | null;
  inboundQty: number;
  usableQty: number;
}

export class InventoryService {
  constructor(private store: Store, private clock: Clock, private audit: AuditService) {}

  async getOwned(householdId: string, id: string): Promise<InventoryItem> {
    const it = await this.store.inventoryItems.get(id);
    if (!it || it.householdId !== householdId) throw notFound("Inventory item");
    return it;
  }
  async findByKey(householdId: string, canonicalKey: string) {
    return this.store.inventoryItems.find((i) => i.householdId === householdId && i.canonicalKey === canonicalKey && i.status === "ACTIVE");
  }

  /** Quantity on order but NOT on hand. Only delivered orders add stock. */
  async inboundQty(householdId: string, canonicalKey: string): Promise<number> {
    const orders: ShoppingOrder[] = await this.store.orders.list((o) => o.householdId === householdId && INBOUND_STATUSES.includes(o.status));
    return orders.flatMap((o) => o.basket.lines).filter((l) => l.canonicalKey === canonicalKey).reduce((s, l) => s + l.quantity * l.packSize, 0);
  }

  async view(householdId: string, item: InventoryItem): Promise<ItemView> {
    const now = this.clock.now();
    const profile = await this.store.profiles.find((p) => p.householdId === householdId && p.canonicalKey === item.canonicalKey);
    const inbound = await this.inboundQty(householdId, item.canonicalKey);
    const usable = usableQuantity(item, now);
    return {
      ...item, inboundQty: inbound, usableQty: usable,
      forecast: profile ? forecastStock({ profile, usableOnHand: usable, inbound, confidence: item.confidence }) : null,
    };
  }

  async list(householdId: string, f: { location?: Storage; lowStock?: boolean; expiringDays?: number; uncertain?: boolean } = {}): Promise<ItemView[]> {
    const now = this.clock.now().getTime();
    const items = await this.store.inventoryItems.list((i) => i.householdId === householdId && i.status === "ACTIVE");
    let views = await Promise.all(items.map((i) => this.view(householdId, i)));
    if (f.location) views = views.filter((v) => v.storage === f.location);
    if (f.lowStock) views = views.filter((v) => v.forecast?.needsReplenishment);
    if (f.uncertain) views = views.filter((v) => v.confidence < 0.6);
    if (f.expiringDays !== undefined)
      views = views.filter((v) => v.expiresAt && new Date(v.expiresAt).getTime() - now <= f.expiringDays! * 86400000);
    return views.sort((a, b) => a.name.localeCompare(b.name));
  }

  async ledger(householdId: string, itemId?: string, limit = 100): Promise<InventoryEvent[]> {
    const rows = await this.store.inventoryEvents.list((e) => e.householdId === householdId && (!itemId || e.itemId === itemId));
    return rows.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)).slice(0, limit);
  }

  private async appendEvent(item: InventoryItem, type: InventoryEvent["type"], delta: number, source: InventoryItem["source"], correlationId: string, note?: string): Promise<InventoryEvent> {
    return this.store.inventoryEvents.insert({
      id: newId("ie"), householdId: item.householdId, itemId: item.id, canonicalKey: item.canonicalKey,
      type, quantityDelta: delta, quantityAfter: item.quantity, source,
      occurredAt: this.clock.now().toISOString(), correlationId, ...(note ? { note } : {}),
    });
  }

  /**
   * Manual add. A custom name gets a slug key (its allergen data is unknown, so it fails closed in recipes).
   * Adding something already in stock merges into the existing row and keeps the earlier expiry.
   */
  async create(householdId: string, actor: string, input: { canonicalKey?: string | undefined; name: string; quantity: number; unit: Unit; storage: Storage; expiresAt?: string | null | undefined; opened?: boolean | undefined; confidence?: number | undefined; dailyUse?: number | undefined }, correlationId = newId("cor")) {
    const key = input.canonicalKey ? slugify(input.canonicalKey) : slugify(input.name);
    if (!key) throw unprocessable("INVALID_NAME", "Give the item a name using letters or numbers");
    return this.store.withLock(`inv:${householdId}`, async () => {
      const now = this.clock.now().toISOString();
      const existing = await this.findByKey(householdId, key);
      let item: InventoryItem; let merged = false;
      if (existing) {
        if (existing.unit !== input.unit) throw unprocessable("UNIT_MISMATCH", `${existing.name} is tracked in ${existing.unit}; enter the amount in ${existing.unit}`);
        merged = true;
        const exp = [existing.expiresAt, input.expiresAt ?? null].filter(Boolean).sort()[0] ?? null;
        item = await this.store.inventoryItems.update(existing.id, { quantity: existing.quantity + input.quantity, expiresAt: exp, source: "MANUAL", observedAt: now, confidence: Math.max(existing.confidence, input.confidence ?? 0.95) });
      } else {
        item = await this.store.inventoryItems.insert({
          id: newId("item"), householdId, canonicalKey: key, name: input.name.trim(), quantity: input.quantity,
          unit: input.unit, storage: input.storage, expiresAt: input.expiresAt ?? null, opened: input.opened ?? false,
          confidence: input.confidence ?? 0.95, source: "MANUAL", observedAt: now, status: "ACTIVE",
        });
      }
      await this.appendEvent(item, "ADD", input.quantity, "MANUAL", correlationId, merged ? "Manual add (merged into existing stock)" : "Manual add");
      if (input.dailyUse && !(await this.store.profiles.find((p) => p.householdId === householdId && p.canonicalKey === key))) {
        await this.store.profiles.insert({ id: newId("prof"), householdId, canonicalKey: key, dailyConsumption: input.dailyUse, consumptionSource: "FALLBACK", leadTimeDays: 1, safetyDays: 2, targetDays: 7, maxPlausibleQty: Math.max(item.quantity * 4, input.dailyUse * 30) });
      }
      await this.audit.record({ householdId, actor, action: "INVENTORY_ADDED", resourceType: "InventoryItem", resourceId: item.id, correlationId, stage: "INVENTORY", details: { canonicalKey: key, added: input.quantity, quantityAfter: item.quantity, merged } });
      return { ...item, merged };
    });
  }

  async patch(householdId: string, actor: string, id: string, patch: Partial<Pick<InventoryItem, "quantity" | "expiresAt" | "storage" | "confidence" | "opened">>, correlationId = newId("cor")) {
    return this.store.withLock(`inv:${householdId}`, async () => {
      const cur = await this.getOwned(householdId, id);
      if (cur.status === "REMOVED") throw unprocessable("ITEM_REMOVED", "Item was removed");
      const qtyChanged = patch.quantity !== undefined && patch.quantity !== cur.quantity;
      const next = await this.store.inventoryItems.update(id, {
        ...patch, source: "MANUAL", observedAt: this.clock.now().toISOString(),
        confidence: patch.confidence ?? (qtyChanged ? 0.9 : cur.confidence),
      });
      await this.appendEvent(next, "ADJUST", next.quantity - cur.quantity, "MANUAL", correlationId, qtyChanged ? "Manual quantity correction" : "Manual metadata edit");
      await this.audit.record({ householdId, actor, action: "INVENTORY_ADJUSTED", resourceType: "InventoryItem", resourceId: id, correlationId, stage: "INVENTORY", details: { from: cur.quantity, to: next.quantity } });
      return next;
    });
  }

  /** Soft delete: the ledger keeps the full history. */
  async remove(householdId: string, actor: string, id: string, correlationId = newId("cor")) {
    return this.store.withLock(`inv:${householdId}`, async () => {
      const cur = await this.getOwned(householdId, id);
      const next = await this.store.inventoryItems.update(id, { status: "REMOVED", quantity: 0 });
      await this.appendEvent(next, "REMOVE", -cur.quantity, "MANUAL", correlationId);
      await this.audit.record({ householdId, actor, action: "INVENTORY_REMOVED", resourceType: "InventoryItem", resourceId: id, correlationId, stage: "INVENTORY", details: { removedQuantity: cur.quantity } });
      return next;
    });
  }

  async observe(householdId: string, actor: string, itemId: string, quantity: number, confidence: number, observedAt: string, correlationId: string): Promise<{ item: InventoryItem; event: InventoryEvent; before: number }> {
    return this.store.withLock(`inv:${householdId}`, async () => {
      const cur = await this.getOwned(householdId, itemId);
      const item = await this.store.inventoryItems.update(itemId, { quantity, confidence, observedAt, source: "OBSERVED" });
      const event = await this.appendEvent(item, "OBSERVE", quantity - cur.quantity, "OBSERVED", correlationId);
      await this.audit.record({ householdId, actor, action: "INVENTORY_OBSERVED", resourceType: "InventoryItem", resourceId: itemId, correlationId, stage: "INVENTORY", details: { from: cur.quantity, to: quantity, confidence } });
      return { item, event, before: cur.quantity };
    });
  }

  /** The only path that increases on-hand stock from an order. Call after verified delivery or user confirmation. */
  async deliver(householdId: string, actor: string, canonicalKey: string, name: string, quantity: number, unit: Unit, correlationId: string, orderId: string) {
    return this.store.withLock(`inv:${householdId}`, async () => {
      const now = this.clock.now().toISOString();
      const cur = await this.findByKey(householdId, canonicalKey);
      let item: InventoryItem;
      if (cur) item = await this.store.inventoryItems.update(cur.id, { quantity: cur.quantity + quantity, source: "DELIVERED", observedAt: now, confidence: 0.95 });
      else item = await this.store.inventoryItems.insert({ id: newId("item"), householdId, canonicalKey, name, quantity, unit, storage: "PANTRY", expiresAt: null, opened: false, confidence: 0.95, source: "DELIVERED", observedAt: now, status: "ACTIVE" });
      await this.appendEvent(item, "DELIVER", quantity, "DELIVERED", correlationId, `order ${orderId}`);
      await this.audit.record({ householdId, actor, action: "INVENTORY_DELIVERED", resourceType: "InventoryItem", resourceId: item.id, correlationId, stage: "VERIFY", details: { orderId, added: quantity, quantityAfter: item.quantity } });
      return item;
    });
  }

  async openReconciliations(householdId: string): Promise<ReconciliationRequest[]> {
    return this.store.reconciliations.list((r) => r.householdId === householdId && r.status === "OPEN");
  }

  async resolveReconciliation(householdId: string, actor: string, requestId: string, resolution: "ACCEPT_OBSERVED" | "KEEP_CURRENT" | "SET", quantity?: number) {
    const req = await this.store.reconciliations.get(requestId);
    if (!req || req.householdId !== householdId) throw notFound("Reconciliation request");
    if (req.status === "RESOLVED") throw unprocessable("ALREADY_RESOLVED", "Already resolved");
    const correlationId = newId("cor");
    let item: InventoryItem | null = null;
    if (req.itemId && resolution !== "KEEP_CURRENT") {
      const qty = resolution === "SET" ? quantity : req.observedQuantity;
      if (qty === undefined) throw unprocessable("QUANTITY_REQUIRED", "quantity is required for SET");
      item = (await this.observe(householdId, actor, req.itemId, qty, 0.9, this.clock.now().toISOString(), correlationId)).item;
    }
    await this.store.reconciliations.update(requestId, { status: "RESOLVED" });
    await this.audit.record({ householdId, actor, action: "RECONCILIATION_RESOLVED", resourceType: "ReconciliationRequest", resourceId: requestId, correlationId, stage: "INVENTORY", details: { resolution } });
    return { request: { ...req, status: "RESOLVED" as const }, item };
  }
}
