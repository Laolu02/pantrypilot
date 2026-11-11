import { UncertainOutcomeError } from "../../lib/errors";
import { newId } from "../../lib/ids";
import type { AuthorizeInput, CaptureInput, PaymentAdapter, PaymentResult } from "./payments";

export type PaymentOutcome = "OK" | "DECLINE" | "TIMEOUT_AFTER_COMMIT" | "TIMEOUT_BEFORE_COMMIT";
export type CaptureOutcome = "OK" | "FAIL";

/** Simulated payment provider. Holds no card data and moves no money. */
export class MockPaymentAdapter implements PaymentAdapter {
  readonly name = "paydesk-mock";
  readonly label = "Mock payments";
  readonly mode = "MOCK" as const;
  readonly requiresConnection = false;
  private auths = new Map<string, PaymentResult>();
  private captures = new Map<string, PaymentResult>();
  private voids = new Set<string>();
  private outcomes: PaymentOutcome[] = [];
  private captureOutcomes: CaptureOutcome[] = [];
  /** Number of authorize calls (kept under its old name so tests read naturally). */
  executeCalls = 0;
  captureCalls = 0;
  voidCalls = 0;
  queueOutcome(o: PaymentOutcome) { this.outcomes.push(o); }
  queueCaptureOutcome(o: CaptureOutcome) { this.captureOutcomes.push(o); }
  reset() { this.auths.clear(); this.captures.clear(); this.voids.clear(); this.outcomes = []; this.captureOutcomes = []; this.executeCalls = 0; this.captureCalls = 0; this.voidCalls = 0; }
  async isConnected() { return true; }

  async authorize(input: AuthorizeInput): Promise<PaymentResult> {
    this.executeCalls++;
    const prior = this.auths.get(input.idempotencyKey);
    if (prior) return { ...prior };
    const outcome = this.outcomes.shift() ?? "OK";
    if (outcome === "TIMEOUT_BEFORE_COMMIT") throw new UncertainOutcomeError("Payment provider timed out");
    const result: PaymentResult = outcome === "DECLINE" ? { status: "FAILED", reference: null, failureCode: "CARD_DECLINED" } : { status: "AUTHORIZED", reference: newId("auth") };
    this.auths.set(input.idempotencyKey, result);
    if (outcome === "TIMEOUT_AFTER_COMMIT") throw new UncertainOutcomeError("Payment provider timed out after commit");
    return { ...result };
  }
  async capture(input: CaptureInput): Promise<PaymentResult> {
    this.captureCalls++;
    const prior = this.captures.get(input.idempotencyKey);
    if (prior) return { ...prior };
    if (this.voids.has(input.idempotencyKey)) return { status: "FAILED", reference: null, failureCode: "AUTHORIZATION_VOIDED" };
    const o = this.captureOutcomes.shift() ?? "OK";
    const r: PaymentResult = o === "FAIL" ? { status: "FAILED", reference: null, failureCode: "CAPTURE_DECLINED" } : { status: "CAPTURED", reference: newId("cap") };
    this.captures.set(input.idempotencyKey, r);
    return { ...r };
  }
  async voidAuthorization(input: { idempotencyKey: string }): Promise<PaymentResult> {
    this.voidCalls++;
    if (this.captures.get(input.idempotencyKey)?.status === "CAPTURED") return { status: "FAILED", reference: null, failureCode: "ALREADY_CAPTURED" };
    this.voids.add(input.idempotencyKey);
    return { status: "VOIDED", reference: this.auths.get(input.idempotencyKey)?.reference ?? null };
  }
  async getStatus(idempotencyKey: string): Promise<PaymentResult> {
    const cap = this.captures.get(idempotencyKey);
    if (cap?.status === "CAPTURED") return { ...cap };
    if (this.voids.has(idempotencyKey)) return { status: "VOIDED", reference: this.auths.get(idempotencyKey)?.reference ?? null };
    return { ...(this.auths.get(idempotencyKey) ?? { status: "NOT_FOUND" as const, reference: null }) };
  }
  async refund() { return { refunded: true }; }
}
