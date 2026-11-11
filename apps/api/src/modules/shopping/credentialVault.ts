import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Store } from "../../store/store";
import type { Clock } from "../../lib/clock";
import { newId } from "../../lib/ids";

/** AES-256-GCM at rest. Plaintext tokens never leave the server and are never logged or sent to the browser. */
export class CredentialVault {
  private key: Buffer;
  /**
   * `filePath` (optional) persists the already-encrypted rows so connections survive API restarts while the rest of the
   * store is in memory. Only used with a stable INTEGRATION_ENCRYPTION_KEY; the file is useless without it.
   */
  constructor(private store: Store, private clock: Clock, keyB64?: string, private filePath?: string) {
    this.key = keyB64 ? Buffer.from(keyB64, "base64") : randomBytes(32);
    if (this.key.length !== 32) throw new Error("INTEGRATION_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
    if (filePath && keyB64 && existsSync(filePath)) {
      try { for (const r of JSON.parse(readFileSync(filePath, "utf8"))) void store.credentials.insert(r); } catch { /* unreadable file: start unconnected */ }
    }
  }
  private async persist() {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(await this.store.credentials.list()), { mode: 0o600 });
    renameSync(tmp, this.filePath);
  }
  async put(householdId: string, provider: string, value: object) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
    const row = { householdId, provider, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ciphertext: ct.toString("base64"), updatedAt: this.clock.now().toISOString() };
    const cur = await this.store.credentials.find((r) => r.householdId === householdId && r.provider === provider);
    if (cur) await this.store.credentials.update(cur.id, row); else await this.store.credentials.insert({ id: newId("cred"), ...row });
    await this.persist();
  }
  async get<T = any>(householdId: string, provider: string): Promise<T | null> {
    const r = await this.store.credentials.find((x) => x.householdId === householdId && x.provider === provider);
    if (!r) return null;
    try { return this.decrypt<T>(r); } catch { return null; } // key changed or file damaged: treat as not connected
  }
  private decrypt<T>(r: { iv: string; tag: string; ciphertext: string }): T {
    const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(r.iv, "base64"));
    d.setAuthTag(Buffer.from(r.tag, "base64"));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(r.ciphertext, "base64")), d.final()]).toString("utf8")) as T;
  }
  async has(householdId: string, provider: string) { return !!(await this.store.credentials.find((x) => x.householdId === householdId && x.provider === provider)); }
  async delete(householdId: string, provider: string) {
    const r = await this.store.credentials.find((x) => x.householdId === householdId && x.provider === provider);
    if (r) await this.store.credentials.remove(r.id);
    await this.persist();
  }
}