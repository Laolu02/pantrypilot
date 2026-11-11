# PantryPilot --- Agent Build Handoff

> **Purpose:** This document is the implementation contract for an AI
> coding agent building the PantryPilot autonomous kitchen agent.
>
> **Product direction:** US/UK-first, smart-device-aware kitchen
> inventory, culturally and dietary-aware meal planning, and bounded
> automatic grocery replenishment.
>
> **Build horizon:** 1--2 weeks, solo developer.
>
> **Core engineering principle:** Build a reliable end-to-end workflow
> with simulated integrations first. Keep real device, retailer, and
> payment integrations behind adapters so they can be added without
> rewriting the domain logic.

------------------------------------------------------------------------

## 1. Mission and definition of done

Build a working application that can:

1.  Ingest an event from a connected-device adapter or simulator.
2.  Reconcile the event with the household's kitchen inventory.
3.  Estimate whether a staple needs replenishment.
4.  Find eligible products and calculate a basket using current
    catalogue data.
5.  Enforce household purchase policies using deterministic server-side
    code.
6.  Execute eligible purchases through a mock commerce/payment adapter
    by default.
7.  Verify the result, update order state, and reconcile inventory only
    when the real-world state warrants it.
8.  Explain its actions through an activity timeline and audit log.
9.  Recommend meals grounded in inventory, household preferences,
    allergies, dietary restrictions, culture, and suitable nutrition
    goals.

The primary demo must work end-to-end without manually editing the
database.

### Acceptance scenario

-   Seed a household with milk, eggs, spinach, rice, chicken, and other
    staple items.
-   Simulate a fridge/sensor event reporting low milk quantity.
-   Deduplicate and validate the event.
-   Update inventory through the inventory service and event ledger.
-   Forecast days of supply and decide whether replenishment is
    warranted.
-   Search the mock product catalogue and compare package sizes and unit
    prices.
-   Evaluate the proposed basket against allowlists, item and order
    limits, weekly budget, stock confidence, freshness, and cooldown
    rules.
-   If eligible, create one idempotent order through the mock commerce
    adapter.
-   Verify the mock provider's order result.
-   Record the order and audit events; mark the stock as
    ordered/in-transit rather than delivered.
-   Simulate a second order that exceeds a spending limit and prove that
    the policy engine blocks it.
-   Show the full sequence in the dashboard.

**Never represent a mock transaction as a real purchase.** The UI must
visibly distinguish `DEMO/MOCK` from live integrations.

------------------------------------------------------------------------

## 2. Scope and priorities

### P0 --- Required for the hackathon

-   Next.js dashboard with inventory, device status, meals, shopping,
    purchase policies, and agent activity.
-   Express API with TypeScript and Zod validation.
-   PostgreSQL with Prisma migrations and deterministic seed data.
-   Inventory CRUD, inventory event ledger, device event ingestion,
    deduplication, and reconciliation.
-   Device simulator that produces realistic events.
-   Household preferences and hard allergy/dietary constraints.
-   Structured recipe recommendations and substitution explanations.
-   Deterministic stock forecasting and reorder calculation.
-   Mock grocery catalogue with product search, unit price, package
    size, availability, and price freshness.
-   Deterministic purchase policy engine with `ALLOW`, `DENY`, and
    `REVIEW`.
-   Mock commerce and payment adapters.
-   Idempotent order creation and safe handling of uncertain provider
    outcomes.
-   Agent-run state, audit trail, and live or refresh-based activity
    timeline.
-   Automated tests for policy, inventory, duplicate events, and order
    execution.

### P1 --- Implement only after P0 works

-   One real device integration, if developer credentials and compatible
    hardware are available.
-   One real product catalogue or retailer integration, if API access
    permits the required use.
-   One payment sandbox integration.
-   SSE updates for the dashboard.
-   Expiry-aware meal prioritization and a basic weekly meal plan.

### Explicitly defer

-   Custom computer-vision model training.
-   Multiple live retailers.
-   Unrestricted autonomous shopping.
-   Complex multi-agent systems.
-   Microservices, Kafka, Kubernetes, Redis, and a vector database
    unless a demonstrated need arises.
-   Claims that a fridge can identify arbitrary food items or quantities
    unless the actual hardware/API supports it.

If the schedule is closer to seven days, retain the simulator and mock
commerce/payment provider. A complete, tested loop is more valuable than
partially implemented live integrations.

