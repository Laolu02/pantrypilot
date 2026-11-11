import type { OrderStatus, PolicyDecision } from "@pantrypilot/contracts";
import type { AgentRunState, Basket, PaymentAttempt, ShoppingOrder, Store } from "../../store/store";
import type { Clock } from "../../lib/clock";
import { newId } from "../../lib/ids";
import { AppError, InvalidTransitionError, UncertainOutcomeError, UniqueViolationError, conflict, notFound } from "../../lib/errors";
import { ProviderError, type ExternalOrder } from "../../integrations/commerce/commerce";
import type { CommerceRegistry } from "../../integrations/commerce/registry";
import type { InstacartChannel } from "../../integrations/commerce/instacart";
import type { PaymentAdapter } from "../../integrations/payments/payments";
import { AuditService } from "../audit/auditService";
import { InventoryService } from "../inventory/inventoryService";
import { BasketService } from "./basketService";
import { PolicyService } from "./policyService";

export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PROPOSED: ["BLOCKED", "PENDING_REVIEW", "SUBMITTING", "FAILED", "CANCELLED"],
  PENDING_REVIEW: ["APPROVED", "CANCELLED", "BLOCKED"],
  APPROVED: ["SUBMITTING", "BLOCKED", "CANCELLED", "PENDING_REVIEW"],
  SUBMITTING: ["CONFIRMED", "UNCERTAIN", "FAILED", "HANDOFF"],
  UNCERTAIN: ["CONFIRMED", "FAILED"],
  HANDOFF: ["CONFIRMED", "CANCELLED", "FAILED"],
  CONFIRMED: ["IN_TRANSIT", "DELIVERED", "CANCELLED"],
  IN_TRANSIT: ["DELIVERED", "FAILED"],
  BLOCKED: [], DELIVERED: [], FAILED: [], CANCELLED: [],
};
const APPROVAL_TTL_MS = 30 * 60 * 1000;

const RUN_MAP: Partial<Record<OrderStatus, { state: AgentRunState; outcome: string; terminal: boolean }>> = {
  BLOCKED: { state: "BLOCKED", outcome: "POLICY_BLOCKED", terminal: true },
  PENDING_REVIEW: { state: "POLICY_REVIEW", outcome: "AWAITING_OWNER_REVIEW", terminal: false },
  APPROVED: { state: "EXECUTING", outcome: "APPROVED_EXECUTING", terminal: false },
  SUBMITTING: { state: "EXECUTING", outcome: "SUBMITTING", terminal: false },
  UNCERTAIN: { state: "NEEDS_RECONCILIATION", outcome: "PROVIDER_OUTCOME_UNCERTAIN", terminal: false },
  HANDOFF: { state: "AWAITING_OWNER", outcome: "CART_READY_AWAITING_CHECKOUT", terminal: false },
  CONFIRMED: { state: "SUCCEEDED", outcome: "ORDER_PLACED_AWAITING_DELIVERY", terminal: true },
  IN_TRANSIT: { state: "SUCCEEDED", outcome: "ORDER_IN_TRANSIT", terminal: true },
  DELIVERED: { state: "SUCCEEDED", outcome: "DELIVERED_AND_STOCKED", terminal: true },
  FAILED: { state: "FAILED", outcome: "ORDER_FAILED", terminal: true },
  CANCELLED: { state: "BLOCKED", outcome: "CANCELLED_BY_OWNER", terminal: true },
};

export class OrderService {
  constructor(
    private store: Store, private clock: Clock, private audit: AuditService, private registry: CommerceRegistry,
    private payments: PaymentAdapter, private policies: PolicyService, private baskets: BasketService, private inventory: InventoryService,
    private instacart: InstacartChannel | null = null,
  ) {}
  private ord(o: { provider: string }) { return this.registry.ordering(o.provider); }

