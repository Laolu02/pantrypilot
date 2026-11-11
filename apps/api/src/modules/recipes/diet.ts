import type { Allergen } from "@pantrypilot/contracts";

export interface IngredientInfo { name: string; allergens: Allergen[] | null; tags: string[] }

/** Canonical ingredient dictionary. `allergens: null` means unknown, which fails closed. */
export const INGREDIENTS: Record<string, IngredientInfo> = {
  milk: { name: "Semi-skimmed milk", allergens: ["milk"], tags: ["dairy"] },
  eggs: { name: "Eggs", allergens: ["egg"], tags: ["egg"] },
  spinach: { name: "Spinach", allergens: [], tags: [] },
  rice: { name: "Long-grain rice", allergens: [], tags: [] },
  chicken_thigh: { name: "Chicken thighs", allergens: [], tags: ["meat"] },
  olive_oil: { name: "Olive oil", allergens: [], tags: [] },
  flour: { name: "Plain flour", allergens: ["gluten"], tags: ["gluten"] },
  butter: { name: "Butter", allergens: ["milk"], tags: ["dairy"] },
  onion: { name: "Onions", allergens: [], tags: [] },
  tinned_tomato: { name: "Chopped tomatoes", allergens: [], tags: [] },
  pasta: { name: "Dried pasta", allergens: ["gluten"], tags: ["gluten"] },
  cheddar: { name: "Mature cheddar", allergens: ["milk"], tags: ["dairy"] },
  yoghurt: { name: "Natural yoghurt", allergens: ["milk"], tags: ["dairy"] },
  garlic: { name: "Garlic", allergens: [], tags: [] },
  peanut_butter: { name: "Peanut butter", allergens: ["peanut"], tags: [] },
  oat_milk: { name: "Oat drink", allergens: ["gluten"], tags: ["gluten"] },
  soy_milk: { name: "Soya drink", allergens: ["soy"], tags: [] },
  suya_spice: { name: "Suya spice blend", allergens: null, tags: [] },
  tomato: { name: "Tomatoes", allergens: [], tags: [] },
  tomato_paste: { name: "Tomato purée", allergens: [], tags: [] },
  bell_pepper: { name: "Bell peppers", allergens: [], tags: [] },
  chilli_pepper: { name: "Chilli peppers", allergens: [], tags: [] },
  carrot: { name: "Carrots", allergens: [], tags: [] },
  potato: { name: "Potatoes", allergens: [], tags: [] },
  sweet_potato: { name: "Sweet potatoes", allergens: [], tags: [] },
  plantain: { name: "Plantain", allergens: [], tags: [] },
  banana: { name: "Bananas", allergens: [], tags: [] },
  apple: { name: "Apples", allergens: [], tags: [] },
  blueberries: { name: "Blueberries", allergens: [], tags: [] },
  lemon: { name: "Lemons", allergens: [], tags: [] },
  avocado: { name: "Avocados", allergens: [], tags: [] },
  lettuce: { name: "Lettuce", allergens: [], tags: [] },
  cucumber: { name: "Cucumber", allergens: [], tags: [] },
  ginger: { name: "Fresh ginger", allergens: [], tags: [] },
  black_beans: { name: "Black beans (tinned)", allergens: [], tags: [] },
  chickpeas: { name: "Chickpeas (tinned)", allergens: [], tags: [] },
  ground_beef: { name: "Beef mince", allergens: [], tags: ["meat"] },
  oats: { name: "Rolled oats", allergens: ["gluten"], tags: ["gluten"] },
  bread: { name: "Wholemeal bread", allergens: ["gluten"], tags: ["gluten"] },
  tortilla: { name: "Flour tortillas", allergens: ["gluten"], tags: ["gluten"] },
  whole_wheat_flour: { name: "Wholemeal flour", allergens: ["gluten"], tags: ["gluten"] },
  baking_powder: { name: "Baking powder", allergens: [], tags: [] },
  honey: { name: "Honey", allergens: [], tags: [] },
  cinnamon: { name: "Ground cinnamon", allergens: [], tags: [] },
  cumin: { name: "Ground cumin", allergens: [], tags: [] },
  paprika: { name: "Smoked paprika", allergens: [], tags: [] },
};

export const RESTRICTION_EXCLUDES: Record<string, string[]> = {
  vegetarian: ["meat", "fish"],
  vegan: ["meat", "fish", "dairy", "egg"],
  pescatarian: ["meat"],
  gluten_free: ["gluten"],
  dairy_free: ["dairy"],
  halal: ["pork"],
};

const SYNONYMS: Record<string, string> = {
  peanuts: "peanut", groundnut: "peanut", groundnuts: "peanut", nuts: "tree_nut", "tree nut": "tree_nut",
  dairy: "milk", eggs: "egg", soya: "soy", wheat: "gluten",
};
export const normalizeAllergen = (a: string) => {
  const k = a.trim().toLowerCase();
  return SYNONYMS[k] ?? k;
};

export interface DietProfile { allergies: string[]; dietaryRestrictions: string[]; dislikedIngredients?: string[] }
export interface Violation { ingredient: string; kind: "ALLERGEN" | "DIETARY" | "DISLIKED"; detail: string }

export function excludedTags(restrictions: string[]): Set<string> {
  return new Set(restrictions.flatMap((r) => RESTRICTION_EXCLUDES[r.trim().toLowerCase()] ?? []));
}