------------------------------------------------------------------------

## 3. Recommended stack

-   **Monorepo:** pnpm workspaces.
-   **Frontend:** Next.js, TypeScript, Tailwind CSS, shadcn/ui
    components customized to the product.
-   **Backend:** Node.js, Express, TypeScript.
-   **Validation:** Zod.
-   **Database:** PostgreSQL.
-   **ORM/migrations:** Prisma.
-   **Agent:** LLM with structured tool calling; provider must be
    configurable behind a small interface.
-   **Jobs:** `node-cron` or a simple worker process for hackathon use.
    Make jobs safe to repeat.
-   **Realtime:** Server-Sent Events (SSE), optional until core workflow
    is stable.
-   **Tests:** Vitest, Supertest, Playwright.
-   **Local environment:** Docker Compose for PostgreSQL and supporting
    services.
-   **Currency:** integer minor units, never floating-point values for
    money.

Do not add infrastructure merely for appearance. Keep the application as
a modular monolith with clear module boundaries.

------------------------------------------------------------------------

## 4. System architecture

``` mermaid
flowchart TD
    UI["Next.js Kitchen Dashboard"]
    SIM["Device Simulator"]
    HW["Smart Device Adapter"]
    API["Express API"]
    EVT["Device Event Ingestion"]
    INV["Inventory Service"]
    AG["Agent Orchestrator"]
    RULES["Deterministic Policy Engine"]
    SHOP["Commerce Adapter"]
    PAY["Payment Adapter"]
    DB[("PostgreSQL")]
    JOB["Scheduled Worker"]
    AUD["Audit Log"]

    UI --> API
    SIM --> EVT
    HW --> EVT
    EVT --> INV
    INV --> DB
    API --> AG
    API --> INV
    AG --> RULES
    RULES --> SHOP
    SHOP --> PAY
    SHOP --> DB
    PAY --> DB
    AG --> DB
    JOB --> INV
    JOB --> AG
    API --> AUD
    EVT --> AUD
    RULES --> AUD
```

### Responsibilities

**Frontend** - Show current inventory, storage location, expiry,
confidence, and device connectivity. - Show recipe suggestions,
ingredient substitutions, and missing ingredients. - Show replenishment
proposals, product comparisons, policies, order states, and agent
activity. - Clearly identify demo/mock transactions. - Allow household
owners to configure purchase policies and disable autonomy.

**Express API** - Authenticate requests and enforce household-level
authorization. - Validate all input and output contracts. - Call domain
services; do not put domain rules in route handlers. - Expose agent runs
and activity events. - Never allow an LLM to call arbitrary URLs or
execute arbitrary code.

**Domain services** - Own inventory reconciliation, forecasting, recipe
constraint validation, basket calculations, policy evaluation, order
state transitions, and audit writes. - Treat the database as the source
of truth.

**Agent orchestrator** - Plans which read-only and domain tools to
call. - Uses structured input/output schemas. - May explain decisions
and rank eligible alternatives. - Cannot override policy results or
directly write payment/order state. - Must stop when the workflow
returns `REVIEW`, a safety failure, or an unresolved external outcome.

**Policy engine** - Deterministically checks purchase permissions. -
Returns `ALLOW`, `DENY`, or `REVIEW` with machine-readable reason
codes. - Does not rely on an LLM's judgment. - Is re-run immediately
before purchase execution.

**Adapters** - Device adapters translate vendor-specific events to
internal contracts. - Commerce adapters expose only capabilities the
provider actually supports. - Payment adapters encapsulate
provider-specific payment operations. - Provide mock adapters for
reliable tests and demo operation.

**Database** - Stores household data, preferences, inventory, event
ledger, devices, policies, recipes/products as needed, agent runs,
orders, payment state, and audit events.

------------------------------------------------------------------------

## 5. Agent orchestration flow

``` mermaid
flowchart TD
    A["Device event or scheduled scan"] --> B["Validate and deduplicate event"]
    B --> C["Update inventory ledger"]
    C --> D["Forecast stock and demand"]
    D --> E{"Replenishment needed?"}
    E -->|No| F["Record evaluation and finish"]
    E -->|Yes| G["Search eligible products"]
    G --> H["Build and price basket"]
    H --> I["Validate hard constraints"]
    I --> J["Evaluate purchase policy"]
    J -->|Deny| K["Block and explain"]
    J -->|Review| L["Request user review"]
    J -->|Allow| M["Create idempotent order"]
    M --> N["Execute through commerce adapter"]
    N --> O["Verify provider outcome"]
    O --> P["Reconcile order and inventory"]
    P --> Q["Audit, notify, and finish"]
```

