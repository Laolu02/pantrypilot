"use client";
import { useCallback, useContext, useEffect, useRef, useState, createContext } from "react";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api/v1";
const TOKEN = process.env.NEXT_PUBLIC_DEMO_TOKEN ?? "pp_demo_okafor";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string) { super(message); }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, ...init.headers },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Cannot reach the PantryPilot API. Is it running on port 4000?");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.code ?? "ERROR", json.message ?? `Request failed (${res.status})`, json.requestId);
  return json as T;
}

export const RefreshContext = createContext<{ version: number; refresh: () => void }>({ version: 0, refresh: () => {} });
export const useRefresh = () => useContext(RefreshContext);

export interface ApiState<T> { data: T | null; error: ApiError | null; loading: boolean; reload: () => void }

/** Polls (SSE is not implemented) and reloads whenever any action calls refresh(). */
export function useApi<T>(path: string | null, intervalMs = 4000): ApiState<T> {
  const { version } = useRefresh();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!path) return;
    let stop = false;
    const run = async () => {
      try {
        const d = await api<T>(path);
        if (!stop && alive.current) { setData(d); setError(null); }
      } catch (e) {
        if (!stop && alive.current) setError(e instanceof ApiError ? e : new ApiError(0, "ERROR", "Unexpected error"));
      } finally {
        if (!stop && alive.current) setLoading(false);
      }
    };
    run();
    const id = intervalMs > 0 ? setInterval(run, intervalMs) : undefined;
    return () => { stop = true; if (id) clearInterval(id); };
  }, [path, version, tick, intervalMs]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
