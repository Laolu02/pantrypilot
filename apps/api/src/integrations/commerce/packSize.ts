/** Normalise retailer size strings ("1 gal", "12 ct", "64 fl oz") into base units. Returns null when unsure. */
export function parsePackSize(text: string | undefined | null): { packSize: number; unit: "ml" | "g" | "count" } | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/,/g, "").trim();
  if (/\bdozen\b/.test(t)) return { packSize: 12, unit: "count" };
  const m = /(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|gal(?:lon)?s?|qt|quarts?|pt|pints?|ml|l|liters?|litres?|lbs?|pounds?|oz|ounces?|kg|g|grams?|ct|count|pk|pack|ea|each)\b/.exec(t);
  if (!m) return null;
  const n = parseFloat(m[1]!); const u = m[2]!.replace(/\s|\./g, "");
  const r = (x: number, unit: "ml" | "g" | "count") => ({ packSize: Math.round(x * 10) / 10, unit });
  if (u === "floz") return r(n * 29.5735, "ml");
  if (u.startsWith("gal")) return r(n * 3785.41, "ml");
  if (u === "qt" || u.startsWith("quart")) return r(n * 946.353, "ml");
  if (u === "pt" || u.startsWith("pint")) return r(n * 473.176, "ml");
  if (u === "ml") return r(n, "ml");
  if (u === "l" || u.startsWith("lit")) return r(n * 1000, "ml");
  if (u.startsWith("lb") || u.startsWith("pound")) return r(n * 453.592, "g");
  if (u === "oz" || u.startsWith("ounce")) return r(n * 28.3495, "g");
  if (u === "kg") return r(n * 1000, "g");
  if (u === "g" || u.startsWith("gram")) return r(n, "g");
  return r(n, "count");
}
