import type { MealLogRow, RecipeRow, Store } from "../../store/store";
import { AppError, notFound } from "../../lib/errors";
import { newId } from "../../lib/ids";

/** A logged meal is not suggested again for this long. */
export const MEAL_COOLDOWN_HOURS = 48;
const HOUR = 3_600_000;

/** The slice of the inventory service this module needs. */
export interface PantryPort {
  findByKey(householdId: string, canonicalKey: string): Promise<{ id: string; name: string; quantity: number; unit: string } | null | undefined>;
  patch(householdId: string, actor: string, id: string, body: { quantity: number }): Promise<unknown>;
  remove(householdId: string, actor: string, id: string): Promise<unknown>;
}

export interface PantryUse { canonicalKey: string; name: string; used: number; unit: string; left: number | null; note?: string }

export interface MealLogInput {
  mealType: MealLogRow["mealType"];
  source: MealLogRow["source"];
  recipeId?: string | undefined;
  name?: string | undefined;
  servings?: number | undefined;
  eatenAt?: string | undefined;
}

const round = (n: number, unit: string) => (unit === "count" ? Math.round(n * 10) / 10 : Math.round(n));

export class MealLogService {
  constructor(private store: Store, private pantry: PantryPort) {}

  /** Newest first. */
  async list(householdId: string, days = 7, now = new Date()): Promise<MealLogRow[]> {
    const since = now.getTime() - days * 24 * HOUR;
    const rows = await this.store.mealLog.list(
      (m) => m.householdId === householdId && !m.removedAt && new Date(m.eatenAt).getTime() >= since,
    );
    return rows.sort((a, b) => (a.eatenAt < b.eatenAt ? 1 : -1));
  }

  async add(householdId: string, actor: string, input: MealLogInput, now = new Date()): Promise<{ entry: MealLogRow; pantry: PantryUse[] }> {
    let name = input.name?.trim() ?? "";
    let recipe: RecipeRow | null = null;
    if (input.recipeId) {
      const found = await this.store.recipes.get(input.recipeId);
      if (!found) throw notFound("Recipe");
      recipe = found;
      if (!name) name = found.name;
    }
    if (!name) throw new AppError(422, "INVALID_MEAL", "Pick a recipe or type what you had");
    const eatenAt = input.eatenAt ?? now.toISOString();
    if (new Date(eatenAt).getTime() > now.getTime() + 5 * 60_000)
      throw new AppError(422, "INVALID_MEAL", "A meal cannot be logged in the future");

    const servings = input.servings ?? recipe?.servings ?? null;
    let pantry: PantryUse[] = [];
    let consumed: MealLogRow["consumed"] = [];
    // Only home cooking with a known recipe takes ingredients out of the pantry.
    if (input.source === "HOME_MADE" && recipe && servings) {
      const r = recipe;
      const out = await this.store.withLock(`pantry:${householdId}`, () => this.consume(householdId, actor, r, servings));
      pantry = out.pantry; consumed = out.consumed;
    }

    const entry = await this.store.mealLog.insert({
      id: newId("ml"), householdId, mealType: input.mealType, source: input.source,
      recipeId: input.recipeId ?? null, name, servings, consumed, eatenAt,
      loggedAt: now.toISOString(), loggedBy: actor, removedAt: null,
    });
    return { entry, pantry };
  }

  /** Soft delete. Anything a home-made meal took from the pantry is put back. */
  async undo(householdId: string, actor: string, id: string, now = new Date()) {
    const row = await this.store.mealLog.get(id);
    if (!row || row.householdId !== householdId || row.removedAt) throw notFound("Meal log entry");
    let restored = 0;
    await this.store.withLock(`pantry:${householdId}`, async () => {
      for (const c of row.consumed ?? []) {
        const item = await this.pantry.findByKey(householdId, c.canonicalKey);
        if (!item) continue; // item was removed from the pantry since; nothing to add back to
        try {
          await this.pantry.patch(householdId, actor, item.id, { quantity: Math.round((item.quantity + c.quantity) * 10) / 10 });
          restored++;
        } catch { /* leave it; the log entry is still removed */ }
      }
    });
    await this.store.mealLog.update(id, { removedAt: now.toISOString() });
    return { restored };
  }

  /** recipeId -> the most recent log still inside the cooldown window. */
  async cooldowns(householdId: string, now = new Date()): Promise<Map<string, MealLogRow>> {
    const since = now.getTime() - MEAL_COOLDOWN_HOURS * HOUR;
    const out = new Map<string, MealLogRow>();
    for (const m of await this.list(householdId, 3, now)) { // newest first
      if (!m.recipeId || new Date(m.eatenAt).getTime() < since) continue;
      if (!out.has(m.recipeId)) out.set(m.recipeId, m);
    }
    return out;
  }

  private async consume(householdId: string, actor: string, recipe: RecipeRow, servings: number) {
    const factor = servings / recipe.servings;
    const pantry: PantryUse[] = [];
    const consumed: MealLogRow["consumed"] = [];
    for (const ing of recipe.ingredients) {
      if (ing.optional) continue;
      const item = await this.pantry.findByKey(householdId, ing.canonicalKey);
      const base = { canonicalKey: ing.canonicalKey, name: item?.name ?? ing.canonicalKey, unit: ing.unit };
      if (!item) { pantry.push({ ...base, used: 0, left: null, note: "not in pantry" }); continue; }
      if (item.unit !== ing.unit) { pantry.push({ ...base, used: 0, left: item.quantity, note: `pantry is in ${item.unit}, recipe in ${ing.unit}` }); continue; }
      const need = round(ing.quantity * factor, ing.unit);
      const used = Math.min(item.quantity, need);
      if (used <= 0) continue;
      const left = round(item.quantity - used, ing.unit);
      try {
        if (left > 0) await this.pantry.patch(householdId, actor, item.id, { quantity: left });
        else {
          try { await this.pantry.patch(householdId, actor, item.id, { quantity: 0 }); }
          catch { await this.pantry.remove(householdId, actor, item.id); } // zero is not a valid stock level
        }
      } catch { pantry.push({ ...base, used: 0, left: item.quantity, note: "could not update" }); continue; }
      consumed.push({ canonicalKey: ing.canonicalKey, quantity: used });
      pantry.push({ ...base, used, left, ...(used < need ? { note: "ran short" } : {}) });
    }
    return { pantry, consumed };
  }
}