"use client";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { Async, Btn, PageHeader, Panel, Pill } from "@/components/ui";
import { api, ApiError, useApi, useRefresh } from "@/lib/api";
import { human } from "@/lib/format";
import type { CatalogEntry, Policy, Store } from "@/lib/types";
import { DeliveryRhythm } from "@/app/shopping/DeliveryRhythm";


const money = (m: number) => (m / 100).toFixed(2);
const toMinor = (s: string) => Math.round(parseFloat(s || "0") * 100);

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-[13px] font-medium">{label}</span>{hint && <span className="ml-2 text-[12px] text-mute">{hint}</span>}<div className="mt-1.5">{children}</div></label>;
}
const input = "w-full rounded-xl border hair bg-paper px-3 py-2 font-mono text-[14px] tnum outline-none focus:border-ink";

function Form({ p }: { p: Policy }) {
  const { refresh } = useRefresh();
  const cat = useApi<{ results: CatalogEntry[] }>("/products/search", 0);
  const [d, setD] = useState({ item: money(p.perItemCapMinor), order: money(p.perOrderCapMinor), week: money(p.weeklyBudgetMinor), cool: String(p.cooldownHours), freq: String(p.maxOrdersPerWeek), conf: String(p.minConfidence), age: String(p.maxPriceAgeMinutes), enabled: p.enabled, mode: p.mode, allow: p.allowlistedProductIds });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setD((x) => ({ ...x, enabled: p.enabled, mode: p.mode })); }, [p.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await api<Policy>("/shopping/policies", { method: "PUT", body: { enabled: d.enabled, mode: d.mode, perItemCapMinor: toMinor(d.item), perOrderCapMinor: toMinor(d.order), weeklyBudgetMinor: toMinor(d.week), cooldownHours: Number(d.cool), maxOrdersPerWeek: Number(d.freq), minConfidence: Number(d.conf), maxPriceAgeMinutes: Number(d.age), allowlistedProductIds: d.allow, allowlistedCategories: [], currency: "GBP" } });
      setMsg(`Saved as policy v${r.version}. Pending approvals made under the old version no longer count.`); refresh();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Could not save"); }
    setBusy(false);
  };
  const grouped = new Map<string, CatalogEntry[]>();
  cat.data?.results.forEach((r) => grouped.set(r.product.name, [...(grouped.get(r.product.name) ?? []), r]));
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <Panel kicker="Autonomy" title="When may it buy by itself?">
          <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-sunk p-1" role="radiogroup" aria-label="Approval mode">
            {([["ALWAYS_CONFIRM", "Always ask me"], ["BOUNDED_AUTONOMY", "Act within limits"]] as const).map(([m, l]) => (
              <button key={m} role="radio" aria-checked={d.mode === m} onClick={() => setD({ ...d, mode: m })} className={clsx("rounded-lg py-2 text-[13px] font-medium transition", d.mode === m ? "bg-ink text-paper" : "text-mute hover:text-ink")}>{l}</button>))}
          </div>
          <label className="mt-4 flex items-center justify-between gap-3 text-[14px]"><span>Autonomous purchasing enabled</span><input type="checkbox" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} className="h-4 w-4 accent-[rgb(194_80_47)]" /></label>
          <p className="mt-3 text-[12.5px] text-mute">Starts on “Always ask me”. Even in autonomous mode only allowlisted staples inside every limit are bought; anything uncertain is sent to you.</p>
        </Panel>
        <Panel kicker="Limits" title="Spending and frequency">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Per pack cap" hint="£"><input className={input} inputMode="decimal" value={d.item} onChange={(e) => setD({ ...d, item: e.target.value })} /></Field>
            <Field label="Per order cap" hint="£ incl. delivery"><input className={input} inputMode="decimal" value={d.order} onChange={(e) => setD({ ...d, order: e.target.value })} /></Field>
            <Field label="Weekly budget" hint="£"><input className={input} inputMode="decimal" value={d.week} onChange={(e) => setD({ ...d, week: e.target.value })} /></Field>
            <Field label="Max orders / week"><input className={input} inputMode="numeric" value={d.freq} onChange={(e) => setD({ ...d, freq: e.target.value })} /></Field>
            <Field label="Cooldown per item" hint="hours"><input className={input} inputMode="numeric" value={d.cool} onChange={(e) => setD({ ...d, cool: e.target.value })} /></Field>
            <Field label="Min stock confidence" hint="0 to 1"><input className={input} inputMode="decimal" value={d.conf} onChange={(e) => setD({ ...d, conf: e.target.value })} /></Field>
            <Field label="Max price age" hint="minutes"><input className={input} inputMode="numeric" value={d.age} onChange={(e) => setD({ ...d, age: e.target.value })} /></Field>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3"><Btn busy={busy} onClick={save}>Save policy</Btn><span className="font-mono text-[11px] text-mute">current v{p.version}</span></div>
          {msg && <p className="mt-3 text-[13px]" aria-live="polite">{msg}</p>}{err && <p role="alert" className="mt-3 text-[13px] text-accent">{err}</p>}
        </Panel>
      </div>
      <Panel kicker="Allowlist" title="Products it may buy automatically" action={<Pill tone="ghost">{d.allow.length} selected</Pill>}>
        <Async state={cat} rows={5}>{() => (
          <ul className="space-y-4">{[...grouped.entries()].map(([name, rows]) => (
            <li key={name}><p className="mb-1.5 text-[13px] font-medium">{name}</p>
              <div className="flex flex-wrap gap-1.5">{rows.map((r) => { const on = d.allow.includes(r.product.id); return (
                <button key={r.product.id} aria-pressed={on} onClick={() => setD({ ...d, allow: on ? d.allow.filter((x) => x !== r.product.id) : [...d.allow, r.product.id] })} className={clsx("rounded-full border px-3 py-1 text-[12.5px] transition", on ? "border-ink bg-ink text-paper" : "hair text-mute hover:text-ink")}>{r.product.packLabel}</button>); })}</div></li>))}</ul>)}
        </Async>
        <p className="mt-4 text-[12px] text-mute">Categories: {human("none configured")}. Unknown products are never bought automatically.</p>
      </Panel>
    </div>
  );
}

