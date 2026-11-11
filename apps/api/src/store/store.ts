import type {
  InventoryItem, InventoryEvent, ReconciliationRequest, PurchasePolicy, Product, StoreProduct,
  Preferences, PolicyDecision, OrderStatus, Currency,
} from "@pantrypilot/contracts";
import { UniqueViolationError } from "../lib/errors";
import { KeyedMutex } from "../lib/mutex";

export interface Household {
  id: string; name: string; locale: string; timezone: string; currency: Currency; size: number;
}
export interface User { id: string; householdId: string; displayName: string; token: string }
export interface ReplenishmentProfile {
  id: string; householdId: string; canonicalKey: string;
  dailyConsumption: number; consumptionSource: "HISTORY" | "FALLBACK";
  leadTimeDays: number; safetyDays: number; targetDays: number; maxPlausibleQty: number;
}
export interface Device {
  id: string; householdId: string; provider: string; externalId: string; name: string;
  connected: boolean; lastSeenAt: string | null;
}
export interface DeviceEventRecord {
  id: string; householdId: string; provider: string; eventId: string; deviceId: string;
  payloadHash: string; status: string; receivedAt: string; correlationId: string; detail?: string;
}
export interface RecipeRow {
  id: string; name: string; cuisine: string; servings: number;
  ingredients: { canonicalKey: string; quantity: number; unit: "ml" | "g" | "count"; optional?: boolean }[];
  steps: string[]; tags: string[];
  nutritionPerServing: { kcal: number; proteinG: number; carbsG: number; fatG: number; source: "ESTIMATE" };
}
export interface MealLogRow {
  id: string; householdId: string;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  source: "HOME_MADE" | "DELIVERY";
  recipeId: string | null; name: string; servings: number | null;
  /** What a home-made meal took out of the pantry, so undo can put it back. */
  consumed: { canonicalKey: string; quantity: number }[];
  eatenAt: string; loggedAt: string; loggedBy: string; removedAt: string | null;
}
export type DeliveryCadence = "ASAP" | "DAILY" | "EVERY_2_DAYS" | "WEEKLY";
export interface DeliveryScheduleRow {
  id: string; householdId: string; cadence: DeliveryCadence;
  /** First delivery order day, YYYY-MM-DD in the household's timezone. */
  anchorDate: string; orderHour: number; lastPlacedSlot: string | null; updatedAt: string;
}
export interface MealDislikeRow { id: string; householdId: string; recipeId: string; at: string; removedAt: string | null }
export type AgentRunState =
  | "QUEUED" | "RUNNING" | "POLICY_REVIEW" | "BLOCKED" | "EXECUTING"
  | "SUCCEEDED" | "FAILED" | "NEEDS_RECONCILIATION" | "AWAITING_OWNER";
export interface AgentRun {
  id: string; householdId: string; correlationId: string; state: AgentRunState;
  trigger: { type: string; [k: string]: unknown }; outcome: string | null; orderId: string | null;
  summary: string | null;
  startedAt: string; finishedAt: string | null; error: string | null;
}
export interface AgentToolCall {
  id: string; runId: string; householdId: string; tool: string; args: unknown;
  resultSummary: string; status: "OK" | "ERROR"; durationMs: number; at: string;
}
export interface BasketLine {
  storeProductId: string; productId: string; canonicalKey: string; name: string; packLabel: string;
  quantity: number; unitPriceMinor: number; lineTotalMinor: number; priceCheckedAt: string;
  available: boolean; allergens: string[] | null; tags: string[]; category: string;
  packSize: number; unit: "ml" | "g" | "count"; url?: string; currency?: Currency;
}
export interface Basket {
  provider: string; currency: Currency; reason: string; lines: BasketLine[];
  subtotalMinor: number; deliveryMinor: number; taxMinor: number; totalMinor: number;
}
export interface Cart { id: string; householdId: string; basket: Basket; createdAt: string }
export interface ShoppingOrder {
  id: string; householdId: string; provider: string; status: OrderStatus; basket: Basket;
  idempotencyKey: string; policyDecision: PolicyDecision | null; policySnapshot: PurchasePolicy | null;
  externalOrderId: string | null; runId: string | null; mock: boolean; failureReason: string | null;
  createdAt: string; updatedAt: string; history: { status: OrderStatus; at: string; note?: string }[];
  /** Set for providers that cannot place orders: we prepare a cart/list and the owner completes checkout there. */
  handoff: { links: { label: string; url: string }[]; note: string; preparedAt: string } | null;
}
export interface PaymentAttempt {
  id: string; householdId: string; orderId: string; provider: string;
  status: "PENDING" | "AUTHORIZED" | "CAPTURED" | "VOIDED" | "REFUNDED" | "FAILED" | "UNKNOWN"; providerReference: string | null; captureReference?: string | null;
  idempotencyKey: string; amountMinor: number; currency: Currency; createdAt: string; updatedAt: string;
}
export interface Approval {
  id: string; householdId: string; orderId: string; actor: string; decision: "APPROVED" | "REJECTED";
  policyVersion: number; expiresAt: string; createdAt: string;
}
export type AuditStage = "DEVICE" | "INVENTORY" | "FORECAST" | "PRODUCT" | "POLICY" | "ORDER" | "VERIFY" | "SYSTEM";
export interface AuditEvent {
  id: string; householdId: string; actor: string; action: string; resourceType: string; resourceId: string;
  correlationId: string; stage: AuditStage; outcome: "OK" | "WARN" | "FAIL"; reason?: string;
  details: unknown; at: string; seq: number;
}

