import { describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { setup, HHID } from "./helpers";
import { hmacHex } from "../src/lib/signing";

const hook = (t: Awaited<ReturnType<typeof setup>>, body: object, secret = "dev-only-webhook-secret") => {
  const raw = JSON.stringify(body);
  return t.raw.post("/api/v1/webhooks/commerce/marketfield-mock").set("content-type", "application/json").set("x-signature", hmacHex(secret, raw)).send(raw);
};

describe("commerce webhooks", () => {
  it("delivers stock once when the provider confirms delivery, and ignores replays", async () => {
    const t = await setup();
    await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    const o = (await t.c.store.orders.list())[0]!;
    t.c.commerce.advance(o.externalOrderId!, "DELIVERED");
    const r1 = await hook(t, { eventId: "wh-1", externalOrderId: o.externalOrderId, status: "DELIVERED" });
    expect(r1.body).toMatchObject({ status: "PROCESSED", order: { status: "DELIVERED" } });
    expect((await t.c.inventory.findByKey(HHID, "milk"))!.quantity).toBe(180 + 3408);
    const r2 = await hook(t, { eventId: "wh-1", externalOrderId: o.externalOrderId, status: "DELIVERED" });
    expect(r2.body.status).toBe("DUPLICATE");
    const r3 = await hook(t, { eventId: "wh-2", externalOrderId: o.externalOrderId, status: "DELIVERED" });
    expect(r3.body.order.status).toBe("DELIVERED");
    expect((await t.c.inventory.findByKey(HHID, "milk"))!.quantity).toBe(180 + 3408);
  });
  it("does not trust a signed webhook that the provider contradicts", async () => {
    const t = await setup();
    await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    const o = (await t.c.store.orders.list())[0]!;
    const r = await hook(t, { eventId: "wh-liar", externalOrderId: o.externalOrderId, status: "DELIVERED" });
    expect(r.body.order.status).toBe("CONFIRMED");
    expect((await t.c.inventory.findByKey(HHID, "milk"))!.quantity).toBe(180);
  });
  it("rejects bad signatures, unknown providers and unknown orders", async () => {
    const t = await setup();
    expect((await hook(t, { eventId: "x", externalOrderId: "y", status: "DELIVERED" }, "wrong-secret-123")).status).toBe(401);
    expect((await t.raw.post("/api/v1/webhooks/commerce/other").send({})).status).toBe(404);
    expect((await hook(t, { eventId: "x2", externalOrderId: "nope", status: "DELIVERED" })).status).toBe(404);
  });
});

describe("SSE stream", () => {
  it("pushes this household's audit events and requires a token", async () => {
    const t = await setup();
    const server = t.app.listen(0);
    const port = (server.address() as AddressInfo).port;
    try {
      expect((await fetch(`http://127.0.0.1:${port}/api/v1/events/stream`)).status).toBe(401);
      const ac = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/events/stream?token=pp_demo_okafor`, { signal: ac.signal });
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let text = "";
      const read = async (until: string) => { while (!text.includes(until)) { const { value, done } = await reader.read(); if (done) break; text += dec.decode(value); } };
      await read("event: ready");
      // another household's activity must not leak; ours must arrive
      await t.c.audit.record({ householdId: "hh_harlow", actor: "t", action: "OTHER_HH", resourceType: "x", resourceId: "x", correlationId: "c", stage: "SYSTEM" });
      await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
      await read("DEVICE_EVENT_RECEIVED");
      expect(text).toContain("event: audit");
      expect(text).not.toContain("OTHER_HH");
      ac.abort();
    } finally { server.close(); }
  });
});