### Required workflow behaviour

1.  **Trigger:** Device event, user action, or scheduled stock review.
2.  **Validate:** Validate schema, authentication/signature where
    applicable, timestamp, household/device ownership, and event ID.
3.  **Deduplicate:** Replayed event IDs must not be applied twice.
4.  **Reconcile:** Update stock using the inventory service and append
    an immutable event. If quantity is implausible or confidence is low,
    request reconciliation instead of blindly trusting it.
5.  **Forecast:** Calculate usable stock, consumption estimate, lead
    time, safety days, reorder point, and target quantity. If
    consumption history is missing, use a configured conservative
    fallback and label it as an estimate.
6.  **Product search:** Search only configured catalogue/retailer
    adapters. Refresh price and availability before checkout.
7.  **Basket:** Normalize units and package sizes, round quantities to
    package increments, calculate subtotal, delivery, tax if available,
    and total.
8.  **Hard-constraint validation:** Reject prohibited allergens,
    disallowed categories/products, expired/recalled products when such
    data is available, and unknown products where policy requires an
    allowlist.
9.  **Policy evaluation:** Return `ALLOW`, `DENY`, or `REVIEW` with
    reason codes.
10. **Order creation:** Persist the proposed order and idempotency key
    before external execution. Use a transaction/locking strategy to
    prevent concurrent duplicate orders for the same replenishment need.
11. **Execution:** Call the provider only after rechecking the current
    policy and basket.
12. **Uncertain result:** If a provider request times out, do not
    blindly retry. Query by idempotency/reference or reconcile the
    provider result first.
13. **Verification:** Treat provider responses/webhooks as the source
    for order/payment state, after validating their authenticity.
14. **Inventory:** A placed order is not available stock. Mark it
    ordered/in-transit. Increase on-hand stock only on verified delivery
    or explicit user confirmation.
15. **Audit:** Record the trigger, inputs/references, policy
    version/snapshot, decision, external reference, result, and failure
    reason. Never log credentials or payment secrets.

### Agent run states

Use an explicit state machine, for example:

`QUEUED → RUNNING → POLICY_REVIEW | BLOCKED | EXECUTING → SUCCEEDED | FAILED | NEEDS_RECONCILIATION`

Terminal and retryable states must be distinguishable. Store a
correlation ID for each run so device events, tool calls, order changes,
and audit entries can be traced together.

------------------------------------------------------------------------

## 6. Database design

Use Prisma + PostgreSQL. The existing initial schema can be used as a
starting point, but extend it with these concepts before treating the
app as reliable:

### Core entities

-   `User`: identity and authentication linkage.
-   `Household`: locale, timezone, currency, household size.
-   `Preference`: cuisine, allergies, dietary restrictions, disliked
    ingredients, health goals, budget.
-   `InventoryItem`: canonical ingredient/product, quantity, unit,
    storage, expiry, opened status, confidence, source, observation
    timestamp.
-   `InventoryEvent`: immutable
    add/remove/consume/observe/adjust/deliver event, event ID, quantity
    delta, source, timestamp, correlation ID.
-   `Device`: provider, external ID, household, connection state,
    last-seen timestamp.
-   `DeviceEvent`: unique provider event ID, received timestamp, payload
    reference/hash, processing status.
-   `PurchasePolicy`: enabled flag, mode, allowlists, item/order/weekly
    limits, currency, cooldown, maximum order frequency, minimum
    confidence, policy version.
-   `Product`: canonical product and normalized package/quantity data.
-   `StoreProduct`: provider-specific product ID, price in minor units,
    currency, availability, URL, last checked timestamp.
-   `Recipe`: cuisine, servings, ingredients, instructions, nutrition
    source/estimates, tags.
-   `RecipeIngredient`: canonical ingredient, required quantity/unit,
    substitution metadata.
-   `AgentRun`: trigger, state, timestamps, input/output references,
    correlation ID.
-   `AgentToolCall`: tool name, validated arguments, result summary,
    status, duration, run ID. Redact sensitive values.
