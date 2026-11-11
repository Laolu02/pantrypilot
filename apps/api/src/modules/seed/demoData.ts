import type { Store, RecipeRow } from "../../store/store";
import type { Clock } from "../../lib/clock";
import { DEFAULT_ALLOWLIST } from "../../integrations/commerce/catalog";
import { SIM_FRIDGE, SIM_PANTRY } from "../../integrations/devices/simulator";

export const DEMO_TOKEN = "pp_demo_okafor";
export const OTHER_TOKEN = "pp_demo_harlow";
export const HH = "hh_okafor";
export const HH_OTHER = "hh_harlow";

const r = (id: string, name: string, cuisine: string, servings: number, ing: [string, number, "ml" | "g" | "count", boolean?][], steps: string[], tags: string[], n: [number, number, number, number]): RecipeRow => ({
  id, name, cuisine, servings, tags, steps,
  ingredients: ing.map(([canonicalKey, quantity, unit, optional]) => ({ canonicalKey, quantity, unit, ...(optional ? { optional } : {}) })),
  nutritionPerServing: { kcal: n[0], proteinG: n[1], carbsG: n[2], fatG: n[3], source: "ESTIMATE" },
});

export const RECIPES: RecipeRow[] = [
  r("r_omelette", "Spinach and cheddar omelette", "British", 2, [["eggs", 4, "count"], ["spinach", 100, "g"], ["cheddar", 50, "g"], ["butter", 15, "g"]],
    ["Wilt the spinach in half the butter, then set aside.", "Beat the eggs and cook in the remaining butter until just set.", "Fill with spinach and cheddar, fold and serve."], ["quick", "vegetarian"], [420, 28, 3, 32]),
  r("r_jollof", "Chicken jollof rice", "West African", 4, [["rice", 400, "g"], ["chicken_thigh", 600, "g"], ["tinned_tomato", 2, "count"], ["onion", 2, "count"], ["olive_oil", 45, "ml"], ["garlic", 3, "count"]],
    ["Brown the chicken in oil and set aside.", "Fry onion and garlic, add tomatoes and reduce until thick.", "Stir in rice and 600ml water, return chicken, cover and cook on low for 25 minutes."], ["one-pot"], [610, 38, 68, 20]),
  r("r_spinach_pasta", "Creamy spinach pasta", "Italian", 3, [["pasta", 300, "g"], ["spinach", 150, "g"], ["milk", 250, "ml"], ["butter", 25, "g"], ["garlic", 2, "count"], ["cheddar", 40, "g", true]],
    ["Boil the pasta.", "Soften garlic in butter, add spinach, then milk, and simmer until slightly thickened.", "Toss with pasta and finish with cheddar."], ["vegetarian", "quick"], [540, 20, 74, 18]),
  r("r_groundnut_stew", "Groundnut chicken stew", "West African", 4, [["chicken_thigh", 600, "g"], ["peanut_butter", 120, "g"], ["onion", 2, "count"], ["tinned_tomato", 2, "count"]],
    ["Brown chicken and onion.", "Add tomatoes and peanut butter loosened with water.", "Simmer for 35 minutes."], [], [560, 40, 14, 38]),
  r("r_rice_pudding", "Baked rice pudding", "British", 4, [["rice", 150, "g"], ["milk", 800, "ml"], ["butter", 15, "g"]],
    ["Combine rice and milk in a baking dish and dot with butter.", "Bake at 150C for 90 minutes, stirring once."], ["vegetarian", "dessert"], [320, 10, 52, 8]),
  r("r_shakshuka", "Tomato and garlic baked eggs", "Mediterranean", 2, [["eggs", 4, "count"], ["tinned_tomato", 2, "count"], ["onion", 1, "count"], ["olive_oil", 20, "ml"], ["garlic", 2, "count"]],
    ["Soften onion and garlic in oil.", "Add tomatoes and simmer 10 minutes.", "Make wells, crack in the eggs, cover until set."], ["vegetarian", "quick"], [380, 22, 20, 24]),
  r("r_pancakes", "Thick pancakes", "British", 4, [["flour", 200, "g"], ["eggs", 2, "count"], ["milk", 300, "ml"], ["butter", 20, "g"]],
    ["Whisk flour, eggs and milk into a batter.", "Fry ladlefuls in butter until golden on both sides."], ["vegetarian", "breakfast"], [310, 11, 42, 10]),
  r("r_suya_rice", "Suya-spiced chicken and rice", "West African", 4, [["chicken_thigh", 600, "g"], ["suya_spice", 30, "g"], ["rice", 300, "g"], ["onion", 1, "count"]],
    ["Coat the chicken in suya spice and roast at 200C for 35 minutes.", "Cook the rice and serve with sliced onion."], [], [590, 42, 58, 20]),
  r("r_garlic_bowl", "Garlic chicken and spinach rice bowl", "American", 3, [["chicken_thigh", 500, "g"], ["rice", 300, "g"], ["spinach", 100, "g"], ["garlic", 3, "count"], ["olive_oil", 20, "ml"]],
    ["Pan-fry the chicken with garlic until cooked through.", "Cook the rice, fold through the spinach, and top with the chicken."], ["high-protein"], [570, 41, 55, 19]),
    // ── Breakfast ──
  r("r_overnight_oats", "Banana cinnamon overnight oats", "American", 2, [["oats", 100, "g"], ["milk", 300, "ml"], ["banana", 2, "count"], ["honey", 20, "g"], ["cinnamon", 2, "g", true]],
    ["Stir the oats, milk and cinnamon together in a jar.", "Chill overnight.", "Top with sliced banana and a drizzle of honey."], ["breakfast", "vegetarian", "healthy", "no-cook"], [340, 12, 58, 7]),
  r("r_avocado_toast", "Avocado and egg toast", "American", 2, [["bread", 4, "count"], ["eggs", 2, "count"], ["avocado", 1, "count"], ["lemon", 1, "count", true], ["paprika", 2, "g", true]],
    ["Toast the bread.", "Poach or fry the eggs.", "Mash the avocado with lemon, spread on the toast, top with the eggs and paprika."], ["breakfast", "quick", "vegetarian", "healthy"], [390, 17, 32, 22]),
  r("r_oat_banana_pancakes", "Oat and banana pancakes", "American", 3, [["oats", 120, "g"], ["banana", 2, "count"], ["eggs", 2, "count"], ["milk", 100, "ml"], ["cinnamon", 2, "g", true]],
    ["Blend the oats, banana, eggs and milk into a batter.", "Cook small pancakes in a non-stick pan, 2 minutes per side."], ["breakfast", "vegetarian", "healthy"], [290, 12, 44, 7]),
  r("r_dodo_eggs", "Fried plantain and tomato egg scramble", "West African", 2, [["plantain", 2, "count"], ["eggs", 4, "count"], ["onion", 1, "count"], ["tomato", 2, "count"], ["chilli_pepper", 1, "count", true], ["olive_oil", 30, "ml"]],
    ["Slice the plantain and fry in oil until golden, then set aside.", "Soften onion, tomato and chilli, then add the beaten eggs and scramble.", "Serve with the plantain."], ["breakfast", "vegetarian"], [430, 19, 48, 18]),
  r("r_yoghurt_bowl", "Yoghurt, berry and oat bowl", "American", 2, [["yoghurt", 300, "g"], ["blueberries", 100, "g"], ["banana", 1, "count"], ["honey", 20, "g"], ["oats", 40, "g"]],
    ["Spoon the yoghurt into bowls.", "Top with blueberries, sliced banana, oats and honey."], ["breakfast", "snack", "vegetarian", "healthy", "no-cook", "quick"], [260, 11, 42, 5]),

  // ── Healthy pastries and bakes ──
  r("r_banana_muffins", "Wholemeal banana muffins", "American", 12, [["whole_wheat_flour", 250, "g"], ["banana", 3, "count"], ["eggs", 2, "count"], ["honey", 60, "g"], ["baking_powder", 8, "g"], ["milk", 120, "ml"], ["olive_oil", 60, "ml"], ["cinnamon", 3, "g", true]],
    ["Heat the oven to 180C and line a 12-hole muffin tin.", "Mash the bananas and whisk with the eggs, honey, milk and oil.", "Fold in the flour, baking powder and cinnamon until just combined.", "Bake for 20 to 22 minutes."], ["pastry", "healthy", "snack", "breakfast", "vegetarian"], [165, 4, 26, 5]),
  r("r_apple_oat_bars", "Apple cinnamon oat bars", "American", 8, [["oats", 200, "g"], ["apple", 2, "count"], ["eggs", 1, "count"], ["honey", 50, "g"], ["whole_wheat_flour", 60, "g"], ["butter", 40, "g"], ["cinnamon", 3, "g"], ["baking_powder", 4, "g"]],
    ["Heat the oven to 180C and line a small square tin.", "Grate the apples and mix with the melted butter, honey and egg.", "Stir in the oats, flour, cinnamon and baking powder.", "Press into the tin and bake for 25 minutes, then cut into bars."], ["pastry", "healthy", "snack", "dessert", "vegetarian"], [220, 5, 35, 7]),
  r("r_blueberry_scones", "Wholemeal blueberry yoghurt scones", "British", 8, [["whole_wheat_flour", 300, "g"], ["baking_powder", 12, "g"], ["butter", 60, "g"], ["yoghurt", 150, "g"], ["blueberries", 100, "g"], ["honey", 30, "g"], ["milk", 50, "ml"]],
    ["Heat the oven to 200C.", "Rub the butter into the flour and baking powder.", "Mix in the yoghurt, honey and enough milk to make a soft dough, then fold in the blueberries.", "Shape, cut into 8 and bake for 15 minutes."], ["pastry", "healthy", "snack", "breakfast", "vegetarian"], [210, 6, 31, 7]),
  r("r_spinach_turnovers", "Spinach and cheddar wholemeal turnovers", "British", 6, [["whole_wheat_flour", 250, "g"], ["olive_oil", 50, "ml"], ["yoghurt", 100, "g"], ["spinach", 150, "g"], ["cheddar", 80, "g"], ["eggs", 1, "count"], ["baking_powder", 6, "g"]],
    ["Mix the flour, baking powder, oil and yoghurt into a dough and rest for 15 minutes.", "Wilt the spinach, squeeze dry and mix with the grated cheddar.", "Cut the dough into 6 rounds, fill, fold and seal, brush with beaten egg.", "Bake at 200C for 20 minutes."], ["pastry", "healthy", "lunch", "snack", "vegetarian"], [250, 10, 28, 11]),

  // ── Lunch ──
  r("r_chickpea_salad", "Chickpea, cucumber and tomato salad", "American", 3, [["chickpeas", 2, "count"], ["cucumber", 1, "count"], ["tomato", 3, "count"], ["lemon", 1, "count"], ["olive_oil", 30, "ml"], ["lettuce", 1, "count", true]],
    ["Drain and rinse the chickpeas.", "Chop the cucumber and tomato and toss everything with lemon juice and oil."], ["lunch", "vegetarian", "vegan", "healthy", "no-cook", "quick"], [330, 13, 40, 13]),
  r("r_chicken_wraps", "Chicken and avocado wraps", "American", 4, [["tortilla", 4, "count"], ["chicken_thigh", 500, "g"], ["avocado", 1, "count"], ["lettuce", 1, "count"], ["tomato", 2, "count"], ["yoghurt", 60, "g"], ["paprika", 3, "g"]],
    ["Season the chicken with paprika and pan-fry until cooked through, then slice.", "Warm the tortillas.", "Fill with chicken, avocado, lettuce, tomato and a spoon of yoghurt."], ["lunch", "high-protein"], [480, 36, 34, 22]),
  r("r_bean_burrito_bowl", "Black bean burrito bowl", "Mexican", 4, [["rice", 300, "g"], ["black_beans", 2, "count"], ["bell_pepper", 2, "count"], ["tomato", 2, "count"], ["avocado", 1, "count"], ["lemon", 1, "count"], ["cumin", 4, "g"], ["paprika", 4, "g"]],
    ["Cook the rice.", "Fry the sliced peppers with cumin and paprika, then add the drained beans and warm through.", "Serve over the rice with chopped tomato, avocado and a squeeze of lemon."], ["lunch", "dinner", "vegetarian", "vegan", "healthy"], [520, 16, 82, 14]),
  r("r_quesadillas", "Cheesy bean quesadillas", "Mexican", 3, [["tortilla", 6, "count"], ["black_beans", 1, "count"], ["cheddar", 150, "g"], ["bell_pepper", 1, "count"], ["cumin", 2, "g"]],
    ["Mix the mashed beans with cumin and diced pepper.", "Spread over 3 tortillas, add cheddar and top with the rest.", "Toast in a dry pan for 3 minutes per side and cut into wedges."], ["lunch", "quick", "vegetarian"], [470, 20, 50, 22]),
  r("r_carrot_potato_soup", "Carrot and potato soup", "American", 4, [["carrot", 4, "count"], ["potato", 500, "g"], ["onion", 1, "count"], ["garlic", 2, "count"], ["olive_oil", 20, "ml"], ["milk", 200, "ml", true]],
    ["Soften the onion and garlic in oil.", "Add the chopped carrot, potato and 800ml water and simmer for 25 minutes.", "Blend until smooth and stir in the milk."], ["lunch", "dinner", "vegetarian", "healthy"], [190, 5, 34, 5]),

  // ── Dinner ──
  r("r_beef_tacos", "Beef tacos", "Mexican", 4, [["tortilla", 8, "count"], ["ground_beef", 500, "g"], ["onion", 1, "count"], ["tomato", 2, "count"], ["lettuce", 1, "count"], ["cheddar", 60, "g"], ["cumin", 4, "g"], ["paprika", 4, "g"]],
    ["Brown the beef with the onion, cumin and paprika.", "Warm the tortillas.", "Fill with beef, chopped tomato, lettuce and grated cheddar."], ["dinner"], [560, 34, 38, 29]),
  r("r_spag_bolognese", "Spaghetti bolognese", "Italian", 4, [["pasta", 400, "g"], ["ground_beef", 400, "g"], ["tinned_tomato", 2, "count"], ["onion", 1, "count"], ["carrot", 1, "count"], ["garlic", 2, "count"], ["olive_oil", 20, "ml"], ["tomato_paste", 30, "g"]],
    ["Soften the onion, carrot and garlic in oil, then brown the beef.", "Add the tomato purée and tinned tomatoes and simmer for 30 minutes.", "Boil the pasta and serve with the sauce."], ["dinner"], [620, 34, 74, 19]),
  r("r_pasta_ceci", "Chickpea and spinach tomato pasta", "Italian", 3, [["pasta", 200, "g"], ["chickpeas", 2, "count"], ["tinned_tomato", 1, "count"], ["garlic", 3, "count"], ["olive_oil", 30, "ml"], ["spinach", 100, "g"]],
    ["Boil the pasta.", "Soften garlic in oil, add tomatoes and chickpeas and simmer for 10 minutes.", "Fold in the spinach and the drained pasta."], ["dinner", "vegetarian", "vegan"], [480, 17, 72, 13]),
  r("r_ata_stew", "Nigerian pepper chicken stew with rice", "West African", 4, [["chicken_thigh", 700, "g"], ["tomato", 4, "count"], ["bell_pepper", 3, "count"], ["onion", 2, "count"], ["chilli_pepper", 1, "count"], ["tomato_paste", 30, "g"], ["ginger", 15, "g", true], ["olive_oil", 60, "ml"], ["rice", 300, "g"]],
    ["Blend the tomatoes, peppers, one onion, chilli and ginger.", "Reduce the blend in oil with the tomato purée until thick and the oil separates.", "Brown the chicken with the remaining onion, add to the stew and simmer for 30 minutes.", "Serve with rice."], ["dinner"], [640, 40, 62, 24]),
  r("r_beans_plantain", "Nigerian beans and fried plantain", "West African", 4, [["black_beans", 3, "count"], ["plantain", 3, "count"], ["onion", 1, "count"], ["tomato_paste", 30, "g"], ["chilli_pepper", 1, "count", true], ["olive_oil", 40, "ml"]],
    ["Fry the onion and tomato purée in oil, add the drained beans and chilli and simmer for 15 minutes.", "Slice the plantain and fry until golden.", "Serve together."], ["dinner", "lunch", "vegetarian", "vegan"], [520, 16, 82, 14]),
  r("r_sweet_potato_chilli", "Sweet potato and black bean chilli", "American", 4, [["sweet_potato", 2, "count"], ["black_beans", 2, "count"], ["tinned_tomato", 2, "count"], ["onion", 1, "count"], ["bell_pepper", 1, "count"], ["garlic", 2, "count"], ["cumin", 4, "g"], ["paprika", 4, "g"]],
    ["Soften onion, pepper and garlic with the spices.", "Add cubed sweet potato, beans and tomatoes and simmer for 30 minutes."], ["dinner", "lunch", "vegetarian", "vegan", "healthy", "one-pot"], [380, 15, 68, 7]),
  r("r_lemon_chicken_potatoes", "Lemon garlic chicken with roast potatoes", "American", 4, [["chicken_thigh", 700, "g"], ["potato", 800, "g"], ["lemon", 1, "count"], ["garlic", 3, "count"], ["olive_oil", 40, "ml"], ["carrot", 2, "count", true]],
    ["Heat the oven to 200C.", "Toss the chicken, chopped potatoes and carrot with oil, garlic and lemon juice in a tray.", "Roast for 40 minutes."], ["dinner", "high-protein"], [560, 40, 42, 24]),

  // ── Snack ──
  r("r_apple_pb", "Apple slices with peanut butter", "American", 2, [["apple", 2, "count"], ["peanut_butter", 40, "g"], ["cinnamon", 1, "g", true]],
    ["Slice the apples and serve with the peanut butter and a pinch of cinnamon."], ["snack", "quick", "vegetarian", "healthy", "no-cook"], [190, 5, 25, 9]),
  r("r_apple_dip", "Apple slices with cinnamon yoghurt dip", "American", 2, [["apple", 2, "count"], ["yoghurt", 150, "g"], ["honey", 10, "g"], ["cinnamon", 1, "g", true]],
    ["Stir the honey and cinnamon into the yoghurt.", "Slice the apples and serve with the dip."], ["snack", "quick", "vegetarian", "healthy", "no-cook"], [150, 6, 28, 2]),
  r("r_carrot_hummus", "Carrot sticks with hummus", "Mediterranean", 2, [["carrot", 3, "count"], ["hummus", 100, "g"]],
    ["Slice the carrots into sticks and serve with the hummus."], ["snack", "quick", "vegetarian", "healthy", "no-cook"], [120, 3, 18, 4]),
  r("r_celery_pb", "Celery sticks with peanut butter", "American", 2, [["celery", 3, "count"], ["peanut_butter", 40, "g"]],
    ["Slice the celery into sticks and serve with the peanut butter."], ["snack", "quick", "vegetarian", "healthy", "no-cook"], [180, 6, 12, 10]),
];

