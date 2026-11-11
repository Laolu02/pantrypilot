import { z } from "zod";

const Bool = z.enum(["true", "false"]).transform((v) => v === "true");
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  STORE: z.enum(["memory", "prisma"]).default("memory"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  DEVICE_PROVIDER: z.string().default("simulator"),
  COMMERCE_PROVIDER: z.string().default("mock"),
  /** Comma list of enabled stores: mock, kroger, walmart. Live ones need credentials below. */
  COMMERCE_PROVIDERS: z.string().default("mock"),
  KROGER_CLIENT_ID: z.string().optional(), KROGER_CLIENT_SECRET: z.string().optional(), KROGER_LOCATION_ID: z.string().optional(), KROGER_REDIRECT_URI: z.string().optional(),
  WALMART_CONSUMER_ID: z.string().optional(), WALMART_KEY_VERSION: z.string().optional(), WALMART_PRIVATE_KEY_B64: z.string().optional(),
  INSTACART_API_KEY: z.string().optional(), INSTACART_ENV: z.enum(["dev", "prod"]).default("dev"),
  INTEGRATION_ENCRYPTION_KEY: z.string().optional(),
  /** mock | paypal (sandbox only). */
  PAYMENT_PROVIDER: z.string().default("mock"),
  PAYPAL_CLIENT_ID: z.string().optional(), PAYPAL_CLIENT_SECRET: z.string().optional(), PAYPAL_BASE_URL: z.string().optional(),
    /** Send the smallest possible Vault setup request (only if PayPal's approval page rejects the standard one). */
  PAYPAL_SETUP_MINIMAL: Bool.default("false"),
  API_PUBLIC_URL: z.string().default("http://localhost:4000"),
  AUTONOMOUS_PURCHASING_ENABLED: Bool.default("true"),
  GLOBAL_PURCHASE_KILL_SWITCH: Bool.default("false"),
  DEVICE_SIGNING_SECRET: z.string().min(8).default("dev-only-device-secret"),
  WEBHOOK_SECRET: z.string().min(8).default("dev-only-webhook-secret"),
  LLM_PROVIDER: z.string().default(""),
});
export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const env = EnvSchema.parse(source);
  // Live adapters are intentionally not implemented. Fail fast instead of silently mocking.
  for (const [k, v, ok] of [
    ["DEVICE_PROVIDER", env.DEVICE_PROVIDER, "simulator"],
  ] as const) {
    if (v !== ok) throw new Error(`${k}=${v} is not supported yet: only "${ok}" is implemented in this build.`);
  }
  if (!["mock", "paypal"].includes(env.PAYMENT_PROVIDER)) throw new Error(`PAYMENT_PROVIDER=${env.PAYMENT_PROVIDER} is not supported: use mock or paypal (sandbox).`);
  if (env.PAYMENT_PROVIDER === "paypal") {
    const m = (["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "INTEGRATION_ENCRYPTION_KEY"] as const).filter((k) => !env[k]);
    if (m.length) throw new Error(`PAYMENT_PROVIDER=paypal but these are missing: ${m.join(", ")}`);
    if (env.PAYPAL_BASE_URL && new URL(env.PAYPAL_BASE_URL).host !== "api-m.sandbox.paypal.com") throw new Error("Only the PayPal sandbox (api-m.sandbox.paypal.com) is supported; live PayPal is not enabled in this build.");
  }
  const need: Record<string, (keyof typeof env)[]> = {
    mock: [], kroger: ["KROGER_CLIENT_ID", "KROGER_CLIENT_SECRET", "KROGER_LOCATION_ID", "KROGER_REDIRECT_URI", "INTEGRATION_ENCRYPTION_KEY"],
    walmart: ["WALMART_CONSUMER_ID", "WALMART_KEY_VERSION", "WALMART_PRIVATE_KEY_B64"],
  };
  for (const p of env.COMMERCE_PROVIDERS.split(",").map((x) => x.trim()).filter(Boolean)) {
    if (!(p in need)) throw new Error(`COMMERCE_PROVIDERS: unknown store "${p}". Supported: ${Object.keys(need).join(", ")}.`);
    const missing = need[p]!.filter((k) => !env[k]);
    if (missing.length) throw new Error(`COMMERCE_PROVIDERS includes ${p} but these are missing: ${missing.join(", ")}`);
  }
  if (env.NODE_ENV === "production" && env.COMMERCE_PROVIDERS.includes("kroger") && !env.INTEGRATION_ENCRYPTION_KEY) throw new Error("INTEGRATION_ENCRYPTION_KEY is required in production");
  if (env.STORE === "prisma") throw new Error("STORE=prisma is not implemented yet (see context.md). Use STORE=memory.");
  if (env.NODE_ENV === "production" && (env.DEVICE_SIGNING_SECRET === "dev-only-device-secret" || env.WEBHOOK_SECRET === "dev-only-webhook-secret"))
    throw new Error("Set DEVICE_SIGNING_SECRET and WEBHOOK_SECRET in production.");
  return env;
}
