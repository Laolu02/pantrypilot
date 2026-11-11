# PantryPilot: context.md (handoff for other chats)

> Keep this file current. Update it at the end of every work session. Paste it, plus `handoff.md`, into a new chat to continue.
> Last updated: end of session 1 (API complete and tested; web built and smoke-tested, not visually reviewed).

## What this is
Autonomous kitchen agent (spec: `handoff.md`). Device event -> inventory ledger -> forecast -> catalogue search -> deterministic policy -> idempotent mock order -> provider verification -> audit timeline. Meal recommendations are constrained by allergies/diet. **Everything external is simulated** (DEMO/MOCK). Live adapters are refused at startup.

## Status
| Area | State | Verified how |
|---|---|---|
| API domain + routes (`apps/api`) | Done for P0 | `pnpm test`: 123 Vitest tests passing; `tsc --noEmit` clean |
| Contracts (`packages/contracts`) | Done | typechecked |
| Web dashboard (`apps/web`) | 7 pages built (Overview, Pantry, Meals, Orders, Devices, Limits, Trace) | `tsc` clean, `next build` passes, all pages return 200, full flow driven through the Next proxy against the real API. **Never opened in a browser**: layout, motion and responsiveness are unreviewed |
| Prisma schema / Postgres store | Schema drafted only | `prisma/schema.prisma` never validated (engines can't be downloaded in the authoring sandbox); no PrismaStore, no seed.ts |
| Playwright e2e | NOT done | needs browsers + running stack |
| SSE + commerce webhooks | Done | tests (`realtime.test.ts`) + SSE verified through the Next proxy with curl |
| Manual pantry add / edit / remove | Done (API + UI) | `pantry.test.ts`; UI typechecks |
| Store adapters: Kroger, Walmart, Instacart | Written, **never run against the live APIs** | unit tests against fixtures I wrote from the docs; no credentials or network access in the sandbox |
| Real LLM, payment webhooks, meal plans, Prisma | NOT done | see "Not built" |

## Run it
```
pnpm install
pnpm --filter @pantrypilot/api dev      # http://localhost:4000  (in-memory store, reseeds on start)
pnpm --filter @pantrypilot/web dev      # http://localhost:3000
pnpm test                               # API tests
```
Demo token: `Authorization: Bearer pp_demo_okafor` (second household for isolation tests: `pp_demo_harlow`).
Reset demo state: `POST /api/v1/demo/reset`.

## Key decisions (and deviations from handoff.md)
1. **In-memory store, not Postgres yet.** `MemoryStore` (`apps/api/src/store/store.ts`) mirrors DB invariants (unique constraints throw `UniqueViolationError`; `withLock` stands in for advisory locks). A `PrismaStore` with the same shape is the next big task. `STORE=prisma` throws on purpose.
2. **No LLM tool-calling loop.** The orchestrator is a deterministic workflow over a typed, Zod-validated tool registry (`modules/agent/tools.ts`, all 16 tools from the spec). `LlmProvider` (`agent/llm.ts`) is an explanation-only seam with a template implementation. A model can never change policy, order or payment state.
3. **Auth is demo-grade** (bearer token -> user -> household). Device events authenticate by HMAC signature; household comes from the registered device, never the payload.
4. `AUTONOMOUS_PURCHASING_ENABLED` defaults to `true` in `.env.example` (handoff shows `false`) because providers are mock-only and the acceptance scenario needs autonomy. Must be revisited before any live provider.
5. Autonomy disabled / ALWAYS_CONFIRM => **REVIEW** (owner can approve). Kill switch, caps, allowlist, allergens, cooldown, duplicates => **DENY**. Approval downgrades REVIEW only, never DENY; approvals expire (30 min) and are bound to the policy version.
6. Money is integer pence; currency GBP in the seed; quantities are base units (ml / g / count).
7. Commerce adapter has two additions to the handoff interface: `getFees()` and `findByReference()` (needed for deterministic baskets and for reconciling uncertain outcomes).
8. Replenishment idempotency key = `repl:<hh>:<item>:<ledgerEventId>:p<policyVersion>:a<attempt>`; a per-item lock plus a unique constraint prevents duplicate orders.
9. Basket choice = cheapest total cost to cover the shortfall, allowlisted first (not lowest unit price).

## Demo script (works today via API)
1. `POST /devices/simulate {"scenario":"LOW_MILK"}` -> milk 180 ml, run SUCCEEDED, mock order CONFIRMED (6 pints, 215p + 199p delivery), stock shows 3408 ml **on order**, 180 ml on hand.
2. `POST /devices/simulate {"scenario":"LOW_OLIVE_OIL"}` -> only the 3 L tin (£29.50) is in stock -> DENY (`ITEM_PRICE_CAP_EXCEEDED`, `ORDER_CAP_EXCEEDED`), run BLOCKED, provider never called.
3. `POST /demo/orders/:id/advance {"status":"DELIVERED"}` -> verified delivery, stock increases once.
Other scenarios: `REPLAY_LAST`, `STALE_MILK`, `IMPLAUSIBLE_MILK`, `LOW_CONFIDENCE_MILK`. Fault injection: `POST /demo/faults {"commerce":"TIMEOUT_AFTER_COMMIT"}` or `{"payment":"DECLINE"}`.

## Map
- `apps/api/src/modules/{inventory,devices,forecasting,recipes,shopping,agent,audit,seed}`; pure logic: `forecasting/forecast.ts`, `shopping/policyEngine.ts`, `recipes/diet.ts`.
- Order state machine: `shopping/orderService.ts` (`TRANSITIONS`). Only `confirmDelivery` increases stock.
- Adapters: `integrations/{commerce,payments,devices}` (mock + simulator only).
- Tests: `apps/api/tests/*.test.ts` (policy, forecast, devices/isolation, acceptance, orders, recipes).

## Real stores (session 3): what is and is not possible
Research finding, and it shapes the design: **none of these public APIs lets an agent place an order.**
- **Walmart**: only the Walmart.io *affiliate catalogue* (search/lookup). Walmart documents no consumer ordering/checkout API. `WalmartAdapter` is read-only and hands the owner product links. Do not scrape or automate walmart.com.
- **Kroger**: product search, store lookup and `PUT /cart/add` (needs the shopper's OAuth). **No checkout endpoint.** `KrogerAdapter` adds items to the owner's cart; the owner pays on kroger.com/app.
- **Instacart Developer Platform**: creates a shopping-list page; the owner picks a store and checks out. It returns no prices, so it is a *handoff channel* (`InstacartChannel`), not a catalogue.
- UK retailers (Tesco, Sainsbury's, Asda, Ocado): no public self-serve ordering API found; not built.
Design that follows from it:
- `CommerceAdapter` now has `capabilities {search, placeOrder, cartHandoff}`; only `OrderingAdapter` (the mock) can `createOrder`. `CommerceRegistry` fans search out across enabled stores (one store failing never hides the rest).
- New order status **HANDOFF** (run state `AWAITING_OWNER`): cart prepared, nothing bought, no payment attempt, not counted as inbound stock. Owner then clicks "I finished checkout" -> CONFIRMED (**attested, not provider-verified**, audited as WARN). Delivery for such stores can only be user-confirmed.
- Live catalogue products have `allergens: null` (the public data has none) so they always go to REVIEW; they also must be explicitly allowlisted. Currency mismatch (US stores vs a GBP household) is a policy DENY; switch the household to USD on the Limits page.
- Enable with `COMMERCE_PROVIDERS=mock,kroger,walmart` plus credentials (see `.env.example`); startup fails if credentials are missing. Outbound calls go through `integrations/http.ts`: pinned hosts, timeout, bounded GET retries, errors never echo bodies. User tokens are AES-256-GCM encrypted (`CredentialVault`).
- Kroger user connection: `GET /integrations/kroger/authorize` -> Kroger -> `/integrations/kroger/callback` (HMAC-signed state, 10 min).
**UNVERIFIED (do this first with real credentials):** Kroger endpoint/field names, Walmart.io host, paths and RSA header scheme, Instacart `products_link` shape. They follow public docs as recalled/seen, tested only against fixtures. Expect small fixes. Also not handled yet: Kroger fees/tax (not exposed by the API, so totals exclude them and the UI says so), per-user store/location selection (single `KROGER_LOCATION_ID`), pack-size parsing for odd retailer strings (unparseable sizes are never auto-selected).


## Payments and checkout plan (session 4: decided; PayPal sandbox part BUILT)
Decisions from the owner: (1) the app must **not hold users' money**; (2) built for the **PayPal hackathon**; (3) **US-only** for now; (4) verify Rye and Zinc first; (5) end users are non-technical: they only click "Connect", never see API keys.
Findings (vendor docs/marketing only; not run, not legally reviewed):
- **Rye** Universal Checkout API: checkout intent -> `awaiting_confirmation` -> confirm with a payment method. Supports BYO card tokens (Basis Theory, Stripe, Prava, Nekuda) so the buyer's own card pays the merchant, or `drawdown` (operator's pre-funded balance). US shipping addresses only. Basis Theory forwards the card to the merchant's vault (Rye not merchant of record for Shopify); the Stripe flow makes Rye merchant of record. Amazon orders go through Rye's own Amazon account. $149/month after first month. Sandbox at staging.api.rye.com. Walmart and grocery delivery coverage NOT confirmed. PayPal is NOT a listed payment method.
- **Zinc**: self-serve key + sandbox, but pays from an operator-prefunded wallet (Stripe) and uses the operator's own Amazon/Walmart accounts. That is a concierge model (operator fronts money), so it conflicts with decision (1). API docs not read yet.
- **PayPal**: Vault v3 (setup token -> user approves in PayPal -> reusable payment token), Orders with `intent=AUTHORIZE` then capture or void, sandbox, plus Agent Toolkit / MCP server. PayPal cannot pay Rye or Zinc directly.
Tension: PayPal-as-funding-source + no custody + autonomous live retail cannot all be true. Proposed split:
- **Hackathon build**: PayPal sandbox via a `PayPalPaymentAdapter` (existing `PaymentAdapter` interface). Flow: policy ALLOW -> PayPal authorize exact total (funds stay with the user's PayPal) -> retailer order (mock, or Rye staging) -> verify -> capture; on any failure void the authorization. No stored balance, no wallet. Consent via Vault v3 "Connect PayPal" with the spend limits shown on the consent screen.
- **Production options (choose later, needs legal review)**: (a) Rye with the buyer's own card via Basis Theory: money goes buyer -> merchant, PayPal unused; (b) PayPal pass-through where the operator fronts the retailer and captures after: operator is merchant of record (not "no custody").
BUILT (session 4): hold-first payments. `PaymentAdapter` is now authorize / capture / voidAuthorization / refund / getStatus (idempotent on the order's key). `OrderService.execute`: policy -> **authorize hold** -> retailer order -> verify with provider -> **capture** -> CONFIRMED. Failures: decline = no retailer call; retailer rejects = void hold; capture fails = cancel retailer order + void; any timeout = UNCERTAIN, resolved by `reconcileUncertain` (no retailer order found -> void hold -> FAILED, safe to re-propose; found -> capture). Cancelling a confirmed order refunds. New policy reason `PAYMENT_NOT_CONNECTED` (DENY). `PayPalPaymentAdapter` (`integrations/payments/paypal.ts`) is SANDBOX-pinned (`api-m.sandbox.paypal.com`; live host refused in code and env). Consent: `GET /integrations/paypal/connect` -> PayPal approval -> `/integrations/paypal/callback` (signed state) -> vaulted token encrypted in `CredentialVault`. UI: Limits page "How purchases are paid for" with plain-language consent terms (states that PantryPilot, not PayPal, enforces the limits); order cards show payment state (held / charged / released / refunded). Set `PAYMENT_PROVIDER=paypal` + `PAYPAL_CLIENT_ID/SECRET` + `INTEGRATION_ENCRYPTION_KEY` (+ `API_PUBLIC_URL`).
**UNVERIFIED: the PayPal request bodies (esp. `usage_pattern: UNSCHEDULED_POSTPAID`, `payment_source.paypal.vault_id` + `stored_credential`, response parsing) were written from PayPal docs and tested only against a fake. First job with real sandbox credentials: run one connect + one order and fix whatever PayPal rejects.** Also not built: PayPal webhooks (capture status updates), authorization expiry handling (honor period ~3 days), hackathon-specific PayPal tooling (MCP / Agent Toolkit) — check the hackathon rules.
Zinc review result: its Create Order takes product URL + address + `max_price` + `idempotency_key`, async with webhooks, 20+ US retailers incl. Walmart/Amazon, but payment source is the operator's Zinc wallet / Stripe Connect / MPP: concierge model, so NOT used (conflicts with no-custody). Rye BYO-card remains the production candidate for live retail; not built.
Open (remaining): confirm Rye supports the grocery/Walmart items we need; read Zinc API docs; confirm hackathon rules on required PayPal APIs.

## Realtime and webhooks (session 2)
- `GET /events/stream` (SSE, `?token=` allowed on this route only because EventSource can't set headers) emits one `audit` message per new audit row, scoped to the caller's household. The dashboard refetches on each message (debounced); polling stays as fallback. `next.config.mjs` sets `compress:false` so the stream isn't buffered.
- `POST /webhooks/commerce/:provider`: HMAC (`WEBHOOK_SECRET`, header `x-signature` over the raw body), event-id dedupe, and the provider is then **queried** before state changes. A signed webhook that the provider contradicts changes nothing.

## Bugs the tests caught in session 3 (keep the tests)
- Re-pricing a basket lost `canonicalKey` for live products, so duplicate-order and cooldown checks missed them. `BasketService.rebuild` now carries it.
- `Buffer.from(hex)` silently drops trailing junk, so signatures with extra characters verified. All HMAC checks now go through strict `safeEqualHex`.

## Gotchas learned
- `packages/contracts` must stay `"type": "module"`; without it the API crashes under `tsx` even though Vitest passes. The runtime smoke test caught this.
- Audit events are ordered by `(at, seq)`; the `seq` tiebreak matters when timestamps collide (tests use a fixed clock).
- Web uses hand-written types in `apps/web/lib/types.ts` (does not import contracts at runtime). Keep them in sync with API responses.
- Web talks to the API through a Next rewrite (`/api/v1/*` -> `API_URL`, default `http://localhost:4000`). Token is `NEXT_PUBLIC_DEMO_TOKEN` (default `pp_demo_okafor`).
- Design: warm paper + ink with ONE accent (tomato), Geist + Geist Mono via the `geist` package (no network font fetch), Phosphor icons, framer-motion springs. `DEMO / MOCK` banner is sticky on every page and flips to "Live integrations" if the API reports non-mock providers.

## Not built (be honest in demos)
Postgres/Prisma store, `prisma/seed.ts`, payment webhooks (`/webhooks/payments/*`; only the commerce one exists), `/meal-plans/generate` (returns 501), real LLM, any live device/retailer/payment, Playwright, rate limits are in-memory only, `docs/` folder (architecture/api/threat-model).

## Next highest-value tasks
1. Open the dashboard in a real browser and fix whatever the layout/motion review turns up (mobile bottom nav, tables on narrow screens, contrast).
2. `PrismaStore` + migrations + `prisma/seed.ts`; run the existing test suite against it.
3. Playwright acceptance flow.
4. SSE for activity; docs; one sandbox integration only if credentials are confirmed.
