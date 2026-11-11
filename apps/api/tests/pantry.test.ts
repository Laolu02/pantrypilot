import { describe, expect, it } from "vitest";
import { setup, HHID } from "./helpers";

const base = { name: "Maize flour", quantity: 2000, unit: "g", storage: "PANTRY" };

describe("manual pantry entry", () => {
  it("lists known ingredients with defaults for the form", async () => {
    const t = await setup();
    const r = await t.me.get("/ingredients");
    const milk = r.body.ingredients.find((i: any) => i.key === "milk");
    expect(milk).toMatchObject({ unit: "ml", storage: "FRIDGE", allergenDataKnown: true });
    expect(r.body.ingredients.find((i: any) => i.key === "suya_spice").allergenDataKnown).toBe(false);
  });
  it("adds a custom item with a derived key, a ledger entry and an audit record", async () => {
    const t = await setup();
    const r = await t.me.post("/inventory", { ...base, expiresAt: "2027-01-01T00:00:00.000Z" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ canonicalKey: "maize_flour", quantity: 2000, source: "MANUAL", merged: false });
    const ledger = (await t.me.get(`/inventory/ledger?itemId=${r.body.id}`)).body.events;
    expect(ledger[0]).toMatchObject({ type: "ADD", quantityDelta: 2000 });
    expect((await t.c.audit.recent(HHID)).some((a) => a.action === "INVENTORY_ADDED")).toBe(true);
  });
  it("merges into existing stock, keeps the earlier expiry, and rejects a unit mismatch", async () => {
    const t = await setup();
    const milk = (await t.c.inventory.findByKey(HHID, "milk"))!;
    const r = await t.me.post("/inventory", { canonicalKey: "milk", name: "Semi-skimmed milk", quantity: 1000, unit: "ml", storage: "FRIDGE", expiresAt: "2030-01-01T00:00:00.000Z" });
    expect(r.body).toMatchObject({ id: milk.id, quantity: 2300, merged: true });
    expect(r.body.expiresAt).toBe(milk.expiresAt);
    const bad = await t.me.post("/inventory", { canonicalKey: "milk", name: "Milk", quantity: 1, unit: "g", storage: "FRIDGE" });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe("UNIT_MISMATCH");
  });
  it("validates input", async () => {
    const t = await setup();
    expect((await t.me.post("/inventory", { ...base, quantity: 0 })).status).toBe(400);
    expect((await t.me.post("/inventory", { ...base, unit: "stone" })).status).toBe(400);
    expect((await t.me.post("/inventory", { ...base, name: "" })).status).toBe(400);
    expect((await t.me.post("/inventory", { ...base, name: "!!!" })).body.code).toBe("INVALID_NAME");
  });
  it("optional daily use makes the item forecastable, and flagged as an estimate", async () => {
    const t = await setup();
    await t.me.post("/inventory", { ...base, dailyUse: 400 });
    const item = (await t.me.get("/inventory")).body.items.find((i: any) => i.canonicalKey === "maize_flour");
    expect(item.forecast).toMatchObject({ estimated: true, needsReplenishment: false });
    expect(item.forecast.daysOfSupply).toBe(5);
    const without = await t.me.post("/inventory", { name: "Curry leaves", quantity: 20, unit: "g", storage: "FRIDGE" });
    expect((await t.me.get("/inventory")).body.items.find((i: any) => i.id === without.body.id).forecast).toBeNull();
  });
  it("custom items are isolated per household and unknown ingredients fail closed in recipes", async () => {
    const t = await setup();
    await t.other.post("/inventory", { ...base });
    expect((await t.me.get("/inventory")).body.items.some((i: any) => i.canonicalKey === "maize_flour")).toBe(false);
    const edit = await t.me.patch("/inventory/item_flour", { quantity: 900 });
    expect(edit.body.quantity).toBe(900);
  });
});


describe("connections survive resets and restarts", () => {
  it("demo reset keeps connected accounts but wipes demo data", async () => {
    const { setup: s2 } = await import("./helpers");
    const t = await s2();
    await t.c.vault.put(HHID, "paypal", { vaultId: "V1" });
    await t.me.post("/inventory", { name: "Maize flour", quantity: 5, unit: "g", storage: "PANTRY" });
    await t.me.post("/demo/reset");
    expect(await t.c.vault.has(HHID, "paypal")).toBe(true);
    expect((await t.c.vault.get<any>(HHID, "paypal")).vaultId).toBe("V1");
    expect((await t.me.get("/inventory")).body.items.some((i: any) => i.canonicalKey === "maize_flour")).toBe(false);
  });
  it("stored connections persist to an encrypted file, reload after a restart, and fail safe with a different key", async () => {
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { randomBytes } = await import("node:crypto");
    const { CredentialVault } = await import("../src/modules/shopping/credentialVault");
    const { MemoryStore } = await import("../src/store/store");
    const { FixedClock } = await import("../src/lib/clock");
    const file = join(mkdtempSync(join(tmpdir(), "pp-")), "creds.json");
    const key = randomBytes(32).toString("base64");
    const clock = new FixedClock(new Date());
    const v1 = new CredentialVault(new MemoryStore(), clock, key, file);
    await v1.put("h", "paypal", { vaultId: "SECRET_VAULT_ID" });
    expect(readFileSync(file, "utf8")).not.toContain("SECRET_VAULT_ID");
    const v2 = new CredentialVault(new MemoryStore(), clock, key, file); // "restart"
    expect((await v2.get<any>("h", "paypal")).vaultId).toBe("SECRET_VAULT_ID");
    const v3 = new CredentialVault(new MemoryStore(), clock, randomBytes(32).toString("base64"), file);
    expect(await v3.get("h", "paypal")).toBeNull();
    await v2.delete("h", "paypal");
    expect(await new CredentialVault(new MemoryStore(), clock, key, file).has("h", "paypal")).toBe(false);
  });
  it("run summaries use real units and readable policy reasons", async () => {
    const { setup: s2 } = await import("./helpers");
    const t = await s2();
    const r = await t.me.post("/devices/simulate", { scenario: "LOW_OLIVE_OIL" });
    expect(r.body.run.summary).toContain("40 ml");
    expect(r.body.run.summary).not.toContain("base units");
    expect(r.body.run.summary).toContain("item price cap exceeded");
    expect(r.body.run.summary).not.toMatch(/[A-Z]+_[A-Z]+/);
  });
});