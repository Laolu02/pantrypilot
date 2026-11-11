import type { Product } from "@pantrypilot/contracts";

export interface CatalogRow { product: Product; priceMinor: number; available: boolean }
const p = (
  id: string, canonicalKey: string, name: string, brand: string, category: string,
  packSize: number, unit: "ml" | "g" | "count", packLabel: string,
  allergens: string[] | null, tags: string[], priceMinor: number, available = true,
): CatalogRow => ({ product: { id, canonicalKey, name, brand, category, packSize, unit, packLabel, allergens, tags }, priceMinor, available });

/** Seeded UK-oriented mock catalogue. Prices in pence. Only the 3L olive oil tin is in stock, on purpose. */
export const MOCK_CATALOG: CatalogRow[] = [
  p("p_milk_2l", "milk", "Semi-skimmed milk", "Meadowvale", "dairy_staples", 2000, "ml", "2L", ["milk"], ["dairy"], 165),
  p("p_milk_4pt", "milk", "Semi-skimmed milk", "Meadowvale", "dairy_staples", 2272, "ml", "4 pints", ["milk"], ["dairy"], 145),
  p("p_milk_6pt", "milk", "Semi-skimmed milk", "Meadowvale", "dairy_staples", 3408, "ml", "6 pints", ["milk"], ["dairy"], 215),
  p("p_oatmilk_1l", "oat_milk", "Oat drink", "Fjellgaard", "dairy_alternatives", 1000, "ml", "1L", ["gluten"], ["gluten"], 180),
  p("p_eggs_6", "eggs", "Free-range eggs", "Hollin Farm", "dairy_staples", 6, "count", "6 pack", ["egg"], ["egg"], 145),
  p("p_eggs_12", "eggs", "Free-range eggs", "Hollin Farm", "dairy_staples", 12, "count", "12 pack", ["egg"], ["egg"], 250),
  p("p_rice_1kg", "rice", "Long-grain rice", "Tamarind Lane", "dry_staples", 1000, "g", "1kg", [], [], 220),
  p("p_rice_5kg", "rice", "Long-grain rice", "Tamarind Lane", "dry_staples", 5000, "g", "5kg", [], [], 850),
  p("p_rice_10kg", "rice", "Long-grain rice", "Tamarind Lane", "dry_staples", 10000, "g", "10kg", [], [], 1450),
  p("p_evoo_500ml", "olive_oil", "Extra virgin olive oil", "Olivar", "dry_staples", 500, "ml", "500ml", [], [], 450, false),
  p("p_evoo_1l", "olive_oil", "Extra virgin olive oil", "Olivar", "dry_staples", 1000, "ml", "1L", [], [], 780, false),
  p("p_evoo_3l", "olive_oil", "Extra virgin olive oil", "Olivar", "dry_staples", 3000, "ml", "3L tin", [], [], 2950),
  p("p_butter_250", "butter", "Salted butter", "Meadowvale", "dairy_staples", 250, "g", "250g", ["milk"], ["dairy"], 210),
  p("p_flour_1500", "flour", "Plain flour", "Millstone", "dry_staples", 1500, "g", "1.5kg", ["gluten"], ["gluten"], 110),
  p("p_pasta_500", "pasta", "Penne", "Casa Verdi", "dry_staples", 500, "g", "500g", ["gluten"], ["gluten"], 95),
  p("p_pasta_1kg", "pasta", "Penne", "Casa Verdi", "dry_staples", 1000, "g", "1kg", ["gluten"], ["gluten"], 160),
  p("p_spinach_200", "spinach", "Baby spinach", "Greenfield", "fresh_produce", 200, "g", "200g", [], [], 130),
  p("p_chicken_1kg", "chicken_thigh", "Chicken thighs", "Hollin Farm", "meat", 1000, "g", "1kg", [], ["meat"], 550),
  p("p_oats_1kg", "oats", "Rolled oats", "Millstone", "dry_staples", 1000, "g", "1kg", ["gluten"], ["gluten"], 135),
  p("p_yoghurt_500", "yoghurt", "Natural yoghurt", "Meadowvale", "dairy_staples", 500, "g", "500g", ["milk"], ["dairy"], 110),
  p("p_yoghurt_1kg", "yoghurt", "Natural yoghurt", "Meadowvale", "dairy_staples", 1000, "g", "1kg", ["milk"], ["dairy"], 190),
  p("p_wwflour_1500", "whole_wheat_flour", "Wholemeal flour", "Millstone", "dry_staples", 1500, "g", "1.5kg", ["gluten"], ["gluten"], 125),
  p("p_tomatopaste_200", "tomato_paste", "Tomato purée", "Casa Verdi", "dry_staples", 200, "g", "200g", [], [], 90),
  p("p_blackbeans_4", "black_beans", "Black beans", "Tamarind Lane", "dry_staples", 4, "count", "4 x 400g tins", [], [], 320),
  p("p_chickpeas_4", "chickpeas", "Chickpeas", "Tamarind Lane", "dry_staples", 4, "count", "4 x 400g tins", [], [], 300),
];

export const DEFAULT_ALLOWLIST = MOCK_CATALOG
  .filter((r) => ["dairy_staples", "dry_staples"].includes(r.product.category) && r.product.id !== "p_oatmilk_1l")
  .map((r) => r.product.id);
