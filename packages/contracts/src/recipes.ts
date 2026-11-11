import { z } from "zod";
import { UnitSchema } from "./common";

export const RecommendRequestSchema = z.object({
  servings: z.number().int().positive().max(12).optional(),
  limit: z.number().int().positive().max(12).optional(),
});

export const PreferencesSchema = z.object({
  cuisines: z.array(z.string()),
  allergies: z.array(z.string()),
  dietaryRestrictions: z.array(z.string()),
  dislikedIngredients: z.array(z.string()),
  healthGoal: z.string().nullable(),
  weeklyBudgetMinor: z.number().int().nonnegative().nullable(),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export const SubstitutionRequestSchema = z.object({ missing: z.array(z.string()).min(1) });
export const RecipeUnitSchema = UnitSchema;
