import { ProviderError } from "./commerce/commerce";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export interface HttpOpts { timeoutMs?: number; retries?: number; sleep?: (ms: number) => Promise<void>; allowedHosts: string[] }
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Every outbound call goes through here: pinned hosts only (no arbitrary URLs), hard timeout,
 * bounded retries for idempotent GETs, and errors that never include response bodies or headers.
 */
export async function httpJson<T = any>(f: FetchLike, url: string, init: RequestInit & { raw?: boolean }, o: HttpOpts): Promise<T | null> {
  const host = new URL(url).host;
  if (!o.allowedHosts.includes(host)) throw new ProviderError("HOST_NOT_ALLOWED", `Refusing to call ${host}`);
  const method = (init.method ?? "GET").toUpperCase();
  const attempts = method === "GET" ? (o.retries ?? 2) + 1 : 1;
  let last: ProviderError = new ProviderError("UNKNOWN", "request failed");
  for (let i = 0; i < attempts; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), o.timeoutMs ?? 8000);
    try {
      const res = await f(url, { ...init, signal: ac.signal });
      clearTimeout(t);
      if (res.status === 429 || res.status >= 500) { last = new ProviderError(`HTTP_${res.status}`, `${host} returned ${res.status}`); await (o.sleep ?? realSleep)(200 * 2 ** i); continue; }
      if (!res.ok) {
        // Keep ONLY a whitelist of non-sensitive diagnostic fields; never the raw body.
        let detail: { name?: string; issue?: string; debugId?: string } | undefined;
        try {
          const b = await res.clone().json();
          const cap = (v: unknown) => (typeof v === "string" ? v.replace(/[^A-Za-z0-9_\- ]/g, "").slice(0, 80) : undefined);
          detail = { name: cap(b?.name ?? b?.error), issue: cap(b?.details?.[0]?.issue), debugId: cap(b?.debug_id) };
        } catch { /* not JSON */ }
        throw new ProviderError(`HTTP_${res.status}`, `${host} returned ${res.status}`, detail);
      }
      if (res.status === 204) return null;
      return (await res.json()) as T;
    } catch (e) {
      clearTimeout(t);
      if (e instanceof ProviderError) { if (e.code.startsWith("HTTP_4")) throw e; last = e; }
      else last = new ProviderError("NETWORK", `${host} unreachable or timed out`);
      if (i < attempts - 1) await (o.sleep ?? realSleep)(200 * 2 ** i);
    }
  }
  throw last;
}