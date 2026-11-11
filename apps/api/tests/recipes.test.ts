import { describe, expect, it } from "vitest";
import { setup } from "./helpers";

describe("recipes and substitutions", () => {
  it("recommends feasible, in-stock meals and rejects allergen violations with reasons", async () => {
    const t = await setup();
    const { body } = await t.me.post("/recipes/recommend", {});
    const names = body.recommendations.map((r: any) => r.id);
    expect(names).toContain("r_omelette");
    expect(names).not.toContain("r_groundnut_stew");
    const rejected = body.rejected.find((r: any) => r.id === "r_groundnut_stew");
    expect(rejected.validation.status).toBe("REJECTED");
    expect(rejected.validation.violations[0]).toMatchObject({ kind: "ALLERGEN", ingredient: "peanut_butter" });
    expect(rejected.explanation).toMatch(/peanut/i);
  });
  it("lists available and missing ingredients and prefers recipes that use expiring items", async () => {
    const t = await setup();
    const { body } = await t.me.post("/recipes/recommend", { limit: 12 });
    const omelette = body.recommendations.find((r: any) => r.id === "r_omelette");
    expect(omelette.feasible).toBe(true);
    expect(omelette.usesExpiringSoon).toContain("spinach");
    const pasta = body.recommendations.find((r: any) => r.id === "r_spinach_pasta");
    expect(pasta.availableIngredients).toContain("pasta");
    expect(body.recommendations[0].score).toBeGreaterThanOrEqual(body.recommendations.at(-1).score);
  });
  it("fails closed to REVIEW when allergen data is unknown", async () => {
    const t = await setup();
    const { body } = await t.me.post("/recipes/recommend", { limit: 12 });
    const suya = body.recommendations.find((r: any) => r.id === "r_suya_rice");
    expect(suya.validation.status).toBe("REVIEW");
    expect(suya.validation.unknownAllergenData).toContain("suya_spice");
    expect(suya.validation.disclaimer).toMatch(/not medical/i);
  });
  it("scales servings and quantities", async () => {
    const t = await setup();
    const { body } = await t.me.post("/recipes/recommend", { servings: 4, limit: 12 });
    const omelette = body.recommendations.find((r: any) => r.id === "r_omelette");
    expect(omelette.servings).toBe(4);
    expect(omelette.ingredients.find((i: any) => i.canonicalKey === "eggs").required).toBe(8);
  });
  it("honours dietary restrictions and updated allergies", async () => {
    const t = await setup();
    await t.me.put("/preferences", { cuisines: [], allergies: ["Eggs", "dairy"], dietaryRestrictions: ["vegetarian"], dislikedIngredients: [], healthGoal: null, weeklyBudgetMinor: null });
    const { body } = await t.me.post("/recipes/recommend", { limit: 12 });
    const ok = body.recommendations.map((r: any) => r.id);
    expect(ok).not.toContain("r_omelette");
    expect(ok).not.toContain("r_jollof"); // chicken, vegetarian
    expect(body.rejected.length).toBeGreaterThan(5);
  });
  it("substitutions respect allergies and say why", async () => {
    const t = await setup();
    await t.me.put("/preferences", { cuisines: [], allergies: ["gluten"], dietaryRestrictions: [], dislikedIngredients: [], healthGoal: null, weeklyBudgetMinor: null });
    const { body } = await t.me.post("/recipes/r_pancakes/substitutions", { missing: ["milk", "cheddar"] });
    const milk = body.substitutions.find((s: any) => s.missing === "milk");
    expect(milk.options.find((o: any) => o.substitute === "oat_milk").allowed).toBe(false);
    expect(milk.options.find((o: any) => o.substitute === "soy_milk").allowed).toBe(true);
    expect(body.substitutions.find((s: any) => s.missing === "cheddar").note).toMatch(/No safe substitution/);
  });
  it("meal-plan generation is explicitly not implemented rather than faked", async () => {
    const t = await setup();
    expect((await t.me.post("/meal-plans/generate")).status).toBe(501);
  });
});
