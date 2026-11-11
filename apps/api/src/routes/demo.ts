import { Router } from "express";
import { z } from "zod";
import type { Container } from "../container";
import { AppError } from "../lib/errors";
import { ah } from "../middleware/http";

/** Demo/test controls. Not mounted in production. All of them act on MOCK providers only. */
export function demoRoutes(c: Container) {
  const r = Router();
  r.post("/demo/reset", ah(async (_req, res) => { await c.reset(); res.json({ ok: true }); }));
  r.post("/demo/orders/:id/advance", ah(async (req, res) => {
    const { status } = z.object({ status: z.enum(["IN_TRANSIT", "DELIVERED"]) }).parse(req.body);
    const o = await c.orders.getOwned(req.ctx!.householdId, String(req.params.id));
    if (!o.externalOrderId) throw new AppError(409, "NO_EXTERNAL_ORDER", "Order was never placed with the provider");
    c.commerce.advance(o.externalOrderId, status);
    res.json({ order: await c.orders.sync(req.ctx!.householdId, o.id, req.ctx!.actor) });
  }));
  r.post("/demo/faults", ah(async (req, res) => {
    const b = z.object({
      commerce: z.enum(["OK", "TIMEOUT_AFTER_COMMIT", "TIMEOUT_BEFORE_COMMIT"]).optional(),
      payment: z.enum(["OK", "DECLINE", "TIMEOUT_AFTER_COMMIT", "TIMEOUT_BEFORE_COMMIT"]).optional(),
      capture: z.enum(["OK", "FAIL"]).optional(),
    }).parse(req.body);
    if (b.commerce) c.commerce.queueCreateOutcome(b.commerce);
    if ((b.payment || b.capture) && c.payments.mode !== "MOCK") throw new AppError(409, "NOT_MOCK", "Fault injection only works with the mock payment provider");
    if (b.payment) c.mockPayments.queueOutcome(b.payment);
    if (b.capture) c.mockPayments.queueCaptureOutcome(b.capture);
    res.json({ queued: b });
  }));
  return r;
}
