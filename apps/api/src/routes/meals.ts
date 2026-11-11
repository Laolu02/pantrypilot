import { Router } from "express";
import { PreferencesSchema, RecommendRequestSchema, SubstitutionRequestSchema } from "@pantrypilot/contracts";
import type { Container } from "../container";
import { AppError } from "../lib/errors";
import { ah } from "../middleware/http";
import { z } from "zod";
import { MealLogService, MEAL_COOLDOWN_HOURS } from "../modules/meals/mealLog";
import { normalizeAllergen } from "../modules/recipes/diet";
import { notFound } from "../lib/errors";
import { newId } from "../lib/ids";
export function mealRoutes(c: Container) {
  const r = Router();
    const meals = new MealLogService(c.store, c.inventory);
  const LogMeal = z.object({
    mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
    source: z.enum(["HOME_MADE", "DELIVERY"]),
    recipeId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    servings: z.number().int().min(1).max(24).optional(),
  }).refine((b) => !!b.recipeId || !!b.name, { message: "Pick a recipe or type what you had" });

  const ListField = z.array(z.string().trim().min(1).max(40)).max(40);
  const DietBody = z.object({ allergies: ListField.optional(), dislikedIngredients: ListField.optional() });
  const clean = (xs: string[], f: (s: string) => string = (s) => s.trim().toLowerCase()) => [...new Set(xs.map(f).filter(Boolean))];
  const prefRow = async (hh: string) => (await c.store.preferences.list((p) => p.householdId === hh))[0];
  const hiddenIds = async (hh: string) => new Set((await c.store.mealDislikes.list((d) => d.householdId === hh && !d.removedAt)).map((d) => d.recipeId));

  /** Recommendations minus meals eaten in the cooldown (returned separately) and meals the household hid. */
  const recommendWithCooldown = async (hh: string, o: { servings?: number; limit?: number }) => {
    const want = o.limit ?? 6;
    const res = await c.recipes.recommend(hh, { ...(o.servings ? { servings: o.servings } : {}), limit: 200 });
    const [cool, hidden] = await Promise.all([meals.cooldowns(hh), hiddenIds(hh)]);
    const shown = res.recommendations.filter((x) => !hidden.has(x.id));
    const recentlyHad = shown.filter((x) => cool.has(x.id)).map((x) => {
      const m = cool.get(x.id)!;
      return { ...x, lastHadAt: m.eatenAt, lastHadSource: m.source, availableAgainAt: new Date(new Date(m.eatenAt).getTime() + MEAL_COOLDOWN_HOURS * 3_600_000).toISOString() };
    });
    return { ...res, recommendations: shown.filter((x) => !cool.has(x.id)).slice(0, want), rejected: res.rejected.filter((x) => !hidden.has(x.id)), recentlyHad };
  };
  r.get("/preferences", ah(async (req, res) => { res.json(await c.prefs.get(req.ctx!.householdId)); }));
  r.put("/preferences", ah(async (req, res) => { res.json(await c.prefs.put(req.ctx!.householdId, req.ctx!.actor, PreferencesSchema.parse(req.body))); }));
   r.post("/recipes/recommend", ah(async (req, res) => {
    const b = RecommendRequestSchema.parse(req.body ?? {});
    res.json(await recommendWithCooldown(req.ctx!.householdId, {
      ...(b.servings ? { servings: b.servings } : {}), ...(b.limit ? { limit: b.limit } : {}),
    }));
  }));
  r.get("/recipes/recommend", ah(async (req, res) => {
    const servings = Number(req.query.servings);
    const limit = Number(req.query.limit);
    res.json(await recommendWithCooldown(req.ctx!.householdId, {
      ...(Number.isFinite(servings) && servings > 0 ? { servings } : {}),
      ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
    }));
  }));
  r.get("/recipes/:id", ah(async (req, res) => { res.json(await c.recipes.validate(req.ctx!.householdId, String(req.params.id))); }));
  r.post("/recipes/:id/substitutions", ah(async (req, res) => {
    const { missing } = SubstitutionRequestSchema.parse(req.body);
    res.json({ substitutions: await c.recipes.substitutions(req.ctx!.householdId, String(req.params.id), missing) });
  }));
  r.post("/meal-plans/generate", ah(async () => { throw new AppError(501, "NOT_IMPLEMENTED", "Weekly meal plans are a P1 item and are not built yet"); }));
    r.get("/meals/log", ah(async (req, res) => { res.json({ entries: await meals.list(req.ctx!.householdId) }); }));
  r.post("/meals/log", ah(async (req, res) => {
    const hh = req.ctx!.householdId;
    const out = await meals.add(hh, req.ctx!.actor, LogMeal.parse(req.body ?? {}));
    // Cooking can push a staple under its reorder point: let the agent check. The log already succeeded either way.
    if (out.pantry.some((p) => p.used > 0)) { try { await c.agent.scan(hh); } catch { /* recorded in the run itself */ } }
    res.status(201).json(out);
  }));
  r.post("/meals/log/:id/undo", ah(async (req, res) => { res.json(await meals.undo(req.ctx!.householdId, req.ctx!.actor, String(req.params.id))); }));

  // Food rules: allergies, disliked ingredients, hidden meals.
  r.get("/diet", ah(async (req, res) => {
    const hh = req.ctx!.householdId;
    const p = await prefRow(hh);
    const hiddenMeals = await Promise.all([...(await hiddenIds(hh))].map(async (recipeId) => ({ recipeId, name: (await c.store.recipes.get(recipeId))?.name ?? recipeId })));
    res.json({ allergies: p?.allergies ?? [], dislikedIngredients: p?.dislikedIngredients ?? [], hiddenMeals });
  }));
  r.post("/diet", ah(async (req, res) => {
    const hh = req.ctx!.householdId;
    const b = DietBody.parse(req.body ?? {});
    const p = await prefRow(hh);
    if (!p) throw notFound("Preferences");
    const next = await c.store.preferences.update(p.id, {
      ...(b.allergies ? { allergies: clean(b.allergies, normalizeAllergen) } : {}),
      ...(b.dislikedIngredients ? { dislikedIngredients: clean(b.dislikedIngredients) } : {}),
    });
    res.json({ allergies: next.allergies, dislikedIngredients: next.dislikedIngredients });
  }));
  r.post("/meals/hidden", ah(async (req, res) => {
    const hh = req.ctx!.householdId;
    const { recipeId } = z.object({ recipeId: z.string().min(1) }).parse(req.body ?? {});
    if (!(await c.store.recipes.get(recipeId))) throw notFound("Recipe");
    if (!(await hiddenIds(hh)).has(recipeId)) await c.store.mealDislikes.insert({ id: newId("md"), householdId: hh, recipeId, at: new Date().toISOString(), removedAt: null });
    res.status(201).json({ ok: true });
  }));
  r.post("/meals/hidden/:recipeId/restore", ah(async (req, res) => {
    const hh = req.ctx!.householdId;
    const rows = await c.store.mealDislikes.list((d) => d.householdId === hh && d.recipeId === String(req.params.recipeId) && !d.removedAt);
    for (const d of rows) await c.store.mealDislikes.update(d.id, { removedAt: new Date().toISOString() });
    res.json({ ok: true });
  }));

   return r;
}
