import { UpdatePolicySchema, type PolicyDecision, type PurchasePolicy } from "@pantrypilot/contracts";
import type { Store, Basket } from "../../store/store";
import type { Clock } from "../../lib/clock";
import { newId } from "../../lib/ids";
import { notFound } from "../../lib/errors";
import { AuditService } from "../audit/auditService";
import { PreferencesService } from "../preferences/preferencesService";
import { evaluatePolicy, type OrderLite } from "./policyEngine";

export class PolicyService {
  constructor(
    private store: Store, private clock: Clock, private audit: AuditService, private prefs: PreferencesService,
    private flags: { globalKillSwitch: boolean; autonomyGloballyEnabled: boolean },
    private payments: { requiresConnection: boolean; isConnected(hh: string): Promise<boolean> } = { requiresConnection: false, isConnected: async () => true },
  ) {}

  async get(householdId: string): Promise<PurchasePolicy> {
    const row = await this.store.policies.get(householdId);
    if (!row) throw notFound("Purchase policy");
    const { id: _id, ...policy } = row;
    return policy;
  }
  async update(householdId: string, actor: string, input: unknown): Promise<PurchasePolicy> {
    const patch = UpdatePolicySchema.parse(input);
    const cur = await this.get(householdId);
    const next = { ...cur, ...patch, version: cur.version + 1 };
    await this.store.policies.update(householdId, next);
    await this.audit.record({ householdId, actor, action: "POLICY_UPDATED", resourceType: "PurchasePolicy", resourceId: householdId, correlationId: newId("cor"), stage: "POLICY", details: { version: next.version, changed: Object.keys(patch) } });
    return next;
  }
  async setKillSwitch(householdId: string, actor: string, enabled: boolean): Promise<PurchasePolicy> {
    const cur = await this.get(householdId);
    const next = { ...cur, killSwitch: enabled, version: cur.version + 1 };
    await this.store.policies.update(householdId, next);
    await this.audit.record({ householdId, actor, action: "KILL_SWITCH_CHANGED", resourceType: "PurchasePolicy", resourceId: householdId, correlationId: newId("cor"), stage: "POLICY", outcome: enabled ? "WARN" : "OK", details: { enabled } });
    return next;
  }

  async orderLites(householdId: string): Promise<OrderLite[]> {
    const orders = await this.store.orders.list((o) => o.householdId === householdId);
    return orders.map((o) => ({ id: o.id, status: o.status, totalMinor: o.basket.totalMinor, createdAt: o.createdAt, canonicalKeys: o.basket.lines.map((l) => l.canonicalKey) }));
  }

  async evaluate(householdId: string, basket: Basket, opts: { excludeOrderId?: string; approved?: boolean } = {}): Promise<{ decision: PolicyDecision; policy: PurchasePolicy }> {
    const policy = await this.get(householdId);
    const hh = await this.store.households.get(householdId);
    if (!hh) throw notFound("Household");
    const prefs = await this.prefs.get(householdId);
    const items = await this.store.inventoryItems.list((i) => i.householdId === householdId && i.status === "ACTIVE");
    const inventoryConfidence = Object.fromEntries(items.map((i) => [i.canonicalKey, i.confidence]));
    const decision = evaluatePolicy({
      policy, basket, now: this.clock.now(), orders: await this.orderLites(householdId), inventoryConfidence,
      household: { currency: hh.currency, allergies: prefs.allergies, dietaryRestrictions: prefs.dietaryRestrictions },
      globalKillSwitch: this.flags.globalKillSwitch, autonomyGloballyEnabled: this.flags.autonomyGloballyEnabled,
      ...(this.payments.requiresConnection ? { paymentConnected: await this.payments.isConnected(householdId) } : {}),
      ...(opts.excludeOrderId ? { excludeOrderId: opts.excludeOrderId } : {}), approved: opts.approved ?? false,
    });
    return { decision, policy };
  }
}
