import { describe, expect, it } from "vitest";
import { setup, HHID } from "./helpers";

describe("acceptance scenario (handoff section 1)", () => {
  it("low milk -> forecast -> basket -> policy ALLOW -> mock order -> verified -> on order, not on hand; then over-limit order is blocked", async () => {
    const t = await setup();

    // seeded state
    const before = (await t.me.get("/inventory")).body.items;
    expect(before.find((i: any) => i.canonicalKey === "milk").quantity).toBe(1300);

    // 1-3. simulated fridge event
    const res = await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    expect(res.body.ingest.status).toBe("APPLIED");
    const run = res.body.run;
    expect(run.state).toBe("SUCCEEDED");
    expect(run.outcome).toBe("ORDER_PLACED_AWAITING_DELIVERY");
    expect(run.correlationId).toBe(res.body.ingest.correlationId);
    expect(run.summary).toContain("Demo order");

    // 4. forecast + product comparison
    const detail = (await t.me.get(`/agent/runs/${run.id}`)).body;
    const tools = detail.toolCalls.map((x: any) => x.tool);
    expect(tools).toEqual(["forecast_stock", "build_replenishment_plan", "evaluate_purchase_policy", "execute_purchase", "verify_purchase"]);
    expect(detail.toolCalls.every((x: any) => x.status === "OK")).toBe(true);

    // 5-7. one idempotent mock order, verified with provider
    const orders = (await t.me.get("/shopping/orders")).body.orders;
    expect(orders).toHaveLength(1);
    const order = orders[0];
    expect(order.status).toBe("CONFIRMED");
    expect(order.mock).toBe(true);
    expect(order.basket.lines[0].productId).toBe("p_milk_6pt"); // cheapest way to cover 3,320 ml
    expect(order.basket.totalMinor).toBe(215 + 199);
    expect(order.policyDecision.decision).toBe("ALLOW");
    expect(order.policySnapshot.version).toBe(1);
    expect(t.c.commerce.orderCount()).toBe(1);
    const external = await t.c.commerce.getOrder(order.externalOrderId);
    expect(external.status).toBe("PLACED");

    // 8. on order, NOT on hand
    const milk = (await t.me.get("/inventory")).body.items.find((i: any) => i.canonicalKey === "milk");
    expect(milk.quantity).toBe(180);
    expect(milk.inboundQty).toBe(3408);

    // trace is complete and ordered under one correlation id
    const audit = (await t.me.get("/agent/activity")).body.events.filter((e: any) => e.correlationId === run.correlationId);
    const stages = [...new Set([...audit].reverse().map((e: any) => e.stage))];
    expect(stages).toEqual(["DEVICE", "INVENTORY", "FORECAST", "PRODUCT", "ORDER", "POLICY", "VERIFY"]);

    // 9. second order exceeds limits and is blocked
    const res2 = await t.me.post("/devices/simulate", { scenario: "LOW_OLIVE_OIL" });
    expect(res2.body.run.state).toBe("BLOCKED");
    const blocked = (await t.me.get("/shopping/orders")).body.orders.find((o: any) => o.status === "BLOCKED");
    const codes = blocked.policyDecision.reasons.map((r: any) => r.code);
    expect(codes).toContain("ITEM_PRICE_CAP_EXCEEDED");
    expect(codes).toContain("ORDER_CAP_EXCEEDED");
    expect(blocked.policyDecision.decision).toBe("DENY");
    expect(t.c.commerce.orderCount()).toBe(1); // nothing reached the provider
    expect(t.c.commerce.createCalls).toBe(1);
  });

  it("stock only increases after verified delivery, and only once", async () => {
    const t = await setup();
    await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    const order = (await t.c.store.orders.list())[0]!;

    expect((await t.me.post(`/shopping/orders/${order.id}/sync`)).body.order.status).toBe("CONFIRMED");
    const early = await t.me.post(`/demo/orders/${order.id}/advance`, { status: "IN_TRANSIT" });
    expect(early.body.order.status).toBe("IN_TRANSIT");
    expect((await t.c.inventory.findByKey(HHID, "milk"))!.quantity).toBe(180);

    const delivered = await t.me.post(`/demo/orders/${order.id}/advance`, { status: "DELIVERED" });
    expect(delivered.body.order.status).toBe("DELIVERED");
    expect((await t.c.inventory.findByKey(HHID, "milk"))!.quantity).toBe(180 + 3408);

    await t.me.post(`/shopping/orders/${order.id}/confirm-delivery`);
    await t.me.post(`/shopping/orders/${order.id}/sync`);
    expect((await t.c.inventory.findByKey(HHID, "milk"))!.quantity).toBe(180 + 3408);
    const run = (await t.c.store.agentRuns.list())[0]!;
    expect(run.outcome).toBe("DELIVERED_AND_STOCKED");
  });

  it("refuses provider-verified delivery that has not happened, but allows explicit user confirmation", async () => {
    const t = await setup();
    await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    const order = (await t.c.store.orders.list())[0]!;
    await expect(t.c.orders.confirmDelivery(HHID, order.id, "PROVIDER", "tester")).rejects.toMatchObject({ code: "NOT_DELIVERED_YET" });
    const r = await t.me.post(`/shopping/orders/${order.id}/confirm-delivery`);
    expect(r.body.order.status).toBe("DELIVERED");
    expect((await t.c.inventory.findByKey(HHID, "milk"))!.quantity).toBe(180 + 3408);
  });

  it("a stock level above the reorder point produces no purchase", async () => {
    const t = await setup();
    const run = (await t.me.post("/agent/runs", { type: "REPLENISHMENT", canonicalKey: "rice" })).body.runs[0];
    expect(run.outcome).toBe("NO_ACTION_ABOVE_REORDER_POINT");
    expect(await t.c.store.orders.list()).toHaveLength(0);
  });

  it("a second low-stock event while the first order is in flight does not order again", async () => {
    const t = await setup();
    await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    t.clock.advanceMs(60_000);
    const again = await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    expect(again.body.run.outcome).toBe("SKIPPED_PENDING_ORDER");
    expect(t.c.commerce.orderCount()).toBe(1);
  });
});
