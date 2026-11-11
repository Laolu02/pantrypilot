"use client";
import { IconContext } from "@phosphor-icons/react";
import { MotionConfig } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshContext } from "@/lib/api";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  // Live updates over SSE; polling in useApi remains as the fallback if the stream drops.
  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_DEMO_TOKEN ?? "pp_demo_okafor";
    const es = new EventSource(`${process.env.NEXT_PUBLIC_API_BASE ?? "/api/v1"}/events/stream?token=${encodeURIComponent(token)}`);
    es.addEventListener("audit", () => { clearTimeout(timer.current); timer.current = setTimeout(refresh, 150); });
    return () => { es.close(); clearTimeout(timer.current); };
  }, [refresh]);
  const value = useMemo(() => ({ version, refresh }), [version, refresh]);
  return (
    <RefreshContext.Provider value={value}>
      <IconContext.Provider value={{ size: 18, weight: "regular" }}>
        <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 100, damping: 20 }}>{children}</MotionConfig>
      </IconContext.Provider>
    </RefreshContext.Provider>
  );
}