const days = (n: number, now: Date) => new Date(now.getTime() + n * 86400000).toISOString();

export async function seedDemo(store: Store, clock: Clock) {
  const now = clock.now();
  const iso = now.toISOString();
    // Demo data is reset; the owner's connected accounts (PayPal, Kroger) are real links and must survive.
  store.clearAll(["credentials"]);

  await store.households.insert({ id: HH, name: "Okafor-Brandt household", locale: "en-GB", timezone: "Europe/London", currency: "GBP", size: 3 });
  await store.households.insert({ id: HH_OTHER, name: "Harlow Street flat", locale: "en-GB", timezone: "Europe/London", currency: "GBP", size: 1 });
  await store.users.insert({ id: "usr_ada", householdId: HH, displayName: "Ada Okafor", token: DEMO_TOKEN });
  await store.users.insert({ id: "usr_rhys", householdId: HH_OTHER, displayName: "Rhys Penhallow", token: OTHER_TOKEN });

  await store.preferences.insert({ id: "pref_okafor", householdId: HH, cuisines: ["British", "WestAfrican", "Italian", "American", "Mexican"], allergies: ["peanut"], dietaryRestrictions: [], dislikedIngredients: ["coriander"], healthGoal: "balanced", weeklyBudgetMinor: 4000 });
  await store.preferences.insert({ id: "pref_harlow", householdId: HH_OTHER, cuisines: [], allergies: [], dietaryRestrictions: ["vegetarian"], dislikedIngredients: [], healthGoal: null, weeklyBudgetMinor: null });

  const inv: [string, string, number, "ml" | "g" | "count", "FRIDGE" | "FREEZER" | "PANTRY", number | null, number, "OBSERVED" | "MANUAL"][] = [
    ["milk", "Semi-skimmed milk", 1300, "ml", "FRIDGE", 5, 0.9, "OBSERVED"],
    ["eggs", "Free-range eggs", 8, "count", "FRIDGE", 12, 0.8, "MANUAL"],
    ["spinach", "Baby spinach", 150, "g", "FRIDGE", 2, 0.7, "MANUAL"],
    ["rice", "Long-grain rice", 2600, "g", "PANTRY", 300, 0.85, "MANUAL"],
    ["chicken_thigh", "Chicken thighs", 900, "g", "FRIDGE", 3, 0.8, "MANUAL"],
    ["olive_oil", "Extra virgin olive oil", 600, "ml", "PANTRY", 200, 0.9, "OBSERVED"],
    ["flour", "Plain flour", 1500, "g", "PANTRY", 180, 0.8, "MANUAL"],
    ["butter", "Salted butter", 250, "g", "FRIDGE", 25, 0.85, "MANUAL"],
    ["onion", "Onions", 5, "count", "PANTRY", 14, 0.8, "MANUAL"],
    ["tinned_tomato", "Chopped tomatoes", 4, "count", "PANTRY", 400, 0.9, "MANUAL"],
    ["pasta", "Penne", 700, "g", "PANTRY", 365, 0.85, "MANUAL"],
    ["cheddar", "Mature cheddar", 220, "g", "FRIDGE", 20, 0.8, "MANUAL"],
    ["garlic", "Garlic", 6, "count", "PANTRY", 21, 0.8, "MANUAL"],
        ["tomato", "Tomatoes", 5, "count", "PANTRY", 6, 0.8, "MANUAL"],
    ["tomato_paste", "Tomato purée", 200, "g", "PANTRY", 300, 0.85, "MANUAL"],
    ["bell_pepper", "Bell peppers", 3, "count", "FRIDGE", 8, 0.7, "MANUAL"],
    ["chilli_pepper", "Chilli peppers", 2, "count", "FRIDGE", 8, 0.7, "MANUAL"],
    ["carrot", "Carrots", 4, "count", "FRIDGE", 14, 0.8, "MANUAL"],
    ["potato", "Potatoes", 1500, "g", "PANTRY", 20, 0.8, "MANUAL"],
    ["sweet_potato", "Sweet potatoes", 2, "count", "PANTRY", 14, 0.8, "MANUAL"],
    ["banana", "Bananas", 4, "count", "PANTRY", 4, 0.7, "MANUAL"],
    ["apple", "Apples", 3, "count", "FRIDGE", 14, 0.8, "MANUAL"],
    ["cucumber", "Cucumber", 1, "count", "FRIDGE", 5, 0.7, "MANUAL"],
    ["lettuce", "Lettuce", 1, "count", "FRIDGE", 5, 0.7, "MANUAL"],
    ["ginger", "Fresh ginger", 40, "g", "FRIDGE", 14, 0.8, "MANUAL"],
    ["black_beans", "Black beans (tinned)", 4, "count", "PANTRY", 400, 0.9, "MANUAL"],
    ["chickpeas", "Chickpeas (tinned)", 3, "count", "PANTRY", 400, 0.9, "MANUAL"],
    ["oats", "Rolled oats", 1000, "g", "PANTRY", 300, 0.85, "MANUAL"],
    ["bread", "Wholemeal bread", 8, "count", "PANTRY", 4, 0.7, "MANUAL"],
    ["whole_wheat_flour", "Wholemeal flour", 1000, "g", "PANTRY", 300, 0.85, "MANUAL"],
    ["baking_powder", "Baking powder", 50, "g", "PANTRY", 300, 0.8, "MANUAL"],
    ["honey", "Honey", 350, "g", "PANTRY", null, 0.85, "MANUAL"],
    ["cinnamon", "Ground cinnamon", 30, "g", "PANTRY", null, 0.8, "MANUAL"],
    ["cumin", "Ground cumin", 40, "g", "PANTRY", null, 0.8, "MANUAL"],
    ["paprika", "Smoked paprika", 40, "g", "PANTRY", null, 0.8, "MANUAL"],
    ["yoghurt", "Natural yoghurt", 500, "g", "FRIDGE", 9, 0.8, "MANUAL"],
  ];
  for (const [k, name, quantity, unit, storage, exp, confidence, source] of inv) {
    const item = await store.inventoryItems.insert({
      id: `item_${k}`, householdId: HH, canonicalKey: k, name, quantity, unit, storage,
      expiresAt: exp === null ? null : days(exp, now), opened: false, confidence, source, observedAt: days(-1, now), status: "ACTIVE",
    });
    await store.inventoryEvents.insert({ id: `ie_seed_${k}`, householdId: HH, itemId: item.id, canonicalKey: k, type: "ADD", quantityDelta: quantity, quantityAfter: quantity, source, occurredAt: days(-1, now), correlationId: "cor_seed" });
  }
  await store.inventoryItems.insert({ id: "item_harlow_milk", householdId: HH_OTHER, canonicalKey: "milk", name: "Oat drink", quantity: 400, unit: "ml", storage: "FRIDGE", expiresAt: null, opened: false, confidence: 0.9, source: "MANUAL", observedAt: iso, status: "ACTIVE" });

  const prof: [string, number, number, number, number][] = [
    ["milk", 500, 1, 2, 7], ["eggs", 1.5, 1, 2, 10], ["rice", 250, 1, 2, 14], ["olive_oil", 20, 1, 2, 14],
    ["butter", 25, 1, 2, 14], ["flour", 60, 1, 2, 14], ["pasta", 90, 1, 2, 10],
    ["oats", 50, 1, 2, 14], ["yoghurt", 100, 1, 2, 7], ["whole_wheat_flour", 40, 1, 2, 14],
    ["tomato_paste", 10, 1, 2, 21], ["black_beans", 0.5, 1, 2, 14], ["chickpeas", 0.3, 1, 2, 14],
  ];
    const maxQty: Record<string, number> = { milk: 6000, eggs: 30, rice: 12000, olive_oil: 3500, butter: 1000, flour: 5000, pasta: 4000, oats: 5000, yoghurt: 2000, whole_wheat_flour: 5000, tomato_paste: 1000, black_beans: 24, chickpeas: 24 };
  for (const [k, daily, lead, safety, target] of prof)
  await store.profiles.insert({ id: `prof_${k}`, householdId: HH, canonicalKey: k, dailyConsumption: daily, consumptionSource: k === "olive_oil" ? "FALLBACK" : "HISTORY", leadTimeDays: lead, safetyDays: safety, targetDays: target, maxPlausibleQty: maxQty[k]! });

  await store.devices.insert({ id: "dev_fridge", householdId: HH, provider: "simulator", externalId: SIM_FRIDGE, name: "Kitchen fridge (simulated)", connected: true, lastSeenAt: iso });
  await store.devices.insert({ id: "dev_pantry", householdId: HH, provider: "simulator", externalId: SIM_PANTRY, name: "Pantry shelf scale (simulated)", connected: true, lastSeenAt: iso });

  await store.policies.insert({
    id: HH, householdId: HH, version: 1, enabled: true, mode: "BOUNDED_AUTONOMY", killSwitch: false,
    allowlistedProductIds: DEFAULT_ALLOWLIST, allowlistedCategories: [], perItemCapMinor: 1500, perOrderCapMinor: 2500,
    weeklyBudgetMinor: 4000, currency: "GBP", cooldownHours: 24, maxOrdersPerWeek: 4, minConfidence: 0.6, maxPriceAgeMinutes: 60,
  });
  const MEAL_TAGS: Record<string, string[]> = {
    r_omelette: ["breakfast", "lunch"], r_jollof: ["dinner"], r_spinach_pasta: ["lunch", "dinner"],
    r_groundnut_stew: ["dinner"], r_rice_pudding: ["snack"], r_shakshuka: ["breakfast", "lunch"],
    r_suya_rice: ["dinner"], r_garlic_bowl: ["lunch", "dinner"],
  };
  for (const rec of RECIPES) await store.recipes.insert({ ...rec, tags: [...new Set([...rec.tags, ...(MEAL_TAGS[rec.id] ?? [])])] });

    await store.mealLog.insert({
    id: "ml_seed_1", householdId: HH, mealType: "dinner", source: "DELIVERY", recipeId: "r_jollof",
    name: "Jollof rice (takeaway)", servings: null, consumed: [], eatenAt: days(-1, now), loggedAt: days(-1, now), loggedBy: "usr_ada", removedAt: null,
  });
}
