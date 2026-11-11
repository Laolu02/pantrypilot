import { z } from "zod";
import type { Store } from "../../store/store";
import type { Clock } from "../../lib/clock";
import { newId } from "../../lib/ids";
import { redact } from "../../lib/redact";
import { AuditService } from "../audit/auditService";
import { InventoryService } from "../inventory/inventoryService";
import { PreferencesService } from "../preferences/preferencesService";
import { RecipeService } from "../recipes/recipeService";
import { BasketService } from "../shopping/basketService";
import { OrderService } from "../shopping/orderService";
import { PolicyService } from "../shopping/policyService";
import { forecastStock, usableQuantity } from "../forecasting/forecast";
import { horizonFor, cadenceAdjusted } from "../delivery/schedule";
import { pickDeliveryLines } from "../delivery/plan";

/** Household, run and actor come from the server, never from model-supplied arguments. */
export interface ToolContext { householdId: string; runId: string; correlationId: string; actor: string }
export interface ToolDeps {
  store: Store; clock: Clock; audit: AuditService; inventory: InventoryService; prefs: PreferencesService;
  recipes: RecipeService; baskets: BasketService; orders: OrderService; policies: PolicyService;
}
interface ToolDef { description: string; args: z.ZodTypeAny; run: (ctx: ToolContext, args: any) => Promise<unknown>; summarize: (out: any) => string }

const key = z.object({ canonicalKey: z.string().min(1) });
const orderRef = z.object({ orderId: z.string().min(1) });