/** Pure check shared by recipes, substitutions and the purchase policy. */
export function checkAgainstProfile(
  items: { key: string; allergens: readonly string[] | null; tags: readonly string[] }[],
  profile: DietProfile,
): { violations: Violation[]; unknown: string[] } {
  const allergies = new Set(profile.allergies.map(normalizeAllergen));
  const excluded = excludedTags(profile.dietaryRestrictions);
  const disliked = new Set((profile.dislikedIngredients ?? []).map((d) => d.trim().toLowerCase()));
  const violations: Violation[] = [];
  const unknown: string[] = [];
  for (const it of items) {
    if (it.allergens === null) unknown.push(it.key);
    else for (const a of it.allergens) if (allergies.has(normalizeAllergen(a)))
      violations.push({ ingredient: it.key, kind: "ALLERGEN", detail: `Contains ${a}` });
    for (const t of it.tags) if (excluded.has(t))
      violations.push({ ingredient: it.key, kind: "DIETARY", detail: `Not compatible with your dietary restrictions (${t})` });
    if (disliked.has(it.key.toLowerCase()) || disliked.has((INGREDIENTS[it.key]?.name ?? "").toLowerCase()))
      violations.push({ ingredient: it.key, kind: "DISLIKED", detail: "On your disliked list" });
  }
  return { violations, unknown };
}

export const INGREDIENT_DEFAULTS: Record<string, { unit: "ml" | "g" | "count"; storage: "FRIDGE" | "FREEZER" | "PANTRY"; shelfLifeDays: number | null }> = {
  milk: { unit: "ml", storage: "FRIDGE", shelfLifeDays: 7 }, eggs: { unit: "count", storage: "FRIDGE", shelfLifeDays: 21 },
  spinach: { unit: "g", storage: "FRIDGE", shelfLifeDays: 5 }, rice: { unit: "g", storage: "PANTRY", shelfLifeDays: null },
  chicken_thigh: { unit: "g", storage: "FRIDGE", shelfLifeDays: 2 }, olive_oil: { unit: "ml", storage: "PANTRY", shelfLifeDays: null },
  flour: { unit: "g", storage: "PANTRY", shelfLifeDays: null }, butter: { unit: "g", storage: "FRIDGE", shelfLifeDays: 30 },
  onion: { unit: "count", storage: "PANTRY", shelfLifeDays: 30 }, tinned_tomato: { unit: "count", storage: "PANTRY", shelfLifeDays: null },
  pasta: { unit: "g", storage: "PANTRY", shelfLifeDays: null }, cheddar: { unit: "g", storage: "FRIDGE", shelfLifeDays: 21 },
  yoghurt: { unit: "g", storage: "FRIDGE", shelfLifeDays: 10 }, garlic: { unit: "count", storage: "PANTRY", shelfLifeDays: 30 },
  peanut_butter: { unit: "g", storage: "PANTRY", shelfLifeDays: null }, oat_milk: { unit: "ml", storage: "PANTRY", shelfLifeDays: null },
  soy_milk: { unit: "ml", storage: "PANTRY", shelfLifeDays: null }, suya_spice: { unit: "g", storage: "PANTRY", shelfLifeDays: null },
  tomato: { unit: "count", storage: "PANTRY", shelfLifeDays: 7 }, tomato_paste: { unit: "g", storage: "PANTRY", shelfLifeDays: null },
  bell_pepper: { unit: "count", storage: "FRIDGE", shelfLifeDays: 10 }, chilli_pepper: { unit: "count", storage: "FRIDGE", shelfLifeDays: 10 },
  carrot: { unit: "count", storage: "FRIDGE", shelfLifeDays: 21 }, potato: { unit: "g", storage: "PANTRY", shelfLifeDays: 30 },
  sweet_potato: { unit: "count", storage: "PANTRY", shelfLifeDays: 21 }, plantain: { unit: "count", storage: "PANTRY", shelfLifeDays: 7 },
  banana: { unit: "count", storage: "PANTRY", shelfLifeDays: 6 }, apple: { unit: "count", storage: "FRIDGE", shelfLifeDays: 21 },
  blueberries: { unit: "g", storage: "FRIDGE", shelfLifeDays: 7 }, lemon: { unit: "count", storage: "FRIDGE", shelfLifeDays: 21 },
  avocado: { unit: "count", storage: "PANTRY", shelfLifeDays: 4 }, lettuce: { unit: "count", storage: "FRIDGE", shelfLifeDays: 7 },
  cucumber: { unit: "count", storage: "FRIDGE", shelfLifeDays: 7 }, ginger: { unit: "g", storage: "FRIDGE", shelfLifeDays: 21 },
  black_beans: { unit: "count", storage: "PANTRY", shelfLifeDays: null }, chickpeas: { unit: "count", storage: "PANTRY", shelfLifeDays: null },
  ground_beef: { unit: "g", storage: "FRIDGE", shelfLifeDays: 2 }, oats: { unit: "g", storage: "PANTRY", shelfLifeDays: null },
  bread: { unit: "count", storage: "PANTRY", shelfLifeDays: 5 }, tortilla: { unit: "count", storage: "PANTRY", shelfLifeDays: 14 },
  whole_wheat_flour: { unit: "g", storage: "PANTRY", shelfLifeDays: null }, baking_powder: { unit: "g", storage: "PANTRY", shelfLifeDays: null },
  honey: { unit: "g", storage: "PANTRY", shelfLifeDays: null }, cinnamon: { unit: "g", storage: "PANTRY", shelfLifeDays: null },
  cumin: { unit: "g", storage: "PANTRY", shelfLifeDays: null }, paprika: { unit: "g", storage: "PANTRY", shelfLifeDays: null },
};
export const slugify = (name: string) => name.trim().toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
