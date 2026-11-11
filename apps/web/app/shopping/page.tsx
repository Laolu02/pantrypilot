"use client";
import clsx from "clsx";
import { Check } from "@phosphor-icons/react";
import { useState } from "react";
import { Async, Btn, Empty, MockBadge, PageHeader, Panel, Pill, StateBadge } from "@/components/ui";
import { api, ApiError, useApi, useRefresh } from "@/lib/api";
import { ago, human, money } from "@/lib/format";
import type { CatalogEntry, Meta, Order, Policy, Store } from "@/lib/types";

const STEPS = [
  { label: "Policy checked", hit: (s: Set<string>) => s.size > 0 },
  { label: "Verified with retailer", hit: (s: Set<string>) => ["CONFIRMED", "IN_TRANSIT", "DELIVERED"].some((x) => s.has(x)) },
  { label: "In transit", hit: (s: Set<string>) => ["IN_TRANSIT", "DELIVERED"].some((x) => s.has(x)) },
  { label: "Delivered, in stock", hit: (s: Set<string>) => s.has("DELIVERED") },
];

function OrderCard({ o, instacart }: { o: Order; instacart: boolean }) {
  const { refresh } = useRefresh();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const hit = new Set(o.history.map((h) => h.status));
  const act = async (name: string, path: string, body?: unknown) => {
    setBusy(name); setErr(null);
    try { await api(path, { body: body ?? {} }); } catch (e) { setErr(e instanceof ApiError ? e.message : "Failed"); }
    setBusy(null); refresh();
  };
  const dead = ["BLOCKED", "FAILED", "CANCELLED"].includes(o.status);
  return (
    <li className="py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2"><p className="text-[16px] font-medium tracking-tight">{o.basket.lines.map((l) => `${l.name} × ${l.quantity}`).join(", ")}</p><StateBadge state={o.status} />{o.mock && <MockBadge />}</div>
          <p className="mt-0.5 font-mono text-[11px] text-mute">{o.provider} · {ago(o.createdAt)}{o.externalOrderId && ` · ref ${o.externalOrderId}`}</p>
        </div>
        <p className="font-mono text-[20px] tnum tracking-tight">{money(o.basket.totalMinor, o.basket.currency)}</p>
      </div>

      {!dead && o.status !== "PENDING_REVIEW" && o.status !== "UNCERTAIN" && o.status !== "HANDOFF" && (
        <ol className="mt-4 grid grid-cols-4 gap-2">
          {STEPS.map((s) => { const on = s.hit(hit); return (
            <li key={s.label} className="min-w-0"><div className={clsx("h-1 rounded-full", on ? "bg-ink" : "bg-sunk")} /><p className={clsx("mt-1.5 flex items-center gap-1 text-[11.5px] leading-tight", on ? "text-ink" : "text-mute")}>{on && <Check size={11} weight="bold" />}{s.label}</p></li>
          ); })}
        </ol>
      )}
      {o.status === "UNCERTAIN" && <p className="mt-3 rounded-xl border border-accent/40 bg-accent/5 p-3 text-[13px]">The retailer did not answer. This order will <b>not</b> be retried blindly. Ask the retailer what it has on record instead.</p>}
      {o.payment && (
        <p className="mt-2 font-mono text-[11.5px] text-mute">
          Payment ({o.payment.provider}{o.payment.mode !== "LIVE" ? `, ${o.payment.mode.toLowerCase()}` : ""}): {({ AUTHORIZED: "held in your account, not yet charged", CAPTURED: "charged after the retailer confirmed", VOIDED: "hold released, nothing charged", REFUNDED: "refunded", FAILED: "not taken", UNKNOWN: "outcome being checked", PENDING: "pending" } as Record<string, string>)[o.payment.status] ?? o.payment.status}
        </p>
      )}
      {o.status === "HANDOFF" && o.handoff && (
        <div className="mt-4 rounded-xl border border-accent/40 bg-accent/5 p-3">
          <p className="text-[13.5px] font-medium">Cart prepared. Nothing has been bought.</p>
          <p className="mt-1 text-[13px] text-mute">{o.handoff.note}</p>
          <ul className="mt-2 space-y-1">{o.handoff.links.map((l) => <li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer" className="text-[13px] underline underline-offset-4 hover:text-accent">{l.label}</a></li>)}</ul>
        </div>
      )}
      {o.failureReason && <p className="mt-3 text-[13px] text-accent">Reason: {o.failureReason.split(",").map(human).join(", ")}</p>}

      {o.policyDecision && (
        <div className="mt-4 rounded-xl bg-sunk/70 p-3">
          <div className="flex items-center gap-2"><StateBadge state={o.policyDecision.decision} /><span className="font-mono text-[11px] text-mute">policy v{o.policyDecision.policyVersion}</span></div>
          {o.policyDecision.reasons.length > 0 ? <ul className="mt-2 space-y-1">{o.policyDecision.reasons.map((r, i) => <li key={i} className="text-[13px]"><span className="font-mono text-[11px] text-accent">{r.code}</span> <span className="text-mute">{r.message}</span></li>)}</ul> : <p className="mt-1.5 text-[13px] text-mute">Every mandatory check passed.</p>}
        </div>
      )}

      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[480px] text-[13px]">
        <tbody className="divide-y hair">
          {o.basket.lines.map((l) => <tr key={l.name}><td className="py-1.5">{l.name}</td><td className="font-mono tnum text-mute">{l.quantity} × {money(l.unitPriceMinor, o.basket.currency)}</td><td className="font-mono text-[11px] text-mute">price checked {ago(l.priceCheckedAt)}</td><td className="text-right font-mono tnum">{money(l.lineTotalMinor, o.basket.currency)}</td></tr>)}
          <tr><td className="py-1.5 text-mute" colSpan={3}>Delivery</td><td className="text-right font-mono tnum">{money(o.basket.deliveryMinor, o.basket.currency)}</td></tr>
        </tbody></table></div>

      <div className="mt-4 flex flex-wrap gap-2">
        {o.status === "PENDING_REVIEW" && <><Btn busy={busy === "a"} onClick={() => act("a", `/shopping/orders/${o.id}/approve`)}>Approve and buy</Btn><Btn variant="quiet" busy={busy === "r"} onClick={() => act("r", `/shopping/orders/${o.id}/reject`)}>Reject</Btn></>}
        {o.status === "UNCERTAIN" && <Btn busy={busy === "c"} onClick={() => act("c", `/shopping/orders/${o.id}/reconcile`)}>Check with retailer</Btn>}
        {o.status === "HANDOFF" && <>
          <Btn busy={busy === "k"} onClick={() => act("k", `/shopping/orders/${o.id}/confirm-checkout`)}>I finished checkout</Btn>
          {instacart && <Btn variant="quiet" busy={busy === "i"} onClick={() => act("i", `/shopping/orders/${o.id}/instacart`)}>Also make an Instacart list</Btn>}
          <Btn variant="danger" busy={busy === "x"} onClick={() => act("x", `/shopping/orders/${o.id}/cancel`)}>Cancel</Btn></>}
        {["CONFIRMED", "IN_TRANSIT"].includes(o.status) && <>
          {o.mock && <Btn variant="quiet" busy={busy === "d"} onClick={() => act("d", `/demo/orders/${o.id}/advance`, { status: "DELIVERED" })}>Demo: retailer delivers</Btn>}
          <Btn variant="quiet" busy={busy === "u"} onClick={() => act("u", `/shopping/orders/${o.id}/confirm-delivery`)}>It arrived (I confirm)</Btn>
          <Btn variant="danger" busy={busy === "x"} onClick={() => act("x", `/shopping/orders/${o.id}/cancel`)}>Cancel</Btn></>}
        {["PROPOSED", "PENDING_REVIEW", "APPROVED"].includes(o.status) && o.status !== "PENDING_REVIEW" && <Btn variant="danger" onClick={() => act("x", `/shopping/orders/${o.id}/cancel`)}>Cancel</Btn>}
      </div>
      {err && <p role="alert" className="mt-2 text-[13px] text-accent">{err}</p>}
    </li>
  );
}

const KEYS = ["milk", "eggs", "rice", "olive_oil", "pasta", "butter", "flour"];
function Compare({ stores }: { stores: Store[] }) {
  const { refresh } = useRefresh();
  const [key, setKey] = useState("milk");
  const res = useApi<{ results: CatalogEntry[]; errors: { provider: string; message: string }[] }>(`/products/search?canonicalKey=${key}`, 0);
  const pol = useApi<Policy>("/shopping/policies", 0);
  const label = (n: string) => stores.find((x) => x.name === n);
  const toggle = async (id: string) => {
    if (!pol.data) return;
    const on = pol.data.allowlistedProductIds.includes(id);
    await api("/shopping/policies", { method: "PUT", body: { allowlistedProductIds: on ? pol.data.allowlistedProductIds.filter((x) => x !== id) : [...pol.data.allowlistedProductIds, id] } });
    pol.reload(); refresh();
  };
  return (
    <Panel kicker="Catalogues" title="Compare across stores">
      <div className="mb-4 flex flex-wrap gap-1.5">{KEYS.map((k) => <button key={k} onClick={() => setKey(k)} className={clsx("rounded-full border px-3 py-1 text-[13px]", key === k ? "border-ink bg-ink text-paper" : "hair text-mute hover:text-ink")}>{human(k)}</button>)}</div>
      <Async state={res} rows={3}>
        {({ results, errors }) => (
          <>
            {errors.length > 0 && <p role="alert" className="mb-3 rounded-xl border border-accent/40 bg-accent/5 p-2.5 text-[13px]">{errors.map((e) => `${label(e.provider)?.label ?? e.provider} is not responding (${e.message}). Other stores are still shown.`).join(" ")}</p>}
            <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-[13.5px]">
              <thead><tr className="border-b hair font-mono text-[10.5px] uppercase tracking-[.14em] text-mute">{["Store / pack", "Price", "Per 100", "Stock", "Auto", ""].map((h, k) => <th key={k} className="py-2 pr-4 font-normal">{h}</th>)}</tr></thead>
              <tbody className="divide-y hair">
                {[...results].sort((a, b) => (a.product.packSize > 0 ? a.offer.priceMinor / a.product.packSize : 1e9) - (b.product.packSize > 0 ? b.offer.priceMinor / b.product.packSize : 1e9)).map((r) => {
                  const st = label(r.offer.provider); const allowed = pol.data?.allowlistedProductIds.includes(r.product.id);
                  return (
                    <tr key={r.product.id} className={clsx(!r.offer.available && "text-mute")}>
                      <td className="py-2 pr-4"><p>{r.product.brand} {r.product.packLabel}</p><p className="font-mono text-[11px] text-mute">{st?.label ?? r.offer.provider} · {st?.mode === "LIVE" ? "live prices" : "mock data"}</p></td>
                      <td className="pr-4 font-mono tnum">{money(r.offer.priceMinor, r.offer.currency)}</td>
                      <td className="pr-4 font-mono tnum">{r.product.packSize <= 0 ? "size unknown" : r.product.unit === "count" ? money(r.offer.priceMinor / r.product.packSize, r.offer.currency) + " ea" : money((r.offer.priceMinor / r.product.packSize) * 100, r.offer.currency)}</td>
                      <td className="pr-4">{r.offer.available ? <Pill tone="outline">In stock</Pill> : <Pill tone="outlineAccent">Out of stock</Pill>}</td>
                      <td className="pr-4"><button aria-pressed={!!allowed} onClick={() => toggle(r.product.id)} className={clsx("rounded-full border px-2.5 py-0.5 text-[12px]", allowed ? "border-ink bg-ink text-paper" : "hair text-mute hover:text-ink")}>{allowed ? "Allowed" : "Allow"}</button></td>
                      <td className="font-mono text-[11px] text-mute">{ago(r.offer.checkedAt)}</td>
                    </tr>
                  );
                })}
              </tbody></table></div>
          </>
        )}
      </Async>
      <p className="mt-3 text-[12px] text-mute">Only allowlisted products are ever prepared automatically. Live catalogues give no allergen data, so those always ask you first.</p>
    </Panel>
  );
}

export default function Shopping() {
  const orders = useApi<{ orders: Order[] }>("/shopping/orders", 3000);
  const meta = useApi<Meta>("/meta", 15000);
  return (
    <>
      <PageHeader kicker="Orders" title="What was bought, and why" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel kicker="Newest first" title="Orders">
          <Async state={orders}>{({ orders: o }) => o.length === 0 ? <Empty title="No orders yet" hint="When stock runs low the agent builds a basket, checks it against your limits, and lists it here. Use the demo controls on the Overview page." /> : <ul className="divide-y hair">{o.map((x) => <OrderCard key={x.id} o={x} instacart={!!meta.data?.instacart} />)}</ul>}</Async>
        </Panel>
        <Compare stores={meta.data?.stores ?? []} />
      </div>
    </>
  );
}
