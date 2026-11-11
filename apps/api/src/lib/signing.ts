import { createHmac, timingSafeEqual } from "node:crypto";
import type { DeviceEventInput } from "@pantrypilot/contracts";

export function signingPayload(e: Omit<DeviceEventInput, "signature">): string {
  return [e.provider, e.deviceId, e.eventId, e.canonicalKey, e.quantity, e.unit, e.confidence, e.observedAt].join("|");
}
export function signDeviceEvent(secret: string, e: Omit<DeviceEventInput, "signature">): string {
  return createHmac("sha256", secret).update(signingPayload(e)).digest("hex");
}
export function verifyDeviceEvent(secret: string, e: DeviceEventInput): boolean {
  const { signature, ...rest } = e;
  return safeEqualHex(signature, signDeviceEvent(secret, rest));
}

export function hmacHex(secret: string, raw: Buffer | string): string {
  return createHmac("sha256", secret).update(raw).digest("hex");
}
/** Strict: Buffer.from(hex) silently drops trailing junk, so validate the format and length first. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0 || a.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
