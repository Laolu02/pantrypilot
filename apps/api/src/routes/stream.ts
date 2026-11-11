import { Router } from "express";
import type { Container } from "../container";
import type { AuditEvent } from "../store/store";

/** Server-Sent Events: one `audit` message per new audit row for the caller's household only. */
export function streamRoutes(c: Container) {
  const r = Router();
  r.get("/events/stream", (req, res) => {
    const hh = req.ctx!.householdId;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    res.write(`event: ready\ndata: {}\n\n`);
    const onAudit = (e: AuditEvent) => {
      if (e.householdId !== hh) return;
      res.write(`event: audit\ndata: ${JSON.stringify({ id: e.id, action: e.action, stage: e.stage, outcome: e.outcome, correlationId: e.correlationId })}\n\n`);
    };
    c.audit.bus.on("audit", onAudit);
    const ping = setInterval(() => res.write(`: ping\n\n`), 20000);
    req.on("close", () => { clearInterval(ping); c.audit.bus.off("audit", onAudit); });
  });
  return r;
}