-   `ShoppingOrder`: household, provider, status, currency,
    subtotal/delivery/tax/total in minor units, idempotency key, policy
    snapshot/version, external order reference.
-   `OrderItem`: product ID, quantity, unit price, line total.
-   `PaymentAttempt`: provider, status, provider reference, idempotency
    key, amount, timestamps. Never store card details or payment
    credentials.
-   `Approval`: actor, order/basket, approved policy snapshot,
    timestamp, decision, expiration.
-   `AuditEvent`: actor, action, resource, correlation ID, reason,
    timestamp, redacted details.
-   `IntegrationCredential`: provider and encrypted token
    reference/metadata. Never expose secret material to the frontend.

### Data invariants

-   Every household-owned query must be scoped to the authenticated
    household.
-   Device provider + external event ID must be unique for
    deduplication.
-   Every order idempotency key must be unique.
-   Money is integer minor units plus explicit currency.
-   Quantity must be positive for current stock; use signed deltas in
    the event ledger.
-   Inventory mutations must be transactional and auditable.
-   Order and payment statuses must be updated through validated state
    transitions.
-   Do not infer successful payment or delivery from an LLM response.
-   Persist policy snapshot/version used for each purchase decision.
-   Do not increase on-hand inventory when an order is merely proposed
    or placed.
-   Use timestamps consistently and store the household timezone for
    local schedules.

### Forecasting formulas

For an item with usable stock and a positive estimated daily
consumption:

`daysOfSupply = usableOnHand / estimatedDailyConsumption`

`reorderPoint = estimatedDailyConsumption * (leadTimeDays + safetyDays)`

Replenishment is considered when usable stock is at or below the reorder
point. The target quantity should account for target days of supply,
package increments, expiry, storage capacity where known, and budget.

These are baseline heuristics, not claims of precise prediction. Record
forecast inputs and confidence.

------------------------------------------------------------------------

## 7. API contract

Prefix routes with `/api/v1`. Use Zod for all request payloads and
stable error responses such as `{ code, message, requestId, details? }`.
Do not expose internal stack traces.

### Inventory and devices

-   `GET /inventory` --- list inventory with location/expiry/confidence
    filters.
-   `POST /inventory` --- add item.
-   `PATCH /inventory/:id` --- correct quantity, expiry, location, or
    confidence.
-   `DELETE /inventory/:id` --- mark removed and append an event; do not
    erase audit history.
-   `GET /inventory/expiring` --- list items nearing expiry.
-   `POST /inventory/reconcile` --- reconcile discrepancies.
-   `GET /devices` --- list device status.
-   `POST /devices` --- register supported device.
-   `POST /devices/events` --- ingest authenticated, validated device
    event.
-   `POST /devices/simulate` --- development/demo-only simulator
    endpoint; disabled in production.

### Preferences and meals

-   `GET /preferences`
-   `PUT /preferences`
-   `POST /recipes/recommend`
-   `POST /recipes/:id/substitutions`
-   `POST /meal-plans/generate`

Recipe outputs must include ingredient quantities, serving count, steps,
available ingredients, missing ingredients, dietary/constraint
validation, and explanations. A recipe is not allowed to override hard
allergy constraints.

### Agent

-   `POST /agent/runs` --- start an allowed workflow.
-   `GET /agent/runs/:id` --- get state and result.
-   `GET /agent/activity` --- timeline of recent activity.
-   `GET /events/stream` --- SSE updates, if implemented.

### Shopping and payments

-   `GET /products/search`
-   `GET /products/:id`
-   `GET /shopping/policies`
-   `PUT /shopping/policies`
-   `POST /shopping/carts`
-   `POST /shopping/carts/:id/evaluate`
-   `POST /shopping/orders`
-   `GET /shopping/orders`
-   `GET /shopping/orders/:id`
-   `POST /shopping/orders/:id/cancel` --- only where provider supports
    cancellation.
-   `POST /webhooks/commerce/:provider`
-   `POST /webhooks/payments/:provider`

For order creation, require an idempotency key and a server-validated
basket. Never accept a client-supplied total as authoritative. Recompute
prices and totals server-side.

------------------------------------------------------------------------

## 8. Agent tool registry

Expose a small, typed tool set to the model. Keep tool implementations
in domain modules, not inside prompts.

### Read/analysis tools

