"use client";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Minus, Plus, ShieldWarning } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { Async, Btn, PageHeader, Panel, Pill } from "@/components/ui";
import { FoodRules } from "@/components/meals/FoodRules";
import { api, useApi } from "@/lib/api";
import { human } from "@/lib/format";
import type { Recipe } from "@/lib/types";

interface Subs { substitutions: { missing: string; name: string; note?: string; options: { name: string; reason: string; allowed: boolean; inStock: boolean; uncertainty: string; quantityNeeded: number | null }[] }[] }

type MealType = "breakfast" | "lunch" | "dinner" | "snack";
type Source = "HOME_MADE" | "DELIVERY";
interface LogEntry { id: string; name: string; mealType: MealType; source: Source; recipeId: string | null; eatenAt: string }
interface PantryUse { canonicalKey: string; name: string; used: number; unit: string; left: number | null; note?: string }
interface LogResult { entry: LogEntry; pantry: PantryUse[] }
interface Had extends Recipe { lastHadAt: string; lastHadSource: Source; availableAgainAt: string }
interface RecData { recommendations: Recipe[]; rejected: Recipe[]; recentlyHad?: Had[] }
interface LogBody { mealType: MealType; source: Source; recipeId?: string; name?: string }

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack"];
const MEAL_LABEL: Record<MealType, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };
const SOURCE_LABEL: Record<Source, string> = { HOME_MADE: "Home-made", DELIVERY: "Delivery" };

const guessMeal = (): MealType => { const h = new Date().getHours(); return h < 11 ? "breakfast" : h < 15 ? "lunch" : h < 21 ? "dinner" : "snack"; };
const mealFor = (r: Recipe, preferred: MealType): MealType => {
  const own = r.tags.filter((t): t is MealType => (MEAL_TYPES as string[]).includes(t));
  return own.includes(preferred) ? preferred : own[0] ?? preferred;
};
const ago = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};
const backOn = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? "later today" : d.toLocaleDateString(undefined, { weekday: "long" });
};
const qty = (n: number, unit: string) => `${n}${unit === "count" ? "" : " " + unit}`;
const pantryNote = (name: string, use: PantryUse[]) => {
  const used = use.filter((u) => u.used > 0);
  const missing = use.filter((u) => u.note === "not in pantry").map((u) => u.name);
  if (used.length === 0 && missing.length === 0) return `Logged ${name}.`;
  return `Logged ${name}.` +
    (used.length ? ` Pantry updated: ${used.map((u) => `${u.name} −${qty(u.used, u.unit)} (${u.left} left)`).join(", ")}.` : "") +
    (missing.length ? ` Not in your pantry: ${missing.join(", ")}.` : "");
};

const field = "rounded-lg border hair bg-card/80 px-3 py-2 text-[14px] outline-none focus:ring-1";

