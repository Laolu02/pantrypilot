"use client";
import { Flask, ArrowCounterClockwise } from "@phosphor-icons/react";
import { useState } from "react";
import { api, ApiError, useApi, useRefresh } from "@/lib/api";
import type { Meta } from "@/lib/types";
import { Btn, MagneticBtn, Panel, StateBadge } from "./ui";

const SCENARIOS = [
  { id: "LOW_MILK", label: "Fridge: milk is low", hint: "Eligible order, auto-approved" },
  { id: "LOW_OLIVE_OIL", label: "Pantry: olive oil is low", hint: "Only a £29.50 tin in stock; blocked" },
  { id: "REPLAY_LAST", label: "Replay the last event", hint: "Applied once, not twice" },
  { id: "IMPLAUSIBLE_MILK", label: "Implausible reading", hint: "Asks you to reconcile" },
];

export default function ScenarioPanel() {
  const { refresh } = useRefresh();
  const meta = useApi<Meta>("/meta", 0);
  const mockPay = meta.data?.payments.mode === "MOCK";
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; state?: string } | null>(null);
  const [fault, setFault] = useState<string>("");

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    try { await fn(); } catch (e) { setMsg({ text: e instanceof ApiError ? e.message : "Failed" }); }
    setBusy(null); refresh();
  };
  const simulate = (scenario: string) => run(scenario, async () => {
    if (fault === "commerce") await api("/demo/faults", { body: { commerce: "TIMEOUT_AFTER_COMMIT" } });
    if (fault === "payment" && mockPay) await api("/demo/faults", { body: { payment: "DECLINE" } });
    if (fault === "capture" && mockPay) await api("/demo/faults", { body: { capture: "FAIL" } });
    setFault("");
    const r = await api<any>("/devices/simulate", { body: { scenario } });
    setMsg({ text: r.run ? (r.run.summary ?? r.run.outcome) : `Event ${r.ingest.status.toLowerCase().replace(/_/g, " ")}${r.ingest.detail ? `: ${r.ingest.detail}` : ""}`, state: r.run?.state ?? r.ingest.status });
  });

  return (
    <Panel dark kicker="Demo controls" title="Make something happen" action={<Flask size={20} className="text-accent" />}>
      <div className="space-y-2">
        {SCENARIOS.map((s, i) => (
          <div key={s.id} className="flex items-center justify-between gap-3 border-b border-paper/10 pb-2 last:border-0">
            <div className="min-w-0"><p className="text-[14px]">{s.label}</p><p className="truncate text-[12px] text-paper/50">{s.hint}</p></div>
            {i === 0 ? <MagneticBtn busy={busy === s.id} onClick={() => simulate(s.id)}>Send</MagneticBtn> : <Btn variant="quiet" className="border-paper/25 text-paper hover:bg-paper/10" busy={busy === s.id} onClick={() => simulate(s.id)}>Send</Btn>}
          </div>
        ))}
      </div>
      <fieldset className="mt-4">
        <legend className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[.14em] text-paper/50">Next order fails with</legend>
        <div className="flex flex-wrap gap-1.5">
          {[["", "Nothing"], ["commerce", "Retailer timeout"], ...(mockPay ? [["payment", "Payment declined"], ["capture", "Capture fails"]] : [])].map(([v, l]) => (
            <button key={v} type="button" onClick={() => setFault(v!)} className={`rounded-full border px-2.5 py-1 text-[12px] transition ${fault === v ? "border-accent bg-accent text-white" : "border-paper/25 text-paper/70 hover:border-paper/50"}`}>{l}</button>
          ))}
        </div>
      </fieldset>
      {msg && (
        <div className="mt-4 rounded-xl bg-paper/[.07] p-3 text-[13px] leading-snug" aria-live="polite">
          {msg.state && <div className="mb-1.5"><StateBadge state={msg.state} /></div>}{msg.text}
        </div>
      )}
      <button onClick={() => run("reset", async () => { await api("/demo/reset", { body: {} }); setMsg({ text: "Demo state restored." }); })} className="mt-4 inline-flex items-center gap-1.5 text-[12px] text-paper/50 hover:text-paper">
        <ArrowCounterClockwise size={14} /> Reset demo data
      </button>
    </Panel>
  );
}
