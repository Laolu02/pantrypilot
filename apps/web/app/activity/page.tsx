"use client";
import { TraceList, groupTraces } from "@/components/trace";
import { Async, Empty, PageHeader, Panel, StateBadge } from "@/components/ui";
import { useApi } from "@/lib/api";
import { ago, human } from "@/lib/format";
import type { Audit, Run } from "@/lib/types";

export default function Activity() {
  const act = useApi<{ events: Audit[]; runs: Run[] }>("/agent/activity", 2500);
  return (
    <>
      <PageHeader kicker="Trace" title="Everything it did, in order" />
      <Async state={act} rows={5}>
        {({ events, runs }) => {
          const groups = groupTraces(events);
          if (!groups.length) return <Empty title="No activity yet" hint="Each device event, forecast, product choice, policy decision and order attempt is recorded here with a shared correlation id." />;
          return (
            <div className="space-y-6">
              {groups.map((g) => {
                const run = runs.find((r) => r.correlationId === g.id);
                return (
                  <Panel key={g.id} kicker={`trace ${g.id.slice(-8)} · ${ago(g.events[0]!.at)}`} title={run ? (run.outcome ? human(run.outcome) : "In progress") : "Device event"} action={run && <StateBadge state={run.state} />}>
                    {run?.summary && <p className="mb-4 max-w-[75ch] text-[14px] text-mute">{run.summary}</p>}
                    <TraceList events={g.events} />
                  </Panel>
                );
              })}
            </div>
          );
        }}
      </Async>
    </>
  );
}
