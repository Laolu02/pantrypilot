"use client";
import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";
import { Btn, Panel } from "@/components/ui";
import { api } from "@/lib/api";
import type { Ingredient } from "@/lib/types";

interface Diet { allergies: string[]; dislikedIngredients: string[]; hiddenMeals: { recipeId: string; name: string }[] }

/** Allergens the ingredient data actually carries. Anything else can be saved but cannot be checked. */
const CHECKABLE = ["peanut", "milk", "egg", "gluten", "soy"];
const field = "rounded-lg border hair bg-card/80 px-3 py-2 text-[14px] outline-none focus:ring-1";

export function FoodRules({ onChanged }: { onChanged: () => Promise<void> }) {
  const [diet, setDiet] = useState<Diet | null>(null);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [otherAllergy, setOtherAllergy] = useState("");
  const [dislike, setDislike] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => { try { setDiet(await api<Diet>("/diet")); } catch (e) { setErr((e as Error).message); } }, []);
  useEffect(() => {
    void load();
    api<unknown>("/ingredients").then((raw) => setIngredients(Array.isArray(raw) ? (raw as Ingredient[]) : ((raw as { ingredients?: Ingredient[] }).ingredients ?? []))).catch(() => {});
  }, [load]);

  const save = async (body: Partial<Pick<Diet, "allergies" | "dislikedIngredients">>) => {
    setErr(null);
    try { await api("/diet", { body }); } catch (e) { setErr((e as Error).message); return; }
    await load();
    await onChanged();
  };
  const restore = async (recipeId: string) => {
    try { await api(`/meals/hidden/${recipeId}/restore`, { body: {} }); } catch (e) { setErr((e as Error).message); return; }
    await load();
    await onChanged();
  };

  if (!diet) return <Panel kicker="Always respected" title="Your food rules"><p className="text-[14px] text-mute">{err ?? "Loading…"}</p></Panel>;

  const toggle = (a: string) => save({ allergies: diet.allergies.includes(a) ? diet.allergies.filter((x) => x !== a) : [...diet.allergies, a] });
  const addOther = async () => { const a = otherAllergy.trim().toLowerCase(); if (!a || diet.allergies.includes(a)) return; setOtherAllergy(""); await save({ allergies: [...diet.allergies, a] }); };
  const nameOf = (key: string) => ingredients.find((i) => i.key === key)?.name ?? key;
  const addDislike = async () => {
    const text = dislike.trim().toLowerCase();
    if (!text) return;
    const known = ingredients.find((i) => i.name.toLowerCase() === text || i.key === text);
    const value = known ? known.key : text;
    setDislike("");
    if (!diet.dislikedIngredients.includes(value)) await save({ dislikedIngredients: [...diet.dislikedIngredients, value] });
  };
  const extra = diet.allergies.filter((a) => !CHECKABLE.includes(a));

  return (
    <Panel kicker="Always respected" title="Your food rules">
      {err && <p className="mb-3 text-[13px] text-accent">{err}</p>}
      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[.14em] text-mute">Allergies</p>
          <div className="flex flex-wrap gap-2">
            {CHECKABLE.map((a) => (
              <button key={a} onClick={() => toggle(a)} aria-pressed={diet.allergies.includes(a)}
                className={clsx("rounded-full border hair px-3.5 py-1.5 text-[13px] capitalize transition-colors", diet.allergies.includes(a) ? "bg-ink text-card" : "bg-card/70 text-mute hover:bg-sunk")}>{a}</button>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input className={clsx(field, "flex-1")} value={otherAllergy} onChange={(e) => setOtherAllergy(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addOther()} placeholder="Another allergy" maxLength={40} />
            <Btn variant="quiet" onClick={addOther}>Add</Btn>
          </div>
          {extra.length > 0 && (
            <p className="mt-2 text-[12px] text-mute">
              {extra.map((a) => (<button key={a} onClick={() => toggle(a)} className="mr-2 underline decoration-dotted">{a} ×</button>))}
              <span className="block pt-1">These are saved, but recipes can't be checked against them yet. Read labels.</span>
            </p>
          )}
        </section>
        <section>
          <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[.14em] text-mute">Ingredients you dislike</p>
          <div className="flex flex-wrap gap-2">
            {diet.dislikedIngredients.length === 0 && <span className="text-[13px] text-mute">None yet.</span>}
            {diet.dislikedIngredients.map((d) => (
              <span key={d} className="flex items-center gap-1.5 rounded-full border hair bg-card/70 py-1 pl-3.5 pr-1.5 text-[13px]">
                {nameOf(d)}
                <button aria-label={`Remove ${nameOf(d)}`} onClick={() => save({ dislikedIngredients: diet.dislikedIngredients.filter((x) => x !== d) })} className="rounded-full px-2 text-mute hover:bg-sunk">×</button>
              </span>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input className={clsx(field, "flex-1")} list="ingredient-options" value={dislike} onChange={(e) => setDislike(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addDislike()} placeholder="e.g. Spinach" maxLength={40} />
            <datalist id="ingredient-options">{ingredients.map((i) => <option key={i.key} value={i.name} />)}</datalist>
            <Btn variant="quiet" onClick={addDislike}>Add</Btn>
          </div>
        </section>
      </div>
      {diet.hiddenMeals.length > 0 && (
        <section className="mt-6 border-t border-dashed hair pt-5">
          <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[.14em] text-mute">Meals you hid</p>
          <ul className="divide-y hair">
            {diet.hiddenMeals.map((m) => (
              <li key={m.recipeId} className="flex items-center justify-between gap-3 py-2 text-[14px]">
                <span>{m.name}</span>
                <Btn variant="quiet" onClick={() => restore(m.recipeId)}>Bring back</Btn>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="mt-5 text-[12px] text-mute">Allergy filtering only covers allergens recorded in the ingredient data. It is a safety net, not a guarantee, so always check labels.</p>
    </Panel>
  );
}