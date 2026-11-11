import { generateKeyPairSync, createVerify, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { setup, HHID } from "./helpers";
import { parsePackSize } from "../src/integrations/commerce/packSize";
import { httpJson } from "../src/integrations/http";
import { FixedClock } from "../src/lib/clock";
import { KrogerAdapter } from "../src/integrations/commerce/kroger";
import { WalmartAdapter } from "../src/integrations/commerce/walmart";
import { InstacartChannel } from "../src/integrations/commerce/instacart";
import { CredentialVault } from "../src/modules/shopping/credentialVault";
import { MemoryStore } from "../src/store/store";

// NOTE: these fixtures encode our understanding of each retailer's documented response shape.
// They prove our code handles those shapes, NOT that the live APIs behave this way.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const KROGER_MILK = { productId: "0001111041700", upc: "0001111041700", description: "Kroger 2% Reduced Fat Milk", brand: "Kroger", categories: ["Dairy"], items: [{ size: "1 gal", price: { regular: 3.49, promo: 0 }, fulfillment: { curbside: true, delivery: true, inStore: true }, inventory: { stockLevel: "HIGH" } }] };
const KROGER_ENV = { COMMERCE_PROVIDERS: "mock,kroger", KROGER_CLIENT_ID: "cid", KROGER_CLIENT_SECRET: "csecret", KROGER_LOCATION_ID: "01400943", KROGER_REDIRECT_URI: "http://localhost:4000/api/v1/integrations/kroger/callback", INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString("base64") };

function fakeKroger(opts: { products?: unknown[]; cartStatus?: number; searchStatus?: number } = {}) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const f = async (url: string, init: RequestInit = {}) => {
    const headers = Object.fromEntries(new Headers(init.headers as HeadersInit).entries());
    const body = init.body ? String(init.body) : undefined;
    calls.push({ url, method: init.method ?? "GET", headers, ...(body ? { body } : {}) });
    if (url.includes("/connect/oauth2/token")) return json({ access_token: `tok_${calls.length}`, refresh_token: "refresh_1", expires_in: 1800 });
    if (url.includes("/cart/add")) return new Response(null, { status: opts.cartStatus ?? 204 });
    if (url.includes("/products/")) return json({ data: (opts.products ?? [KROGER_MILK])[0] });
    if (url.includes("/products")) return opts.searchStatus ? json({}, opts.searchStatus) : json({ data: opts.products ?? [KROGER_MILK] });
    return json({}, 404);
  };
  return { f, calls };
}

describe("size parsing", () => {
  it.each([["1 gal", 3785.4, "ml"], ["64 fl oz", 1892.7, "ml"], ["2 L", 2000, "ml"], ["1 lb", 453.6, "g"], ["12 ct", 12, "count"], ["dozen", 12, "count"], ["500 g", 500, "g"], ["5 lb", 2268, "g"]])("%s", (t, n, u) => {
    const r = parsePackSize(t)!; expect(r.unit).toBe(u); expect(Math.abs(r.packSize - n)).toBeLessThan(1);
  });
  it("returns null when unsure instead of guessing", () => { expect(parsePackSize("family size")).toBeNull(); expect(parsePackSize(undefined)).toBeNull(); });
});

describe("http client", () => {
  const noSleep = async () => {};
  it("refuses hosts that are not pinned", async () => {
    await expect(httpJson(async () => json({}), "https://evil.example/x", {}, { allowedHosts: ["api.kroger.com"] })).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
  });
  it("retries 429/5xx on GET then succeeds, and does not retry 4xx or POST", async () => {
    let n = 0;
    const flaky = async () => (++n < 3 ? json({}, 503) : json({ ok: 1 }));
    expect(await httpJson(flaky, "https://api.kroger.com/x", {}, { allowedHosts: ["api.kroger.com"], sleep: noSleep })).toEqual({ ok: 1 });
    expect(n).toBe(3);
    let m = 0;
    await expect(httpJson(async () => { m++; return json({ secret: "x" }, 401); }, "https://api.kroger.com/x", {}, { allowedHosts: ["api.kroger.com"], sleep: noSleep })).rejects.toMatchObject({ code: "HTTP_401" });
    expect(m).toBe(1);
    let p = 0;
    await expect(httpJson(async () => { p++; return json({}, 500); }, "https://api.kroger.com/x", { method: "POST" }, { allowedHosts: ["api.kroger.com"], sleep: noSleep })).rejects.toBeTruthy();
    expect(p).toBe(1);
  });
  it("errors never echo response bodies", async () => {
    const e = await httpJson(async () => json({ token: "SUPERSECRET" }, 400), "https://api.kroger.com/x", {}, { allowedHosts: ["api.kroger.com"] }).catch((x) => x);
    expect(String(e.message)).not.toContain("SUPERSECRET");
  });
});

