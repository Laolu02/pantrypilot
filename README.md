# PantryPilot

A kitchen agent that watches stock, decides when a staple needs replenishing, buys it **only inside limits you set**, verifies what happened, and shows every step. Built from `handoff.md`.

> **Everything external is simulated.** The retailer, payment provider and appliances are mocks (`DEMO / MOCK` is shown on every screen). Live providers are refused at startup. No real money moves.

## Run
```
pnpm install
pnpm --filter @pantrypilot/api dev     # http://localhost:4000, in-memory store, reseeds on start
pnpm --filter @pantrypilot/web dev     # http://localhost:3000 (proxies /api/v1 to :4000)
pnpm test                              # 123 API tests
```
Demo token for direct API calls: `Authorization: Bearer pp_demo_okafor`. Copy `.env.example` to `.env` to change settings.

## Two-minute demo
1. Overview -> **Send** "Fridge: milk is low". Watch the trace: sensor, ledger, forecast, product choice, policy ALLOW, mock order, verified. Stock shows **on order**, not on hand.
2. Send "Pantry: olive oil is low". Only a £29.50 tin is in stock, so policy returns DENY and the retailer is never called.
3. Orders -> "Demo: retailer delivers". Stock increases exactly once.
4. Pick "Retailer timeout" under "Next order fails with", send milk again (after Reset). The order becomes UNCERTAIN and is reconciled by reference, not retried.
5. Limits -> switch to "Always ask me" or hit Emergency stop and repeat.

## Payments (PayPal sandbox)
Set `PAYMENT_PROVIDER=paypal` with sandbox credentials. Users click **Connect PayPal** (Limits page) and approve in PayPal's own window; PantryPilot never sees their PayPal credentials. Each purchase: policy check -> PayPal **hold** of the exact total -> order -> verify -> **capture**; on any failure the hold is released. PantryPilot holds no balances. Sandbox only: live PayPal is refused. Without credentials the app runs on a mock payment provider. Not yet run against the real sandbox (see `context.md`).

## Real stores
Set `COMMERCE_PROVIDERS` and credentials in `.env` (see `.env.example`). **No public retailer API here can place an order**: Kroger can fill your cart, Walmart's API is catalogue-only, Instacart makes a shopping list. PantryPilot prepares the cart or list and you check out; it says so on screen and never marks such an order as bought until you confirm. These adapters have not been run against the live APIs.

## Adding items by hand
Pantry -> Add item. Pick a known ingredient (sensible unit/storage/expiry filled in) or type your own. Adding something you already have merges into it. An optional "use per day" lets it forecast and reorder.

## Layout
`apps/api` Express + Zod, domain modules, mock adapters, tests. `apps/web` Next.js dashboard. `packages/contracts` shared Zod schemas. `prisma/schema.prisma` unverified draft. See `context.md` for status, decisions and next steps, and `docs/` for notes.

## Known limitations
No Postgres store yet, no payment webhooks, no meal plans, no LLM calls, no live integrations, demo-grade auth. Full list in `context.md`.
