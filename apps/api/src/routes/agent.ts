import { Router } from "express";
import { z } from "zod";
import type { Container } from "../container";
import { ah } from "../middleware/http";

const StartRun = z.object({ type: z.enum(["REPLENISHMENT_SCAN", "REPLENISHMENT"]).default("REPLENISHMENT_SCAN"), canonicalKey: z.string().optional() });

export function agentRoutes(c: Container) {
  const r = Router();
  r.post("/agent/runs", ah(async (req, res) => {
    const b = StartRun.parse(req.body ?? {});
    const hh = req.ctx!.householdId;
  
    if (b.type === "REPLENISHMENT" && b.canonicalKey) {
            const run = await c.agent.runReplenishment(hh, { canonicalKey: b.canonicalKey, trigger: { type: "USER_ACTION", orderNow: true } });
      return res.status(201).json({ runs: [run] });
    }
    res.status(201).json({ runs: await c.agent.scan(hh) });
  }));
  r.get("/agent/runs", ah(async (req, res) => { res.json({ runs: await c.agent.listRuns(req.ctx!.householdId) }); }));
  r.get("/agent/runs/:id", ah(async (req, res) => { res.json(await c.agent.getRun(req.ctx!.householdId, String(req.params.id))); }));
  r.get("/agent/activity", ah(async (req, res) => {
    const hh = req.ctx!.householdId;
    res.json({ events: await c.audit.recent(hh, 300), runs: (await c.agent.listRuns(hh)).slice(0, 30) });
  }));
  return r;
}
