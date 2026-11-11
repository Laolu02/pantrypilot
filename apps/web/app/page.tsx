"use client";
import { motion } from "framer-motion";
import { Power, Siren } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import ScenarioPanel from "@/components/scenario";
import { TraceList, groupTraces } from "@/components/trace";
import { Async, Btn, Empty, LiveDot, Meter, MockBadge, PageHeader, Panel, Pill, StateBadge } from "@/components/ui";
import { api, useApi, useRefresh } from "@/lib/api";
import { ago, daysUntil, money, qty } from "@/lib/format";
import type { Audit, Device, Item, Order, Policy, Recipe, Run } from "@/lib/types";

function PaymentNotice() {
  const info = useApi<{ payments: { label: string; requiresConnection: boolean; connected: boolean } }>("/integrations", 6000);
  const p = info.data?.payments;
  if (!p || !p.requiresConnection || p.connected) return null;
  return (
    <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/50 bg-accent/5 px-5 py-4">
      <div><p className="font-medium">{p.label} is not connected, so nothing can be bought yet</p><p className="text-[13px] text-mute">Orders will be blocked until you connect. Your money stays in PayPal until a store confirms an order.</p></div>
      <Link href="/policies" className="rounded-xl bg-ink px-3.5 py-2 text-[13px] font-medium text-paper hover:bg-ink2">Connect PayPal</Link>
    </div>
  );
}

