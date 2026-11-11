"use client";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle, WarningCircle, XCircle } from "@phosphor-icons/react";
import { clock, gbp, human } from "@/lib/format";
import type { Audit } from "@/lib/types";

const STAGE_LABEL: Record<string, string> = { DEVICE: "Device", INVENTORY: "Stock", FORECAST: "Forecast", PRODUCT: "Product", POLICY: "Policy", ORDER: "Order", VERIFY: "Verify", SYSTEM: "System" };

export function describe(e: Audit): string {
  const d = e.details ?? {};
  switch (e.action) {
    case "DEVICE_EVENT_RECEIVED": return `Sensor reported ${d.quantity}${d.unit === "count" ? "" : " " + d.unit} of ${human(d.canonicalKey ?? "item").toLowerCase()} (confidence ${Math.round((d.confidence ?? 0) * 100)}%)`;
    case "DEVICE_EVENT_DUPLICATE": return "Replayed event ignored; nothing applied twice";
    case "DEVICE_EVENT_STALE": return "Older than the current reading; ignored";
    case "DEVICE_EVENT_REJECTED": return `Event rejected: ${human(e.reason ?? "invalid")}`;
    case "INVENTORY_OBSERVED": return `Ledger updated: ${d.from} → ${d.to}`;
    case "RECONCILIATION_REQUESTED": return `Reading looks doubtful (${human(e.reason ?? "")}); waiting for you`;
    case "FORECAST_EVALUATED": return d.daysOfSupply == null ? "No forecast available" : `${Number(d.daysOfSupply).toFixed(1)} days of supply left; reorder point ${Math.round(d.reorderPoint)}${d.estimated ? " (estimated usage)" : ""}`;
    case "BASKET_BUILT": return `Chose ${d.chosen} for ${gbp(d.totalMinor)} from ${d.options?.length ?? 0} pack options`;
    case "ORDER_CREATED": return `Order saved before contacting the retailer${d.mock ? " (mock)" : ""}`;
    case "POLICY_EVALUATED": return `Policy says ${d.decision}${d.reasons?.length ? `: ${d.reasons.map(human).join(", ")}` : ""}`;
    case "POLICY_RECHECKED": return `Re-checked just before buying: ${e.reason ?? "OK"}`;
    case "PRICE_CHANGED": return `Price moved ${gbp(d.fromMinor)} → ${gbp(d.toMinor)} since the plan`;
    case "ORDER_BLOCKED": return `Blocked: ${(e.reason ?? "").split(",").map(human).join(", ")}`;
    case "ORDER_REVIEW_REQUESTED": return "Needs your approval before anything is bought";
    case "ORDER_SUBMITTING": return "Sending order to the retailer";
    case "ORDER_UNCERTAIN": return `Outcome unknown (${human(e.reason ?? "timeout")}); will not retry blindly`;
    case "ORDER_FAILED": return `Order failed: ${human(e.reason ?? "unknown")}${d.stockChanged === false ? "; stock unchanged" : ""}`;
    case "ORDER_VERIFIED": return `Retailer confirmed order ${d.externalOrderId}; payment authorised`;
    case "ORDER_DELIVERED": return `Delivery confirmed (${human(d.source ?? "")})`;
    case "INVENTORY_DELIVERED": return `Stock +${d.added} → ${d.quantityAfter} on hand`;
    case "REPLENISHMENT_SKIPPED": return "Skipped: an order for this item is already on its way";
    default: return human(e.action);
  }
}

const icon = { OK: CheckCircle, WARN: WarningCircle, FAIL: XCircle } as const;

export function TraceList({ events, dark = false }: { events: Audit[]; dark?: boolean }) {
  return (
    <ol className="relative space-y-3">
      <span className={clsx("absolute bottom-2 left-[9px] top-2 w-px", dark ? "bg-paper/15" : "bg-line")} />
      <AnimatePresence initial={false}>
        {events.map((e, i) => {
          const Ic = icon[e.outcome];
          return (
            <motion.li key={e.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.04 }} className="relative grid grid-cols-[20px_1fr] gap-3">
              <Ic weight={e.outcome === "OK" ? "fill" : "regular"} size={20} className={clsx("relative z-10 rounded-full", dark ? "bg-ink" : "bg-paper", e.outcome === "OK" ? (dark ? "text-paper" : "text-ink") : "text-accent")} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={clsx("font-mono text-[10.5px] uppercase tracking-[.14em]", dark ? "text-paper/50" : "text-mute")}>{STAGE_LABEL[e.stage] ?? e.stage}</span>
                  <span className={clsx("font-mono text-[10.5px]", dark ? "text-paper/40" : "text-mute/70")}>{clock(e.at)}</span>
                </div>
                <p className={clsx("text-[14px] leading-snug", e.outcome === "FAIL" && "text-accent", e.outcome === "WARN" && !dark && "text-ink")}>{describe(e)}</p>
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}

export function groupTraces(events: Audit[]) {
  const map = new Map<string, Audit[]>();
  for (const e of events) (map.get(e.correlationId) ?? map.set(e.correlationId, []).get(e.correlationId)!).push(e);
  return [...map.entries()]
    .map(([id, evs]) => ({ id, events: evs.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.seq - b.seq)) }))
    .filter((g) => g.events.some((e) => ["DEVICE", "FORECAST", "PRODUCT", "ORDER"].includes(e.stage)))
    .sort((a, b) => (b.events.at(-1)!.at > a.events.at(-1)!.at ? 1 : -1));
}
