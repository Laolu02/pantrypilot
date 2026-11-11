import { Router } from "express";
import { z } from "zod";
import type { Container } from "../container";
import { AppError, UniqueViolationError } from "../lib/errors";
import { newId } from "../lib/ids";
import { hmacHex, safeEqualHex } from "../lib/signing";
import { ah, rateLimit } from "../middleware/http";

const Body = z.object({ eventId: z.string().min(1), externalOrderId: z.string().min(1), status: z.enum(["IN_TRANSIT", "DELIVERED", "CANCELLED"]) });

/**
 * Commerce webhooks are a hint, not a source of truth: the signature is verified, the event id is
 * deduplicated, and then the provider is queried before any order or stock state changes.
 */
export function webhookRoutes(c: Container) {
  const r = Router();
  r.post("/webhooks/commerce/:provider", rateLimit("webhooks", 120), ah(async (req, res) => {
    if (req.params.provider !== c.commerce.name) throw new AppError(404, "UNKNOWN_PROVIDER", "Unknown provider");
    const sig = req.header("x-signature") ?? "";
    if (!req.rawBody || !safeEqualHex(sig, hmacHex(c.env.WEBHOOK_SECRET, req.rawBody))) throw new AppError(401, "BAD_SIGNATURE", "Invalid webhook signature");
    const b = Body.parse(req.body);
    try { await c.store.webhookEvents.insert({ id: newId("wh"), provider: c.commerce.name, eventId: b.eventId, receivedAt: c.clock.now().toISOString() }); }
    catch (e) { if (e instanceof UniqueViolationError) return res.json({ status: "DUPLICATE" }); throw e; }
    const order = await c.store.orders.find((o) => o.externalOrderId === b.externalOrderId);
    if (!order) throw new AppError(404, "UNKNOWN_ORDER", "No order with that reference");
    const synced = await c.orders.sync(order.householdId, order.id, `webhook:${c.commerce.name}`);
    res.json({ status: "PROCESSED", order: { id: synced.id, status: synced.status } });
  }));
  return r;
}