function Payments() {
  const info = useApi<{ household: { currency: "GBP" | "USD" }; payments: { label: string; mode: "MOCK" | "SANDBOX" | "LIVE"; requiresConnection: boolean; connected: boolean } }>("/integrations", 0);
  const pol = useApi<Policy>("/shopping/policies", 0);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
    useEffect(() => {
    const sp = new URLSearchParams(window.location.search); const q = sp.get("connected");
    if (q === "paypal") setNote("PayPal connected.");
    if (q === "cancelled") setNote("PayPal sent you back without finishing, so nothing was saved. If PayPal showed a message such as \"already connected\", note its exact wording. The API terminal has a [paypal] line with details.");
    if (q === "failed") setNote(`You approved in PayPal, but saving the payment method failed (${sp.get("why") ?? "unknown"}). The API terminal has a [paypal] line with details.`);
    if (q === "kroger") setNote("Kroger connected.");
  }, []);
  const go = async () => { try { const r = await api<{ url: string }>("/integrations/paypal/connect"); window.location.href = r.url; } catch (e) { setErr((e as Error).message); } };
  const off = async () => { await api("/integrations/paypal", { method: "DELETE" }); info.reload(); };
  const sym = info.data?.household.currency === "USD" ? "$" : "£";
  return (
    <Panel kicker="Payment" title="How purchases are paid for">
      <Async state={info} rows={2}>{({ payments: p }) => (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="flex items-center gap-2"><p className="font-medium">{p.label}</p><Pill tone={p.mode === "LIVE" ? "ink" : "outlineAccent"}>{p.mode}</Pill></div>
              <p className="text-[12.5px] text-mute">{p.requiresConnection ? (p.connected ? "Connected. Funds stay in your PayPal until an order is confirmed." : "Not connected. Nothing can be bought until you connect.") : "Simulated. No account needed and no money moves."}</p></div>
            {p.requiresConnection && (p.connected ? <Btn variant="quiet" onClick={off}>Disconnect</Btn> : <Btn onClick={go}>Connect PayPal</Btn>)}
          </div>
          {p.requiresConnection && !p.connected && pol.data && (
            <div className="mt-4 rounded-xl bg-sunk/70 p-3 text-[13px] leading-relaxed">
              <p className="font-medium">What you are agreeing to</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-mute">
                <li>PantryPilot may ask PayPal to <b className="text-ink">hold</b> up to {sym}{(pol.data.perOrderCapMinor / 100).toFixed(2)} per order and {sym}{(pol.data.weeklyBudgetMinor / 100).toFixed(2)} per week, only for products you allowlisted.</li>
                <li>The hold is <b className="text-ink">captured only after the store confirms the order</b>. If anything fails, the hold is released and you are not charged.</li>
                <li>PantryPilot never holds your balance. <b className="text-ink">PayPal does not enforce these limits; PantryPilot does</b>, and you can disconnect or hit the emergency stop at any time.</li>
              </ul>
            </div>
          )}
          {note && <p role="status" className="mt-3 text-[13px]">{note}</p>}{err && <p role="alert" className="mt-3 text-[13px] text-accent">{err}</p>}
        </>)}</Async>
    </Panel>
  );
}

