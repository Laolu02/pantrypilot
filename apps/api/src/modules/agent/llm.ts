/**
 * Seam for a real LLM. The model may EXPLAIN decisions; it can never change policy results,
 * order state, payment state or allergy checks. A failing provider must not break a run.
 */
export interface ExplainFacts {
  canonicalKey: string;
  unit?: "ml" | "g" | "count";
  forecast: { usableOnHand: number; daysOfSupply: number | null; reorderPoint: number; estimated: boolean };
  choice?: { name: string; priceMinor: number; qty: number; totalMinor: number };
  decision?: { decision: string; reasons: string[] };
  orderStatus?: string;
  mock: boolean;
}
export interface LlmProvider { readonly name: string; explain(facts: ExplainFacts): Promise<string> }

const words = (code: string) => code.toLowerCase().replace(/_/g, " ");
const amount = (n: number, unit?: string) => {
  const r = Math.round(n);
  if (unit === "ml") return r >= 1000 ? `${(r / 1000).toFixed(2).replace(/\.?0+$/, "")} L` : `${r} ml`;
  if (unit === "g") return r >= 1000 ? `${(r / 1000).toFixed(2).replace(/\.?0+$/, "")} kg` : `${r} g`;
  return `${r}`;
};
export class TemplateExplainer implements LlmProvider {
  readonly name = "template";
  async explain(f: ExplainFacts): Promise<string> {
    const days = f.forecast.daysOfSupply === null ? "unknown days" : `${f.forecast.daysOfSupply.toFixed(1)} days`;
    const parts = [`${f.canonicalKey.replace(/_/g, " ")} is down to ${amount(f.forecast.usableOnHand, f.unit)} (about ${days} of supply; reorder point ${amount(f.forecast.reorderPoint, f.unit)}${f.forecast.estimated ? ", consumption is an estimate" : ""}).`];
    if (f.choice) parts.push(`Selected ${f.choice.name} x${f.choice.qty} for £${(f.choice.totalMinor / 100).toFixed(2)} including delivery, the cheapest way to cover the shortfall.`);
    if (f.decision) parts.push(`Policy decision: ${f.decision.decision}${f.decision.reasons.length ? ` (${f.decision.reasons.map(words).join(", ")})` : ""}.`);
    if (f.orderStatus === "CONFIRMED") parts.push(`${f.mock ? "Demo order" : "Order"} verified with the provider. Stock is marked on order, not on hand, until delivery is confirmed.`);
    else if (f.orderStatus === "HANDOFF") parts.push("Cart prepared at the store. This store has no ordering API, so you finish checkout there. Nothing has been bought yet.");
    else if (f.orderStatus) parts.push(`Order status: ${f.orderStatus}.`);
    return parts.join(" ");
  }
}