describe("Kroger adapter", () => {
  const mk = () => {
    const clock = new FixedClock(new Date("2026-10-16T09:00:00Z")); const store = new MemoryStore(); const vault = new CredentialVault(store, clock);
    const k = fakeKroger();
    const a = new KrogerAdapter({ clientId: "cid", clientSecret: "cs", locationId: "L1", redirectUri: "http://x/cb" }, { fetch: k.f as any, clock, vault, sleep: async () => {} });
    return { a, k, vault, clock };
  };
  it("maps products to base units and pence, marks allergen data unknown, caches the app token", async () => {
    const { a, k } = mk();
    const r = await a.searchProducts({ canonicalKey: "milk" });
    await a.searchProducts({ canonicalKey: "milk" });
    expect(r).toHaveLength(1);
    expect(r[0]!.offer).toMatchObject({ priceMinor: 349, currency: "USD", provider: "kroger", externalId: "0001111041700", available: true });
    expect(r[0]!.product).toMatchObject({ unit: "ml", allergens: null, canonicalKey: "milk" });
    expect(r[0]!.product.packSize).toBeCloseTo(3785.4, 0);
    expect(k.calls.filter((c) => c.url.includes("oauth2/token"))).toHaveLength(1);
    const search = k.calls.find((c) => c.url.includes("filter.term"))!;
    expect(search.url).toContain("filter.locationId=L1");
    expect(search.headers.authorization).toMatch(/^Bearer tok_/);
  });
  it("uses the promo price when present and drops unpriced products", async () => {
    const clock = new FixedClock(new Date()); const vault = new CredentialVault(new MemoryStore(), clock);
    const k = fakeKroger({ products: [{ ...KROGER_MILK, items: [{ ...KROGER_MILK.items[0], price: { regular: 3.49, promo: 2.99 } }] }, { productId: "9", upc: "9", description: "Kroger milk", items: [{ size: "1 gal" }] }, { ...KROGER_MILK, upc: "7", description: "Chocolate cereal" }] });
    const a = new KrogerAdapter({ clientId: "c", clientSecret: "s", locationId: "L", redirectUri: "r" }, { fetch: k.f as any, clock, vault, sleep: async () => {} });
    const r = await a.searchProducts({ canonicalKey: "milk" });
    expect(r.map((e) => e.offer.priceMinor)).toEqual([299]);
  });
  it("cannot hand off until the owner connects their account, and never sends the cart without a user token", async () => {
    const { a, k } = mk();
    await expect(a.prepareHandoff({ householdId: "h", reference: "r", lines: [{ externalId: "0001111041700", name: "Milk", quantity: 1, unitPriceMinor: 349 }] })).rejects.toMatchObject({ code: "NOT_CONNECTED" });
    expect(k.calls.some((c) => c.url.includes("/cart/add"))).toBe(false);
  });
  it("adds to the cart with the stored user token, refreshes it when expired, and says nothing was bought", async () => {
    const { a, k, vault, clock } = mk();
    await a.exchangeCode("h", "authcode");
    const h = await a.prepareHandoff({ householdId: "h", reference: "r", lines: [{ externalId: "0001111041700", name: "Milk", quantity: 2, unitPriceMinor: 349 }] });
    const add = k.calls.find((c) => c.url.includes("/cart/add"))!;
    expect(add.method).toBe("PUT");
    expect(JSON.parse(add.body!)).toEqual({ items: [{ upc: "0001111041700", quantity: 2, modality: "PICKUP" }] });
    expect(h.note).toMatch(/Nothing has been bought/);
    clock.advanceMs(3600_000);
    await a.prepareHandoff({ householdId: "h", reference: "r2", lines: [{ externalId: "1", name: "x", quantity: 1, unitPriceMinor: 1 }] });
    expect(k.calls.some((c) => c.body?.includes("grant_type=refresh_token"))).toBe(true);
    expect(await vault.has("h", "kroger")).toBe(true);
  });
  it("encrypts stored credentials at rest", async () => {
    const clock = new FixedClock(new Date()); const store = new MemoryStore(); const vault = new CredentialVault(store, clock);
    await vault.put("h", "kroger", { accessToken: "PLAINTEXT_TOKEN" });
    const raw = JSON.stringify(await store.credentials.list());
    expect(raw).not.toContain("PLAINTEXT_TOKEN");
    expect((await vault.get<any>("h", "kroger")).accessToken).toBe("PLAINTEXT_TOKEN");
    await vault.delete("h", "kroger");
    expect(await vault.has("h", "kroger")).toBe(false);
  });
});

