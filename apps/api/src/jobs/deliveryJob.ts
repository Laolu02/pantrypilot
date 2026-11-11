import type { Container } from "../container";

/** Checks every 5 minutes whether any household's delivery slot is due. Safe to repeat: one attempt per slot. */
export function startDeliveryJob(c: Container, everyMs = 5 * 60_000) {
  if (process.env.NODE_ENV === "test") return () => {};
  const t = setInterval(() => { void c.agent.runDueDeliveries().catch(() => {}); }, everyMs);
  t.unref();
  return () => clearInterval(t);
}