"use client";
import { useState } from "react";
import { Async, Btn, LiveDot, PageHeader, Panel, Pill, StateBadge } from "@/components/ui";
import { api, useApi, useRefresh } from "@/lib/api";
import { ago } from "@/lib/format";
import type { Device } from "@/lib/types";

const SCEN = [
  ["LOW_MILK", "Low milk (fridge)"], ["LOW_OLIVE_OIL", "Low olive oil (pantry scale)"], ["REPLAY_LAST", "Replay last event"],
  ["STALE_MILK", "Older reading arrives late"], ["IMPLAUSIBLE_MILK", "Impossible quantity"], ["LOW_CONFIDENCE_MILK", "Low sensor confidence"],
];
export default function Devices() {
  const { refresh } = useRefresh();
  const d = useApi<{ devices: Device[] }>("/devices", 4000);
  const [res, setRes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const send = async (s: string) => {
    setBusy(s);
    try { const r = await api<any>("/devices/simulate", { body: { scenario: s } }); setRes((p) => ({ ...p, [s]: `${r.ingest.status}${r.ingest.detail ? ` · ${r.ingest.detail}` : ""}` })); }
    catch (e) { setRes((p) => ({ ...p, [s]: (e as Error).message })); }
    setBusy(null); refresh();
  };
  return (
    <>
      <PageHeader kicker="Devices" title="Sensors and connectivity" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel kicker="Registered" title="Connected devices">
          <Async state={d} rows={2}>{({ devices }) => (
            <ul className="divide-y hair">{devices.map((x) => (
              <li key={x.id} className="flex items-center gap-4 py-4"><LiveDot on={x.status === "ONLINE"} />
                <div className="min-w-0 flex-1"><p className="font-medium">{x.name}</p><p className="font-mono text-[11px] text-mute">{x.provider}:{x.externalId} · last seen {ago(x.lastSeenAt)}</p></div><StateBadge state={x.status} /></li>))}</ul>)}
          </Async>
          <p className="mt-4 rounded-xl bg-sunk/70 p-3 text-[13px] text-mute">Both devices are <b className="text-ink">simulated</b>. Events are signed (HMAC) and verified, the household is taken from the registered device, and each event id is applied at most once. A real appliance integration would plug in behind the same adapter.</p>
        </Panel>
        <Panel kicker="Simulator" title="Send an event" action={<Pill tone="outlineAccent">Demo only</Pill>}>
          <ul className="divide-y hair">{SCEN.map(([id, label]) => (
            <li key={id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="text-[14px]">{label}</p>{res[id!] && <p className="font-mono text-[11px] text-mute">{res[id!]}</p>}</div><Btn variant="quiet" busy={busy === id} onClick={() => send(id!)}>Send</Btn></li>))}</ul>
        </Panel>
      </div>
    </>
  );
}