describe("Walmart adapter (catalogue only)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  it("signs requests, maps items, and hands off product links without claiming to buy", async () => {
    const clock = new FixedClock(new Date("2026-10-16T09:00:00Z")); let seen: Record<string, string> = {};
    const f = async (_u: string, init: RequestInit = {}) => { seen = Object.fromEntries(new Headers(init.headers as HeadersInit).entries()); return json({ items: [{ itemId: 123, name: "Great Value Whole Milk, 1 Gallon", salePrice: 3.12, size: "1 gal", availableOnline: true, productUrl: "https://www.walmart.com/ip/123" }, { itemId: 5, name: "Chocolate cereal", salePrice: 2 }] }); };
    const a = new WalmartAdapter({ consumerId: "cons", keyVersion: "1", privateKeyPem: pem }, { fetch: f as any, clock });
    const r = await a.searchProducts({ canonicalKey: "milk" });
    expect(r).toHaveLength(1);
    expect(r[0]!.offer).toMatchObject({ priceMinor: 312, currency: "USD", provider: "walmart" });
    expect(a.capabilities.placeOrder).toBe(false);
    const v = createVerify("RSA-SHA256").update(`cons\n${seen["wm_consumer.intimestamp"]}\n1\n`);
    expect(v.verify(publicKey, seen["wm_sec.auth_signature"]!, "base64")).toBe(true);
    const h = await a.prepareHandoff({ householdId: "h", reference: "r", lines: [{ externalId: "123", name: "Milk", quantity: 1, unitPriceMinor: 312, url: "https://www.walmart.com/ip/123" }] });
    expect(h.links[0]!.url).toBe("https://www.walmart.com/ip/123");
    expect(h.note).toMatch(/no ordering API/i);
  });
});

describe("Instacart handoff channel", () => {
  it("creates a shopping-list link and rejects malformed answers", async () => {
    let req: any;
    const ok = async (u: string, init: RequestInit = {}) => { req = { u, body: JSON.parse(String(init.body)), auth: new Headers(init.headers as HeadersInit).get("authorization") }; return json({ products_link_url: "https://customers.dev.instacart.tools/store/shopping_lists/1" }); };
    const ch = new InstacartChannel({ apiKey: "k", env: "dev" }, { fetch: ok as any });
    expect(await ch.createListLink({ title: "t", lines: [{ name: "Milk", quantity: 2 }] })).toContain("instacart");
    expect(req.u).toContain("/idp/v1/products/products_link");
    expect(req.auth).toBe("Bearer k");
    expect(req.body).toMatchObject({ link_type: "shopping_list", line_items: [{ name: "Milk", quantity: 2 }] });
    await expect(new InstacartChannel({ apiKey: "k", env: "dev" }, { fetch: (async () => json({})) as any }).createListLink({ title: "t", lines: [] })).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });
});

