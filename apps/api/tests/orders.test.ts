import { describe, expect, it } from "vitest";
import { setup, HHID } from "./helpers";

const lowMilk = async (t: Awaited<ReturnType<typeof setup>>) => t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
const milkQty = async (t: Awaited<ReturnType<typeof setup>>) => (await t.c.inventory.findByKey(HHID, "milk"))!.quantity;

describe("order execution safety", () => {
  it("concurrent runs for the same need create exactly one order", async () => {
    const t = await setup();
    await t.c.inventory.observe(HHID, "test", "item_milk", 180, 0.9, "2026-10-16T09:00:00.000Z", "cor_x");
    const runs = await Promise.all([1, 2, 3].map(() => t.c.agent.runReplenishment(HHID, { canonicalKey: "milk", trigger: { type: "USER_ACTION" } })));
    expect(await t.c.store.orders.list()).toHaveLength(1);
    expect(t.c.commerce.orderCount()).toBe(1);
    expect(t.c.commerce.createCalls).toBe(1);
    expect(runs.map((r) => r.outcome).sort()).toEqual(["ORDER_PLACED_AWAITING_DELIVERY", "SKIPPED_PENDING_ORDER", "SKIPPED_PENDING_ORDER"]);
  });

  it("POST /shopping/orders is idempotent: same key, same order, one provider call", async () => {
    const t = await setup();
    const cart = (await t.me.post("/shopping/carts", { reason: "test", lines: [{ storeProductId: "marketfield-mock:p_eggs_12", quantity: 1 }] })).body;
    const post = (key: string | null) => {
      const r = t.me.post("/shopping/orders", { cartId: cart.id });
      return key ? r.set("Idempotency-Key", key) : r;
    };
    expect((await post(null)).status).toBe(400);
    const [a, b] = await Promise.all([post("k-1"), post("k-1")]);
    expect([a.body.order.id]).toEqual([b.body.order.id]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(t.c.commerce.createCalls).toBe(1);
    // same key with a different basket is a client error, not a second order
    const other = (await t.me.post("/shopping/carts", { reason: "x", lines: [{ storeProductId: "marketfield-mock:p_eggs_6", quantity: 1 }] })).body;
    const reuse = await t.me.post("/shopping/orders", { cartId: other.id }).set("Idempotency-Key", "k-1");
    expect(reuse.status).toBe(409);
    expect(reuse.body.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("recomputes prices server-side and ignores client-supplied totals", async () => {
    const t = await setup();
    const cart = await t.me.post("/shopping/carts", { reason: "x", totalMinor: 1, lines: [{ storeProductId: "marketfield-mock:p_eggs_12", quantity: 1, unitPriceMinor: 1 }] });
    expect(cart.body.basket.lines[0].unitPriceMinor).toBe(250);
    expect(cart.body.basket.totalMinor).toBe(250 + 199);
    expect((await t.me.post("/shopping/carts", { lines: [{ storeProductId: "marketfield-mock:nope", quantity: 1 }] })).status).toBe(422);
  });

  it("provider timeout after commit leaves the order UNCERTAIN, never retries blindly, and reconciles by reference", async () => {
    const t = await setup();
    await t.me.post("/demo/faults", { commerce: "TIMEOUT_AFTER_COMMIT" });
    const r = await lowMilk(t);
    expect(r.body.run.state).toBe("NEEDS_RECONCILIATION");
    const order = (await t.c.store.orders.list())[0]!;
    expect(order.status).toBe("UNCERTAIN");
    expect(t.c.commerce.createCalls).toBe(1);
    expect(await milkQty(t)).toBe(180);

    // cannot approve/execute an uncertain order
    expect((await t.me.post(`/shopping/orders/${order.id}/approve`)).status).toBe(409);

    const rec = await t.me.post(`/shopping/orders/${order.id}/reconcile`);
    expect(rec.body.order.status).toBe("CONFIRMED");
    expect(t.c.commerce.orderCount()).toBe(1); // still exactly one provider order
    expect(t.c.commerce.createCalls).toBe(1);
    expect(t.c.mockPayments.executeCalls).toBe(1);
    expect((await t.c.store.agentRuns.list())[0]!.state).toBe("SUCCEEDED");
  });

  it("provider timeout before commit reconciles to FAILED (safe to re-propose), with no phantom order", async () => {
    const t = await setup();
    await t.me.post("/demo/faults", { commerce: "TIMEOUT_BEFORE_COMMIT" });
    await lowMilk(t);
    const order = (await t.c.store.orders.list())[0]!;
    expect(order.status).toBe("UNCERTAIN");
    const rec = await t.me.post(`/shopping/orders/${order.id}/reconcile`);
    expect(rec.body.order.status).toBe("FAILED");
    expect(rec.body.order.failureReason).toBe("NOT_PLACED_AT_PROVIDER");
    expect(t.c.commerce.orderCount()).toBe(0);
    expect(await milkQty(t)).toBe(180);
  });

  it("the payment is held BEFORE the retailer is called, and captured only after the retailer confirms", async () => {
    const t = await setup();
    await lowMilk(t);
    const actions = (await t.c.audit.recent(HHID)).map((a) => a.action).reverse();
    expect(actions.indexOf("PAYMENT_HELD")).toBeGreaterThan(-1);
    expect(actions.indexOf("PAYMENT_HELD")).toBeLessThan(actions.indexOf("ORDER_VERIFIED"));
    expect(actions.indexOf("PAYMENT_HELD")).toBeLessThan(actions.indexOf("PAYMENT_CAPTURED"));
    expect((await t.c.store.payments.list())[0]!.status).toBe("CAPTURED");
    expect(t.c.mockPayments.captureCalls).toBe(1);
  });

  it("a payment-hold timeout never reaches the retailer; reconciling releases the hold instead of charging", async () => {
    const t = await setup();
    await t.me.post("/demo/faults", { payment: "TIMEOUT_AFTER_COMMIT" });
    await lowMilk(t);
    const order = (await t.c.store.orders.list())[0]!;
    expect(order.status).toBe("UNCERTAIN");
    expect(t.c.commerce.createCalls).toBe(0);
    const rec = await t.me.post(`/shopping/orders/${order.id}/reconcile`);
    expect(rec.body.order.status).toBe("FAILED");
    expect(rec.body.order.failureReason).toBe("NOT_PLACED_AT_PROVIDER");
    expect(t.c.mockPayments.voidCalls).toBe(1);
    expect(t.c.mockPayments.captureCalls).toBe(0);
    expect((await t.c.store.payments.list())[0]!.status).toBe("VOIDED");
    expect(t.c.commerce.orderCount()).toBe(0);
  });

  it("a declined payment fails the order without contacting the retailer, and never adds stock", async () => {
    const t = await setup();
    await t.me.post("/demo/faults", { payment: "DECLINE" });
    const r = await lowMilk(t);
    expect(r.body.run.state).toBe("FAILED");
    const order = (await t.c.store.orders.list())[0]!;
    expect(order.failureReason).toBe("PAYMENT_CARD_DECLINED");
    expect(t.c.commerce.createCalls).toBe(0);
    expect(await milkQty(t)).toBe(180);
    expect((await t.c.inventory.list(HHID)).find((i) => i.canonicalKey === "milk")!.inboundQty).toBe(0);
  });

  it("if the capture fails, the retailer order is cancelled, the hold is released and nothing is stocked", async () => {
    const t = await setup();
    await t.me.post("/demo/faults", { capture: "FAIL" });
    await lowMilk(t);
    const order = (await t.c.store.orders.list())[0]!;
    expect(order.status).toBe("FAILED");
    expect(order.failureReason).toBe("PAYMENT_CAPTURE_DECLINED");
    expect((await t.c.commerce.getOrder(order.externalOrderId!)).status).toBe("CANCELLED");
    expect(t.c.mockPayments.voidCalls).toBe(1);
    expect(await milkQty(t)).toBe(180);
  });

  it("cancelling a confirmed order refunds the captured payment", async () => {
    const t = await setup();
    await lowMilk(t);
    const order = (await t.c.store.orders.list())[0]!;
    expect((await t.me.post(`/shopping/orders/${order.id}/cancel`)).body.order.status).toBe("CANCELLED");
    expect((await t.c.store.payments.list())[0]!.status).toBe("REFUNDED");
  });

  it("re-checks price at execution time: an out-of-policy price change blocks the order before any provider call", async () => {
    const t = await setup();
    await t.c.inventory.observe(HHID, "test", "item_milk", 180, 0.9, "2026-10-16T09:00:00.000Z", "cor_x");
    const plan = await t.c.baskets.plan(HHID, "milk", 3320, (await t.c.policies.get(HHID)).allowlistedProductIds, "t");
    const { order } = await t.c.orders.propose({ householdId: HHID, basket: plan!.basket, idempotencyKey: "pc-1", actor: "t", correlationId: "c" });
    expect((await t.c.orders.evaluate(HHID, order.id, "t", "c")).decision.decision).toBe("ALLOW");
    t.c.commerce.setPrice("p_milk_6pt", 1800); // above the per-item cap
    const after = await t.c.orders.execute(HHID, order.id, "t", "c");
    expect(after.status).toBe("BLOCKED");
    expect(after.failureReason).toContain("ITEM_PRICE_CAP_EXCEEDED");
    expect(t.c.commerce.createCalls).toBe(0);
  });

  it("executes at the refreshed price when the change stays inside policy, and audits it", async () => {
    const t = await setup();
    await t.c.inventory.observe(HHID, "test", "item_milk", 180, 0.9, "2026-10-16T09:00:00.000Z", "cor_x");
    const plan = await t.c.baskets.plan(HHID, "milk", 3320, (await t.c.policies.get(HHID)).allowlistedProductIds, "t");
    const { order } = await t.c.orders.propose({ householdId: HHID, basket: plan!.basket, idempotencyKey: "pc-2", actor: "t", correlationId: "c" });
    t.c.commerce.setPrice("p_milk_6pt", 240);
    const after = await t.c.orders.execute(HHID, order.id, "t", "c");
    expect(after.status).toBe("CONFIRMED");
    expect(after.basket.totalMinor).toBe(240 + 199);
    expect((await t.c.audit.recent(HHID)).some((a) => a.action === "PRICE_CHANGED")).toBe(true);
  });

  it("cannot execute an order that was never persisted or is in the wrong state", async () => {
    const t = await setup();
    await lowMilk(t);
    const order = (await t.c.store.orders.list())[0]!;
    await expect(t.c.orders.execute(HHID, order.id, "t", "c")).rejects.toMatchObject({ code: "ORDER_NOT_EXECUTABLE" });
    await expect(t.c.orders.execute(HHID, "ord_missing", "t", "c")).rejects.toMatchObject({ status: 404 });
  });

  it("the kill switch stops autonomous purchasing and is audited", async () => {
    const t = await setup();
    expect((await t.me.post("/shopping/kill-switch", { enabled: true })).body.killSwitch).toBe(true);
    const r = await lowMilk(t);
    expect(r.body.run.state).toBe("BLOCKED");
    expect((await t.c.store.orders.list())[0]!.policyDecision!.reasons.map((x) => x.code)).toContain("KILL_SWITCH_ON");
    expect(t.c.commerce.createCalls).toBe(0);
    expect((await t.c.audit.recent(HHID)).some((a) => a.action === "KILL_SWITCH_CHANGED")).toBe(true);
  });

  it("the global kill switch overrides household settings", async () => {
    const t = await setup({ GLOBAL_PURCHASE_KILL_SWITCH: "true" });
    expect((await lowMilk(t)).body.run.state).toBe("BLOCKED");
    expect(t.c.commerce.createCalls).toBe(0);
  });

  it("ALWAYS_CONFIRM parks the order for review; approving executes it; rejecting cancels it", async () => {
    const t = await setup();
    await t.me.put("/shopping/policies", { mode: "ALWAYS_CONFIRM" });
    const r = await lowMilk(t);
    expect(r.body.run.state).toBe("POLICY_REVIEW");
    const order = (await t.c.store.orders.list())[0]!;
    expect(order.status).toBe("PENDING_REVIEW");
    expect(t.c.commerce.createCalls).toBe(0);
    const approved = await t.me.post(`/shopping/orders/${order.id}/approve`);
    expect(approved.body.order.status).toBe("CONFIRMED");
    expect((await t.c.store.agentRuns.list())[0]!.state).toBe("SUCCEEDED");
    expect(await t.c.store.approvals.list()).toHaveLength(1);
  });

  it("an owner approval cannot override a DENY", async () => {
    const t = await setup();
    await t.me.put("/shopping/policies", { mode: "ALWAYS_CONFIRM" });
    await lowMilk(t);
    const order = (await t.c.store.orders.list())[0]!;
    await t.me.post("/shopping/kill-switch", { enabled: true });
    const res = await t.me.post(`/shopping/orders/${order.id}/approve`);
    expect(res.body.order.status).toBe("BLOCKED");
    expect(t.c.commerce.createCalls).toBe(0);
  });

  it("a rejected order cannot later be approved", async () => {
    const t = await setup();
    await t.me.put("/shopping/policies", { mode: "ALWAYS_CONFIRM" });
    await lowMilk(t);
    const order = (await t.c.store.orders.list())[0]!;
    expect((await t.me.post(`/shopping/orders/${order.id}/reject`)).body.order.status).toBe("CANCELLED");
    expect((await t.me.post(`/shopping/orders/${order.id}/approve`)).status).toBe(409);
  });

  it("rejects illegal state transitions", async () => {
    const t = await setup();
    await lowMilk(t);
    const order = (await t.c.store.orders.list())[0]!;
    expect((await t.me.post(`/shopping/orders/${order.id}/reject`)).status).toBe(409);
    const cancelled = await t.me.post(`/shopping/orders/${order.id}/cancel`);
    expect(cancelled.body.order.status).toBe("CANCELLED");
    expect((await t.me.post(`/shopping/orders/${order.id}/cancel`)).status).toBe(409);
  });

  it("an order is never marked mock=false by the mock adapter, and /meta says so", async () => {
    const t = await setup();
    await lowMilk(t);
    expect((await t.c.store.orders.list())[0]!.mock).toBe(true);
    const meta = await t.raw.get("/api/v1/meta");
    expect(meta.body.commerce.mode).toBe("MOCK");
    expect(meta.body.payments.mode).toBe("MOCK");
  });

  it("refuses live payments, unknown stores and live stores without credentials", async () => {
    const { loadEnv } = await import("../src/config/env");
    expect(() => loadEnv({ PAYMENT_PROVIDER: "stripe" })).toThrow(/not supported/);
    expect(() => loadEnv({ PAYMENT_PROVIDER: "paypal" })).toThrow(/missing/);
    expect(() => loadEnv({ PAYMENT_PROVIDER: "paypal", PAYPAL_CLIENT_ID: "a", PAYPAL_CLIENT_SECRET: "b", INTEGRATION_ENCRYPTION_KEY: "k", PAYPAL_BASE_URL: "https://api-m.paypal.com" })).toThrow(/sandbox/);
    expect(() => loadEnv({ COMMERCE_PROVIDERS: "tesco" })).toThrow(/unknown store/);
    expect(() => loadEnv({ COMMERCE_PROVIDERS: "mock,kroger" })).toThrow(/missing/);
    expect(() => loadEnv({ COMMERCE_PROVIDERS: "walmart" })).toThrow(/WALMART_CONSUMER_ID/);
  });

  it("redacts sensitive keys in audit details", async () => {
    const { redact } = await import("../src/lib/redact");
    expect(redact({ apiToken: "abc", nested: { cardNumber: "4111", ok: 1 } })).toEqual({ apiToken: "[redacted]", nested: { cardNumber: "[redacted]", ok: 1 } });
  });
});