type Row = { id: string };

/** Repository with optional unique constraints, mirroring DB invariants. */
export class Repo<T extends Row> {
  private rows = new Map<string, T>();
  private uniques = new Map<string, Set<string>>();
  constructor(private uniqueKeys: Record<string, (row: T) => string> = {}) {
    for (const k of Object.keys(uniqueKeys)) this.uniques.set(k, new Set());
  }
  async insert(row: T): Promise<T> {
    const keys: [string, string][] = [];
    for (const [name, fn] of Object.entries(this.uniqueKeys)) {
      const v = fn(row);
      if (this.uniques.get(name)!.has(v)) throw new UniqueViolationError(name);
      keys.push([name, v]);
    }
    for (const [n, v] of keys) this.uniques.get(n)!.add(v);
    this.rows.set(row.id, structuredClone(row));
    return structuredClone(row);
  }
  async get(id: string): Promise<T | undefined> {
    const r = this.rows.get(id);
    return r ? structuredClone(r) : undefined;
  }
  async update(id: string, patch: Partial<T>): Promise<T> {
    const cur = this.rows.get(id);
    if (!cur) throw new Error(`Row ${id} missing`);
    const next = { ...cur, ...patch } as T;
    this.rows.set(id, structuredClone(next));
    return structuredClone(next);
  }
  async list(pred: (r: T) => boolean = () => true): Promise<T[]> {
    return [...this.rows.values()].filter(pred).map((r) => structuredClone(r));
  }
  async find(pred: (r: T) => boolean): Promise<T | undefined> {
    const r = [...this.rows.values()].find(pred);
    return r ? structuredClone(r) : undefined;
  }
  async remove(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    for (const [name, fn] of Object.entries(this.uniqueKeys)) this.uniques.get(name)!.delete(fn(row));
    this.rows.delete(id);
  }
  clear() {
    this.rows.clear();
    for (const s of this.uniques.values()) s.clear();
  }
}

export interface CredentialRow { id: string; householdId: string; provider: string; iv: string; tag: string; ciphertext: string; updatedAt: string }
export type PolicyRow = PurchasePolicy & Row;
export type PrefRow = Preferences & Row & { householdId: string };

/**
 * In-memory store. A Postgres/Prisma implementation must expose the same shape;
 * `withLock` maps to advisory locks or SELECT ... FOR UPDATE.
 */
export class MemoryStore {
  private mutex = new KeyedMutex();
  users = new Repo<User>();
  households = new Repo<Household>();
  preferences = new Repo<PrefRow>();
  profiles = new Repo<ReplenishmentProfile>({ k: (r) => `${r.householdId}:${r.canonicalKey}` });
  inventoryItems = new Repo<InventoryItem>();
  inventoryEvents = new Repo<InventoryEvent>();
  reconciliations = new Repo<ReconciliationRequest>();
  devices = new Repo<Device>();
  deviceEvents = new Repo<DeviceEventRecord>({ providerEvent: (r) => `${r.provider}:${r.eventId}` });
  policies = new Repo<PolicyRow>();
  products = new Repo<Product>();
  storeProducts = new Repo<StoreProduct>();
  recipes = new Repo<RecipeRow>();
  mealLog = new Repo<MealLogRow>();
  deliverySchedules = new Repo<DeliveryScheduleRow>();
  mealDislikes = new Repo<MealDislikeRow>();
  carts = new Repo<Cart>();
  orders = new Repo<ShoppingOrder>({ idempotency: (r) => `${r.householdId}:${r.idempotencyKey}` });
  payments = new Repo<PaymentAttempt>({ idempotency: (r) => r.idempotencyKey });
  approvals = new Repo<Approval>();
  agentRuns = new Repo<AgentRun>();
  toolCalls = new Repo<AgentToolCall>();
  audit = new Repo<AuditEvent>();
  credentials = new Repo<CredentialRow>({ k: (r) => `${r.householdId}:${r.provider}` });
  webhookEvents = new Repo<{ id: string; provider: string; eventId: string; receivedAt: string }>({ providerEvent: (r) => `${r.provider}:${r.eventId}` });

  withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return this.mutex.run(key, fn);
  }
    /** Wipe demo data. External connections (stored tokens) are passed in `keep` and survive. */
  clearAll(keep: (keyof MemoryStore)[] = []) {
    for (const [k, v] of Object.entries(this)) if (v instanceof Repo && !keep.includes(k as keyof MemoryStore)) v.clear();
  }
}
export type Store = MemoryStore;