function Stores() {
  const { refresh } = useRefresh();
  const info = useApi<{ household: { currency: "GBP" | "USD" }; stores: Store[]; instacart: { configured: boolean; note: string } }>("/integrations", 0);
  const [err, setErr] = useState<string | null>(null);
  const setCurrency = async (currency: string) => { try { await api("/household", { method: "PUT", body: { currency } }); info.reload(); refresh(); } catch (e) { setErr((e as Error).message); } };
  const connect = async () => { try { const r = await api<{ url: string }>("/integrations/kroger/authorize"); window.location.href = r.url; } catch (e) { setErr((e as Error).message); } };
  const disconnect = async () => { await api("/integrations/kroger", { method: "DELETE" }); info.reload(); };
  return (
    <Panel kicker="Stores" title="Where it can shop">
      <Async state={info} rows={3}>{(d) => (
        <>
          <div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-[13px] font-medium">Household currency</p><p className="text-[12px] text-mute">Only stores priced in this currency are chosen automatically.</p></div>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-sunk p-0.5" role="radiogroup" aria-label="Currency">{["GBP", "USD"].map((c) => <button key={c} role="radio" aria-checked={d.household.currency === c} onClick={() => setCurrency(c)} className={clsx("rounded-lg px-3 py-1.5 font-mono text-[12.5px]", d.household.currency === c ? "bg-ink text-paper" : "text-mute")}>{c}</button>)}</div></div>
          <ul className="divide-y hair">{d.stores.map((s) => (
            <li key={s.name} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div><div className="flex items-center gap-2"><p className="font-medium">{s.label}</p><Pill tone={s.mode === "LIVE" ? "ink" : "outlineAccent"}>{s.mode}</Pill><span className="font-mono text-[11px] text-mute">{s.currency}</span></div>
                <p className="text-[12.5px] text-mute">{s.capabilities.placeOrder ? "Can place and verify orders (simulated)." : "Cannot place orders by API. We prepare a cart; you check out."}</p></div>
              {s.name === "kroger" && (s.connected ? <Btn variant="quiet" onClick={disconnect}>Disconnect</Btn> : <Btn onClick={connect}>Connect account</Btn>)}
            </li>))}
            <li className="py-3"><div className="flex items-center gap-2"><p className="font-medium">Instacart</p><Pill tone={d.instacart.configured ? "ink" : "ghost"}>{d.instacart.configured ? "Configured" : "Not configured"}</Pill></div><p className="text-[12.5px] text-mute">{d.instacart.note}</p></li>
          </ul>
          {err && <p role="alert" className="mt-2 text-[13px] text-accent">{err}</p>}
        </>)}</Async>
    </Panel>
  );
}

export default function Policies() {
  const pol = useApi<Policy>("/shopping/policies", 0);
  const { refresh } = useRefresh();
  return (
    <>
      <PageHeader kicker="Limits" title="The rules it cannot break" />
      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><Payments /><Stores /></div>
      <div className="mb-6"><DeliveryRhythm onChanged={refresh} /></div>
      <Async state={pol} rows={5}>{(p) => <Form key={p.version} p={p} />}</Async>
    </>
  );
}
