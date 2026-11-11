import { Router } from "express";
import { z } from "zod";
import { CreateCartSchema, CreateOrderSchema, UpdatePolicySchema } from "@pantrypilot/contracts";
import type { Container } from "../container";
import { AppError, notFound } from "../lib/errors";
import { newId } from "../lib/ids";
import { ah, rateLimit } from "../middleware/http";

export function shoppingRoutes(c: Container) {
  const r = Router();
  r.get("/products/search", ah(async (req, res) => {
    const q = z.object({ q: z.string().optional(), canonicalKey: z.string().optional() }).parse(req.query);
    const { entries, errors } = await c.baskets.search({ ...(q.q ? { text: q.q } : {}), ...(q.canonicalKey ? { canonicalKey: q.canonicalKey } : {}) });
    res.json({ providers: c.baskets.providers(), results: entries, errors });
  }));
  r.get("/products/:id", ah(async (req, res) => {
    const id = String(req.params.id); const i = id.indexOf(":");
    try { res.json(await c.registry.get(i < 0 ? c.commerce.name : id.slice(0, i)).getProduct(i < 0 ? id : id.slice(i + 1))); } catch { throw notFound("Product"); }
  }));

  r.get("/shopping/policies", ah(async (req, res) => { res.json(await c.policies.get(req.ctx!.householdId)); }));
  r.put("/shopping/policies", ah(async (req, res) => { res.json(await c.policies.update(req.ctx!.householdId, req.ctx!.actor, UpdatePolicySchema.parse(req.body))); }));
  r.post("/shopping/kill-switch", ah(async (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    res.json(await c.policies.setKillSwitch(req.ctx!.householdId, req.ctx!.actor, enabled));
  }));

  r.post("/shopping/carts", ah(async (req, res) => {
    const b = CreateCartSchema.parse(req.body);
    res.status(201).json(await c.baskets.createCart(req.ctx!.householdId, b.reason, b.lines));
  }));
  r.post("/shopping/carts/:id/evaluate", ah(async (req, res) => {
    const cart = await c.baskets.getCart(req.ctx!.householdId, String(req.params.id));
    const { decision, policy } = await c.policies.evaluate(req.ctx!.householdId, cart.basket);
    res.json({ cart, decision, policyVersion: policy.version });
  }));

  r.post("/shopping/orders", rateLimit("orders", 30), ah(async (req, res) => {
    const key = req.header("idempotency-key");
    if (!key) throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required");
    const { cartId } = CreateOrderSchema.parse(req.body);
    const hh = req.ctx!.householdId;
    const cart = await c.baskets.getCart(hh, cartId);
    const correlationId = newId("cor");
    // Prices are recomputed from the provider; the cart's stored totals are never trusted.
    const basket = await c.baskets.rebuild(cart.basket.lines.map((l) => ({ storeProductId: l.storeProductId, quantity: l.quantity, canonicalKey: l.canonicalKey })), cart.basket.reason);
    const { order, replay } = await c.orders.propose({ householdId: hh, basket, idempotencyKey: key, actor: req.ctx!.actor, correlationId });
    if (replay) return res.status(200).json({ order, idempotentReplay: true });
    const ev = await c.orders.evaluate(hh, order.id, req.ctx!.actor, correlationId);
    const final = ev.decision.decision === "ALLOW" ? await c.orders.execute(hh, order.id, req.ctx!.actor, correlationId) : ev.order;
    res.status(201).json({ order: final, decision: ev.decision, idempotentReplay: false });
  }));
  r.get("/shopping/orders", ah(async (req, res) => { res.json({ orders: await c.orders.listWithPayments(req.ctx!.householdId) }); }));
  r.get("/shopping/orders/:id", ah(async (req, res) => {
    const order = await c.orders.getOwned(req.ctx!.householdId, String(req.params.id));
    res.json({ order, payment: (await c.orders.payment(order.id)) ?? null });
  }));
  const act = (name: string, fn: (hh: string, id: string, actor: string) => Promise<unknown>) =>
    r.post(`/shopping/orders/:id/${name}`, rateLimit("order-actions", 60), ah(async (req, res) => { res.json({ order: await fn(req.ctx!.householdId, String(req.params.id), req.ctx!.actor) }); }));
  act("approve", (h, id, a) => c.orders.approve(h, id, a));
  act("reject", (h, id, a) => c.orders.reject(h, id, a));
  act("cancel", (h, id, a) => c.orders.cancel(h, id, a));
  act("reconcile", (h, id, a) => c.orders.reconcileUncertain(h, id, a));
  act("sync", (h, id, a) => c.orders.sync(h, id, a));
  act("confirm-checkout", (h, id, a) => c.orders.confirmCheckout(h, id, a));
  act("instacart", (h, id, a) => c.orders.addInstacartLink(h, id, a));
  act("confirm-delivery", (h, id, a) => c.orders.confirmDelivery(h, id, "USER", a));
 const CadenceBody = z.object({
    cadence: z.enum(["ASAP", "DAILY", "EVERY_2_DAYS", "WEEKLY"]),
    orderHour: z.number().int().min(0).max(23).optional(),
    anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Invalid date").optional(),
    applyLimits: z.boolean().optional(),
  });
  r.get("/delivery/schedule", ah(async (req, res) => { res.json(await c.agent.getSchedule(req.ctx!.householdId)); }));
  r.post("/delivery/schedule", ah(async (req, res) => {
    const hh = req.ctx!.householdId;
    await c.agent.setSchedule(hh, req.ctx!.actor, CadenceBody.parse(req.body ?? {}));
    res.json(await c.agent.getSchedule(hh));
  }));
  r.get("/delivery/preview", ah(async (req, res) => { res.json(await c.agent.previewDelivery(req.ctx!.householdId)); }));
  r.post("/delivery/run", ah(async (req, res) => {
    res.status(201).json({ run: await c.agent.runDelivery(req.ctx!.householdId, { trigger: { type: "USER_ACTION" } }) });
  }));
  return r;
}
