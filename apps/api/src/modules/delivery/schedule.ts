import type { DeliveryCadence, DeliveryScheduleRow, Store } from "../../store/store";
import type { Clock } from "../../lib/clock";
import { INGREDIENT_DEFAULTS } from "../recipes/diet";

export const CADENCE_DAYS: Record<DeliveryCadence, number> = { ASAP: 0, DAILY: 1, EVERY_2_DAYS: 2, WEEKLY: 7 };
export const CADENCE_LABEL: Record<DeliveryCadence, string> = { ASAP: "as-needed", DAILY: "daily", EVERY_2_DAYS: "every-2-days", WEEKLY: "weekly" };
export const DEFAULT_ORDER_HOUR = 8;

export interface Horizon {
  cadence: DeliveryCadence; intervalDays: number; orderHour: number; anchorDate: string;
  nextSlotDate: string; daysUntil: number; dueNow: boolean;
}

const DAY = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const dayDiff = (a: string, b: string) => Math.round((utc(b) - utc(a)) / DAY);
export const addDays = (d: string, n: number) => new Date(utc(d) + n * DAY).toISOString().slice(0, 10);

/** The household's local calendar date and hour. */
export function localParts(now: Date, timeZone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

type ScheduleLike = Pick<DeliveryScheduleRow, "cadence" | "anchorDate" | "orderHour" | "lastPlacedSlot">;

/** Pure. Slots fall on anchorDate + k * interval. A slot already placed is skipped. */
export function computeHorizon(s: ScheduleLike | null, now: Date, timeZone: string): Horizon {
  const { date: today, hour } = localParts(now, timeZone);
  if (!s || s.cadence === "ASAP")
    return { cadence: "ASAP", intervalDays: 0, orderHour: s?.orderHour ?? DEFAULT_ORDER_HOUR, anchorDate: s?.anchorDate ?? today, nextSlotDate: today, daysUntil: 0, dueNow: false };
  const interval = CADENCE_DAYS[s.cadence];
  const diff = dayDiff(s.anchorDate, today);
  let next = diff <= 0 ? s.anchorDate : addDays(s.anchorDate, Math.ceil(diff / interval) * interval);
  if (s.lastPlacedSlot === next) next = addDays(next, interval);
  return { cadence: s.cadence, intervalDays: interval, orderHour: s.orderHour, anchorDate: s.anchorDate, nextSlotDate: next, daysUntil: dayDiff(today, next), dueNow: next === today && hour >= s.orderHour };
}

export async function horizonFor(store: Store, clock: Clock, householdId: string): Promise<Horizon> {
  const [row, hh] = await Promise.all([store.deliverySchedules.get(householdId), store.households.get(householdId)]);
  return computeHorizon(row ?? null, clock.now(), hh?.timezone ?? "Europe/London");
}

/**
 * An item belongs in the next delivery if it will not last until the delivery AFTER that one arrives:
 * usable <= daily * (daysUntilSlot + interval + lead + safety). With no rhythm this is the original formula.
 * Target quantity covers the gap between deliveries, capped by shelf life where known.
 */
export function cadenceAdjusted<P extends { canonicalKey: string; leadTimeDays: number; safetyDays: number; targetDays: number }>(
  p: P, h: { intervalDays: number; daysUntil: number },
): P {
  if (h.intervalDays === 0) return p;
  const wanted = Math.max(p.targetDays, h.intervalDays + p.leadTimeDays + p.safetyDays);
  const shelf = INGREDIENT_DEFAULTS[p.canonicalKey]?.shelfLifeDays ?? null;
  return { ...p, leadTimeDays: p.leadTimeDays + h.daysUntil + h.intervalDays, targetDays: shelf ? Math.min(wanted, shelf) : wanted };
}

/** Order-count limits that let a rhythm work. Spending caps are never touched. */
export function recommendedLimits(cadence: DeliveryCadence, cur: { maxOrdersPerWeek: number; cooldownHours: number }) {
  if (cadence === "ASAP") return { maxOrdersPerWeek: cur.maxOrdersPerWeek, cooldownHours: cur.cooldownHours };
  const interval = CADENCE_DAYS[cadence];
  return { maxOrdersPerWeek: Math.max(cur.maxOrdersPerWeek, Math.ceil(7 / interval) + 1), cooldownHours: Math.min(cur.cooldownHours, interval * 24 - 2) };
}