describe("multi-store ordering end to end (Kroger via fake HTTP)", () => {
  const setupKroger = async (kf = fakeKroger()) => {
    const t = await setup(KROGER_ENV, { fetch: kf.f });
    await t.me.put("/household", { currency: "USD" });
    return { t, kf };
  };
  const allowKroger = (t: Awaited<ReturnType<typeof setup>>) => t.me.put("/shopping/policies", { allowlistedProductIds: ["kroger_0001111041700"] });

  it("one store failing does not hide the others, and the failure is reported", async () => {
    const t = await setup(KROGER_ENV, { fetch: fakeKroger({ searchStatus: 500 }).f });
    const r = await t.me.get("/products/search?canonicalKey=milk");
    expect(r.body.results.length).toBeGreaterThan(0);
    expect(r.body.errors[0]).toMatchObject({ provider: "kroger" });
    expect(r.body.providers.map((p: any) => p.name).sort()).toEqual(["kroger", "marketfield-mock"]);
  });

  it("prefers an eligible store and never auto-selects products priced in another currency", async () => {
    const { t } = await setupKroger();
    await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    const order = (await t.c.store.orders.list())[0]!;
    expect(order.provider).toBe("kroger"); // mock is GBP, household is now USD
    expect(order.basket.currency).toBe("USD");
  });

  it("unknown allergens and non-allowlisted live products stop at the owner; a missing connection fails safely with no stock or payment effect", async () => {
    const { t } = await setupKroger();
    const r = await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    expect(r.body.run.state).toBe("BLOCKED"); // not allowlisted => DENY
    expect((await t.c.store.orders.list())[0]!.policyDecision!.reasons.map((x) => x.code)).toContain("PRODUCT_NOT_ALLOWLISTED");
    await t.me.post("/demo/reset"); // fresh data but same container
    await t.me.put("/household", { currency: "USD" });
    await allowKroger(t);
    const r2 = await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    expect(r2.body.run.state).toBe("POLICY_REVIEW"); // ALLERGEN_UNKNOWN => REVIEW, never auto-bought
    const order = (await t.c.store.orders.list())[0]!;
    expect(order.policyDecision!.reasons.map((x) => x.code)).toContain("ALLERGEN_UNKNOWN");
    const approved = await t.me.post(`/shopping/orders/${order.id}/approve`);
    expect(approved.body.order.status).toBe("FAILED");
    expect(approved.body.order.failureReason).toBe("NOT_CONNECTED");
    expect(t.c.mockPayments.executeCalls).toBe(0);
    expect((await t.c.inventory.findByKey(HHID, "milk"))!.quantity).toBe(180);
  });

  it("with a connected account: approve -> cart prepared (HANDOFF, nothing bought, not counted as stock) -> owner attests checkout -> on order", async () => {
    const kf = fakeKroger();
    const { t } = await setupKroger(kf);
    await allowKroger(t);
    await t.c.kroger!.exchangeCode(HHID, "code");
    await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    const order = (await t.c.store.orders.list())[0]!;
    expect(order.status).toBe("PENDING_REVIEW");
    const done = (await t.me.post(`/shopping/orders/${order.id}/approve`)).body.order;
    expect(done.status).toBe("HANDOFF");
    expect(done.handoff.links[0].url).toContain("kroger.com");
    expect(done.handoff.note).toMatch(/Nothing has been bought/);
    expect(kf.calls.filter((c) => c.url.includes("/cart/add"))).toHaveLength(1);
    expect(t.c.mockPayments.executeCalls).toBe(0);
    expect(t.c.commerce.createCalls).toBe(0); // mock provider never touched
    expect((await t.c.store.agentRuns.list())[0]!.state).toBe("AWAITING_OWNER");
    let milk = (await t.me.get("/inventory")).body.items.find((i: any) => i.canonicalKey === "milk");
    expect(milk.inboundQty).toBe(0); // a prepared cart is not an order
    // a second low-stock event must not prepare a second cart
    t.clock.advanceMs(60_000);
    expect((await t.me.post("/devices/simulate", { scenario: "LOW_MILK" })).body.run.outcome).toBe("SKIPPED_PENDING_ORDER");
    // provider-verified delivery is impossible for a store with no order API
    expect((await t.me.post(`/shopping/orders/${order.id}/confirm-delivery`)).status).toBe(409);
    const att = (await t.me.post(`/shopping/orders/${order.id}/confirm-checkout`)).body.order;
    expect(att.status).toBe("CONFIRMED");
    expect((await t.c.audit.recent(HHID)).find((a) => a.action === "ORDER_CHECKOUT_ATTESTED")!.outcome).toBe("WARN");
    milk = (await t.me.get("/inventory")).body.items.find((i: any) => i.canonicalKey === "milk");
    expect(milk.inboundQty).toBeGreaterThan(3000);
    expect(milk.quantity).toBe(180);
    expect((await t.me.post(`/shopping/orders/${order.id}/sync`)).body.order.status).toBe("CONFIRMED");
    expect((await t.me.post(`/shopping/orders/${order.id}/confirm-delivery`)).body.order.status).toBe("DELIVERED");
    expect((await t.c.inventory.findByKey(HHID, "milk"))!.quantity).toBeGreaterThan(3900);
  });

  it("adds an Instacart list link to a handoff order when configured, and refuses when not", async () => {
    const kf = fakeKroger();
    const base = async (u: string, i?: RequestInit) => (u.includes("instacart") ? json({ products_link_url: "https://customers.dev.instacart.tools/store/shopping_lists/9" }) : kf.f(u, i));
    const t = await setup({ ...KROGER_ENV, INSTACART_API_KEY: "ik" }, { fetch: base });
    await t.me.put("/household", { currency: "USD" }); await allowKroger(t); await t.c.kroger!.exchangeCode(HHID, "c");
    await t.me.post("/devices/simulate", { scenario: "LOW_MILK" });
    const o = (await t.c.store.orders.list())[0]!;
    expect((await t.me.post(`/shopping/orders/${o.id}/instacart`)).status).toBe(409); // not in HANDOFF yet
    await t.me.post(`/shopping/orders/${o.id}/approve`);
    const r = await t.me.post(`/shopping/orders/${o.id}/instacart`);
    expect(r.body.order.handoff.links.map((l: any) => l.label)).toContain("Instacart list");
    const t2 = await setup();
    expect((await t2.me.post("/shopping/orders/x/instacart")).status).toBe(404);
  });

  it("a basket cannot mix stores", async () => {
    const { t } = await setupKroger();
    const r = await t.me.post("/shopping/carts", { lines: [{ storeProductId: "kroger:0001111041700", quantity: 1 }, { storeProductId: "marketfield-mock:p_eggs_6", quantity: 1 }] });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("MIXED_PROVIDERS");
  });
});

