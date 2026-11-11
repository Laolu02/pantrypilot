"use client";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { PencilSimple, Plus, Trash, X } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Async, Btn, Empty, Meter, PageHeader, Panel, Pill } from "@/components/ui";
import { api, ApiError, useApi, useRefresh } from "@/lib/api";
import { daysUntil, human, qty } from "@/lib/format";
import type { Ingredient, Item } from "@/lib/types";

const FILTERS = [
  { id: "all", label: "Everything" }, { id: "FRIDGE", label: "Fridge" }, { id: "FREEZER", label: "Freezer" }, { id: "PANTRY", label: "Pantry" },
  { id: "low", label: "Low stock" }, { id: "expiring", label: "Expiring" }, { id: "uncertain", label: "Uncertain" },
];
const SOURCE: Record<string, string> = { OBSERVED: "Sensor", MANUAL: "Entered", ESTIMATED: "Estimated", DELIVERED: "Delivered" };
const UNITS = { ml: [["ml", 1], ["L", 1000]], g: [["g", 1], ["kg", 1000]], count: [["items", 1]] } as const;
const inputCls = "w-full rounded-xl border hair bg-paper px-3 py-2 text-[14px] outline-none focus:border-ink";

function AddForm({ onClose }: { onClose: () => void }) {
  const { refresh } = useRefresh();
  const ing = useApi<{ ingredients: Ingredient[] }>("/ingredients", 0);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [family, setFamily] = useState<"ml" | "g" | "count">("g");
  const [unitIdx, setUnitIdx] = useState(0);
  const [storage, setStorage] = useState<"FRIDGE" | "FREEZER" | "PANTRY">("PANTRY");
  const [expiry, setExpiry] = useState("");
  const [daily, setDaily] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const known = useMemo(() => ing.data?.ingredients.find((i) => i.name.toLowerCase() === name.trim().toLowerCase()), [ing.data, name]);
  const pick = (v: string) => {
    setName(v);
    const k = ing.data?.ingredients.find((i) => i.name.toLowerCase() === v.trim().toLowerCase());
    if (k) {
      setFamily(k.unit); setUnitIdx(0); setStorage(k.storage);
      if (k.shelfLifeDays && !expiry) setExpiry(new Date(Date.now() + k.shelfLifeDays * 86400000).toISOString().slice(0, 10));
    }
  };
  const units = UNITS[family];
  const mult = units[Math.min(unitIdx, units.length - 1)]![1];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setDone(null);
    const q = parseFloat(amount);
    if (!name.trim()) return setErr("Give the item a name.");
    if (!(q > 0)) return setErr("Enter an amount greater than zero.");
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: known?.name ?? name.trim(), ...(known ? { canonicalKey: known.key } : {}), quantity: q * mult, unit: family, storage };
      if (expiry) body.expiresAt = `${expiry}T12:00:00.000Z`;
      const d = parseFloat(daily);
      if (d > 0) body.dailyUse = d * mult;
      const r = await api<Item & { merged: boolean }>("/inventory", { body });
      setDone(r.merged ? `Added to what you already had. Now ${qty(r.quantity, r.unit)}.` : `Added ${r.name}: ${qty(r.quantity, r.unit)}.`);
      setName(""); setAmount(""); setExpiry(""); setDaily(""); refresh();
    } catch (e2) { setErr(e2 instanceof ApiError ? (e2.code === "VALIDATION_ERROR" ? "Check the amount and name, then try again." : e2.message) : "Could not add the item."); }
    setBusy(false);
  };

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="mb-6">
      <Panel kicker="Manual entry" title="Add something to the pantry" action={<button aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 text-mute hover:bg-sunk"><X size={16} /></button>}>
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-6">
          <label className="md:col-span-3"><span className="text-[13px] font-medium">Item</span>
            <input list="known-items" className={clsx(inputCls, "mt-1.5")} value={name} onChange={(e) => pick(e.target.value)} placeholder="Milk, rice, or anything of your own" autoComplete="off" />
            <datalist id="known-items">{ing.data?.ingredients.map((i) => <option key={i.key} value={i.name} />)}</datalist>
            <span className="mt-1 block text-[12px] text-mute">{name.trim() ? known ? (known.allergenDataKnown ? "Known ingredient: allergen checks apply." : "Known item, but its allergens are unknown, so recipes using it ask you to check labels.") : "Custom item: allergens are unknown, so recipes using it ask you to check labels." : "Pick a known item to fill in sensible defaults."}</span>
          </label>
          <div className="md:col-span-3"><span className="text-[13px] font-medium">Amount</span>
            <div className="mt-1.5 grid grid-cols-[1fr_auto] gap-2">
              <input inputMode="decimal" className={clsx(inputCls, "font-mono tnum")} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 1.5" aria-label="Amount" />
              <div className="flex rounded-xl border hair bg-sunk p-0.5" role="group" aria-label="Unit">
                {(["g", "ml", "count"] as const).flatMap((f) => UNITS[f].map(([label], i) => ({ f, i, label }))).filter((u) => known ? u.f === family : true).map((u) => (
                  <button type="button" key={`${u.f}${u.label}`} aria-pressed={family === u.f && Math.min(unitIdx, units.length - 1) === u.i} onClick={() => { setFamily(u.f); setUnitIdx(u.i); }}
                    className={clsx("rounded-lg px-2.5 py-1.5 text-[12.5px] transition", family === u.f && Math.min(unitIdx, units.length - 1) === u.i ? "bg-ink text-paper" : "text-mute hover:text-ink")}>{u.label}</button>))}
              </div>
            </div>
          </div>
          <div className="md:col-span-2"><span className="text-[13px] font-medium">Stored in</span>
            <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-xl bg-sunk p-0.5" role="radiogroup" aria-label="Storage">
              {(["FRIDGE", "FREEZER", "PANTRY"] as const).map((s) => <button type="button" role="radio" aria-checked={storage === s} key={s} onClick={() => setStorage(s)} className={clsx("rounded-lg py-1.5 text-[12.5px] transition", storage === s ? "bg-ink text-paper" : "text-mute hover:text-ink")}>{human(s)}</button>)}
            </div>
          </div>
          <label className="md:col-span-2"><span className="text-[13px] font-medium">Best before <span className="text-mute">(optional)</span></span><input type="date" className={clsx(inputCls, "mt-1.5 font-mono")} value={expiry} onChange={(e) => setExpiry(e.target.value)} /></label>
          <label className="md:col-span-2"><span className="text-[13px] font-medium">Use per day <span className="text-mute">(optional)</span></span><input inputMode="decimal" className={clsx(inputCls, "mt-1.5 font-mono tnum")} value={daily} onChange={(e) => setDaily(e.target.value)} placeholder={`in ${units[Math.min(unitIdx, units.length - 1)]![0]}`} /><span className="mt-1 block text-[12px] text-mute">Lets it forecast and reorder. Marked as an estimate.</span></label>
          <div className="flex flex-wrap items-center gap-3 md:col-span-6"><Btn type="submit" busy={busy}><Plus size={15} />Add to pantry</Btn>
            {done && <span role="status" className="text-[13px]">{done}</span>}{err && <span role="alert" className="text-[13px] text-accent">{err}</span>}</div>
        </form>
      </Panel>
    </motion.div>
  );
}

