import type { Preferences } from "@pantrypilot/contracts";
import type { RecipeRow, Store } from "../../store/store";
import type { Clock } from "../../lib/clock";
import { notFound } from "../../lib/errors";
import { InventoryService } from "../inventory/inventoryService";
import { PreferencesService } from "../preferences/preferencesService";
import { INGREDIENTS, checkAgainstProfile, type Violation } from "./diet";
import { SUBSTITUTIONS } from "./substitutions";

export const DISCLAIMER = "Checked only against the allergies and restrictions listed in your preferences. This is not medical or dietary advice; always read labels.";

export interface RecipeIngredientView {
  canonicalKey: string; name: string; required: number; unit: string; optional: boolean;
  have: number; missing: number;
}
export interface RecipeView {
  id: string; name: string; cuisine: string; servings: number; steps: string[]; tags: string[];
  nutritionPerServing: RecipeRow["nutritionPerServing"] & { note: string };
  ingredients: RecipeIngredientView[];
  availableIngredients: string[]; missingIngredients: string[];
  usesExpiringSoon: string[]; feasible: boolean;
  validation: { status: "PASS" | "REVIEW" | "REJECTED"; violations: Violation[]; unknownAllergenData: string[]; disclaimer: string };
  score: number; explanation: string;
}

export class RecipeService {
  constructor(private store: Store, private clock: Clock, private prefs: PreferencesService, private inventory: InventoryService) {}

  private async build(householdId: string, recipe: RecipeRow, prefs: Preferences, servings?: number): Promise<RecipeView> {
    const factor = (servings ?? recipe.servings) / recipe.servings;
    const items = await this.inventory.list(householdId);
    const stock = new Map(items.map((i) => [i.canonicalKey, i]));
    const ingredients: RecipeIngredientView[] = recipe.ingredients.map((ing) => {
      const required = Math.round(ing.quantity * factor * 10) / 10;
      const have = stock.get(ing.canonicalKey)?.usableQty ?? 0;
      return { canonicalKey: ing.canonicalKey, name: INGREDIENTS[ing.canonicalKey]?.name ?? ing.canonicalKey, required, unit: ing.unit, optional: !!ing.optional, have, missing: Math.max(0, required - have) };
    });
    const core = ingredients.filter((i) => !i.optional);
    const missingIngredients = core.filter((i) => i.missing > 0).map((i) => i.canonicalKey);
    const availableIngredients = core.filter((i) => i.missing === 0).map((i) => i.canonicalKey);
    const soon = new Set(items.filter((i) => i.expiresAt && new Date(i.expiresAt).getTime() - this.clock.now().getTime() <= 3 * 86400000 && i.usableQty > 0).map((i) => i.canonicalKey));
    const usesExpiringSoon = ingredients.filter((i) => soon.has(i.canonicalKey)).map((i) => i.canonicalKey);

    const chk = checkAgainstProfile(
      ingredients.map((i) => ({ key: i.canonicalKey, allergens: INGREDIENTS[i.canonicalKey]?.allergens ?? null, tags: INGREDIENTS[i.canonicalKey]?.tags ?? [] })),
      prefs,
    );
    const status = chk.violations.length ? "REJECTED" : chk.unknown.length ? "REVIEW" : "PASS";
    const coverage = core.length ? availableIngredients.length / core.length : 0;
    const cuisineBoost = prefs.cuisines.map((c) => c.toLowerCase()).includes(recipe.cuisine.toLowerCase()) ? 15 : 0;
    const score = Math.round(coverage * 60 + cuisineBoost + (usesExpiringSoon.length ? 15 : 0) - missingIngredients.length * 3);

    const explanation = status === "REJECTED"
      ? `Excluded: ${chk.violations.map((v) => `${INGREDIENTS[v.ingredient]?.name ?? v.ingredient} (${v.detail.toLowerCase()})`).join("; ")}.`
      : [
          missingIngredients.length === 0 ? "You have everything in stock." : `Missing ${missingIngredients.map((k) => INGREDIENTS[k]?.name ?? k).join(", ")}.`,
          usesExpiringSoon.length ? `Uses ${usesExpiringSoon.map((k) => INGREDIENTS[k]?.name ?? k).join(", ")} before they expire.` : "",
          cuisineBoost ? `Matches your ${recipe.cuisine} preference.` : "",
          status === "REVIEW" ? `Allergen data is unknown for ${chk.unknown.map((k) => INGREDIENTS[k]?.name ?? k).join(", ")}; check the label before cooking.` : "",
        ].filter(Boolean).join(" ");

    return {
      id: recipe.id, name: recipe.name, cuisine: recipe.cuisine, servings: servings ?? recipe.servings, steps: recipe.steps, tags: recipe.tags,
      nutritionPerServing: { ...recipe.nutritionPerServing, note: "Rough estimate, not a measured value." },
      ingredients, availableIngredients, missingIngredients, usesExpiringSoon, feasible: missingIngredients.length === 0,
      validation: { status, violations: chk.violations, unknownAllergenData: chk.unknown, disclaimer: DISCLAIMER },
      score, explanation,
    };
  }

  async recommend(householdId: string, opts: { servings?: number; limit?: number } = {}) {
    const prefs = await this.prefs.get(householdId);
    const all = await this.store.recipes.list();
    const views = await Promise.all(all.map((r) => this.build(householdId, r, prefs, opts.servings)));
    const sorted = views.filter((v) => v.validation.status !== "REJECTED").sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return { recommendations: sorted.slice(0, opts.limit ?? 6), rejected: views.filter((v) => v.validation.status === "REJECTED") };
  }

  async validate(householdId: string, recipeId: string, servings?: number) {
    const r = await this.store.recipes.get(recipeId);
    if (!r) throw notFound("Recipe");
    return this.build(householdId, r, await this.prefs.get(householdId), servings);
  }

  async substitutions(householdId: string, recipeId: string, missing: string[]) {
    const r = await this.store.recipes.get(recipeId);
    if (!r) throw notFound("Recipe");
    const prefs = await this.prefs.get(householdId);
    const items = await this.inventory.list(householdId);
    const stock = new Map(items.map((i) => [i.canonicalKey, i]));
    return missing.map((key) => {
      const need = r.ingredients.find((i) => i.canonicalKey === key);
      const options = (SUBSTITUTIONS[key] ?? []).map((rule) => {
        const info = INGREDIENTS[rule.to];
        const chk = checkAgainstProfile([{ key: rule.to, allergens: info?.allergens ?? null, tags: info?.tags ?? [] }], prefs);
        const allowed = chk.violations.length === 0;
        const have = stock.get(rule.to)?.usableQty ?? 0;
        const qty = need ? Math.round(need.quantity * rule.ratio) : null;
        return {
          substitute: rule.to, name: info?.name ?? rule.to, ratio: rule.ratio, quantityNeeded: qty,
          inStock: qty !== null && have >= qty, allowed,
          reason: allowed ? rule.note : `Not allowed: ${chk.violations.map((v) => v.detail).join("; ")}`,
          uncertainty: chk.unknown.length ? "HIGH" : rule.uncertainty,
        };
      });
      return { missing: key, name: INGREDIENTS[key]?.name ?? key, options, note: options.length ? undefined : "No safe substitution on file for this ingredient." };
    });
  }
}
