/** Retailer search text per canonical ingredient. Anything not listed falls back to the key itself. */
export const SEARCH_TERMS: Record<string, string> = {
  milk: "whole milk", eggs: "large eggs", spinach: "baby spinach", rice: "long grain rice", chicken_thigh: "chicken thighs",
  olive_oil: "extra virgin olive oil", flour: "all purpose flour", butter: "salted butter", onion: "yellow onions",
  tinned_tomato: "diced tomatoes", pasta: "penne pasta", cheddar: "cheddar cheese", yoghurt: "plain yogurt", garlic: "garlic",
};
export const termFor = (q: { text?: string | undefined; canonicalKey?: string | undefined }) =>
  q.text ?? (q.canonicalKey ? SEARCH_TERMS[q.canonicalKey] ?? q.canonicalKey.replace(/_/g, " ") : "");
/** Guard against a search for "milk" returning "chocolate milk cereal": every word of the key term must appear. */
export const matchesTerm = (name: string, canonicalKey: string | undefined) => {
  if (!canonicalKey) return true;
  const words = (SEARCH_TERMS[canonicalKey] ?? canonicalKey.replace(/_/g, " ")).toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !["large", "whole", "extra", "virgin", "salted", "plain"].includes(w));
  const n = name.toLowerCase();
  return words.every((w) => n.includes(w.replace(/s$/, "")));
};