function RowActions({ i }: { i: Item }) {
  const { refresh } = useRefresh();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const factor = i.unit === "count" ? 1 : 1;
  const save = async () => {
    const n = parseFloat(val);
    if (!(n >= 0)) return setErr("Enter a number");
    try { await api(`/inventory/${i.id}`, { method: "PATCH", body: { quantity: n * factor } }); setEditing(false); setErr(null); refresh(); } catch (e) { setErr((e as Error).message); }
  };
  const del = async () => { try { await api(`/inventory/${i.id}`, { method: "DELETE" }); refresh(); } catch (e) { setErr((e as Error).message); } };
  if (editing) return (
    <div className="flex items-center gap-1.5"><input autoFocus inputMode="decimal" aria-label={`New quantity of ${i.name} in ${i.unit}`} className="w-20 rounded-lg border hair bg-paper px-2 py-1 font-mono text-[13px]" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder={i.unit} />
      <Btn onClick={save} className="px-2.5 py-1">Set</Btn><button aria-label="Cancel" onClick={() => setEditing(false)} className="p-1 text-mute"><X size={14} /></button>{err && <span className="text-[11px] text-accent">{err}</span>}</div>);
  if (confirm) return <div className="flex items-center gap-1.5"><span className="text-[12px] text-mute">Remove?</span><Btn variant="danger" onClick={del} className="px-2.5 py-1">Yes</Btn><Btn variant="quiet" onClick={() => setConfirm(false)} className="px-2.5 py-1">No</Btn></div>;
  return <div className="flex gap-1"><button aria-label={`Correct quantity of ${i.name}`} title="Correct amount" onClick={() => { setVal(String(Math.round(i.quantity * 10) / 10)); setEditing(true); }} className="rounded-lg p-1.5 text-mute hover:bg-sunk hover:text-ink"><PencilSimple size={15} /></button><button aria-label={`Remove ${i.name}`} title="Remove" onClick={() => setConfirm(true)} className="rounded-lg p-1.5 text-mute hover:bg-sunk hover:text-accent"><Trash size={15} /></button></div>;
}

