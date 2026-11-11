import { httpJson, type FetchLike } from "../http";
import { ProviderError } from "./commerce";

/**
 * Instacart Developer Platform: creates a shareable shopping-list page. The owner picks a store, reviews
 * matches and checks out on Instacart. It is a HANDOFF CHANNEL, not a catalogue: it exposes no prices
 * to us, so it cannot be used to build or price a basket. Shapes unverified against the live API.
 */
export class InstacartChannel {
  readonly name = "instacart";
  readonly mode = "LIVE" as const;
  private base: string;
  constructor(private cfg: { apiKey: string; env: "dev" | "prod"; baseUrl?: string }, private deps: { fetch: FetchLike; sleep?: (ms: number) => Promise<void> }) {
    this.base = cfg.baseUrl ?? (cfg.env === "prod" ? "https://connect.instacart.com" : "https://connect.dev.instacart.tools");
  }
  async createListLink(input: { title: string; lines: { name: string; quantity: number; unit?: string }[] }): Promise<string> {
    const r = await httpJson<any>(this.deps.fetch, `${this.base}/idp/v1/products/products_link`, {
      method: "POST", headers: { authorization: `Bearer ${this.cfg.apiKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ title: input.title, link_type: "shopping_list", line_items: input.lines.map((l) => ({ name: l.name, quantity: l.quantity, ...(l.unit ? { unit: l.unit } : {}) })) }),
    }, { allowedHosts: ["connect.instacart.com", "connect.dev.instacart.tools"], ...(this.deps.sleep ? { sleep: this.deps.sleep } : {}) });
    if (!r?.products_link_url) throw new ProviderError("BAD_RESPONSE", "Instacart did not return a link");
    return r.products_link_url as string;
  }
}
