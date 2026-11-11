import { PreferencesSchema, type Preferences } from "@pantrypilot/contracts";
import type { Store } from "../../store/store";
import { newId } from "../../lib/ids";
import { normalizeAllergen } from "../recipes/diet";
import { AuditService } from "../audit/auditService";

export class PreferencesService {
  constructor(private store: Store, private audit: AuditService) {}
  async get(householdId: string): Promise<Preferences> {
    const row = await this.store.preferences.find((p) => p.householdId === householdId);
    if (!row) return { cuisines: [], allergies: [], dietaryRestrictions: [], dislikedIngredients: [], healthGoal: null, weeklyBudgetMinor: null };
    const { id: _id, householdId: _h, ...rest } = row;
    return rest;
  }
  async put(householdId: string, actor: string, input: unknown): Promise<Preferences> {
    const p = PreferencesSchema.parse(input);
    p.allergies = [...new Set(p.allergies.map(normalizeAllergen))];
    p.dietaryRestrictions = p.dietaryRestrictions.map((d) => d.trim().toLowerCase());
    const row = await this.store.preferences.find((x) => x.householdId === householdId);
    if (row) await this.store.preferences.update(row.id, p);
    else await this.store.preferences.insert({ id: newId("pref"), householdId, ...p });
    await this.audit.record({ householdId, actor, action: "PREFERENCES_UPDATED", resourceType: "Preference", resourceId: householdId, correlationId: newId("cor"), stage: "SYSTEM", details: { allergies: p.allergies, dietaryRestrictions: p.dietaryRestrictions } });
    return p;
  }
}
