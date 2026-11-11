import { Router } from "express";
import { CreateInventoryItemSchema, PatchInventoryItemSchema, ResolveReconciliationSchema, StorageSchema } from "@pantrypilot/contracts";
import { z } from "zod";
import type { Container } from "../container";
import { ah } from "../middleware/http";
import { INGREDIENTS, INGREDIENT_DEFAULTS } from "../modules/recipes/diet";

const Filters = z.object({
  location: StorageSchema.optional(),
  lowStock: z.enum(["true", "false"]).optional(),
  uncertain: z.enum(["true", "false"]).optional(),
  expiringDays: z.coerce.number().positive().optional(),
});

export function inventoryRoutes(c: Container) {
  const r = Router();
  r.get("/inventory", ah(async (req, res) => {
    const f = Filters.parse(req.query);
    res.json({ items: await c.inventory.list(req.ctx!.householdId, {
      ...(f.location ? { location: f.location } : {}), ...(f.lowStock ? { lowStock: f.lowStock === "true" } : {}),
      ...(f.uncertain ? { uncertain: f.uncertain === "true" } : {}), ...(f.expiringDays ? { expiringDays: f.expiringDays } : {}),
    }) });
  }));
  r.get("/inventory/expiring", ah(async (req, res) => {
    const days = z.coerce.number().positive().default(3).parse(req.query.days);
    res.json({ items: await c.inventory.list(req.ctx!.householdId, { expiringDays: days }) });
  }));
  /** Known ingredients with sensible defaults, for the manual-add form. Custom names are also accepted. */
  r.get("/ingredients", ah(async (_req, res) => {
    res.json({ ingredients: Object.entries(INGREDIENTS).map(([key, v]) => ({ key, name: v.name, allergenDataKnown: v.allergens !== null, ...INGREDIENT_DEFAULTS[key] })) });
  }));
  r.get("/inventory/ledger", ah(async (req, res) => {
    res.json({ events: await c.inventory.ledger(req.ctx!.householdId, typeof req.query.itemId === "string" ? req.query.itemId : undefined) });
  }));
  r.get("/inventory/reconciliations", ah(async (req, res) => { res.json({ requests: await c.inventory.openReconciliations(req.ctx!.householdId) }); }));
  r.post("/inventory", ah(async (req, res) => {
    const body = CreateInventoryItemSchema.parse(req.body);
    res.status(201).json(await c.inventory.create(req.ctx!.householdId, req.ctx!.actor, body));
  }));
  r.patch("/inventory/:id", ah(async (req, res) => {
    const body = PatchInventoryItemSchema.parse(req.body);
    const hh = req.ctx!.householdId;
    const updated = await c.inventory.patch(hh, req.ctx!.actor, String(req.params.id), body);
    // A manual quantity change can cross the reorder point: let the agent evaluate it.
    // The run is idempotent and policy-gated; failures here never fail the edit itself.
    if ("quantity" in body && updated?.canonicalKey) {
      try {
        await c.agent.runReplenishment(hh, { canonicalKey: updated.canonicalKey, trigger: { type: "USER_ACTION" } });
      } catch { /* the edit already succeeded; the run records its own failure */ }
    }
    res.json(updated);
  }));
  r.delete("/inventory/:id", ah(async (req, res) => { res.json(await c.inventory.remove(req.ctx!.householdId, req.ctx!.actor, String(req.params.id))); }));
  r.post("/inventory/reconcile", ah(async (req, res) => {
    const b = ResolveReconciliationSchema.parse(req.body);
    res.json(await c.inventory.resolveReconciliation(req.ctx!.householdId, req.ctx!.actor, b.requestId, b.resolution, b.quantity));
  }));
  return r;
}