-   `read_inventory`
-   `read_preferences`
-   `get_expiring_items`
-   `estimate_consumption`
-   `recommend_meals`
-   `validate_recipe`
-   `find_substitutions`
-   `search_grocery_products`
-   `compare_grocery_products`
-   `forecast_stock`

### Controlled action tools

-   `build_replenishment_plan`
-   `evaluate_purchase_policy`
-   `request_purchase_review`
-   `execute_purchase`
-   `verify_purchase`
-   `reconcile_inventory`

### Tool rules

-   Define Zod schemas for tool arguments and outputs.
-   Scope every tool call to the authenticated household and current
    run.
-   The model must not supply an arbitrary household ID to access other
    users' data.
-   No arbitrary network access, shell execution, or dynamic code
    execution.
-   The model cannot directly write database order/payment status.
-   `execute_purchase` accepts an existing persisted order ID and a
    valid policy decision, not arbitrary products and amounts from model
    prose.
-   Recheck policy and price at execution time.
-   Use timeouts, bounded retries, and structured errors.
-   Persist tool-call status and redacted summaries.
-   Stop and return `REVIEW` on ambiguity, low confidence, stale prices,
    unknown allergens, or unexpected provider outcomes according to
    configured policy.

------------------------------------------------------------------------

## 9. Deterministic purchase policy

Implement a pure policy service with three outcomes:

-   `ALLOW`: all mandatory checks pass.
-   `DENY`: a hard rule is violated.
-   `REVIEW`: data is uncertain, stale, outside an allowed range, or
    requires owner approval.

### Mandatory checks

1.  Autonomy is enabled for the household.
2.  Product is explicitly allowlisted or falls within an explicitly
    configured safe category.
3.  Product and quantity are valid and available.
4.  Allergens and dietary exclusions are not violated; unknown
    ingredient data triggers review where required.
5.  Item price is within the per-item cap.
6.  Complete order total, including known fees/tax, is within the order
    cap.
7.  Weekly spend including committed/pending eligible orders stays
    within budget.
8.  Inventory confidence is sufficient.
9.  No equivalent replenishment order is already pending/in flight.
10. Cooldown and maximum order frequency are respected.
11. Price and availability are fresh enough for the policy.
12. Currency matches the household's configured currency or an explicit
    conversion policy is available.
13. Policy is rechecked immediately before external execution.
14. Emergency kill switch is off.

Store a policy decision with machine-readable reason codes and the
policy version/snapshot. Never let the LLM change policy or convert a
`DENY` into `ALLOW`.

### Safety defaults

-   Start with `ALWAYS_CONFIRM`.
-   Use seeded allowlisted products in demo mode.
-   Enable bounded autonomy only for specific allowlisted staples.
-   Set conservative caps and order-frequency limits.
-   If price, product identity, allergen data, or provider outcome is
    uncertain, fail closed or require review.
-   Make the kill switch available in the dashboard and API.
-   Never store payment card data.
-   Do not execute a live purchase without the required user
    authorization and provider-supported payment consent.

------------------------------------------------------------------------

## 10. Adapter interfaces

Use dependency injection so tests can switch between mock and real
providers.

``` ts
export interface DeviceAdapter {
  connect(): Promise<void>;
  getStatus(): Promise<DeviceStatus[]>;
  subscribe(
    handler: (event: NormalizedDeviceEvent) => Promise<void>
  ): Promise<() => Promise<void>>;
}

export interface CommerceAdapter {
  searchProducts(query: ProductSearchQuery): Promise<Product[]>;
  getProduct(productId: string): Promise<Product>;
  checkAvailability(productId: string): Promise<Availability>;
  createOrder(input: CreateOrderInput): Promise<ExternalOrder>;
  getOrder(externalOrderId: string): Promise<ExternalOrder>;
  cancelOrder?(externalOrderId: string): Promise<void>;
}

export interface PaymentAdapter {
  execute(input: AuthorizedPaymentInput): Promise<PaymentResult>;
  getStatus(reference: string): Promise<PaymentResult>;
  refund?(
    reference: string,
    amountMinor: number
  ): Promise<RefundResult>;
}
```

These are internal contracts, not guarantees that every provider
supports every operation. Document capability differences in each
adapter. A product catalogue API does not automatically grant permission
to create carts, place orders, or arrange delivery.

Recommended initial adapters:

-   `SimulatorDeviceAdapter`
-   `MockCommerceAdapter`
-   `MockPaymentAdapter`

Only add a live adapter after credentials, terms, checkout permissions,
and a reliable test environment have been confirmed.

------------------------------------------------------------------------

## 11. Suggested repository structure

``` text
autonomous-kitchen/
├── apps/
│   ├── web/
│   │   ├── app/
│   │   │   ├── dashboard/
│   │   │   ├── inventory/
│   │   │   ├── meals/
│   │   │   ├── shopping/
│   │   │   ├── devices/
│   │   │   ├── policies/
│   │   │   └── activity/
│   │   ├── components/
│   │   │   ├── inventory/
│   │   │   ├── agent/
│   │   │   ├── shopping/
│   │   │   └── dashboard/
│   │   └── lib/
│   │       ├── api-client.ts
│   │       └── event-stream.ts
│   └── api/
│       ├── src/
│       │   ├── app.ts
│       │   ├── server.ts
│       │   ├── config/
│       │   ├── middleware/
│       │   ├── routes/
│       │   ├── modules/
│       │   │   ├── inventory/
│       │   │   ├── devices/
│       │   │   ├── preferences/
│       │   │   ├── recipes/
│       │   │   ├── forecasting/
│       │   │   ├── agent/
│       │   │   ├── shopping/
│       │   │   ├── payments/
│       │   │   └── audit/
│       │   ├── integrations/
│       │   │   ├── devices/
│       │   │   ├── commerce/
│       │   │   └── payments/
│       │   ├── jobs/
│       │   └── lib/
│       └── tests/
├── packages/
│   └── contracts/
│       └── src/
│           ├── inventory.ts
│           ├── device-events.ts
│           ├── recipes.ts
│           ├── shopping.ts
│           └── policies.ts
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── tests/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
├── docs/
│   ├── architecture.md
│   ├── api.md
│   ├── threat-model.md
│   └── demo-script.md
├── docker-compose.yml
├── .env.example
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

Keep route handlers thin: parse/validate → authenticate/authorize → call
service → map result to response. Do not put the entire workflow in a
single controller or giant agent file.

------------------------------------------------------------------------

## 12. UI requirements

Build a distinctive, polished kitchen operations dashboard. Avoid a
generic chatbot-first layout.

### Main dashboard

-   Current inventory summary by pantry/fridge/freezer.
-   Low-stock and expiring-soon sections.
-   Device connectivity and last-seen status.
-   Recommended meals grounded in stock.
-   Replenishment queue with projected cost.
-   Recent agent activity and order states.
-   Visible autonomy state and emergency stop.

### Inventory page

-   Item, quantity, unit, storage location, expiry, confidence, and
    source.
-   Filters for low stock, expiring items, location, and uncertain
    quantities.
-   Clear distinction between observed, manually entered, estimated,
    ordered, and delivered quantities.

### Meals page

-   Recommended recipes with available/missing ingredients.
-   Serving adjustment.
-   Cuisine and dietary explanations.
-   Substitutions with reasons and uncertainty.
-   Never label a meal medically safe based only on generated text.

### Shopping page

-   Product, package size, unit cost, quantity, stock status, freshness
    timestamp, subtotal, fees, and total.
-   Reason the item is being replenished.
-   Policy decision and reason codes.
-   Explicit `MOCK/DEMO` indicator when using a simulated provider.
-   Order lifecycle and external reference where applicable.

### Policies page

-   Autonomy on/off.
-   Approval mode.
-   Allowlisted products/categories.
-   Per-item cap, per-order cap, weekly cap.
-   Order frequency/cooldown.
-   Minimum inventory confidence.
-   Emergency stop.

### Activity page

Show a chronological, traceable timeline: device event → inventory
change → forecast → product selection → policy result → order attempt →
verified result. Display failures clearly, not as successful agent
actions.

------------------------------------------------------------------------

## 13. Implementation schedule

### Days 1--2: Foundation and inventory

-   Scaffold pnpm monorepo.
-   Configure TypeScript, linting, formatting, environment validation,
    and Docker Compose.
-   Create Prisma schema, migrations, seed script, and household
    scoping.
-   Build inventory CRUD and the inventory event ledger.
-   Build device simulator, event validation, deduplication, and
    reconciliation.

**Checkpoint:** A simulated device event safely updates inventory and
appears in the audit history.

### Days 3--4: Meal agent and forecasting

-   Implement household preferences.
-   Add structured LLM provider interface and tool schemas.
-   Build recipe recommendation and deterministic hard-constraint
    validation.
-   Implement substitution evaluation.
-   Implement consumption estimate, days-of-supply, reorder point, and
    target stock calculations.

**Checkpoint:** The agent recommends a feasible meal and correctly
detects a low-stock staple.

### Days 5--6: Shopping and policy

-   Seed a realistic US/UK-oriented mock catalogue with units, packages,
    prices, and availability.
-   Implement product normalization, package-size math, basket
    calculation, and price freshness checks.
-   Implement deterministic purchase policy and reason codes.
-   Implement mock commerce/payment adapters, idempotency, order states,
    and uncertain-outcome reconciliation.

**Checkpoint:** An eligible basket creates one mock order; an
over-budget basket is blocked.

### Days 7--8: Dashboard and reliability

-   Build dashboard, inventory, meals, shopping, policies, device
    status, and activity timeline.
-   Add SSE only if time permits.
-   Add API integration and browser tests.
-   Test duplicate events, concurrent replenishment attempts, stale
    prices, provider timeouts, and failed payments.

**Checkpoint:** The complete demo works from the UI with no manual
database edits.

### Days 9--10: Integrations and presentation

-   Attempt one real device/catalogue integration only if access is
    confirmed.
-   Add provider sandbox integration where feasible.
-   Deploy frontend, API, and managed database.
-   Configure secrets and seed/reset scripts.
-   Prepare a three-to-five-minute demo and backup recording.

**Checkpoint:** The demo is repeatable and clearly distinguishes real
capabilities from simulated ones.

For a one-week event, finish the Day 6 checkpoint and use the remaining
time for UI polish, testing, and demo rehearsal.

------------------------------------------------------------------------

## 14. Testing plan

Use Vitest for unit tests, Supertest for API tests, and Playwright for
the browser-level acceptance test.

### Critical tests

-   Replayed device event is applied once.
-   Invalid/unauthenticated event is rejected.
-   Older device event does not silently overwrite newer state.
-   Implausible quantity or low confidence triggers reconciliation.
-   Stock above reorder point does not trigger a purchase.
-   Stock below reorder point produces a replenishment proposal.
-   Allergy-excluded recipe is rejected.
-   Unknown product/allergen data follows the configured
    fail-closed/review policy.
-   Unallowlisted product is denied.
-   Per-item/order/weekly budget caps are enforced.
-   Duplicate concurrent runs cannot create duplicate orders.
-   Price changes are rechecked before execution.
-   Provider timeout does not lead to blind duplicate purchase.
-   Failed payment does not increase on-hand inventory.
-   Placed order remains pending/in-transit until delivery is verified.
-   Cross-household data access is denied.
-   Kill switch prevents new autonomous purchases.
-   Mock mode is clearly displayed and cannot accidentally invoke live
    payment credentials.

Aim for complete coverage of safety-critical policy branches and
order-state transitions rather than chasing a single overall coverage
percentage.

------------------------------------------------------------------------

## 15. Security and reliability requirements

-   Authentication and household-level authorization on every private
    endpoint.
-   Validate all external inputs with Zod.
-   Use least-privilege provider credentials and store secrets
    server-side.
-   Verify webhook signatures when supported and deduplicate webhook
    events.
-   Apply rate limits to device ingestion, LLM calls, and purchase
    execution.
-   Use idempotency keys for order/payment operations.
-   Treat external provider timeouts as uncertain until reconciled.
-   Never store card numbers or sensitive payment credentials.
-   Never let the model execute arbitrary code, shell commands, or
    arbitrary URLs.
-   Never let the model override allergies, purchase policies, or
    spending limits.
-   Log redacted decision details; do not log access tokens or secrets.
-   Use explicit state transitions for orders and payments.
-   Add a global and household-level purchase kill switch.
-   Keep mock and live providers separated by configuration and
    credentials.
-   Preserve audit history for all inventory and purchasing actions.
-   Do not mark an order paid, delivered, or stocked based only on
    model-generated text.

For production, add credential encryption/rotation, backup and recovery,
retention rules, monitoring, and an incident-response process.

------------------------------------------------------------------------

## 16. Environment and local development

Create `.env.example` with placeholder values only:

``` dotenv
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pantrypilot
WEB_ORIGIN=http://localhost:3000