export default function Overview() {
  const { refresh } = useRefresh();
  const inv = useApi<{ items: Item[] }>("/inventory");
  const act = useApi<{ events: Audit[]; runs: Run[] }>("/agent/activity", 2500);
  const orders = useApi<{ orders: Order[] }>("/shopping/orders");
  const devices = useApi<{ devices: Device[] }>("/devices", 6000);
  const policy = useApi<Policy>("/shopping/policies");
  const meals = useApi<{ recommendations: Recipe[] }>("/recipes/recommend", 0);
  const [stopping, setStopping] = useState(false);

  const toggleStop = async () => {
    if (!policy.data) return;
    setStopping(true);
    try { await api("/shopping/kill-switch", { body: { enabled: !policy.data.killSwitch } }); } finally { setStopping(false); refresh(); }
  };
  const p = policy.data;
  const autonomy = !p ? "…" : p.killSwitch ? "Stopped" : p.enabled && p.mode === "BOUNDED_AUTONOMY" ? "Autonomous within limits" : "Asks before buying";

  return (
    <>
      <PageHeader kicker="Overview" title="Kitchen operations">
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 text-[13px] text-mute sm:flex"><LiveDot on={!!p && !p.killSwitch} />{autonomy}</span>
          <Btn variant={p?.killSwitch ? "solid" : "danger"} busy={stopping} onClick={toggleStop} aria-pressed={!!p?.killSwitch}>
            {p?.killSwitch ? <><Power size={15} />Resume purchasing</> : <><Siren size={15} />Emergency stop</>}
          </Btn>
        </div>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <PaymentNotice />
        <div className="space-y-6">
          <Panel dark kicker="Most recent trace" title="What the agent just did">
            <Async state={act} rows={4}>
              {(d) => {
                const g = groupTraces(d.events)[0];
                const run = d.runs.find((r) => r.correlationId === g?.id);
                if (!g) return <Empty title="Nothing has happened yet" hint="Send the fridge event from the demo controls and watch each step appear here, from sensor to verified order." />;
                return (
                  <div className="space-y-4">
                    {run && <div className="flex flex-wrap items-center gap-2"><StateBadge state={run.state} />{run.summary && <p className="text-[13px] text-paper/70">{run.summary}</p>}</div>}
                    <TraceList events={g.events} dark />
                  </div>
                );
              }}
            </Async>
          </Panel>

          <Panel kicker="Stock" title="Needs attention" action={<Link href="/inventory" className="text-[13px] text-mute underline-offset-4 hover:underline">All stock</Link>}>
            <Async state={inv}>
              {({ items }) => {
                const rows = items.filter((i) => i.forecast?.needsReplenishment || (daysUntil(i.expiresAt) ?? 99) <= 3);
                if (!rows.length) return <Empty title="All stocked up" hint={`${items.length} items are above their reorder points and none expire in the next 3 days.`} />;
                return (
                  <ul className="divide-y hair">
                    {rows.map((i, n) => {
                      const low = i.forecast?.needsReplenishment; const exp = daysUntil(i.expiresAt);
                      return (
                        <motion.li key={i.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: n * 0.05 }} className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-1.5 py-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
                          <div className="min-w-0"><p className="truncate font-medium">{i.name}</p><p className="font-mono text-[12px] tnum text-mute">{qty(i.quantity, i.unit)} on hand{i.inboundQty > 0 && <span className="text-ink"> · +{qty(i.inboundQty, i.unit)} on order</span>}</p></div>
                          <div className="col-span-2 order-last sm:order-none sm:col-span-1">{i.forecast && i.forecast.daysOfSupply != null && <><Meter value={i.forecast.daysOfSupply} max={7} tone={low ? "accent" : "ink"} /><p className="mt-1 font-mono text-[11px] text-mute">{i.forecast.daysOfSupply.toFixed(1)} days of supply</p></>}</div>
                          <div className="flex flex-col items-end gap-1">{low && <Pill tone="outlineAccent">Low</Pill>}{exp != null && exp <= 3 && <Pill tone="outline">Expires {exp <= 0 ? "today" : `in ${Math.ceil(exp)} d`}</Pill>}</div>
                        </motion.li>
                      );
                    })}
                  </ul>
                );
              }}
            </Async>
          </Panel>

          <Panel kicker="Meals" title="Cook from what you have" action={<Link href="/meals" className="text-[13px] text-mute underline-offset-4 hover:underline">All meals</Link>}>
            <Async state={meals}>
              {({ recommendations }) => (
                <ul className="divide-y hair">
                  {recommendations.slice(0, 3).map((r) => (
                    <li key={r.id} className="py-3">
                      <div className="flex items-center justify-between gap-3"><p className="font-medium">{r.name}</p><span className="font-mono text-[11px] uppercase tracking-wider text-mute">{r.cuisine}</span></div>
                      <p className="mt-0.5 text-[13px] text-mute">{r.explanation}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Async>
          </Panel>
        </div>

        <div className="space-y-6">
          <ScenarioPanel />
          <Panel kicker="Orders" title="Recent orders" action={<Link href="/shopping" className="text-[13px] text-mute underline-offset-4 hover:underline">All orders</Link>}>
            <Async state={orders} rows={2}>
              {({ orders: o }) => o.length === 0 ? <Empty title="No orders yet" hint="Orders appear here with the policy decision behind each one." /> : (
                <ul className="divide-y hair">
                  {o.slice(0, 4).map((x) => (
                    <li key={x.id} className="space-y-1.5 py-3">
                      <div className="flex items-center justify-between gap-2"><p className="truncate text-[14px] font-medium">{x.basket.lines[0]?.name}</p><span className="font-mono tnum text-[13px]">{money(x.basket.totalMinor, x.basket.currency)}</span></div>
                      <div className="flex flex-wrap items-center gap-1.5"><StateBadge state={x.status} />{x.mock && <MockBadge />}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Async>
          </Panel>
          <Panel kicker="Hardware" title="Devices">
            <Async state={devices} rows={2}>
              {({ devices: d }) => (
                <ul className="space-y-3">
                  {d.map((x) => (
                    <li key={x.id} className="flex items-center gap-3"><LiveDot on={x.status === "ONLINE"} /><div className="min-w-0 flex-1"><p className="truncate text-[14px]">{x.name}</p><p className="font-mono text-[11px] text-mute">seen {ago(x.lastSeenAt)}</p></div><StateBadge state={x.status} /></li>
                  ))}
                </ul>
              )}
            </Async>
          </Panel>
        </div>
      </div>
    </>
  );
}