  async getOwned(householdId: string, id: string): Promise<ShoppingOrder> {
    const o = await this.store.orders.get(id);
    if (!o || o.householdId !== householdId) throw notFound("Order");
    return o;
  }
  async list(householdId: string) {
    const rows = await this.store.orders.list((o) => o.householdId === householdId);
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  async listWithPayments(householdId: string) {
    const orders = await this.list(householdId);
    const pays = await this.store.payments.list((p) => p.householdId === householdId);
    return orders.map((o) => { const p = pays.find((x) => x.orderId === o.id); return { ...o, payment: p ? { provider: p.provider, status: p.status, mode: this.payments.mode } : null }; });
  }
  async payment(orderId: string) { return this.store.payments.find((p) => p.orderId === orderId); }

  private async setStatus(order: ShoppingOrder, to: OrderStatus, note?: string, extra: Partial<ShoppingOrder> = {}): Promise<ShoppingOrder> {
    if (!TRANSITIONS[order.status].includes(to)) throw new InvalidTransitionError(`Illegal order transition ${order.status} -> ${to}`);
    const at = this.clock.now().toISOString();
    const next = await this.store.orders.update(order.id, { ...extra, status: to, updatedAt: at, history: [...order.history, { status: to, at, ...(note ? { note } : {}) }] });
    await this.syncRun(next);
    return next;
  }
  private async syncRun(order: ShoppingOrder) {
    if (!order.runId) return;
    const m = RUN_MAP[order.status];
    if (!m) return;
    await this.store.agentRuns.update(order.runId, { state: m.state, outcome: m.outcome, orderId: order.id, error: order.failureReason, finishedAt: m.terminal ? this.clock.now().toISOString() : null });
  }
  private log(order: ShoppingOrder, actor: string, action: string, correlationId: string, stage: "ORDER" | "POLICY" | "VERIFY" | "PRODUCT", outcome: "OK" | "WARN" | "FAIL", reason?: string, details?: unknown) {
    return this.audit.record({ householdId: order.householdId, actor, action, resourceType: "ShoppingOrder", resourceId: order.id, correlationId, stage, outcome, ...(reason ? { reason } : {}), details: details ?? {} });
  }

  async propose(a: { householdId: string; basket: Basket; idempotencyKey: string; runId?: string | null; actor: string; correlationId: string }): Promise<{ order: ShoppingOrder; replay: boolean }> {
    const now = this.clock.now().toISOString();
    const sig = (b: Basket) => JSON.stringify(b.lines.map((l) => [l.productId, l.quantity]));
    try {
      const order = await this.store.orders.insert({
        id: newId("ord"), householdId: a.householdId, provider: a.basket.provider, status: "PROPOSED", basket: a.basket,
        idempotencyKey: a.idempotencyKey, policyDecision: null, policySnapshot: null, externalOrderId: null, runId: a.runId ?? null,
        mock: this.registry.get(a.basket.provider).mode === "MOCK", handoff: null, failureReason: null, createdAt: now, updatedAt: now, history: [{ status: "PROPOSED", at: now }],
      });
      await this.log(order, a.actor, "ORDER_CREATED", a.correlationId, "ORDER", "OK", undefined, { idempotencyKey: a.idempotencyKey, totalMinor: a.basket.totalMinor, mock: order.mock });
      return { order, replay: false };
    } catch (e) {
      if (!(e instanceof UniqueViolationError)) throw e;
      const existing = await this.store.orders.find((o) => o.householdId === a.householdId && o.idempotencyKey === a.idempotencyKey);
      if (!existing) throw e;
      if (sig(existing.basket) !== sig(a.basket)) throw conflict("IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used with a different basket");
      return { order: existing, replay: true };
    }
  }

  private async validApproval(order: ShoppingOrder): Promise<boolean> {
    if (order.status !== "APPROVED") return false;
    const policy = await this.policies.get(order.householdId);
    const now = this.clock.now().getTime();
    const appr = await this.store.approvals.list((x) => x.orderId === order.id && x.decision === "APPROVED");
    return appr.some((x) => new Date(x.expiresAt).getTime() > now && x.policyVersion === policy.version);
  }

  /** Evaluate and persist the decision. DENY blocks; REVIEW parks for the owner; ALLOW leaves it ready to execute. */
  async evaluate(householdId: string, orderId: string, actor: string, correlationId: string): Promise<{ order: ShoppingOrder; decision: PolicyDecision }> {
    return this.store.withLock(`ord:${orderId}`, async () => {
      let order = await this.getOwned(householdId, orderId);
      if (!["PROPOSED", "APPROVED", "PENDING_REVIEW"].includes(order.status)) return { order, decision: order.policyDecision! };
      const { decision, policy } = await this.policies.evaluate(householdId, order.basket, { excludeOrderId: order.id, approved: await this.validApproval(order) });
      order = await this.store.orders.update(order.id, { policyDecision: decision, policySnapshot: policy });
      await this.log(order, actor, "POLICY_EVALUATED", correlationId, "POLICY", decision.decision === "ALLOW" ? "OK" : "WARN", decision.decision, { decision: decision.decision, reasons: decision.reasons.map((r) => r.code), policyVersion: policy.version });
      if (decision.decision === "DENY") {
        order = await this.setStatus(order, "BLOCKED", decision.reasons.map((r) => r.code).join(","), { failureReason: decision.reasons.filter((r) => r.severity === "DENY").map((r) => r.code).join(",") });
        await this.log(order, actor, "ORDER_BLOCKED", correlationId, "POLICY", "WARN", order.failureReason ?? undefined);
      } else if (decision.decision === "REVIEW" && ["PROPOSED", "APPROVED"].includes(order.status)) {
        order = await this.setStatus(order, "PENDING_REVIEW", decision.reasons.map((r) => r.code).join(","));
        await this.log(order, actor, "ORDER_REVIEW_REQUESTED", correlationId, "POLICY", "WARN");
      }
      return { order, decision };
    });
  }

  /**
   * Re-prices from the provider and re-runs policy immediately before calling out.
   * Provider timeouts leave the order UNCERTAIN: never retried blindly.
   */
  async execute(householdId: string, orderId: string, actor: string, correlationId: string): Promise<ShoppingOrder> {
    return this.store.withLock(`ord:${orderId}`, async () => {
      let order = await this.getOwned(householdId, orderId);
      if (!["PROPOSED", "APPROVED"].includes(order.status)) throw conflict("ORDER_NOT_EXECUTABLE", `Order is ${order.status}`);

      const fresh = await this.baskets.rebuild(order.basket.lines.map((l) => ({ storeProductId: l.storeProductId, quantity: l.quantity, canonicalKey: l.canonicalKey })), order.basket.reason);
      if (fresh.totalMinor !== order.basket.totalMinor)
        await this.log(order, actor, "PRICE_CHANGED", correlationId, "PRODUCT", "WARN", undefined, { fromMinor: order.basket.totalMinor, toMinor: fresh.totalMinor });
      order = await this.store.orders.update(order.id, { basket: fresh });

      const { decision, policy } = await this.policies.evaluate(householdId, fresh, { excludeOrderId: order.id, approved: await this.validApproval(order) });
      order = await this.store.orders.update(order.id, { policyDecision: decision, policySnapshot: policy });
      await this.log(order, actor, "POLICY_RECHECKED", correlationId, "POLICY", decision.decision === "ALLOW" ? "OK" : "WARN", decision.decision, { reasons: decision.reasons.map((r) => r.code), policyVersion: policy.version });
      if (decision.decision === "DENY") {
        order = await this.setStatus(order, "BLOCKED", "recheck", { failureReason: decision.reasons.filter((r) => r.severity === "DENY").map((r) => r.code).join(",") });
        await this.log(order, actor, "ORDER_BLOCKED", correlationId, "POLICY", "WARN", order.failureReason ?? undefined);
        return order;
      }
      if (decision.decision === "REVIEW") {
        order = await this.setStatus(order, "PENDING_REVIEW", "recheck");
        await this.log(order, actor, "ORDER_REVIEW_REQUESTED", correlationId, "POLICY", "WARN");
        return order;
      }

      order = await this.setStatus(order, "SUBMITTING");
      const adapter = this.registry.get(order.provider);
      await this.log(order, actor, "ORDER_SUBMITTING", correlationId, "ORDER", "OK", undefined, { provider: adapter.name, mock: order.mock, handoff: !adapter.capabilities.placeOrder });
      const idem = order.idempotencyKey;

      // Providers whose API cannot place orders: prepare a cart/list and stop. No payment, no money moves.
      if (!adapter.capabilities.placeOrder) {
        try {
          const h = await adapter.prepareHandoff!({ householdId, reference: idem, lines: order.basket.lines.map((l) => ({ externalId: l.storeProductId.slice(l.storeProductId.indexOf(":") + 1), name: l.name, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, url: l.url })) });
          order = await this.setStatus(order, "HANDOFF", "cart prepared; owner completes checkout", { externalOrderId: h.reference, handoff: { links: h.links, note: h.note, preparedAt: this.clock.now().toISOString() } });
          await this.log(order, actor, "ORDER_HANDOFF_READY", correlationId, "ORDER", "WARN", "OWNER_CHECKOUT_REQUIRED", { provider: adapter.name, links: h.links.length });
        } catch (e) {
          const code = e instanceof ProviderError ? e.code : "HANDOFF_FAILED";
          order = await this.setStatus(order, "FAILED", code, { failureReason: code });
          await this.log(order, actor, "ORDER_FAILED", correlationId, "ORDER", "FAIL", code, { stockChanged: false });
        }
        return order;
      }

      const ordering = this.ord(order);
      let pay = await this.payment(order.id);
      if (!pay) pay = await this.store.payments.insert({ id: newId("pa"), householdId, orderId: order.id, provider: this.payments.name, status: "PENDING", providerReference: null, captureReference: null, idempotencyKey: idem, amountMinor: order.basket.totalMinor, currency: order.basket.currency, createdAt: this.clock.now().toISOString(), updatedAt: this.clock.now().toISOString() });

      // 1. Hold the exact total in the user's own payment account BEFORE anything is ordered. No hold, no order.
      const held = await this.hold(order, pay, actor, correlationId);
      if (held.stop) return held.order;
      order = held.order;

      // 2. Place the retailer order.
      let ext: ExternalOrder;
      try {
        ext = await ordering.createOrder({ reference: idem, currency: order.basket.currency, totalMinor: order.basket.totalMinor, lines: order.basket.lines.map((l) => ({ externalId: l.productId, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor })) });
      } catch (e) {
        if (e instanceof UncertainOutcomeError) {
          // The hold stays in place: reconciliation decides between capture and release using the provider's own records.
          order = await this.setStatus(order, "UNCERTAIN", "createOrder timed out");
          await this.log(order, actor, "ORDER_UNCERTAIN", correlationId, "ORDER", "FAIL", "PROVIDER_TIMEOUT");
          return order;
        }
        if (e instanceof ProviderError) {
          await this.release(order, actor, correlationId);
          order = await this.setStatus(order, "FAILED", e.code, { failureReason: e.code });
          await this.log(order, actor, "ORDER_FAILED", correlationId, "ORDER", "FAIL", order.failureReason ?? undefined, { stockChanged: false, retailerCalled: false, paymentDetail:e.detail });
          if (process.env.NODE_ENV !== "test") await this.log(order, actor, "ORDER_FAILED", correlationId, "ORDER", "FAIL", e.code, { stockChanged: false, paymentReleased: true });
          return order;
        }
        throw e;
      }
      order = await this.store.orders.update(order.id, { externalOrderId: ext.externalOrderId });
      // 3. Verify with the provider, then capture. Capture happens only after the retailer confirms.
      return this.settle(order, actor, correlationId);
    });
  }

  private touchPay(id: string, patch: Record<string, unknown>) { return this.store.payments.update(id, { ...patch, updatedAt: this.clock.now().toISOString() }); }

  private async hold(order: ShoppingOrder, pay: PaymentAttempt, actor: string, correlationId: string): Promise<{ stop: true; order: ShoppingOrder } | { stop: false; order: ShoppingOrder }> {
    try {
      const res = await this.payments.authorize({ householdId: order.householdId, idempotencyKey: order.idempotencyKey, amountMinor: order.basket.totalMinor, currency: order.basket.currency, orderReference: order.id });
      if (res.status !== "AUTHORIZED") {
        await this.touchPay(pay.id, { status: "FAILED" });
        order = await this.setStatus(order, "FAILED", res.failureCode, { failureReason: `PAYMENT_${res.failureCode ?? "FAILED"}` });
        await this.log(order, actor, "ORDER_FAILED", correlationId, "ORDER", "FAIL", order.failureReason ?? undefined, { stockChanged: false, retailerCalled: false, paymentDetail: res.detail });
        if (process.env.NODE_ENV !== "test") console.warn(`[payment] ${this.payments.name} refused the hold for ${order.id}: ${res.failureCode} ${res.detail ?? ""}`);
        return { stop: true, order };
      }
      await this.touchPay(pay.id, { status: "AUTHORIZED", providerReference: res.reference });
      await this.log(order, actor, "PAYMENT_HELD", correlationId, "ORDER", "OK", undefined, { paymentProvider: this.payments.name, paymentMode: this.payments.mode, amountMinor: order.basket.totalMinor });
      return { stop: false, order };
    } catch (e) {
      if (!(e instanceof UncertainOutcomeError)) throw e;
      await this.touchPay(pay.id, { status: "UNKNOWN" });
      order = await this.setStatus(order, "UNCERTAIN", "payment hold timed out");
      await this.log(order, actor, "ORDER_UNCERTAIN", correlationId, "ORDER", "FAIL", "PAYMENT_TIMEOUT");
      return { stop: true, order };
    }
  }

  /** Give the user's money back to them: void an uncaptured hold. Best effort, always audited. */
  private async release(order: ShoppingOrder, actor: string, correlationId: string): Promise<void> {
    const pay = await this.payment(order.id);
    if (!pay || !["AUTHORIZED", "UNKNOWN", "PENDING"].includes(pay.status)) return;
    let ref = pay.providerReference;
    if (!ref) {
      const st = await this.payments.getStatus(order.idempotencyKey, null).catch(() => null);
      ref = st?.status === "AUTHORIZED" ? st.reference : null;
    }
    if (!ref) { await this.touchPay(pay.id, { status: "FAILED" }); return; } // nothing was ever held, as far as the provider shows
    try {
      const r = await this.payments.voidAuthorization({ householdId: order.householdId, idempotencyKey: order.idempotencyKey, authorizationRef: ref });
      if (r.status === "VOIDED") { await this.touchPay(pay.id, { status: "VOIDED", providerReference: ref }); await this.log(order, actor, "PAYMENT_RELEASED", correlationId, "ORDER", "OK"); }
      else await this.log(order, actor, "HOLD_RELEASE_FAILED", correlationId, "ORDER", "FAIL", r.failureCode);
    } catch { await this.log(order, actor, "HOLD_RELEASE_UNCERTAIN", correlationId, "ORDER", "WARN", "CHECK_PAYMENT_PROVIDER"); }
  }

  /** Provider state is the source of truth for CONFIRMED. A model's say-so never is. Capture only after verification. */
  private async settle(order: ShoppingOrder, actor: string, correlationId: string): Promise<ShoppingOrder> {
    const ordering = this.ord(order);
    const ext = await ordering.getOrder(order.externalOrderId!);
    let pay = await this.payment(order.id);
    const placed = ["PLACED", "CONFIRMED", "IN_TRANSIT", "DELIVERED"].includes(ext.status) && ext.totalMinor === order.basket.totalMinor;
    if (!placed || !pay || !["AUTHORIZED", "CAPTURED"].includes(pay.status)) {
      if (order.status === "SUBMITTING") order = await this.setStatus(order, "UNCERTAIN", "verification mismatch");
      await this.log(order, actor, "VERIFICATION_FAILED", correlationId, "VERIFY", "FAIL", "PROVIDER_MISMATCH", { providerStatus: ext.status, paymentStatus: pay?.status });
      return order;
    }
    if (pay.status === "AUTHORIZED") {
      try {
        const cap = await this.payments.capture({ householdId: order.householdId, idempotencyKey: order.idempotencyKey, authorizationRef: pay.providerReference!, amountMinor: order.basket.totalMinor, currency: order.basket.currency });
        if (cap.status !== "CAPTURED") {
          // The retailer order exists but we cannot be paid: undo both sides.
          try { await ordering.cancelOrder?.(ext.externalOrderId); } catch { /* audited via the failure below */ }
          await this.release(order, actor, correlationId);
          order = await this.setStatus(order, "FAILED", cap.failureCode, { failureReason: `PAYMENT_${cap.failureCode ?? "CAPTURE_FAILED"}` });
          await this.log(order, actor, "ORDER_FAILED", correlationId, "ORDER", "FAIL", order.failureReason ?? undefined, { stockChanged: false, retailerOrderCancelled: true });
          return order;
        }
        pay = await this.touchPay(pay.id, { status: "CAPTURED", captureReference: cap.reference });
        await this.log(order, actor, "PAYMENT_CAPTURED", correlationId, "VERIFY", "OK", undefined, { paymentProvider: this.payments.name, paymentMode: this.payments.mode });
      } catch (e) {
        if (!(e instanceof UncertainOutcomeError)) throw e;
        await this.touchPay(pay.id, { status: "UNKNOWN" });
        if (order.status === "SUBMITTING") order = await this.setStatus(order, "UNCERTAIN", "capture timed out");
        await this.log(order, actor, "ORDER_UNCERTAIN", correlationId, "ORDER", "FAIL", "CAPTURE_TIMEOUT");
        return order;
      }
    }
    order = await this.setStatus(order, "CONFIRMED", "verified with provider; payment captured");
    await this.log(order, actor, "ORDER_VERIFIED", correlationId, "VERIFY", "OK", undefined, { externalOrderId: ext.externalOrderId, paymentReference: pay?.captureReference, providerStatus: ext.status, mock: order.mock, paymentMode: this.payments.mode });
    return order;
  }

  async approve(householdId: string, orderId: string, actor: string): Promise<ShoppingOrder> {
    const correlationId = newId("cor");
    const order = await this.store.withLock(`ord:${orderId}`, async () => {
      const o = await this.getOwned(householdId, orderId);
      if (o.status !== "PENDING_REVIEW") throw conflict("NOT_PENDING_REVIEW", `Order is ${o.status}`);
      const policy = await this.policies.get(householdId);
      const now = this.clock.now();
      await this.store.approvals.insert({ id: newId("appr"), householdId, orderId, actor, decision: "APPROVED", policyVersion: policy.version, expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS).toISOString(), createdAt: now.toISOString() });
      const next = await this.setStatus(o, "APPROVED", `approved by ${actor}`);
      await this.log(next, actor, "ORDER_APPROVED", correlationId, "ORDER", "OK", undefined, { policyVersion: policy.version });
      return next;
    });
    return this.execute(householdId, order.id, actor, correlationId);
  }

