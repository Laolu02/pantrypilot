import { describe, expect, it } from "vitest";
import { setup, HHID } from "./helpers";
import { signDeviceEvent } from "../src/lib/signing";

const milk = async (c: Awaited<ReturnType<typeof setup>>["c"]) => (await c.inventory.findByKey(HHID, "milk"))!;

describe("device event ingestion", () => {
  it("applies a signed event once, writes the ledger and audit trail", async () => {
    const t = await setup();
    const r = await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    expect(r.status).toBe(201);
    expect(r.body.ingest.status).toBe("APPLIED");
    expect((await milk(t.c)).quantity).toBe(180);
    const ledger = await t.me.get("/inventory/ledger");
    expect(ledger.body.events.filter((e: any) => e.type === "OBSERVE")).toHaveLength(1);
    const audit = await t.c.audit.recent(HHID);
    expect(audit.some((a) => a.action === "DEVICE_EVENT_RECEIVED")).toBe(true);
    expect(audit.some((a) => a.action === "INVENTORY_OBSERVED")).toBe(true);
  });

  it("applies a replayed event exactly once", async () => {
    const t = await setup();
    await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    const replay = await t.me.post("/devices/simulate", { scenario: "REPLAY_LAST" });
    expect(replay.body.ingest.status).toBe("DUPLICATE");
    const observes = (await t.c.store.inventoryEvents.list()).filter((e) => e.type === "OBSERVE");
    expect(observes).toHaveLength(1);
    expect(await t.c.store.orders.list()).toHaveLength(1);
  });

  it("rejects invalid payloads, bad signatures and unknown devices", async () => {
    const t = await setup();
    expect((await t.raw.post("/api/v1/devices/events").send({ nope: 1 })).status).toBe(400);
    const e = t.c.simulator.build("LOW_MILK");
    const forged = await t.raw.post("/api/v1/devices/events").send({ ...e, quantity: 1 });
    expect(forged.status).toBe(401);
    expect(forged.body.code).toBe("BAD_SIGNATURE");
    const unknown = { ...e, deviceId: "ghost-device" };
    const res = await t.raw.post("/api/v1/devices/events").send({ ...unknown, signature: signDeviceEvent("dev-only-device-secret", unknown) });
    expect(res.status).toBe(403);
    expect((await milk(t.c)).quantity).toBe(1300);
  });

  it("rejects events from the future", async () => {
    const t = await setup();
    const base = { ...t.c.simulator.build("LOW_MILK"), eventId: "evt_future", observedAt: "2026-10-16T10:00:00.000Z" };
    const { signature: _s, ...unsigned } = base;
    const r = await t.raw.post("/api/v1/devices/events").send({ ...unsigned, signature: signDeviceEvent("dev-only-device-secret", unsigned) });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("EVENT_FROM_FUTURE");
  });

  it("does not let an older event overwrite newer state", async () => {
    const t = await setup();
    const r = await t.me.post("/devices/simulate", { scenario: "STALE_MILK" });
    expect(r.body.ingest.status).toBe("STALE");
    expect((await milk(t.c)).quantity).toBe(1300);
  });

  it("opens a reconciliation request for implausible quantities instead of trusting them", async () => {
    const t = await setup();
    const r = await t.me.post("/devices/simulate", { scenario: "IMPLAUSIBLE_MILK" });
    expect(r.body.ingest.status).toBe("NEEDS_RECONCILIATION");
    expect(r.body.run).toBeNull();
    expect((await milk(t.c)).quantity).toBe(1300);
    const open = await t.me.get("/inventory/reconciliations");
    expect(open.body.requests).toHaveLength(1);
    const resolved = await t.me.post("/inventory/reconcile", { requestId: open.body.requests[0].id, resolution: "KEEP_CURRENT" });
    expect(resolved.status).toBe(200);
    expect((await milk(t.c)).quantity).toBe(1300);
  });

  it("opens a reconciliation request for low-confidence observations and can accept them", async () => {
    const t = await setup();
    const r = await t.me.post("/devices/simulate", { scenario: "LOW_CONFIDENCE_MILK" });
    expect(r.body.ingest.status).toBe("NEEDS_RECONCILIATION");
    const open = await t.c.inventory.openReconciliations(HHID);
    await t.me.post("/inventory/reconcile", { requestId: open[0]!.id, resolution: "ACCEPT_OBSERVED" });
    expect((await milk(t.c)).quantity).toBe(150);
  });
});

describe("authentication and household isolation", () => {
  it("requires a token on private routes", async () => {
    const t = await setup();
    expect((await t.raw.get("/api/v1/inventory")).status).toBe(401);
    expect((await t.raw.get("/api/v1/inventory").set("Authorization", "Bearer nope")).status).toBe(401);
  });
  it("never leaks or mutates another household's data", async () => {
    const t = await setup();
    const mine = await t.me.get("/inventory");
    const theirs = await t.other.get("/inventory");
    expect(mine.body.items.map((i: any) => i.id)).not.toContain("item_harlow_milk");
    expect(theirs.body.items.map((i: any) => i.id)).toEqual(["item_harlow_milk"]);
    expect((await t.other.patch("/inventory/item_milk", { quantity: 1 })).status).toBe(404);
    expect((await t.other.del("/inventory/item_milk")).status).toBe(404);
    await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    const order = (await t.c.store.orders.list())[0]!;
    expect((await t.other.get(`/shopping/orders/${order.id}`)).status).toBe(404);
    expect((await t.other.post(`/shopping/orders/${order.id}/cancel`)).status).toBe(404);
    expect((await t.other.get("/shopping/orders")).body.orders).toHaveLength(0);
  });
  it("soft-deletes inventory and keeps ledger history", async () => {
    const t = await setup();
    expect((await t.me.del("/inventory/item_flour")).status).toBe(200);
    expect((await t.me.get("/inventory")).body.items.map((i: any) => i.id)).not.toContain("item_flour");
    const ledger = (await t.me.get("/inventory/ledger?itemId=item_flour")).body.events;
    expect(ledger.map((e: any) => e.type)).toContain("REMOVE");
  });
});

describe("signature strictness", () => {
  it("rejects signatures with trailing junk or wrong length", async () => {
    const t = await setup();
    const e = t.c.simulator.build("LOW_MILK");
    for (const sig of [e.signature + "zz", e.signature + "00", e.signature.slice(0, -2), e.signature.toUpperCase().replace(/[0-9A-F]$/, "g")]) {
      const r = await t.raw.post("/api/v1/devices/events").send({ ...e, signature: sig });
      expect(r.status).toBe(401);
    }
    expect((await t.raw.post("/api/v1/devices/events").send(e)).status).toBe(201);
  });
});
