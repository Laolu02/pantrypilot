import request from "supertest";
import { loadEnv } from "../src/config/env";
import { buildContainer } from "../src/container";
import { createApp } from "../src/app";
import { FixedClock } from "../src/lib/clock";
import { DEMO_TOKEN, OTHER_TOKEN } from "../src/modules/seed/demoData";
import { clearRateLimits } from "../src/middleware/http";

export async function setup(envOverrides: Record<string, string> = {}, opts: { fetch?: any } = {}) {
  clearRateLimits();
  const clock = new FixedClock(new Date("2026-10-16T09:00:00.000Z"));
  const c = await buildContainer(loadEnv({ NODE_ENV: "test", ...envOverrides }), { clock, sleep: async () => {}, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  const app = createApp(c);
  const api = (token = DEMO_TOKEN) => ({
    get: (p: string) => request(app).get(`/api/v1${p}`).set("Authorization", `Bearer ${token}`),
    post: (p: string, body: unknown = {}) => request(app).post(`/api/v1${p}`).set("Authorization", `Bearer ${token}`).send(body as object),
    put: (p: string, body: unknown = {}) => request(app).put(`/api/v1${p}`).set("Authorization", `Bearer ${token}`).send(body as object),
    patch: (p: string, body: unknown = {}) => request(app).patch(`/api/v1${p}`).set("Authorization", `Bearer ${token}`).send(body as object),
    del: (p: string) => request(app).delete(`/api/v1${p}`).set("Authorization", `Bearer ${token}`),
  });
  return { c, app, clock, api, other: api(OTHER_TOKEN), me: api(DEMO_TOKEN), raw: request(app) };
}
export const HHID = "hh_okafor";