describe("Kroger OAuth routes", () => {
  it("issues a signed state, rejects tampering, stores tokens encrypted, and never returns them", async () => {
    const kf = fakeKroger();
    const t = await setup(KROGER_ENV, { fetch: kf.f });
    const auth = await t.me.get("/integrations/kroger/authorize");
    const url = new URL(auth.body.url);
    expect(url.searchParams.get("client_id")).toBe("cid");
    const state = url.searchParams.get("state")!;
    expect((await t.raw.get(`/api/v1/integrations/kroger/callback?code=abc&state=${state}x`)).status).toBe(400);
    const ok = await t.raw.get(`/api/v1/integrations/kroger/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(ok.status).toBe(302);
    expect(ok.headers.location).toContain("connected=kroger");
    const info = await t.me.get("/integrations");
    expect(info.body.stores.find((s: any) => s.name === "kroger").connected).toBe(true);
    expect(JSON.stringify(info.body)).not.toContain("refresh_1");
    expect(JSON.stringify(await t.c.store.credentials.list())).not.toContain("refresh_1");
    expect((await t.other.get("/integrations")).body.stores.find((s: any) => s.name === "kroger").connected).toBe(false);
    await t.me.del("/integrations/kroger");
    expect((await t.me.get("/integrations")).body.stores.find((s: any) => s.name === "kroger").connected).toBe(false);
  });
  it("is unavailable when Kroger is not enabled", async () => {
    const t = await setup();
    expect((await t.me.get("/integrations/kroger/authorize")).status).toBe(404);
  });
});
