/**
 * Finds out which Vault setup request PayPal's approval page accepts. Run from the repo root:
 *   pnpm --filter @pantrypilot/api exec tsx scripts/paypal-check.ts
 * Reads PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET from your .env. It creates SANDBOX setup tokens only,
 * prints a link for each variant, and never prints secrets. Nothing is saved or charged.
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const HOST = "https://api-m.sandbox.paypal.com";
const id = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET;
if (!id || !secret) { console.error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set in .env"); process.exit(1); }
const api = process.env.API_PUBLIC_URL ?? "http://localhost:4000";
const safe = (v: unknown) => (typeof v === "string" ? v.replace(/[^A-Za-z0-9_\- .:/?=&%]/g, "").slice(0, 160) : "");

async function main() {
  let tokenRes: Response;
  try {
    tokenRes = await fetch(`${HOST}/v1/oauth2/token`, { method: "POST", headers: { authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  } catch { console.error("Cannot reach api-m.sandbox.paypal.com from this machine."); process.exit(1); }
  if (!tokenRes.ok) { console.error(`Step 1 FAILED: PayPal rejected the client id/secret (HTTP ${tokenRes.status}). Use the SANDBOX app's credentials.`); process.exit(1); }
  const token = (await tokenRes.json()).access_token as string;
  console.log("Step 1 OK: sandbox credentials are valid.\n");

  const ctx = { return_url: `${api}/api/v1/integrations/paypal/callback?state=diagnostic`, cancel_url: `${api}/api/v1/integrations/paypal/cancel` };
  const variants: [string, object][] = [
    ["A  minimal (usage_type only)", { usage_type: "MERCHANT", experience_context: ctx }],
    ["B  + usage_pattern", { usage_type: "MERCHANT", usage_pattern: "UNSCHEDULED_POSTPAID", experience_context: ctx }],
    ["C  + permit_multiple_payment_tokens", { usage_type: "MERCHANT", usage_pattern: "UNSCHEDULED_POSTPAID", permit_multiple_payment_tokens: true, experience_context: ctx }],
    ["D  full (what the app sends)", { usage_type: "MERCHANT", usage_pattern: "UNSCHEDULED_POSTPAID", permit_multiple_payment_tokens: true, experience_context: { brand_name: "PantryPilot", shipping_preference: "NO_SHIPPING", vault_instruction: "ON_PAYER_APPROVAL", ...ctx } }],
  ];
  console.log("Step 2: creating one setup token per variant. Open each link in a PRIVATE window and log in as the sandbox BUYER.");
  console.log("Note which pages show the normal PayPal consent screen and which show 'Something went wrong'.\n");
  for (const [name, paypal] of variants) {
    try {
      const r = await fetch(`${HOST}/v3/vault/setup-tokens`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "paypal-request-id": `diag-${Date.now()}-${name[0]}` }, body: JSON.stringify({ payment_source: { paypal } }) });
      const body: any = await r.json().catch(() => ({}));
      const debug = r.headers.get("paypal-debug-id");
      if (r.ok) {
        const link = (body.links ?? []).find((l: any) => ["approve", "payer-action"].includes(l.rel))?.href;
        console.log(`${name}\n   HTTP ${r.status}  debug_id=${safe(debug)}\n   OPEN: ${link ?? "(no approval link returned)"}\n`);
      } else {
        console.log(`${name}\n   REJECTED BY PAYPAL: HTTP ${r.status}  ${safe(body.name)} ${safe(body.message)} ${safe(body.details?.[0]?.issue)} ${safe(body.details?.[0]?.description)}  debug_id=${safe(debug)}\n`);
      }
    } catch { console.log(`${name}\n   network error\n`); }
  }
  console.log("Tell me which variants (A-D) opened the consent screen, and the text of any that failed.");
  console.log("If A works but D fails, set PAYPAL_SETUP_MINIMAL=true in .env and restart the API.");
}
main();