  async reject(householdId: string, orderId: string, actor: string): Promise<ShoppingOrder> {
    return this.store.withLock(`ord:${orderId}`, async () => {
      const o = await this.getOwned(householdId, orderId);
      if (o.status !== "PENDING_REVIEW") throw conflict("NOT_PENDING_REVIEW", `Order is ${o.status}`);
      const policy = await this.policies.get(householdId);
      const now = this.clock.now();
      await this.store.approvals.insert({ id: newId("appr"), householdId, orderId, actor, decision: "REJECTED", policyVersion: policy.version, expiresAt: now.toISOString(), createdAt: now.toISOString() });
      const next = await this.setStatus(o, "CANCELLED", `rejected by ${actor}`);
      await this.log(next, actor, "ORDER_REJECTED", newId("cor"), "ORDER", "OK");
      return next;
    });
  }

  async cancel(householdId: string, orderId: string, actor: string): Promise<ShoppingOrder> {
    return this.store.withLock(`ord:${orderId}`, async () => {
      const o = await this.getOwned(householdId, orderId);
      if (o.status === "CONFIRMED") {
        const ordering = this.ord(o);
        if (!ordering.cancelOrder) throw conflict("CANCEL_UNSUPPORTED", "Provider does not support cancellation");
        try { await ordering.cancelOrder(o.externalOrderId!); } catch (e) { throw conflict("PROVIDER_REFUSED_CANCEL", e instanceof Error ? e.message : "Provider refused cancellation"); }
        const pay = await this.payment(o.id);
        if (pay?.status === "CAPTURED" && pay.captureReference && this.payments.refund) {
          try {
            const r = await this.payments.refund({ householdId, idempotencyKey: o.idempotencyKey, captureRef: pay.captureReference, amountMinor: o.basket.totalMinor, currency: o.basket.currency });
            if (r.refunded) await this.touchPay(pay.id, { status: "REFUNDED" });
            await this.log(o, actor, r.refunded ? "PAYMENT_REFUNDED" : "REFUND_FAILED", newId("cor"), "ORDER", r.refunded ? "OK" : "FAIL");
          } catch { await this.log(o, actor, "REFUND_UNCERTAIN", newId("cor"), "ORDER", "WARN", "CHECK_PAYMENT_PROVIDER"); }
        }
      } else if (!["PROPOSED", "PENDING_REVIEW", "APPROVED", "HANDOFF"].includes(o.status)) throw conflict("NOT_CANCELLABLE", `Order is ${o.status}`);
      const next = await this.setStatus(o, "CANCELLED", `cancelled by ${actor}`);
      await this.log(next, actor, "ORDER_CANCELLED", newId("cor"), "ORDER", "OK");
      return next;
    });
  }

