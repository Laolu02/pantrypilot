import type { AgentRun, AgentRunState, ShoppingOrder,DeliveryCadence, } from "../../store/store";
import { newId } from "../../lib/ids";
import { notFound } from "../../lib/errors";
import { OPEN } from "../shopping/policyEngine";
import type { DeviceService } from "../devices/deviceService";
import type { LlmProvider } from "./llm";
import type { ToolContext, ToolDeps, ToolRunner } from "./tools";
import { forecastStock, usableQuantity } from "../forecasting/forecast";
import { CADENCE_LABEL, addDays, horizonFor, cadenceAdjusted, localParts, recommendedLimits } from "../delivery/schedule";
import { pickDeliveryLines } from "../delivery/plan";

export interface RunTrigger { type: "DEVICE_EVENT" | "USER_ACTION" | "SCHEDULED_SCAN" | "DELIVERY_SLOT"; eventId?: string; ledgerEventId?: string; [k: string]: unknown }

/**
 * Deterministic workflow over typed tools. The LLM seam is used for explanation only.
 * It cannot override a policy result or write order/payment state.
 */
export class AgentOrchestrator {
  constructor(private d: ToolDeps & { tools: ToolRunner; llm: LlmProvider; devices: DeviceService; mock: boolean }) {}

  async getRun(householdId: string, id: string) {
    const run = await this.d.store.agentRuns.get(id);
    if (!run || run.householdId !== householdId) throw notFound("Agent run");
    const toolCalls = (await this.d.store.toolCalls.list((t) => t.runId === id)).sort((a, b) => (a.at < b.at ? -1 : 1));
    return { run, toolCalls };
  }
  async listRuns(householdId: string) {
    return (await this.d.store.agentRuns.list((r) => r.householdId === householdId)).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  /** Device event -> inventory -> (if applied) forecast and replenishment, all under one correlation id. */
  async handleDeviceEvent(raw: unknown) {
    const ingest = await this.d.devices.ingest(raw);
    if (ingest.status !== "APPLIED" || !ingest.canonicalKey) return { ingest, run: null as AgentRun | null };
    const run = await this.runReplenishment(ingest.householdId, {
      canonicalKey: ingest.canonicalKey, correlationId: ingest.correlationId,
      trigger: { type: "DEVICE_EVENT", eventId: (raw as { eventId?: string }).eventId, ...(ingest.ledgerEventId ? { ledgerEventId: ingest.ledgerEventId } : {}) },
    });
    return { ingest, run };
  }

  async scan(householdId: string): Promise<AgentRun[]> {
    const low = await this.d.inventory.list(householdId, { lowStock: true });
    const runs: AgentRun[] = [];
    for (const it of low) runs.push(await this.runReplenishment(householdId, { canonicalKey: it.canonicalKey, trigger: { type: "SCHEDULED_SCAN" } }));
    return runs;
  }

  async runReplenishment(householdId: string, opts: { canonicalKey: string; trigger: RunTrigger; correlationId?: string }): Promise<AgentRun> {
    const { store, clock, audit, tools, orders, policies, inventory } = this.d;
    const correlationId = opts.correlationId ?? newId("cor");
    const startedAt = clock.now().toISOString();
    let run = await store.agentRuns.insert({ id: newId("run"), householdId, correlationId, state: "QUEUED", trigger: opts.trigger, outcome: null, orderId: null, summary: null, startedAt, finishedAt: null, error: null });
    run = await store.agentRuns.update(run.id, { state: "RUNNING" });
    const ctx: ToolContext = { householdId, runId: run.id, correlationId, actor: "agent" };
    const end = async (state: AgentRunState, outcome: string, patch: Partial<AgentRun> = {}) =>
      store.agentRuns.update(run.id, { state, outcome, finishedAt: clock.now().toISOString(), ...patch });

    try {
      const forecast = await tools.call<any>(ctx, "forecast_stock", { canonicalKey: opts.canonicalKey });
      await audit.record({ householdId, actor: "agent", action: "FORECAST_EVALUATED", resourceType: "AgentRun", resourceId: run.id, correlationId, stage: "FORECAST", details: forecast ?? { note: "no item or profile" } });
      if (!forecast) return await end("SUCCEEDED", "NO_ITEM_OR_PROFILE");
      if (!forecast.needsReplenishment){  
         const rhythm = await horizonFor(store, clock, householdId);
        if (rhythm.cadence !== "ASAP" && opts.trigger.orderNow !== true) {
          await audit.record({ householdId, actor: "agent", action: "REPLENISHMENT_QUEUED", resourceType: "AgentRun", resourceId: run.id, correlationId, stage: "ORDER", details: { canonicalKey: opts.canonicalKey, cadence: rhythm.cadence, nextSlotDate: rhythm.nextSlotDate } });
          return await end("SUCCEEDED", "QUEUED_FOR_DELIVERY");
      }};

      return await store.withLock(`repl:${householdId}:${opts.canonicalKey}`, async () => {
        const pending = (await store.orders.list((o) => o.householdId === householdId && OPEN.includes(o.status) && o.basket.lines.some((l) => l.canonicalKey === opts.canonicalKey)))[0];
        if (pending) {
          await audit.record({ householdId, actor: "agent", action: "REPLENISHMENT_SKIPPED", resourceType: "ShoppingOrder", resourceId: pending.id, correlationId, stage: "ORDER", outcome: "WARN", reason: "ORDER_ALREADY_PENDING" });
          return end("SUCCEEDED", "SKIPPED_PENDING_ORDER", { orderId: pending.id });
        }
        if (forecast.shortfall <= 0) return end("SUCCEEDED", "NO_SHORTFALL");

        const policy = await policies.get(householdId);
        const lastLedger = (await inventory.ledger(householdId, undefined, 500)).find((e) => e.canonicalKey === opts.canonicalKey);
        const base = `repl:${householdId}:${opts.canonicalKey}:${opts.trigger.ledgerEventId ?? lastLedger?.id ?? "none"}:p${policy.version}`;
        const failed = (await store.orders.list((o) => o.idempotencyKey.startsWith(base) && ["BLOCKED", "FAILED", "CANCELLED"].includes(o.status))).length;
        const plan = await tools.call<any>(ctx, "build_replenishment_plan", { canonicalKey: opts.canonicalKey, shortfall: forecast.shortfall, idempotencyKey: `${base}:a${failed}` });
        if (!plan.orderId) {
          await audit.record({ householdId, actor: "agent", action: "NO_ELIGIBLE_PRODUCT", resourceType: "AgentRun", resourceId: run.id, correlationId, stage: "PRODUCT", outcome: "FAIL" });
          return end("FAILED", "NO_ELIGIBLE_PRODUCT", { error: "No available product could cover the shortfall" });
        }

        const ev = await tools.call<{ order: ShoppingOrder; decision: { decision: string; reasons: { code: string }[] } }>(ctx, "evaluate_purchase_policy", { orderId: plan.orderId });
        let order = ev.order;
        if (ev.decision.decision === "REVIEW") await tools.call(ctx, "request_purchase_review", { orderId: order.id });
        if (ev.decision.decision === "ALLOW") {
          order = await tools.call<ShoppingOrder>(ctx, "execute_purchase", { orderId: order.id });
          order = await tools.call<ShoppingOrder>(ctx, "verify_purchase", { orderId: order.id });
        }

        let summary: string | null = null;
        try {
          const line = order.basket.lines[0];
          const stockItem = await inventory.findByKey(householdId, opts.canonicalKey);
          summary = await this.d.llm.explain({
            canonicalKey: opts.canonicalKey, forecast, mock: order.mock, orderStatus: order.status,
            ...(stockItem ? { unit: stockItem.unit } : {}),
            ...(line ? { choice: { name: line.name, priceMinor: line.unitPriceMinor, qty: line.quantity, totalMinor: order.basket.totalMinor } } : {}),
            ...(order.policyDecision ? { decision: { decision: order.policyDecision.decision, reasons: order.policyDecision.reasons.map((r) => r.code) } } : {}),
          });
        } catch { /* an explanation failure never affects the run */ }
        return store.agentRuns.update(run.id, { summary, orderId: order.id });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await audit.record({ householdId, actor: "agent", action: "RUN_FAILED", resourceType: "AgentRun", resourceId: run.id, correlationId, stage: "SYSTEM", outcome: "FAIL", reason: msg });
      return end("FAILED", "RUN_ERROR", { error: msg });
    }
  }
    // ───────── Delivery rhythm ─────────

  async getSchedule(householdId: string) {
    const { store, clock, policies } = this.d;
    const h = await horizonFor(store, clock, householdId);
    const policy = await policies.get(householdId);
    const warnings: { code: string; message: string }[] = [];
    if (h.cadence !== "ASAP") {
      const perWeek = Math.ceil(7 / h.intervalDays);
      if (policy.maxOrdersPerWeek < perWeek)
        warnings.push({ code: "ORDERS_PER_WEEK", message: `${CADENCE_LABEL[h.cadence]} delivery can need ${perWeek} orders a week, but your limit is ${policy.maxOrdersPerWeek}. Deliveries would be blocked.` });
      if (policy.cooldownHours > h.intervalDays * 24 - 2)
        warnings.push({ code: "COOLDOWN", message: `The ${policy.cooldownHours}h cooldown is longer than the gap between deliveries, so repeat items would be blocked.` });
    }
    return {
      cadence: h.cadence, orderHour: h.orderHour, anchorDate: h.anchorDate, nextSlotDate: h.nextSlotDate, daysUntil: h.daysUntil, dueNow: h.dueNow,
      deliveriesPerWeek: h.intervalDays ? Math.ceil(7 / h.intervalDays) : null,
      warnings, recommendedLimits: recommendedLimits(h.cadence, policy), limits: { maxOrdersPerWeek: policy.maxOrdersPerWeek, cooldownHours: policy.cooldownHours },
    };
  }

  async setSchedule(householdId: string, actor: string, input: { cadence: DeliveryCadence; orderHour?: number | undefined; anchorDate?: string | undefined; applyLimits?: boolean | undefined }) {
    const { store, clock, audit, policies } = this.d;
    const existing = await store.deliverySchedules.get(householdId);
    const hh = await store.households.get(householdId);
    const today = localParts(clock.now(), hh?.timezone ?? "Europe/London").date;
    const row = {
      id: householdId, householdId, cadence: input.cadence,
      anchorDate: input.anchorDate ?? (existing && existing.cadence !== "ASAP" ? existing.anchorDate : addDays(today, 1)),
      orderHour: input.orderHour ?? existing?.orderHour ?? 8,
      lastPlacedSlot: existing?.lastPlacedSlot ?? null, updatedAt: clock.now().toISOString(),
    };
    if (existing) await store.deliverySchedules.update(householdId, row); else await store.deliverySchedules.insert(row);
    let limitsChanged = false;
    if (input.applyLimits && input.cadence !== "ASAP") {
      const cur = await policies.get(householdId);
      const rec = recommendedLimits(input.cadence, cur);
      if (rec.maxOrdersPerWeek !== cur.maxOrdersPerWeek || rec.cooldownHours !== cur.cooldownHours) { await policies.update(householdId, actor, rec); limitsChanged = true; }
    }
    await audit.record({ householdId, actor, action: "DELIVERY_SCHEDULE_CHANGED", resourceType: "DeliverySchedule", resourceId: householdId, correlationId: newId("cor"), stage: "POLICY", details: { cadence: row.cadence, orderHour: row.orderHour, anchorDate: row.anchorDate, limitsChanged } });
  }

  /** What the next delivery would contain, priced. Read-only: persists nothing. */
  async previewDelivery(householdId: string) {
    const { store, clock, policies, baskets } = this.d;
    const h = await horizonFor(store, clock, householdId);
    const policy = await policies.get(householdId);
    const hh = await store.households.get(householdId);
    const needs = await this.dueNeeds(householdId, h.daysUntil);
    const { picks, skipped } = await pickDeliveryLines(baskets, policy.allowlistedProductIds, hh?.currency ?? "GBP", needs);
    const basket = picks.length ? await baskets.rebuild(picks, "Delivery preview") : null;
    const warnings: { code: string; message: string }[] = [];
    const money = (m: number) => (m / 100).toFixed(2);
    if (basket && basket.totalMinor > policy.perOrderCapMinor) warnings.push({ code: "ORDER_CAP", message: `This delivery is about ${money(basket.totalMinor)}, over your ${money(policy.perOrderCapMinor)} per-order cap, so it would be blocked.` });
    if (basket && basket.totalMinor > policy.weeklyBudgetMinor) warnings.push({ code: "WEEKLY_BUDGET", message: `This delivery is about ${money(basket.totalMinor)}, over your ${money(policy.weeklyBudgetMinor)} weekly budget.` });
    return {
      cadence: h.cadence, nextSlotDate: h.nextSlotDate, daysUntil: h.daysUntil,
      needs: needs.map((n) => ({ canonicalKey: n.canonicalKey, name: n.name, unit: n.unit, shortfall: Math.round(n.shortfall * 10) / 10, daysOfSupply: n.daysOfSupply })),
      skipped,
      basket: basket && { currency: basket.currency, lines: basket.lines.map((l) => ({ name: l.name, quantity: l.quantity, lineTotalMinor: l.lineTotalMinor })), deliveryMinor: basket.deliveryMinor, totalMinor: basket.totalMinor },
      warnings,
    };
  }

  /** One combined order for everything due. Same policy, idempotency and verification path as a single replenishment. */
  async runDelivery(householdId: string, opts: { trigger: RunTrigger; correlationId?: string }): Promise<AgentRun> {
    const { store, clock, audit, tools, policies } = this.d;
    const correlationId = opts.correlationId ?? newId("cor");
    let run = await store.agentRuns.insert({ id: newId("run"), householdId, correlationId, state: "QUEUED", trigger: opts.trigger, outcome: null, orderId: null, summary: null, startedAt: clock.now().toISOString(), finishedAt: null, error: null });
    run = await store.agentRuns.update(run.id, { state: "RUNNING" });
    const ctx: ToolContext = { householdId, runId: run.id, correlationId, actor: "agent" };
    const end = async (state: AgentRunState, outcome: string, patch: Partial<AgentRun> = {}) =>
      store.agentRuns.update(run.id, { state, outcome, finishedAt: clock.now().toISOString(), ...patch });
    let slot: string | null = null;
    let orderPlaced = false;

    try {
      return await store.withLock(`delivery:${householdId}`, async () => {
        const h = await horizonFor(store, clock, householdId);
        slot = h.nextSlotDate;
        const needs = await this.dueNeeds(householdId, 0);
        await audit.record({ householdId, actor: "agent", action: "DELIVERY_NEEDS_EVALUATED", resourceType: "AgentRun", resourceId: run.id, correlationId, stage: "FORECAST", details: { slot: h.nextSlotDate, cadence: h.cadence, needs: needs.map((n) => ({ canonicalKey: n.canonicalKey, shortfall: n.shortfall })) } });
        if (needs.length === 0) return end("SUCCEEDED", "NOTHING_DUE");

        const policy = await policies.get(householdId);
        const base = `delivery:${householdId}:${h.nextSlotDate}:p${policy.version}`;
        const failed = (await store.orders.list((o) => o.idempotencyKey.startsWith(base) && ["BLOCKED", "FAILED", "CANCELLED"].includes(o.status))).length;
        const plan = await tools.call<any>(ctx, "build_delivery_plan", { idempotencyKey: `${base}:a${failed}`, needs: needs.map((n) => ({ canonicalKey: n.canonicalKey, shortfall: n.shortfall })) });
        if (!plan.orderId) {
          await audit.record({ householdId, actor: "agent", action: "NO_ELIGIBLE_PRODUCT", resourceType: "AgentRun", resourceId: run.id, correlationId, stage: "PRODUCT", outcome: "FAIL" });
          return end("FAILED", "NO_ELIGIBLE_PRODUCT", { error: "No available product could cover the delivery" });
        }
        orderPlaced = true;

        const ev = await tools.call<{ order: ShoppingOrder; decision: { decision: string; reasons: { code: string }[] } }>(ctx, "evaluate_purchase_policy", { orderId: plan.orderId });
        let order = ev.order;
        if (ev.decision.decision === "REVIEW") await tools.call(ctx, "request_purchase_review", { orderId: order.id });
        if (ev.decision.decision === "ALLOW") {
          order = await tools.call<ShoppingOrder>(ctx, "execute_purchase", { orderId: order.id });
          order = await tools.call<ShoppingOrder>(ctx, "verify_purchase", { orderId: order.id });
        }
        const n = plan.picked.length as number;
        const summary = `${n} item${n === 1 ? "" : "s"} for the ${CADENCE_LABEL[h.cadence]} delivery${plan.skipped.length ? `; ${plan.skipped.length} could not be sourced` : ""}`;
        return store.agentRuns.update(run.id, { summary, orderId: order.id });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await audit.record({ householdId, actor: "agent", action: "RUN_FAILED", resourceType: "AgentRun", resourceId: run.id, correlationId, stage: "SYSTEM", outcome: "FAIL", reason: msg });
      return end("FAILED", "RUN_ERROR", { error: msg });
    } finally {
      // One attempt per slot: a scheduled run always consumes it, a manual run only when it created an order.
      if (slot && (orderPlaced || opts.trigger.type === "DELIVERY_SLOT")) {
        try { await store.deliverySchedules.update(householdId, { lastPlacedSlot: slot, updatedAt: clock.now().toISOString() }); } catch { /* no schedule row */ }
      }
    }
  }

  /** Called by the scheduler. Safe to call repeatedly. */
  async runDueDeliveries(): Promise<number> {
    const rows = await this.d.store.deliverySchedules.list((s) => s.cadence !== "ASAP");
    let started = 0;
    for (const s of rows) {
      const h = await horizonFor(this.d.store, this.d.clock, s.householdId);
      if (!h.dueNow) continue;
      await this.runDelivery(s.householdId, { trigger: { type: "DELIVERY_SLOT", slot: h.nextSlotDate } });
      started++;
    }
    return started;
  }

  /** Items that will not last until the delivery after the next one. projectDays estimates stock at the delivery slot. */
  private async dueNeeds(householdId: string, projectDays: number) {
    const { store, clock, inventory } = this.d;
    const h = await horizonFor(store, clock, householdId);
    const profiles = await store.profiles.list((p) => p.householdId === householdId);
    const openOrders = await store.orders.list((o) => o.householdId === householdId && OPEN.includes(o.status));
    const inFlight = new Set(openOrders.flatMap((o) => o.basket.lines.map((l) => l.canonicalKey)));
    const out: { canonicalKey: string; name: string; unit: string; shortfall: number; daysOfSupply: number | null }[] = [];
    for (const p of profiles) {
      if (inFlight.has(p.canonicalKey)) continue;
      const item = await inventory.findByKey(householdId, p.canonicalKey);
      if (!item) continue;
      const usable = Math.max(0, usableQuantity(item, clock.now()) - p.dailyConsumption * projectDays);
      const f = forecastStock({
        profile: cadenceAdjusted(p, { intervalDays: h.intervalDays, daysUntil: 0 }),
        usableOnHand: usable, inbound: await inventory.inboundQty(householdId, p.canonicalKey), confidence: item.confidence,
      });
      if (f.needsReplenishment && f.shortfall > 0) out.push({ canonicalKey: p.canonicalKey, name: item.name, unit: item.unit, shortfall: f.shortfall, daysOfSupply: f.daysOfSupply });
    }
    return out;
  }
}