function RecipeRow({ r, preferred, onLog, onHide }: {
  r: Recipe; preferred: MealType;
  onLog: (r: Recipe, source: Source, meal: MealType) => Promise<void>;
  onHide: (r: Recipe) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [subs, setSubs] = useState<Subs | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [logging, setLogging] = useState<Source | "HIDE" | null>(null);
  const loadSubs = async () => { try { setSubs(await api<Subs>(`/recipes/${r.id}/substitutions`, { body: { missing: r.missingIngredients } })); } catch (e) { setErr((e as Error).message); } };
  const run = async (kind: Source | "HIDE", fn: () => Promise<void>) => {
    if (logging) return;
    setLogging(kind); setErr(null);
    try { await fn(); } catch (e) { setErr((e as Error).message); setLogging(null); }
  };
  return (
    <li className="py-1">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="grid w-full grid-cols-[1fr_auto] items-start gap-4 py-3 text-left">
        <div>
          <div className="flex flex-wrap items-center gap-2"><p className="text-[16px] font-medium tracking-tight">{r.name}</p>{r.feasible ? <Pill tone="ink">Have everything</Pill> : <Pill tone="outline">Missing {r.missingIngredients.length}</Pill>}{r.validation.status === "REVIEW" && <Pill tone="outlineAccent">Check labels</Pill>}</div>
          <p className="mt-1 max-w-[70ch] text-[13px] text-mute">{r.explanation}</p>
        </div>
        <span className="font-mono text-[11px] uppercase tracking-wider text-mute">{r.cuisine}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="grid gap-6 pb-5 pt-1 md:grid-cols-[1.1fr_1fr]">
              <div>
                <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[.14em] text-mute">Ingredients for {r.servings}</p>
                <ul className="space-y-1 text-[14px]">
                  {r.ingredients.map((i) => (
                    <li key={i.canonicalKey} className="flex justify-between gap-3 border-b border-dashed hair py-1"><span className={clsx(i.missing > 0 && !i.optional && "text-accent")}>{i.name}{i.optional && " (optional)"}</span><span className="font-mono tnum text-mute">{i.required} {i.unit === "count" ? "" : i.unit}{i.missing > 0 && !i.optional && ` · short ${Math.round(i.missing)}`}</span></li>
                  ))}
                </ul>
                <p className="mt-3 font-mono text-[11px] text-mute">≈ {r.nutritionPerServing.kcal} kcal · {r.nutritionPerServing.proteinG} g protein per serving. {r.nutritionPerServing.note}</p>
              </div>
              <div>
                <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[.14em] text-mute">Method</p>
                <ol className="list-decimal space-y-1.5 pl-5 text-[14px]">{r.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                {r.missingIngredients.length > 0 && !subs && <Btn variant="quiet" className="mt-4" onClick={loadSubs}>Suggest substitutions</Btn>}
                {err && <p className="mt-2 text-sm text-accent">{err}</p>}
                {subs && (
                  <div className="mt-4 space-y-3">
                    {subs.substitutions.map((s) => (
                      <div key={s.missing}><p className="text-[13px] font-medium">Instead of {s.name.toLowerCase()}</p>
                        {s.options.length === 0 && <p className="text-[13px] text-mute">{s.note}</p>}
                        {s.options.map((o) => <p key={o.name} className={clsx("text-[13px]", o.allowed ? "text-mute" : "text-accent line-through decoration-accent/50")}>{o.name}: {o.reason} <span className="font-mono text-[11px]">({o.uncertainty.toLowerCase()} certainty{o.inStock ? ", in stock" : ""})</span></p>)}
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-dashed hair pt-4">
                  <Btn onClick={() => run("HOME_MADE", () => onLog(r, "HOME_MADE", mealFor(r, preferred)))}>{logging === "HOME_MADE" ? "Saving…" : "I'm cooking this"}</Btn>
                  <Btn variant="quiet" onClick={() => run("DELIVERY", () => onLog(r, "DELIVERY", mealFor(r, preferred)))}>{logging === "DELIVERY" ? "Saving…" : "Having this delivered"}</Btn>
                  <Btn variant="quiet" onClick={() => run("HIDE", () => onHide(r))}>{logging === "HIDE" ? "Hiding…" : "Not for me"}</Btn>
                </div>
                <p className="mt-2 text-[12px] text-mute">Cooking takes the ingredients out of your pantry. Either way, this meal rests for 2 days.</p>
              </div>
            </div>
            <p className="pb-3 text-[12px] text-mute">{r.validation.disclaimer}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function LogPanel({ log, recipes, servings, onAdd, onUndo }: {
  log: LogEntry[]; recipes: Recipe[]; servings: number;
  onAdd: (b: LogBody) => Promise<void>; onUndo: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [mealType, setMealType] = useState<MealType>(guessMeal());
  const [source, setSource] = useState<Source>("DELIVERY");
  const [name, setName] = useState("");
  const [recipeId, setRecipeId] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const recent = log.filter((e) => Date.now() - new Date(e.eatenAt).getTime() < 2 * 86400000);
  const canSave = !!recipeId || name.trim().length > 0;
  const submit = async () => {
    if (!canSave || saving) return;
    setSaving(true); setErr(null);
    try {
      await onAdd({ mealType, source, ...(recipeId ? { recipeId } : {}), ...(name.trim() ? { name: name.trim() } : {}) });
      setName(""); setRecipeId(""); setOpen(false);
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };
  return (
    <Panel kicker="Last 2 days" title="What you've had" action={<Btn variant="quiet" onClick={() => setOpen(!open)}>{open ? "Close" : "Log a meal"}</Btn>}>
      {recent.length === 0
        ? <p className="py-1 text-[14px] text-mute">Nothing logged yet. Tell PantryPilot what you eat, cooked or delivered, and it won't repeat it for 2 days.</p>
        : <ul className="flex flex-wrap gap-2">
            {recent.map((e) => (
              <li key={e.id} className="flex items-center gap-2 rounded-full border hair bg-card/70 py-1 pl-3.5 pr-1.5 text-[13px]">
                <span>{e.name}</span>
                <span className="font-mono text-[11px] text-mute">{MEAL_LABEL[e.mealType]} · {SOURCE_LABEL[e.source]} · {ago(e.eatenAt)}</span>
                <button aria-label={`Remove ${e.name}`} onClick={() => onUndo(e.id)} className="rounded-full px-2 text-mute hover:bg-sunk">×</button>
              </li>
            ))}
          </ul>}
      {open && (
        <div className="mt-5 grid gap-3 border-t border-dashed hair pt-5 md:grid-cols-2">
          <label className="grid gap-1 text-[12px] text-mute">Meal
            <select className={field} value={mealType} onChange={(e) => setMealType(e.target.value as MealType)}>{MEAL_TYPES.map((m) => <option key={m} value={m}>{MEAL_LABEL[m]}</option>)}</select>
          </label>
          <label className="grid gap-1 text-[12px] text-mute">How
            <select className={field} value={source} onChange={(e) => setSource(e.target.value as Source)}>{(Object.keys(SOURCE_LABEL) as Source[]).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</select>
          </label>
          <label className="grid gap-1 text-[12px] text-mute">What was it? (type anything)
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Margherita pizza" maxLength={120} />
          </label>
          <label className="grid gap-1 text-[12px] text-mute">Closest recipe (stops it being suggested)
            <select className={field} value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
              <option value="">None</option>
              {recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          {source === "HOME_MADE" && (
            <p className="text-[12px] text-mute md:col-span-2">{recipeId ? `Takes ${servings} servings of ingredients out of your pantry.` : "Pick a recipe to take its ingredients out of your pantry."}</p>
          )}
          <div className="flex items-center gap-3 md:col-span-2">
            <Btn onClick={submit}>{saving ? "Saving…" : "Log it"}</Btn>
            {!canSave && <span className="text-[12px] text-mute">Type a name or pick a recipe.</span>}
            {err && <span className="text-[13px] text-accent">{err}</span>}
          </div>
        </div>
      )}
    </Panel>
  );
}

const MEAL_TABS = [
  { id: "all", label: "All day", tag: null },
  { id: "breakfast", label: "Breakfast", tag: "breakfast" },
  { id: "lunch", label: "Lunch", tag: "lunch" },
  { id: "dinner", label: "Dinner", tag: "dinner" },
  { id: "snack", label: "Snacks", tag: "snack" },
  { id: "bakes", label: "Healthy bakes", tag: "pastry" },
] as const;

const tagsOf = (r: Recipe): string[] => r.tags ?? [];

export default function Meals() {
  const [servings, setServings] = useState(4);
  const [tab, setTab] = useState<(typeof MEAL_TABS)[number]["id"]>("all");
  const data = useApi<RecData>("/recipes/recommend?limit=60", 0);
  const [rec, setRec] = useState<RecData | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reload through GET: it skips the strict POST body schema, and a failed reload never masks a successful save.
  const load = async (n: number) => {
    setBusy(true);
    try { setRec(await api<RecData>(`/recipes/recommend?servings=${n}&limit=60`)); } catch { /* keep what is on screen */ } finally { setBusy(false); }
  };
  const loadLog = useCallback(async () => { try { setLog((await api<{ entries: LogEntry[] }>("/meals/log")).entries); } catch { /* non-critical */ } }, []);
  useEffect(() => { void loadLog(); }, [loadLog]);
  const refresh = async () => { await Promise.allSettled([loadLog(), load(servings)]); };

  const addLog = async (b: LogBody) => {
    const out = await api<LogResult>("/meals/log", { body: { ...b, servings } });
    setNotice(pantryNote(out.entry.name, out.pantry));
    await refresh();
  };
  const undoLog = async (id: string) => {
    const out = await api<{ restored: number }>(`/meals/log/${id}/undo`, { body: {} });
    setNotice(out.restored > 0 ? "Removed. The ingredients are back in your pantry." : "Removed.");
    await refresh();
  };
  const logRecipe = async (r: Recipe, source: Source, mealType: MealType) => { await addLog({ mealType, source, recipeId: r.id }); };
  const hideRecipe = async (r: Recipe) => {
    await api("/meals/hidden", { body: { recipeId: r.id } });
    setNotice(`Hidden ${r.name}. You can bring it back under "Your food rules".`);
    await refresh();
  };

  const shown = rec ?? data.data;
  const step = (d: number) => { const n = Math.min(12, Math.max(1, servings + d)); setServings(n); load(n); };

  const tagged = !!shown && shown.recommendations.some((r) => tagsOf(r).length > 0);
  const activeTag = MEAL_TABS.find((t) => t.id === tab)?.tag ?? null;
  const preferred: MealType = (MEAL_TYPES as string[]).includes(tab) ? (tab as MealType) : guessMeal();
  const countFor = (tag: string | null) => !shown ? 0 : tag ? shown.recommendations.filter((r) => tagsOf(r).includes(tag)).length : shown.recommendations.length;
  const visible = <T extends Recipe>(list: T[]) => (tagged && activeTag ? list.filter((r) => tagsOf(r).includes(activeTag)) : list);
  const pickable = shown ? [...shown.recommendations, ...(shown.recentlyHad ?? [])].sort((a, b) => a.name.localeCompare(b.name)) : [];
  const had = shown ? visible(shown.recentlyHad ?? []) : [];

  return (
    <>
      <PageHeader kicker="Meals" title="Eat well, all day">
        <div className="flex items-center gap-2 rounded-xl border hair bg-card/80 px-2 py-1.5" aria-label="Servings">
          <button aria-label="Fewer servings" onClick={() => step(-1)} className="rounded-lg p-1.5 hover:bg-sunk"><Minus size={14} /></button>
          <span className="w-20 text-center font-mono text-[13px] tnum">{servings} servings</span>
          <button aria-label="More servings" onClick={() => step(1)} className="rounded-lg p-1.5 hover:bg-sunk"><Plus size={14} /></button>
        </div>
      </PageHeader>
      <div className={clsx("space-y-6 transition-opacity", busy && "opacity-60")}>
        {notice && (
          <div role="status" className="flex items-start justify-between gap-4 rounded-xl border hair bg-card/80 px-4 py-3 text-[13px]">
            <p>{notice}</p>
            <button aria-label="Dismiss" onClick={() => setNotice(null)} className="rounded-full px-2 text-mute hover:bg-sunk">×</button>
          </div>
        )}
        <LogPanel log={log} recipes={pickable} servings={servings} onAdd={addLog} onUndo={undoLog} />
        {tagged && (
          <div role="tablist" aria-label="Meal of the day" className="flex flex-wrap gap-2">
            {MEAL_TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={clsx("rounded-full border hair px-3.5 py-1.5 text-[13px] transition-colors", tab === t.id ? "bg-ink text-card" : "bg-card/70 text-mute hover:bg-sunk")}
              >
                {t.label} <span className="ml-1 font-mono text-[11px] tnum opacity-70">{countFor(t.tag)}</span>
              </button>
            ))}
          </div>
        )}
        <Panel kicker="Ranked by what you already have" title={tagged ? (MEAL_TABS.find((t) => t.id === tab)?.label ?? "Suggestions") : "Suggestions"}>
          <Async state={{ ...data, data: shown }}>
            {(d) => {
              const list = visible(d.recommendations);
              return list.length === 0
                ? <p className="py-6 text-[14px] text-mute">Nothing in this category fits your household right now.</p>
                : <ul className="divide-y hair">{list.map((r) => <RecipeRow key={r.id + servings} r={r} preferred={preferred} onLog={logRecipe} onHide={hideRecipe} />)}</ul>;
            }}
          </Async>
        </Panel>
        {had.length > 0 && (
          <Panel kicker="Resting for 2 days" title="Had recently">
            <ul className="divide-y hair">
              {had.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                  <p className="font-medium">{r.name}</p>
                  <p className="font-mono text-[11px] text-mute">{SOURCE_LABEL[r.lastHadSource]} · {ago(r.lastHadAt)} · back on the menu {backOn(r.availableAgainAt)}</p>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        {shown && visible(shown.rejected).length > 0 && (
          <Panel kicker="Hard constraints" title="Excluded for your household" action={<ShieldWarning size={20} className="text-accent" />}>
            <ul className="divide-y hair">{visible(shown.rejected).map((r) => <li key={r.id} className="py-3"><p className="font-medium">{r.name}</p><p className="text-[13px] text-accent">{r.explanation}</p><p className="mt-0.5 font-mono text-[11px] text-mute">{r.validation.violations.map((v) => human(v.kind)).join(", ")}</p></li>)}</ul>
          </Panel>
        )}
        <FoodRules onChanged={refresh} />
      </div>
    </>
  );
}