  /** Resolve an UNCERTAIN order by asking the providers, using the idempotency key. Never by placing a new order blindly. */
  async reconcileUncertain(householdId: string, orderId: string, actor: string): Promise<ShoppingOrder> {
    const correlationId = newId("cor");
    return this.store.withLock(`ord:${orderId}`, async () => {
      let order = await this.getOwned(householdId, orderId);
      if (order.status !== "UNCERTAIN") throw conflict("NOT_UNCERTAIN", `Order is ${order.status}`);
      const ordering = this.ord(order);
      const found = order.externalOrderId ? await ordering.getOrder(order.externalOrderId) : await ordering.findByReference(order.idempotencyKey);
      if (!found) {
        // Nothing was placed at the retailer: release any hold and fail safely. Safe to propose again.
        await this.release(order, actor, correlationId);
        order = await this.setStatus(order, "FAILED", "not placed at provider", { failureReason: "NOT_PLACED_AT_PROVIDER" });
        await this.log(order, actor, "ORDER_RECONCILED", correlationId, "VERIFY", "WARN", "NOT_PLACED_AT_PROVIDER", { safeToRepropose: true });
        return order;
      }
      order = await this.store.orders.update(order.id, { externalOrderId: found.externalOrderId });
      let pay = await this.payment(order.id);
      if (!pay) throw new AppError(500, "PAYMENT_RECORD_MISSING", "Payment attempt missing");
      if (["UNKNOWN", "PENDING"].includes(pay.status)) {
        const st = await this.payments.getStatus(order.idempotencyKey, pay.providerReference);
        if (st.status === "CAPTURED") pay = await this.touchPay(pay.id, { status: "CAPTURED", captureReference: st.reference });
        else if (st.status === "AUTHORIZED") pay = await this.touchPay(pay.id, { status: "AUTHORIZED", providerReference: st.reference });
        else if (st.status === "NOT_FOUND") {
          // The payment provider has no record. Re-sending the SAME idempotency key cannot create a second hold.
          try {
            const res = await this.payments.authorize({ householdId, idempotencyKey: order.idempotencyKey, amountMinor: order.basket.totalMinor, currency: order.basket.currency, orderReference: order.id });
            if (res.status !== "AUTHORIZED") throw new ProviderError(res.failureCode ?? "PAYMENT_FAILED", "payment refused");
            pay = await this.touchPay(pay.id, { status: "AUTHORIZED", providerReference: res.reference });
          } catch (e) {
            if (e instanceof UncertainOutcomeError) { await this.log(order, actor, "ORDER_RECONCILED", correlationId, "VERIFY", "FAIL", "STILL_UNCERTAIN"); return order; }
            if (!(e instanceof ProviderError)) throw e;
            try { await ordering.cancelOrder?.(found.externalOrderId); } catch { /* audited below */ }
            await this.touchPay(pay.id, { status: "FAILED" });
            order = await this.setStatus(order, "FAILED", "payment failed", { failureReason: "PAYMENT_FAILED" });
            await this.log(order, actor, "ORDER_RECONCILED", correlationId, "VERIFY", "FAIL", "PAYMENT_FAILED");
            return order;
          }
        } else {
          try { await ordering.cancelOrder?.(found.externalOrderId); } catch { /* audited below */ }
          await this.touchPay(pay.id, { status: "FAILED" });
          order = await this.setStatus(order, "FAILED", "payment failed", { failureReason: "PAYMENT_FAILED" });
          await this.log(order, actor, "ORDER_RECONCILED", correlationId, "VERIFY", "FAIL", "PAYMENT_FAILED");
          return order;
        }
      }
      await this.log(order, actor, "ORDER_RECONCILED", correlationId, "VERIFY", "OK", undefined, { externalOrderId: found.externalOrderId });
      return this.settle(order, actor, correlationId);
    });
  }

