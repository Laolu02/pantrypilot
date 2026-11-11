import { loadEnv } from "../../config/env";
import { buildContainer } from "../../container";
// In-memory build: resetting happens on every API start. This CLI verifies the seed is valid.
const c = await buildContainer(loadEnv());
console.log(`Seed OK: ${(await c.store.inventoryItems.list()).length} inventory rows, ${(await c.store.recipes.list()).length} recipes`);
