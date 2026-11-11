import { Router } from "express";
import { RegisterDeviceSchema, SimulateRequestSchema } from "@pantrypilot/contracts";
import type { Container } from "../container";
import { AppError } from "../lib/errors";
import { ah, rateLimit } from "../middleware/http";

/** `/devices/events` is authenticated by device signature, so it is mounted without user auth. */
export function deviceEventRoutes(c: Container) {
  const r = Router();
  r.post("/devices/events", rateLimit("device-events", 120), ah(async (req, res) => {
    const { ingest, run } = await c.agent.handleDeviceEvent(req.body);
    res.status(ingest.status === "APPLIED" ? 201 : 200).json({ ingest, run });
  }));
  return r;
}

export function deviceRoutes(c: Container) {
  const r = Router();
  r.get("/devices", ah(async (req, res) => { res.json({ devices: await c.devices.list(req.ctx!.householdId) }); }));
  r.post("/devices", ah(async (req, res) => {
    res.status(201).json(await c.devices.register(req.ctx!.householdId, RegisterDeviceSchema.parse(req.body)));
  }));
  r.post("/devices/simulate", rateLimit("simulate", 60), ah(async (req, res) => {
    if (c.env.NODE_ENV === "production") throw new AppError(404, "NOT_FOUND", "Not found");
    const { scenario } = SimulateRequestSchema.parse(req.body);
    const event = c.simulator.build(scenario);
    const { ingest, run } = await c.agent.handleDeviceEvent(event);
    res.status(ingest.status === "APPLIED" ? 201 : 200).json({ scenario, eventId: event.eventId, ingest, run });
  }));
  return r;
}
