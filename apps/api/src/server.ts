import { loadEnv } from "./config/env";
import { buildContainer } from "./container";
import { createApp } from "./app";

import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const env = loadEnv();
const container = await buildContainer(env);
const app = createApp(container);
app.listen(env.PORT, () => {
  console.log(`PantryPilot API on :${env.PORT}  [commerce=${container.commerce.mode} payments=${container.payments.mode} devices=simulated]`);
  console.log("Demo token: Authorization: Bearer pp_demo_okafor");
});
// Safe-to-repeat stock review (idempotent per ledger event + policy version).
const every = Number(process.env.SCAN_INTERVAL_MS ?? 0);
if (every > 0) setInterval(() => { container.agent.scan("hh_okafor").catch((e) => console.error("scan failed", e)); }, every);
