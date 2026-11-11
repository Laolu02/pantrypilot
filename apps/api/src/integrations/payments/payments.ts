import type { Currency } from "@pantrypilot/contracts";

export type PaymentMode = "MOCK" | "SANDBOX" | "LIVE";
export interface PaymentResult {
  status: "AUTHORIZED" | "CAPTURED" | "VOIDED" | "FAILED" | "NOT_FOUND";
  /** Authorization id for AUTHORIZED/VOIDED, capture id for CAPTURED. */
  reference: string | null;
  failureCode?: string;
  /** Sanitised reason from the provider, for diagnostics. */
  detail?: string;
}
export interface AuthorizeInput { householdId: string; idempotencyKey: string; amountMinor: number; currency: Currency; orderReference: string }
export interface CaptureInput { householdId: string; idempotencyKey: string; authorizationRef: string; amountMinor: number; currency: Currency }

/**
 * Hold, then capture. We never keep a balance for users: funds stay in the user's own payment
 * account until the retailer order is verified, and a failed or unverifiable order releases the hold.
 * Every money-moving call is idempotent on `idempotencyKey`.
 */
export interface PaymentAdapter {
  readonly name: string;
  readonly label: string;
  readonly mode: PaymentMode;
  /** True when each household must connect its own account before we can place a hold. */
  readonly requiresConnection: boolean;
  isConnected(householdId: string): Promise<boolean>;
  authorize(input: AuthorizeInput): Promise<PaymentResult>;
  capture(input: CaptureInput): Promise<PaymentResult>;
  voidAuthorization(input: { householdId: string; idempotencyKey: string; authorizationRef: string }): Promise<PaymentResult>;
  getStatus(idempotencyKey: string, authorizationRef?: string | null): Promise<PaymentResult>;
  refund?(input: { householdId: string; idempotencyKey: string; captureRef: string; amountMinor: number; currency: Currency }): Promise<{ refunded: boolean }>;
}