  /** Stock increases only here: on provider-verified delivery, or explicit user confirmation. */
  async confirmDelivery(householdId: string, orderId: string, source: "PROVIDER" | "USER", actor: string): Promise<ShoppingOrder> {
    const correlationId = newId("cor");
    return this.store.withLock(`ord:${orderId}`, async () => {
      let order = await this.getOwned(householdId, orderId);
      if (order.status === "DELIVERED") return order; // idempotent: never double-stock
      if (!["CONFIRMED", "IN_TRANSIT"].includes(order.status)) throw conflict("NOT_DELIVERABLE", `Order is ${order.status}`);
      if (source === "PROVIDER") {
        if (!this.registry.get(order.provider).capabilities.placeOrder) throw conflict("NOT_VERIFIABLE", "This store has no order API; confirm delivery yourself");
        const ext = await this.ord(order).getOrder(order.externalOrderId!);
        if (ext.status !== "DELIVERED") throw conflict("NOT_DELIVERED_YET", `Provider reports ${ext.status}`);
      }
      for (const l of order.basket.lines)
        await this.inventory.deliver(householdId, actor, l.canonicalKey, l.name, l.quantity * l.packSize, l.unit, correlationId, order.id);
      order = await this.setStatus(order, "DELIVERED", source === "USER" ? `confirmed by ${actor}` : "provider verified");
      await this.log(order, actor, "ORDER_DELIVERED", correlationId, "VERIFY", "OK", undefined, { source });
      return order;
    });
  }