LLM_PROVIDER=
LLM_API_KEY=
LLM_MODEL=

DEVICE_PROVIDER=simulator
COMMERCE_PROVIDER=mock
PAYMENT_PROVIDER=mock
AUTONOMOUS_PURCHASING_ENABLED=false

PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_BASE_URL=

SMARTTHINGS_TOKEN=
```

Validate environment variables at startup. Never commit a real `.env`
file. Keep live provider configuration disabled by default.

Recommended scripts:

-   `pnpm dev` --- start frontend and API.
-   `pnpm db:up` --- start local database.
-   `pnpm db:migrate` --- apply Prisma migrations.
-   `pnpm db:seed` --- load demo household and catalogue.
-   `pnpm test` --- run unit/integration tests.
-   `pnpm test:e2e` --- run the Playwright acceptance flow.
-   `pnpm lint` --- lint all packages.
-   `pnpm typecheck` --- type-check all packages.
-   `pnpm demo:reset` --- restore deterministic demo state.

Use the project's package manager consistently and pin compatible
dependency versions.

------------------------------------------------------------------------

## 17. Judge-ready demo script

Target duration: 3--5 minutes.

1.  **Show kitchen state:** Display fridge/pantry stock, expiry,
    confidence, and device connection.
2.  **Trigger event:** Simulate the fridge reporting low milk quantity.
    Show the event and inventory reconciliation.
3.  **Show intelligence:** Explain estimated days of supply and why
    replenishment is needed. Show a meal recommendation grounded in
    current stock.
4.  **Show product choice:** Compare package sizes, unit prices, and
    availability from the mock catalogue or a real supported provider.
5.  **Show autonomy:** Show the allowlist and budget policy. Execute an
    eligible purchase in mock/sandbox mode.
6.  **Show verification:** Display the order reference, payment result,
    order state, audit record, and pending-delivery inventory state.
7.  **Show a safety failure:** Trigger an over-budget or unallowlisted
    purchase and prove that it is blocked.
8.  **Close on the value:** The system observes, reasons, acts within
    limits, verifies the outcome, and explains what happened.

Use deterministic seed data and a reset script. Do not rely on a live
retailer, hardware connection, or network call for the core demo to
succeed.

------------------------------------------------------------------------

## 18. Final implementation instructions for the coding agent

1.  Inspect the existing repository before changing files. Preserve
    useful code and report existing constraints.
2.  Read this handoff completely and convert it into a short
    implementation checklist.
3.  Implement in vertical slices, starting with database + inventory +
    simulated device events.
4.  After each slice, run tests, lint, and type-check. Fix failures
    before proceeding.
5.  Use typed contracts and domain services; avoid giant controllers and
    a monolithic prompt.
6.  Implement mock adapters first. Add live integrations only after
    confirming credentials, provider capability, and permissions.
7.  Keep all purchasing decisions enforced by deterministic server-side
    policy.
8.  Use migrations and seed data; do not rely on manual database edits.
9.  Do not invent working provider capabilities or report an integration
    as complete without verifying it.
10. Keep the app runnable at each milestone and document commands and
    configuration.
11. Add a `README.md`, API documentation, architecture diagram, and demo
    instructions.
12. At the end, report: implemented features, architecture decisions,
    exact commands run, tests and results, environment variables
    required, known limitations, and the next highest-value tasks.

### Completion checklist

-   [ ] App and database start from documented commands.
-   [ ] Migrations and seed data run reproducibly.
-   [ ] Simulated device event updates inventory exactly once.
-   [ ] Inventory ledger and audit history are visible.
-   [ ] Recipe recommendations use real inventory/preferences and pass
    hard constraints.
-   [ ] Replenishment calculation is deterministic and tested.
-   [ ] Policy engine supports `ALLOW`, `DENY`, and `REVIEW`.
-   [ ] Mock shopping order is idempotent and verifiable.
-   [ ] Uncertain provider outcomes are reconciled before retry.
-   [ ] Inventory is not increased before delivery confirmation.
-   [ ] UI clearly labels mock/live integrations.
-   [ ] End-to-end demo passes without manual database edits.
-   [ ] README and limitations are documented.

**Product principle:** PantryPilot is not just a recipe chatbot. It is a
stateful kitchen management agent whose actions are constrained,
auditable, and verifiable.
