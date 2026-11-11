import type { AuditEvent, AuditStage, Store } from "../../store/store";
import type { Clock } from "../../lib/clock";
import { newId } from "../../lib/ids";
import { redact } from "../../lib/redact";
import { EventEmitter } from "node:events";

export interface AuditInput {
  householdId: string; actor: string; action: string; resourceType: string; resourceId: string;
  correlationId: string; stage: AuditStage; outcome?: "OK" | "WARN" | "FAIL"; reason?: string; details?: unknown;
}

/** Append-only. There is intentionally no update or delete. */
export class AuditService {
  private seq = 0;
  readonly bus = new EventEmitter();
  constructor(private store: Store, private clock: Clock) {}
  async record(e: AuditInput): Promise<AuditEvent> {
    const row = await this.store.audit.insert({
      id: newId("aud"), ...e, outcome: e.outcome ?? "OK",
      details: redact(e.details ?? {}), at: this.clock.now().toISOString(), seq: ++this.seq,
    });
    this.bus.emit("audit", row);
    return row;
  }
  async recent(householdId: string, limit = 200): Promise<AuditEvent[]> {
    const rows = await this.store.audit.list((r) => r.householdId === householdId);
    return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.seq - a.seq)).slice(0, limit);
  }
}