export function buildTools(d: ToolDeps): Record<string, ToolDef> {
  return {
    read_inventory: {
      description: "List active inventory with forecasts.",
      args: z.object({ lowStock: z.boolean().optional() }),
      run: (c, a) => d.inventory.list(c.householdId, { lowStock: a.lowStock }),
      summarize: (o) => `${o.length} items`,
    },
    read_preferences: { description: "Household dietary preferences.", args: z.object({}), run: (c) => d.prefs.get(c.householdId), summarize: () => "preferences read" },
    get_expiring_items: {
      description: "Items expiring within N days.", args: z.object({ days: z.number().int().positive().max(30).default(3) }),
      run: (c, a) => d.inventory.list(c.householdId, { expiringDays: a.days }), summarize: (o) => `${o.length} expiring`,
    },
    estimate_consumption: {
      description: "Consumption profile for an item.", args: key,
      run: async (c, a) => (await d.store.profiles.find((p) => p.householdId === c.householdId && p.canonicalKey === a.canonicalKey)) ?? null,
      summarize: (o) => (o ? `${o.dailyConsumption}/day (${o.consumptionSource})` : "no profile"),
    },
    recommend_meals: { description: "Recommend meals from stock.", args: z.object({ servings: z.number().int().positive().optional(), limit: z.number().int().positive().optional() }), run: (c, a) => d.recipes.recommend(c.householdId, a), summarize: (o) => `${o.recommendations.length} recommended, ${o.rejected.length} rejected` },
    validate_recipe: { description: "Validate a recipe against hard constraints.", args: z.object({ recipeId: z.string(), servings: z.number().int().positive().optional() }), run: (c, a) => d.recipes.validate(c.householdId, a.recipeId, a.servings), summarize: (o) => o.validation.status },
    find_substitutions: { description: "Safe substitutions for missing ingredients.", args: z.object({ recipeId: z.string(), missing: z.array(z.string()).min(1) }), run: (c, a) => d.recipes.substitutions(c.householdId, a.recipeId, a.missing), summarize: (o) => `${o.length} ingredients checked` },
    search_grocery_products: { description: "Search the configured catalogue.", args: key, run: (_c, a) => d.baskets.search({ canonicalKey: a.canonicalKey }), summarize: (o) => `${o.length} products` },
    compare_grocery_products: {
      description: "Compare pack sizes and unit prices for a need.", args: key.extend({ need: z.number().positive() }),
      run: async (c, a) => { const hh = await d.store.households.get(c.householdId); return d.baskets.compare(a.canonicalKey, a.need, (await d.policies.get(c.householdId)).allowlistedProductIds, hh?.currency); },
      summarize: (o) => `${o.options.length} options, best ${o.options[0]?.packLabel ?? "none"}${o.errors.length ? `, ${o.errors.length} store(s) failed` : ""}`,
    },
    forecast_stock: {
      description: "Deterministic days-of-supply and reorder point. Accounts for the household's delivery rhythm.", args: key,
      run: async (c, a) => {
        const item = await d.inventory.findByKey(c.householdId, a.canonicalKey);
        const profile = await d.store.profiles.find((p) => p.householdId === c.householdId && p.canonicalKey === a.canonicalKey);
        if (!item || !profile) return null;
        const h = await horizonFor(d.store, d.clock, c.householdId);
        return forecastStock({ profile: cadenceAdjusted(profile, h), usableOnHand: usableQuantity(item, d.clock.now()), inbound: await d.inventory.inboundQty(c.householdId, a.canonicalKey), confidence: item.confidence });
      },
      summarize: (o) => (o ? `${o.status}, ${o.daysOfSupply?.toFixed(1) ?? "?"} days` : "no item or profile"),
    },
    build_replenishment_plan: {
      description: "Build a priced basket and persist a PROPOSED order (idempotent by key).",
      args: key.extend({ shortfall: z.number().positive(), idempotencyKey: z.string().min(1) }),
      run: async (c, a) => {
        const policy = await d.policies.get(c.householdId);
        const plan = await d.baskets.plan(c.householdId, a.canonicalKey, a.shortfall, policy.allowlistedProductIds, `Replenish ${a.canonicalKey}`);
        if (!plan) return { orderId: null, options: [], basket: null, replay: false };
        await d.audit.record({ householdId: c.householdId, actor: c.actor, action: "BASKET_BUILT", resourceType: "Basket", resourceId: a.idempotencyKey, correlationId: c.correlationId, stage: "PRODUCT", details: { options: plan.options.slice(0, 4).map((o) => ({ pack: o.packLabel, priceMinor: o.priceMinor, allowlisted: o.allowlisted, available: o.available })), chosen: plan.basket.lines[0]?.name, totalMinor: plan.basket.totalMinor } });
        const { order, replay } = await d.orders.propose({ householdId: c.householdId, basket: plan.basket, idempotencyKey: a.idempotencyKey, runId: c.runId, actor: c.actor, correlationId: c.correlationId });
        return { orderId: order.id, options: plan.options, basket: plan.basket, replay };
      },
      summarize: (o) => (o.orderId ? `order ${o.orderId} total ${o.basket.totalMinor}` : "no available product"),
    },
    build_delivery_plan: {
      description: "Combine several replenishment needs into one priced basket and persist a PROPOSED order (idempotent by key).",
      args: z.object({
        idempotencyKey: z.string().min(1),
        needs: z.array(z.object({ canonicalKey: z.string().min(1), shortfall: z.number().positive() })).min(1).max(60),
      }),
      run: async (c, a) => {
        const policy = await d.policies.get(c.householdId);
        const hh = await d.store.households.get(c.householdId);
        const { picks, skipped } = await pickDeliveryLines(d.baskets, policy.allowlistedProductIds, hh?.currency ?? "GBP", a.needs);
        if (picks.length === 0) return { orderId: null, picked: [] as string[], skipped, basket: null, replay: false };
        const basket = await d.baskets.rebuild(picks, `Scheduled delivery: ${picks.length} item(s)`);
        await d.audit.record({ householdId: c.householdId, actor: c.actor, action: "BASKET_BUILT", resourceType: "Basket", resourceId: a.idempotencyKey, correlationId: c.correlationId, stage: "PRODUCT", details: { lines: basket.lines.map((l) => ({ name: l.name, quantity: l.quantity, lineTotalMinor: l.lineTotalMinor })), skipped, totalMinor: basket.totalMinor } });
        const { order, replay } = await d.orders.propose({ householdId: c.householdId, basket, idempotencyKey: a.idempotencyKey, runId: c.runId, actor: c.actor, correlationId: c.correlationId });
        return { orderId: order.id, picked: picks.map((p) => p.canonicalKey), skipped, basket, replay };
      },
      summarize: (o) => (o.orderId ? `order ${o.orderId}: ${o.picked.length} item(s), ${o.skipped.length} skipped, total ${o.basket.totalMinor}` : "no available product"),
    },
    evaluate_purchase_policy: { description: "Run the deterministic policy engine on an order.", args: orderRef, run: (c, a) => d.orders.evaluate(c.householdId, a.orderId, c.actor, c.correlationId), summarize: (o) => `${o.decision.decision} [${o.decision.reasons.map((r: any) => r.code).join(",")}]` },
    request_purchase_review: {
      description: "Flag an order for owner review.", args: orderRef,
      run: async (c, a) => {
        const o = await d.orders.getOwned(c.householdId, a.orderId);
        await d.audit.record({ householdId: c.householdId, actor: c.actor, action: "REVIEW_REQUESTED", resourceType: "ShoppingOrder", resourceId: o.id, correlationId: c.correlationId, stage: "POLICY", outcome: "WARN" });
        return { orderId: o.id, status: o.status };
      },
      summarize: (o) => `status ${o.status}`,
    },
    execute_purchase: { description: "Execute an existing persisted order. Re-prices and re-checks policy first.", args: orderRef, run: (c, a) => d.orders.execute(c.householdId, a.orderId, c.actor, c.correlationId), summarize: (o) => `order ${o.status}` },
    verify_purchase: { description: "Read provider-verified order state.", args: orderRef, run: async (c, a) => d.orders.getOwned(c.householdId, a.orderId), summarize: (o) => `order ${o.status}, ext ${o.externalOrderId ?? "none"}` },
    reconcile_inventory: {
      description: "Resolve an open reconciliation request. Not used by the autonomous replenishment flow.",
      args: z.object({ requestId: z.string(), resolution: z.enum(["ACCEPT_OBSERVED", "KEEP_CURRENT"]) }),
      run: (c, a) => d.inventory.resolveReconciliation(c.householdId, c.actor, a.requestId, a.resolution), summarize: (o) => o.request.status,
    },
  };
}

export class ToolRunner {
  private tools: ReturnType<typeof buildTools>;
  constructor(private d: ToolDeps) { this.tools = buildTools(d); }
  names() { return Object.keys(this.tools); }

  async call<T = any>(ctx: ToolContext, name: string, rawArgs: unknown): Promise<T> {
    const tool = this.tools[name];
    if (!tool) throw new Error(`Unknown tool ${name}`);
    const t0 = Date.now();
    const args = tool.args.parse(rawArgs);
    const log = (status: "OK" | "ERROR", summary: string) =>
      this.d.store.toolCalls.insert({ id: newId("tc"), runId: ctx.runId, householdId: ctx.householdId, tool: name, args: redact(args), resultSummary: summary, status, durationMs: Date.now() - t0, at: this.d.clock.now().toISOString() });
    try {
      const out = await tool.run(ctx, args);
      await log("OK", tool.summarize(out));
      return out as T;
    } catch (e) {
      await log("ERROR", e instanceof Error ? e.message : String(e));
      throw e;
    }
  }
}
