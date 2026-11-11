import { AppError } from "../../lib/errors";
import type { CatalogEntry, CommerceAdapter, OrderingAdapter, ProductSearchQuery } from "./commerce";

export class CommerceRegistry {
  private byName = new Map<string, CommerceAdapter>();
  constructor(adapters: CommerceAdapter[]) { for (const a of adapters) this.byName.set(a.name, a); }
  list() { return [...this.byName.values()]; }
  get(name: string): CommerceAdapter {
    const a = this.byName.get(name);
    if (!a) throw new AppError(422, "UNKNOWN_PROVIDER", `Provider ${name} is not enabled`);
    return a;
  }
  /** Only adapters that can really place orders. Others must use the handoff path. */
  ordering(name: string): OrderingAdapter {
    const a = this.get(name);
    if (!a.capabilities.placeOrder) throw new AppError(409, "PROVIDER_CANNOT_ORDER", `${a.label} cannot place orders through its API`);
    return a as OrderingAdapter;
  }
  /** A provider failure never hides the others. Errors are reported alongside results. */
  async search(q: ProductSearchQuery): Promise<{ entries: CatalogEntry[]; errors: { provider: string; message: string }[] }> {
    const searchable = this.list().filter((a) => a.capabilities.search);
    const settled = await Promise.allSettled(searchable.map((a) => a.searchProducts(q)));
    const entries: CatalogEntry[] = []; const errors: { provider: string; message: string }[] = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") entries.push(...r.value);
      else errors.push({ provider: searchable[i]!.name, message: r.reason instanceof Error ? r.reason.message : "search failed" });
    });
    return { entries, errors };
  }
}
