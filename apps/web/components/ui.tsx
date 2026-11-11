"use client";
import clsx from "clsx";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { ArrowClockwise, Tray, WarningDiamond } from "@phosphor-icons/react";
import { useRef } from "react";
import type { ApiState } from "@/lib/api";

export function Panel({ title, kicker, action, dark, children, className, pad = true }: {
  title?: string; kicker?: string; action?: React.ReactNode; dark?: boolean; children: React.ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={clsx("rounded-[1.4rem] border", dark ? "border-ink2 bg-ink text-paper shadow-lift" : "hair bg-card/80 shadow-lift", className)}>
      {(title || action) && (
        <header className={clsx("flex items-end justify-between gap-4 px-5 pt-5", !pad && "pb-4")}>
          <div>
            {kicker && <p className={clsx("font-mono text-[10.5px] uppercase tracking-[.16em]", dark ? "text-paper/50" : "text-mute")}>{kicker}</p>}
            {title && <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      <div className={clsx(pad && "p-5", title && pad && "pt-4")}>{children}</div>
    </section>
  );
}

const tones = {
  ink: "bg-ink text-paper border-ink",
  accent: "bg-accent text-white border-accent",
  outlineAccent: "border-accent text-accent",
  outline: "border-ink/30 text-ink",
  ghost: "border-line text-mute",
  onDark: "border-paper/25 text-paper/80",
} as const;
export function Pill({ tone = "ghost", children, className }: { tone?: keyof typeof tones; children: React.ReactNode; className?: string }) {
  return <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-[2px] font-mono text-[10.5px] uppercase tracking-[.08em]", tones[tone], className)}>{children}</span>;
}

export function StateBadge({ state }: { state: string }) {
  const map: Record<string, keyof typeof tones> = {
    SUCCEEDED: "ink", DELIVERED: "ink", CONFIRMED: "ink", ALLOW: "ink", IN_TRANSIT: "outline", APPROVED: "outline", ONLINE: "ink",
    BLOCKED: "accent", FAILED: "accent", DENY: "accent", CANCELLED: "ghost", OFFLINE: "accent",
    POLICY_REVIEW: "outlineAccent", HANDOFF: "outlineAccent", AWAITING_OWNER: "outlineAccent", PENDING_REVIEW: "outlineAccent", REVIEW: "outlineAccent", NEEDS_RECONCILIATION: "outlineAccent", UNCERTAIN: "outlineAccent", STALE: "outlineAccent",
  };
  return <Pill tone={map[state] ?? "ghost"}>{state.replace(/_/g, " ")}</Pill>;
}

export function MockBadge({ mock = true }: { mock?: boolean }) {
  return mock ? <Pill tone="outlineAccent" className="font-semibold">Demo / mock</Pill> : <Pill tone="ink">Live store</Pill>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("relative overflow-hidden rounded-lg bg-sunk", className)}><div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-paper/70 to-transparent" /></div>;
}

export function Empty({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-2xl border border-dashed hair px-5 py-8">
      <Tray size={22} className="text-mute" />
      <p className="font-medium">{title}</p>
      {hint && <p className="max-w-[46ch] text-sm text-mute">{hint}</p>}
      {children}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: { message: string; status?: number }; retry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-2xl border border-accent/40 bg-accent/5 p-4">
      <WarningDiamond size={20} className="mt-0.5 shrink-0 text-accent" />
      <div className="flex-1">
        <p className="font-medium">Something went wrong</p>
        <p className="text-sm text-mute">{error.message}</p>
      </div>
      {retry && <Btn variant="quiet" onClick={retry}><ArrowClockwise size={15} />Retry</Btn>}
    </div>
  );
}

export function Async<T>({ state, children, rows = 3 }: { state: ApiState<T>; children: (d: T) => React.ReactNode; rows?: number }) {
  if (state.data) return <>{children(state.data)}</>;
  if (state.error) return <ErrorState error={state.error} retry={state.reload} />;
  return <div className="space-y-2">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>;
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "solid" | "accent" | "quiet" | "danger"; busy?: boolean };
export function Btn({ variant = "solid", busy, className, children, disabled, ...p }: BtnProps) {
  const v = {
    solid: "bg-ink text-paper hover:bg-ink2",
    accent: "bg-accent text-white hover:brightness-95",
    quiet: "border hair bg-transparent hover:bg-sunk",
    danger: "border border-accent text-accent hover:bg-accent hover:text-white",
  }[variant];
  return (
    <button {...p} disabled={disabled || busy} className={clsx("inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-medium transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50", v, className)}>
      {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
      {children}
    </button>
  );
}

/** Primary actions lean toward the cursor. Springs, not easing. */
export function MagneticBtn({ children, className, ...p }: BtnProps) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useSpring(useMotionValue(0), { stiffness: 150, damping: 15, mass: 0.1 });
  const y = useSpring(useMotionValue(0), { stiffness: 150, damping: 15, mass: 0.1 });
  return (
    <motion.div ref={ref} style={{ x, y }} className="inline-block"
      onMouseMove={(e) => { const r = ref.current!.getBoundingClientRect(); x.set((e.clientX - (r.left + r.width / 2)) * 0.18); y.set((e.clientY - (r.top + r.height / 2)) * 0.25); }}
      onMouseLeave={() => { x.set(0); y.set(0); }}>
      <Btn variant="accent" className={className} {...p}>{children}</Btn>
    </motion.div>
  );
}

export function Meter({ value, max, tone = "ink" }: { value: number; max: number; tone?: "ink" | "accent" }) {
  const pct = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunk" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <motion.div className={clsx("h-full rounded-full", tone === "accent" ? "bg-accent" : "bg-ink")} initial={{ width: 0 }} animate={{ width: `${pct}%` }} />
    </div>
  );
}

export function PageHeader({ kicker, title, children }: { kicker: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[.18em] text-mute">{kicker}</p>
        <h1 className="mt-1 text-[clamp(1.7rem,3vw,2.3rem)] font-semibold leading-none tracking-tighter">{title}</h1>
      </div>
      {children}
    </div>
  );
}

/** Perpetual, isolated micro-animation: a live-status dot. */
export function LiveDot({ on }: { on: boolean }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {on && <span className="absolute inset-0 animate-pulseRing rounded-full bg-ink/40" />}
      <span className={clsx("relative h-2.5 w-2.5 rounded-full", on ? "bg-ink" : "bg-accent")} />
    </span>
  );
}