export default function Inventory() {
  const { refresh } = useRefresh();
  const [f, setF] = useState("all");
  const [adding, setAdding] = useState(false);
  const inv = useApi<{ items: Item[] }>("/inventory");
  const recon = useApi<{ requests: { id: string; canonicalKey: string; observedQuantity: number; currentQuantity: number | null; reason: string }[] }>("/inventory/reconciliations");
  const resolve = async (requestId: string, resolution: string) => { await api("/inventory/reconcile", { body: { requestId, resolution } }); refresh(); };

  return (
    <>
      <PageHeader kicker="Pantry" title="What is in the kitchen">
        <Btn onClick={() => setAdding((a) => !a)} aria-expanded={adding}><Plus size={15} />{adding ? "Close form" : "Add item"}</Btn>
      </PageHeader>
      <AnimatePresence initial={false}>{adding && <AddForm onClose={() => setAdding(false)} />}</AnimatePresence>
      {recon.data && recon.data.requests.length > 0 && (
        <Panel className="mb-6 border-accent/50" kicker="Needs your check" title="Readings we did not trust">
          <ul className="divide-y hair">
            {recon.data.requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <p className="text-[14px]"><span className="font-medium">{human(r.canonicalKey)}</span>: sensor says <span className="font-mono">{r.observedQuantity}</span>, we have <span className="font-mono">{r.currentQuantity ?? "nothing"}</span> <Pill tone="outlineAccent" className="ml-1">{human(r.reason)}</Pill></p>
                <div className="flex gap-2"><Btn variant="quiet" onClick={() => resolve(r.id, "KEEP_CURRENT")}>Keep ours</Btn><Btn onClick={() => resolve(r.id, "ACCEPT_OBSERVED")}>Accept sensor</Btn></div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Filters">
        {FILTERS.map((x) => (
          <button key={x.id} role="tab" aria-selected={f === x.id} onClick={() => setF(x.id)} className={clsx("rounded-full border px-3 py-1.5 text-[13px] transition", f === x.id ? "border-ink bg-ink text-paper" : "hair text-mute hover:text-ink")}>{x.label}</button>
        ))}
      </div>
      <Panel pad={false}>
        <Async state={inv} rows={6}>
          {({ items }) => {
            const rows = items.filter((i) => f === "all" ? true : ["FRIDGE", "FREEZER", "PANTRY"].includes(f) ? i.storage === f : f === "low" ? i.forecast?.needsReplenishment : f === "expiring" ? (daysUntil(i.expiresAt) ?? 99) <= 3 : i.confidence < 0.75);
            if (!rows.length) return <div className="p-5"><Empty title={items.length ? "Nothing matches this filter" : "The pantry is empty"} hint={items.length ? "Try another filter." : "Add what you have with the Add item button."} /></div>;
            return (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-left text-[14px]">
                  <thead><tr className="border-b hair font-mono text-[10.5px] uppercase tracking-[.14em] text-mute">
                    {["Item", "On hand", "Supply", "Where", "Expires", "Confidence", "Source", ""].map((h, k) => <th key={k} className="px-5 py-3 font-normal">{h}</th>)}
                  </tr></thead>
                  <tbody className="divide-y hair">
                    {rows.map((i, n) => {
                      const exp = daysUntil(i.expiresAt); const low = i.forecast?.needsReplenishment;
                      return (
                        <motion.tr key={i.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(n, 10) * 0.025 }}>
                          <td className="px-5 py-3"><p className="font-medium">{i.name}</p>{i.inboundQty > 0 && <p className="font-mono text-[11px] text-ink">+{qty(i.inboundQty, i.unit)} on order, not yet here</p>}</td>
                          <td className="px-5 py-3 font-mono tnum">{qty(i.quantity, i.unit)}</td>
                          <td className="w-40 px-5 py-3">{i.forecast?.daysOfSupply != null ? <><Meter value={i.forecast.daysOfSupply} max={7} tone={low ? "accent" : "ink"} /><p className="mt-1 font-mono text-[11px] text-mute">{i.forecast.daysOfSupply.toFixed(1)} d{i.forecast.estimated ? " · est." : ""}</p></> : <span className="text-mute">no forecast</span>}</td>
                          <td className="px-5 py-3 text-mute">{human(i.storage)}</td>
                          <td className={clsx("px-5 py-3 font-mono tnum", exp != null && exp <= 3 && "text-accent")}>{exp == null ? "n/a" : exp <= 0 ? "expired" : `${Math.ceil(exp)} d`}</td>
                          <td className="w-32 px-5 py-3"><Meter value={i.confidence} max={1} tone={i.confidence < 0.6 ? "accent" : "ink"} /><p className="mt-1 font-mono text-[11px] text-mute">{Math.round(i.confidence * 100)}%</p></td>
                          <td className="px-5 py-3"><Pill tone={i.source === "OBSERVED" ? "outline" : "ghost"}>{SOURCE[i.source]}</Pill></td>
                          <td className="px-3 py-3"><RowActions i={i} /></td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          }}
        </Async>
      </Panel>
    </>
  );
}
