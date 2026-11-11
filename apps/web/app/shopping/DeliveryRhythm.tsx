"use client";
import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";
import { Btn, Panel } from "@/components/ui";
import { api } from "@/lib/api";

type Cadence = "ASAP" | "DAILY" | "EVERY_2_DAYS" | "WEEKLY";
interface Warn { code: string; message: string }
interface Schedule { cadence: Cadence; orderHour: number; nextSlotDate: string; daysUntil: number; deliveriesPerWeek: number | null; warnings: Warn[]; recommendedLimits: { maxOrdersPerWeek: number; cooldownHours: number } }
interface Preview {
  needs: { canonicalKey: string; name: string; unit: string; shortfall: number; daysOfSupply: number | null }[]; skipped: string[];
  basket: null | { currency: string; lines: { name: string; quantity: number; lineTotalMinor: number }[]; deliveryMinor: number; totalMinor: number }; warnings: Warn[];
}
interface RunResult { run: { outcome: string | null; summary: string | null; orderId: string | null; error: string | null } }

const OPTIONS: { id: Cadence; label: string; note: string }[] = [
  { id: "ASAP", label: "As needed", note: "Order the moment something runs low" },
  { id: "DAILY", label: "Every day", note: "One delivery each day" },
  { id: "EVERY_2_DAYS", label: "Every 2 days", note: "One delivery every other day" },
  { id: "WEEKLY", label: "Weekly", note: "One bigger delivery a week" },
];
const HOURS = Array.from({ length: 15 }, (_, i) => i + 6);
const field = "rounded-lg border hair bg-card/80 px-3 py-2 text-[14px] outline-none focus:ring-1";
const money = (minor: number, cur: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency: cur }).format(minor / 100);
const when = (s: Schedule) => s.daysUntil === 0 ? "today" : s.daysUntil === 1 ? "tomorrow" : new Date(`${s.nextSlotDate}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
const outcomeText = (r: RunResult["run"]) =>
  r.error ? r.error : r.outcome === "NOTHING_DUE" ? "Nothing needs ordering right now."
  : r.outcome === "NO_ELIGIBLE_PRODUCT" ? "No available product could cover this delivery."
  : r.orderId ? `${r.summary ?? "Delivery order created"}. See Orders for the policy result.` : r.summary ?? "Done.";

export function DeliveryRhythm({ onChanged }: { onChanged?: () => void }) {
  const [sch, setSch] = useState<Schedule | null>(null);
  const [prev, setPrev] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await api<Schedule>("/delivery/schedule");
      setSch(s);
      setPrev(s.cadence === "ASAP" ? null : await api<Preview>("/delivery/preview"));
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (body: { cadence: Cadence; orderHour?: number; applyLimits?: boolean }, label: string) => {
    setBusy(label); setErr(null); setMsg(null);
    try { setSch(await api<Schedule>("/delivery/schedule", { body })); await load(); onChanged?.(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const placeNow = async () => {
    setBusy("run"); setErr(null); setMsg(null);
    try { const out = await api<RunResult>("/delivery/run", { body: {} }); setMsg(outcomeText(out.run)); await load(); onChanged?.(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };

  if (!sch) return <Panel kicker="Groceries" title="Delivery rhythm"><p className="text-[14px] text-mute">{err ?? "Loading…"}</p></Panel>;
  const warnings = [...sch.warnings, ...(prev?.warnings ?? [])];

  return (
    <Panel kicker="Groceries" title="Delivery rhythm">
      <div role="radiogroup" aria-label="Delivery rhythm" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {OPTIONS.map((o) => (
          <button key={o.id} role="radio" aria-checked={sch.cadence === o.id} onClick={() => o.id !== sch.cadence && save({ cadence: o.id }, o.id)}
            className={clsx("rounded-xl border hair p-3.5 text-left transition-colors", sch.cadence === o.id ? "bg-ink text-paper" : "bg-card/70 hover:bg-sunk")}>
            <span className="block text-[14px] font-medium">{busy === o.id ? "Saving…" : o.label}</span>
            <span className={clsx("mt-0.5 block text-[12px]", sch.cadence === o.id ? "opacity-75" : "text-mute")}>{o.note}</span>
          </button>
        ))}
      </div>

      {sch.cadence !== "ASAP" && (
        <div className="mt-5 grid gap-6 border-t border-dashed hair pt-5 md:grid-cols-[1fr_1.4fr]">
          <div className="space-y-3">
            <p className="font-mono text-[10.5px] uppercase tracking-[.14em] text-mute">Next delivery</p>
            <p className="text-[22px] font-medium tracking-tight">{when(sch)}</p>
            <label className="grid gap-1 text-[12px] text-mute">Order placed at
              <select className={field} value={sch.orderHour} onChange={(e) => save({ cadence: sch.cadence, orderHour: Number(e.target.value) }, "hour")}>
                {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
            </label>
            <Btn onClick={placeNow}>{busy === "run" ? "Placing…" : "Place this delivery now"}</Btn>
            <p className="text-[12px] text-mute">Skips the wait. It still goes through your spending limits.</p>
          </div>
          <div>
            <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[.14em] text-mute">Will include</p>
            {!prev || prev.needs.length === 0
              ? <p className="text-[14px] text-mute">Nothing is due yet. Stock will last until the delivery after this one.</p>
              : <>
                  <ul className="space-y-1 text-[14px]">
                    {(prev.basket?.lines ?? []).map((l) => (
                      <li key={l.name} className="flex justify-between gap-3 border-b border-dashed hair py-1"><span>{l.name} × {l.quantity}</span><span className="font-mono tnum text-mute">{money(l.lineTotalMinor, prev.basket!.currency)}</span></li>
                    ))}
                  </ul>
                  {prev.basket && <p className="mt-2 flex justify-between font-mono text-[12px] text-mute"><span>Delivery {money(prev.basket.deliveryMinor, prev.basket.currency)}</span><span>Total {money(prev.basket.totalMinor, prev.basket.currency)}</span></p>}
                  {prev.skipped.length > 0 && <p className="mt-2 text-[12px] text-accent">Not available from the store: {prev.skipped.join(", ")}</p>}
                </>}
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-5 space-y-2 rounded-xl border hair bg-sunk/50 p-4 text-[13px]">
          {warnings.map((w) => <p key={w.code} className="text-accent">{w.message}</p>)}
          {sch.warnings.length > 0 && (
            <div className="pt-1">
              <Btn variant="quiet" onClick={() => save({ cadence: sch.cadence, applyLimits: true }, "limits")}>{busy === "limits" ? "Applying…" : `Allow ${sch.recommendedLimits.maxOrdersPerWeek} orders a week, ${sch.recommendedLimits.cooldownHours}h cooldown`}</Btn>
              <p className="mt-1 text-[12px] text-mute">This only changes order-count limits. Your spending caps stay as they are.</p>
            </div>
          )}
        </div>
      )}
      {msg && <p role="status" className="mt-4 text-[13px]">{msg}</p>}
      {err && <p className="mt-4 text-[13px] text-accent">{err}</p>}
    </Panel>
  );
}