  /** The owner says they finished checkout at the store. We cannot verify this, and the audit trail says so. */
  async confirmCheckout(householdId: string, orderId: string, actor: string): Promise<ShoppingOrder> {
    return this.store.withLock(`ord:${orderId}`, async () => {
      let o = await this.getOwned(householdId, orderId);
      if (o.status !== "HANDOFF") throw conflict("NOT_AWAITING_CHECKOUT", `Order is ${o.status}`);
      o = await this.setStatus(o, "CONFIRMED", `checkout attested by ${actor}; not provider-verified`);
      await this.log(o, actor, "ORDER_CHECKOUT_ATTESTED", newId("cor"), "VERIFY", "WARN", "OWNER_ATTESTED", { verified: false });
      return o;
    });
  }

  /** Also send the basket to Instacart as a shopping list the owner can check out there. */
  async addInstacartLink(householdId: string, orderId: string, actor: string): Promise<ShoppingOrder> {
    return this.store.withLock(`ord:${orderId}`, async () => {
      const o = await this.getOwned(householdId, orderId);
      if (!this.instacart) throw new AppError(409, "INSTACART_NOT_CONFIGURED", "Instacart is not configured");
      if (o.status !== "HANDOFF" || !o.handoff) throw conflict("NOT_AWAITING_CHECKOUT", `Order is ${o.status}`);
      let url: string;
      try { url = await this.instacart!.createListLink({ title: "PantryPilot restock", lines: o.basket.lines.map((l) => ({ name: l.name, quantity: l.quantity })) }); }
      catch (e) { throw new AppError(502, "INSTACART_FAILED", e instanceof ProviderError ? e.code : "Instacart request failed"); }
      const next = await this.store.orders.update(o.id, { handoff: { ...o.handoff, links: [...o.handoff.links.filter((l) => l.label !== "Instacart list"), { label: "Instacart list", url }] } });
      await this.log(next, actor, "HANDOFF_LINK_ADDED", newId("cor"), "ORDER", "OK", undefined, { channel: "instacart" });
      return next;
    });
  }

  /** Pull provider status; used by the demo "advance" control and by polling. */
  async sync(householdId: string, orderId: string, actor: string): Promise<ShoppingOrder> {
    const order = await this.getOwned(householdId, orderId);
    if (!order.externalOrderId || !["CONFIRMED", "IN_TRANSIT"].includes(order.status) || !this.registry.get(order.provider).capabilities.placeOrder) return order;
    const ext = await this.ord(order).getOrder(order.externalOrderId);
    if (ext.status === "DELIVERED") return this.confirmDelivery(householdId, orderId, "PROVIDER", actor);
    if (ext.status === "IN_TRANSIT" && order.status === "CONFIRMED")
      return this.store.withLock(`ord:${orderId}`, async () => this.setStatus(await this.getOwned(householdId, orderId), "IN_TRANSIT", "provider in transit"));
    return order;
  }
}
