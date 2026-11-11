import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { randomUUID } from "node:crypto";
import { AppError, InvalidTransitionError, UniqueViolationError, unauthorized } from "../lib/errors";
import type { Container } from "../container";
import { ProviderError } from "../integrations/commerce/commerce";

export interface AuthCtx { householdId: string; userId: string; actor: string }
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { requestId: string; ctx?: AuthCtx; rawBody?: Buffer } }
}

export const ah = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => { fn(req, res).catch(next); };

export const requestId: RequestHandler = (req, res, next) => {
  req.requestId = (req.header("x-request-id") ?? randomUUID()).slice(0, 64);
  res.setHeader("x-request-id", req.requestId);
  next();
};

/** Demo auth: bearer token -> user -> household. Every private query is scoped to req.ctx.householdId. */
export const authMw = (c: Container): RequestHandler => (req, _res, next) => {
  (async () => {
    const m = /^Bearer (.+)$/.exec(req.header("authorization") ?? "") ?? (req.path === "/events/stream" && typeof req.query.token === "string" ? [null, req.query.token] : null);
    if (!m) throw unauthorized();
    const user = await c.store.users.find((u) => u.token === m[1]);
    if (!user) throw unauthorized("Invalid token");
    req.ctx = { householdId: user.householdId, userId: user.id, actor: `user:${user.id}` };
  })().then(() => next(), next);
};

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data);
}

const buckets = new Map<string, { n: number; reset: number }>();
export const rateLimit = (name: string, max: number, windowMs = 60_000): RequestHandler => (req, res, next) => {
  const k = `${name}:${req.ctx?.householdId ?? req.ip}`;
  const now = Date.now();
  const b = buckets.get(k);
  if (!b || b.reset < now) buckets.set(k, { n: 1, reset: now + windowMs });
  else if (++b.n > max) return next(new AppError(429, "RATE_LIMITED", "Too many requests"));
  next();
};
export const clearRateLimits = () => buckets.clear();

export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const requestId = req.requestId;
  if (err instanceof ZodError) return res.status(400).json({ code: "VALIDATION_ERROR", message: "Request validation failed", requestId, details: err.flatten() });
  if (err instanceof AppError) return res.status(err.status).json({ code: err.code, message: err.message, requestId, ...(err.details ? { details: err.details } : {}) });
  if (err instanceof ProviderError) return res.status(502).json({ code: err.code, message: `The external service failed: ${err.message}`, requestId });
  if (err instanceof UniqueViolationError) return res.status(409).json({ code: "CONFLICT", message: "Resource already exists", requestId });
  if (err instanceof InvalidTransitionError) return res.status(409).json({ code: "INVALID_TRANSITION", message: err.message, requestId });
  console.error(`[${requestId}]`, err instanceof Error ? err.message : err); // never send stack traces to clients
  return res.status(500).json({ code: "INTERNAL", message: "Internal error", requestId });
};
