export interface SubRule { to: string; ratio: number; note: string; uncertainty: "LOW" | "MEDIUM" | "HIGH" }
/** Hand-written, conservative. Every candidate is still re-validated against the household profile. */
export const SUBSTITUTIONS: Record<string, SubRule[]> = {
  milk: [
    { to: "oat_milk", ratio: 1, note: "Works in sauces and batters; slightly sweeter.", uncertainty: "LOW" },
    { to: "soy_milk", ratio: 1, note: "Neutral in savoury dishes; can curdle in acidic sauces.", uncertainty: "MEDIUM" },
  ],
  butter: [{ to: "olive_oil", ratio: 0.8, note: "Fine for frying and sauces; not for baking.", uncertainty: "MEDIUM" }],
  garlic: [{ to: "onion", ratio: 0.5, note: "Milder and sweeter; the flavour changes noticeably.", uncertainty: "HIGH" }],
  rice: [{ to: "pasta", ratio: 0.8, note: "Changes the dish; cook separately.", uncertainty: "HIGH" }],
  cheddar: [],
};
