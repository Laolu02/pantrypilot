import { Router } from "express";
import { z } from "zod";
import { CurrencySchema } from "@pantrypilot/contracts";
import type { Container } from "../container";
import { AppError } from "../lib/errors";
import { hmacHex, safeEqualHex } from "../lib/signing";
import { ah } from "../middleware/http";
import { ProviderError } from "../integrations/commerce/commerce";

const sign = (c: Container, hh: string) => {
  const body = Buffer.from(JSON.stringify({ hh, exp: c.clock.now().getTime() + 10 * 60_000 })).toString("base64url");
  return `${body}.${hmacHex(c.env.WEBHOOK_SECRET, body)}`;
};
const verify = (c: Container, state: string): string => {
  const [body, mac] = state.split(".");
  if (!body || !mac || !safeEqualHex(mac, hmacHex(c.env.WEBHOOK_SECRET, body))) throw new AppError(400, "BAD_STATE", "Invalid OAuth state");
  const { hh, exp } = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (exp < c.clock.now().getTime()) throw new AppError(400, "STATE_EXPIRED", "Connection attempt expired; start again");
  return hh as string;
};

/** Browser redirect targets for OAuth-style consent (Kroger, PayPal). Authenticated by the signed `state`, not a bearer token. */
/** (Kroger's callback shown first.) Authenticated by the signed `state`, not a bearer token. */
export function integrationCallbackRoutes(c: Container) {
  const r = Router();
  r.get("/integrations/kroger/callback", ah(async (req, res) => {
    if (!c.kroger) throw new AppError(404, "NOT_ENABLED", "Kroger is not enabled");
    const q = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(req.query);
    await c.kroger.exchangeCode(verify(c, q.state), q.code);
    res.redirect(`${c.env.WEB_ORIGIN}/policies?connected=kroger`);
  }));
  r.get("/integrations/paypal/callback", ah(async (req, res) => {
    if (!c.paypal) throw new AppError(404, "NOT_ENABLED", "PayPal is not enabled");
       const q = z.object({ approval_token_id: z.string().min(1), state: z.string().min(1) }).parse(req.query);
    const householdId = verify(c, q.state);
    try {
      await c.paypal.completeSetup(householdId, q.approval_token_id);
    } catch (e) {
      const why = e instanceof ProviderError ? [e.code, e.detail?.issue, e.detail?.debugId && `debug_id=${e.detail.debugId}`].filter(Boolean).join(" ") : "unexpected error";
      console.warn(`[paypal] approved in PayPal but saving the payment method failed: ${why}`);
      return res.redirect(`${c.env.WEB_ORIGIN}/policies?connected=failed&why=${encodeURIComponent(why.slice(0, 120))}`);
    }
    res.redirect(`${c.env.WEB_ORIGIN}/policies?connected=paypal`);
  }));
  /** PayPal sends the browser here when consent is abandoned or refused. Logs what PayPal sent (sanitised), then returns to the app. */
  r.get("/integrations/paypal/cancel", (req, res) => {
    const seen = Object.entries(req.query).filter(([k]) => !/token|secret|state|session/i.test(k)).map(([k, v]) => `${k.slice(0, 40)}=${String(v).replace(/[^A-Za-z0-9_\- .]/g, "").slice(0, 80)}`);
    console.warn(`[paypal] consent returned to the cancel address. Query keys: ${Object.keys(req.query).join(", ") || "none"}${seen.length ? ` | ${seen.join(" ")}` : ""}`);
    res.redirect(`${c.env.WEB_ORIGIN}/policies?connected=cancelled`);
  });
  return r;
}

export function integrationRoutes(c: Container) {
  const r = Router();
  r.get("/integrations", ah(async (req, res) => {
    const hh = req.ctx!.householdId;
    res.json({
      household: await c.store.households.get(hh),
      stores: await Promise.all(c.baskets.providers().map(async (p) => ({ ...p, connected: p.name === "kroger" ? await c.vault.has(hh, "kroger") : null }))),
      payments: { name: c.payments.name, label: c.payments.label, mode: c.payments.mode, requiresConnection: c.payments.requiresConnection, connected: await c.payments.isConnected(hh) },
      instacart: { configured: !!c.instacart, note: "Shopping-list handoff only. Instacart returns no prices to us." },
    });
  }));
  r.get("/integrations/kroger/authorize", ah(async (req, res) => {
    if (!c.kroger) throw new AppError(404, "NOT_ENABLED", "Kroger is not enabled on this server");
    res.json({ url: c.kroger.authorizeUrl(sign(c, req.ctx!.householdId)) });
  }));
  /** Starts PayPal consent. The consent screen is PayPal's own; our limits are shown to the user in the app beside the button. */
  r.get("/integrations/paypal/connect", ah(async (req, res) => {
    if (!c.paypal) throw new AppError(404, "NOT_ENABLED", "PayPal is not enabled on this server");
    const { approveUrl } = await c.paypal.createSetupToken(sign(c, req.ctx!.householdId));
    res.json({ url: approveUrl });
  }));
  r.delete("/integrations/paypal", ah(async (req, res) => { if (!c.paypal) throw new AppError(404, "NOT_ENABLED", "PayPal is not enabled"); await c.paypal.disconnect(req.ctx!.householdId); res.json({ connected: false }); }));
  r.delete("/integrations/kroger", ah(async (req, res) => { await c.vault.delete(req.ctx!.householdId, "kroger"); res.json({ connected: false }); }));

  r.put("/household", ah(async (req, res) => {
    const { currency } = z.object({ currency: CurrencySchema }).parse(req.body);
    const hh = req.ctx!.householdId;
    await c.store.households.update(hh, { currency });
    await c.policies.update(hh, req.ctx!.actor, { currency }); // keeps policy and household in step; bumps the policy version
    res.json(await c.store.households.get(hh));
  }));
  return r;
}
