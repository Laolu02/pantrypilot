import cors from "cors";
import express from "express";
import type { Container } from "./container";
import { authMw, errorHandler, requestId } from "./middleware/http";
import { agentRoutes } from "./routes/agent";
import { demoRoutes } from "./routes/demo";
import { deviceEventRoutes, deviceRoutes } from "./routes/devices";
import { inventoryRoutes } from "./routes/inventory";
import { integrationCallbackRoutes, integrationRoutes } from "./routes/integrations";
import { mealRoutes } from "./routes/meals";
import { shoppingRoutes } from "./routes/shopping";
import { streamRoutes } from "./routes/stream";
import { webhookRoutes } from "./routes/webhooks";

export function createApp(c: Container) {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestId);
  app.use(cors({ origin: c.env.WEB_ORIGIN }));
  app.use(express.json({ limit: "100kb", verify: (req, _res, buf) => { (req as express.Request).rawBody = buf; } }));

  app.get("/health", (_req, res) => { res.json({ ok: true }); });
  const v1 = express.Router();
  v1.get("/meta", (_req, res) => {
    res.json({
      commerce: { name: c.commerce.name, mode: c.commerce.mode }, payments: { name: c.payments.name, label: c.payments.label, mode: c.payments.mode, requiresConnection: c.payments.requiresConnection },
      stores: c.baskets.providers(), instacart: !!c.instacart,
      anyLive: c.baskets.providers().some((p) => p.mode === "LIVE"),
      devices: { provider: c.env.DEVICE_PROVIDER, mode: "SIMULATED" }, llm: c.env.LLM_PROVIDER || "template",
      autonomyEnabledGlobally: c.env.AUTONOMOUS_PURCHASING_ENABLED, globalKillSwitch: c.env.GLOBAL_PURCHASE_KILL_SWITCH,
      demoControls: c.env.NODE_ENV !== "production",
    });
  });
  v1.use(deviceEventRoutes(c)); // signature-authenticated
  v1.use(webhookRoutes(c)); // signature-authenticated
  v1.use(integrationCallbackRoutes(c)); // signed OAuth state
  v1.use(authMw(c));
  v1.use(streamRoutes(c));
  v1.use(integrationRoutes(c));
  v1.use(inventoryRoutes(c));
  v1.use(deviceRoutes(c));
  v1.use(mealRoutes(c));
  v1.use(agentRoutes(c));
  v1.use(shoppingRoutes(c));
  if (c.env.NODE_ENV !== "production") v1.use(demoRoutes(c));
  app.use("/api/v1", v1);
  app.use((req, res) => { res.status(404).json({ code: "NOT_FOUND", message: "Route not found", requestId: req.requestId }); });
  app.use(errorHandler);
  return app;
}
