"use client";
import clsx from "clsx";
import { motion } from "framer-motion";
import { Cpu, CookingPot, Package, Pulse, ShoppingCart, SlidersHorizontal, SquaresFour } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApi } from "@/lib/api";
import type { Meta } from "@/lib/types";

const NAV = [
  { href: "/", label: "Overview", icon: SquaresFour },
  { href: "/inventory", label: "Pantry", icon: Package },
  { href: "/meals", label: "Meals", icon: CookingPot },
  { href: "/shopping", label: "Orders", icon: ShoppingCart },
  { href: "/devices", label: "Devices", icon: Cpu },
  { href: "/policies", label: "Limits", icon: SlidersHorizontal },
  { href: "/activity", label: "Trace", icon: Pulse },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const meta = useApi<Meta>("/meta", 15000);
  const live = !!meta.data?.anyLive;
  return (
    <div className="min-h-[100dvh]">
      <div className={clsx("sticky top-0 z-30 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 px-4 py-1.5 text-center font-mono text-[11px] uppercase tracking-[.14em]", live ? "bg-ink text-paper" : "bg-accent text-white")}>
        <span className="font-semibold">{live ? "Live stores connected" : "Demo / mock"}</span>
        <span className="opacity-80">
          {meta.data ? [...meta.data.stores.map((x) => (x.mode === "MOCK" ? x.label : `${x.label} live`)), meta.data.payments.label].join(" · ") : "connecting"}
          {" "}— {live ? "stores without an order API only get a prepared cart; you check out" : meta.data?.payments.mode === "LIVE" ? "real payments enabled" : "nothing here moves real money"}
        </span>
      </div>
      <div className="mx-auto grid max-w-[1500px] md:grid-cols-[212px_minmax(0,1fr)]">
        <aside className="hidden md:block">
          <nav className="sticky top-[30px] flex h-[calc(100dvh-30px)] flex-col px-4 py-7">
            <Link href="/" className="mb-9 block">
              <span className="block text-[22px] font-semibold leading-none tracking-tighter">PantryPilot</span>
              <span className="mt-1 block font-mono text-[10.5px] uppercase tracking-[.16em] text-mute">Okafor-Brandt kitchen</span>
            </Link>
            <ul className="space-y-0.5">
              {NAV.map((n) => {
                const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
                return (
                  <li key={n.href}>
                    <Link href={n.href} className={clsx("relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-[14px] transition-colors", active ? "text-paper" : "text-mute hover:text-ink")}>
                      {active && <motion.span layoutId="rail" className="absolute inset-0 rounded-xl bg-ink" transition={{ type: "spring", stiffness: 300, damping: 30 }} />}
                      <n.icon className="relative" /><span className="relative">{n.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="mt-auto font-mono text-[10.5px] leading-relaxed text-mute">Acts inside limits you set.<br />Every action is traced.</p>
          </nav>
        </aside>
        <main className="min-w-0 px-4 pb-28 pt-7 md:px-9 md:pb-16">{children}</main>
      </div>
      <nav className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-7 rounded-2xl border border-ink2 bg-ink p-1 md:hidden">
        {NAV.map((n) => {
          const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
          return <Link key={n.href} href={n.href} aria-label={n.label} className={clsx("flex justify-center rounded-xl py-2.5", active ? "bg-paper text-ink" : "text-paper/60")}><n.icon size={19} /></Link>;
        })}
      </nav>
    </div>
  );
}
