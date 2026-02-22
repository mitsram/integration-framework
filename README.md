# Integration Testing Framework

**Hybrid Real + Virtual with Schema-Driven Validation**

A comprehensive integration testing framework for App1's integrations with App2 (SOAP), Siebel (Pub/Sub via Integration Layer), and the ETL pipeline (Fivetran → Coalesce → Snowflake → Power BI).

> **Architecture Option:** Option 1 (Hybrid Real + Virtual) + Option 4 (Schema-Driven).
> See [docs/integration-testing-options.md](docs/integration-testing-options.md) for all evaluated options.

---

## Use Case: Create Customer Order

This framework implements one end-to-end use case that exercises all three integration boundaries:

```
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                     "Create Customer Order" Flow                       │
  │                                                                        │
  │  1. User creates order in App1 UI                                      │
  │  2. App1 sends SOAP CreateOrder request → App2 (3rd party)             │
  │  3. App2 responds with order confirmation                              │
  │  4. App1 publishes OrderCreated event → Integration Layer → Siebel     │
  │  5. Siebel acknowledges → OrderUpdated event → App1                    │
  │  6. Order data feeds ETL → Fivetran → Coalesce → Snowflake → Power BI │
  └─────────────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
integration-framework/
├── .github/workflows/
│   └── integration-tests.yml       # GitHub Actions CI/CD pipeline
├── docs/
│   └── integration-testing-options.md  # Architecture options analysis
├── schemas/
│   ├── wsdl/
│   │   └── order-service.wsdl       # App2 SOAP WSDL (schema source of truth)
│   └── messages/
│       ├── order-created-event.schema.json   # Pub/Sub: App1 → Siebel
│       └── order-updated-event.schema.json   # Pub/Sub: Siebel → App1
├── wiremock/
│   └── mappings/
│       ├── soap-order-service.json          # WireMock stubs for App2 SOAP
│       └── pubsub-integration-layer.json    # WireMock stubs for Integration Layer
├── src/
│   ├── clients/
│   │   ├── soap-client.ts           # SOAP client for App1 ↔ App2
│   │   ├── pubsub-client.ts         # Pub/Sub client for App1 ↔ Integration Layer
│   │   └── snowflake-client.ts      # Snowflake client for ETL validation
│   ├── schemas/
│   │   ├── schema-validator.ts      # JSON Schema validation (messages)
│   │   └── wsdl-validator.ts        # WSDL validation (SOAP)
│   └── utils/
│       └── test-helpers.ts          # Test data factories & helpers
├── tests/
│   ├── contract/                    # Pact consumer contract tests
│   │   ├── soap-consumer.pact.spec.ts
│   │   └── pubsub-consumer.pact.spec.ts
│   ├── schema/                      # Schema validation tests
│   │   ├── soap-schema.spec.ts
│   │   └── message-schema.spec.ts
│   ├── integration/
│   │   ├── virtual/                 # Tests against WireMock (CI)
│   │   │   ├── soap-virtual.spec.ts
│   │   │   └── pubsub-virtual.spec.ts
│   │   └── staging/                 # Tests against real staging
│   │       ├── soap-staging.spec.ts
│   │       ├── pubsub-staging.spec.ts
│   │       └── etl-staging.spec.ts
│   └── e2e/                         # End-to-end UI tests
│       └── order-flow.spec.ts
├── scripts/
│   ├── schema-drift-check.ts       # Nightly schema drift detection
│   └── publish-pacts.ts            # Publish Pact contracts to broker
├── docker-compose.yml               # WireMock service
├── playwright.config.ts             # Playwright configuration
├── jest.config.ts                   # Jest config (Pact tests)
├── package.json
└── tsconfig.json
```

---

## Test Pyramid

```
        ╱ ╲               E2E UI Tests (staging only)
       ╱   ╲              ── Playwright browser tests
      ╱─────╲             ── Full order flow through App1 UI
     ╱       ╲
    ╱ Staging  ╲          Staging Integration Tests
   ╱  Integr.  ╲         ── Real App2 SOAP, Integration Layer, Snowflake
  ╱─────────────╲        ── Runs nightly or on deploy
 ╱   Virtual     ╲       Virtual Integration Tests (WireMock)
╱   Integration   ╲      ── Fast CI feedback, no staging dependency
╱───────────────────╲
╱  Schema + Contract  ╲   Schema Validation + Pact Consumer Contracts
╱─────────────────────╲   ── WSDL compliance, JSON Schema, Pact contracts
                          ── Fastest layer, runs on every commit
```

---

## Quick Start

### Prerequisites

- Node.js 20+
- Docker (for WireMock)

### Setup

```bash
# Clone and install
git clone <repo-url>
cd integration-framework
npm install

# Copy environment config
cp .env.example .env
# Edit .env with your staging URLs and Snowflake credentials

# Install Playwright browsers
npx playwright install --with-deps chromium
```

### Run Tests Locally

```bash
# 1. Start WireMock (service virtualization)
npm run wiremock:start

# 2. Run CI test suite (contract + schema + virtual)
#    No staging dependency — runs against WireMock
npm run test:ci

# 3. Run specific test layers
npm run test:contract     # Pact consumer contracts only
npm run test:schema       # Schema validation only
npm run test:virtual      # Virtual integration only (needs WireMock)

# 4. Run staging tests (needs real staging environments)
npm run test:staging

# 5. Run E2E UI tests (needs App1 staging)
npm run test:e2e

# 6. Run schema drift detection (needs staging URLs)
npm run schema:drift-check

# 7. Stop WireMock
npm run wiremock:stop
```

---

## GitHub Actions CI/CD

The pipeline is defined in `.github/workflows/integration-tests.yml` and runs in layers:

| Trigger | Jobs That Run |
|---------|---------------|
| **Push to `main`/`develop`** | CI Tests (contract + schema + virtual) |
| **Pull Request** | CI Tests (contract + schema + virtual) |
| **Nightly (2 AM UTC)** | CI Tests → Staging → E2E → Schema Drift Detection |
| **Manual (`workflow_dispatch`)** | Selectable: ci, staging, e2e, all, drift-check |

### Pipeline Flow

```
Push/PR:
  ┌─────────────┐
  │  CI Tests   │  ← Contract + Schema + Virtual (fast, ~2 min)
  └─────────────┘

Nightly / Manual "all":
  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
  │  CI Tests   │────→│  Staging    │────→│  E2E UI     │     │  Drift      │
  │             │     │  Tests      │     │  Tests      │     │  Detection  │
  └─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       ~2 min              ~5 min              ~10 min              ~1 min
```

### Required Secrets (for staging/E2E)

Configure these in GitHub repository Settings → Secrets:

| Secret | Description |
|--------|-------------|
| `APP1_STAGING_URL` | App1 staging base URL |
| `APP2_STAGING_URL` | App2 staging SOAP endpoint |
| `INTEGRATION_LAYER_URL` | Integration Layer staging URL |
| `SNOWFLAKE_ACCOUNT` | Snowflake account identifier |
| `SNOWFLAKE_USERNAME` | Snowflake username |
| `SNOWFLAKE_PASSWORD` | Snowflake password |
| `SNOWFLAKE_DATABASE` | Snowflake database name |
| `SNOWFLAKE_SCHEMA` | Snowflake schema name |
| `SNOWFLAKE_WAREHOUSE` | Snowflake warehouse name |

---

## How Each Test Layer Works

### 1. Pact Consumer Contracts (`tests/contract/`)

Documents App1's expectations of App2 SOAP and Integration Layer APIs. Since both are 3rd-party, we run **consumer-side only** — no provider verification.

```
App1 expectations  ──→  Pact contract files (pacts/*.json)
                        └─ Serve as living documentation
                        └─ Baseline for drift detection
```

### 2. Schema Validation (`tests/schema/`)

Validates structural compliance against published schemas:
- **SOAP:** App1 requests/responses match App2's WSDL
- **Pub/Sub:** Messages match JSON Schema definitions

This is the **Schema-Driven** element — using the 3rd party's own schemas as truth.

### 3. Virtual Integration (`tests/integration/virtual/`)

Full client-flow tests against WireMock stubs:
- SOAP `CreateOrder` and `GetOrderStatus` against virtualized App2
- Pub/Sub publish, subscribe, and acknowledge against virtualized Integration Layer

Runs on every CI build. No staging dependency.

### 4. Staging Integration (`tests/integration/staging/`)

Same flows tested against real staging:
- Real App2 SOAP endpoints
- Real Integration Layer Pub/Sub
- Real Snowflake queries for ETL validation

Runs nightly or on deploy. Catches real-world drift.

### 5. Schema Drift Detection (`scripts/schema-drift-check.ts`)

Scheduled nightly job that:
1. Fetches live WSDL from App2 staging
2. Fetches live message schemas from Integration Layer
3. Compares against stored versions in `schemas/`
4. Alerts on any structural changes

### 6. E2E UI Tests (`tests/e2e/`)

Browser-based tests through App1's UI that trigger the full integration chain. Uses Playwright Page Object pattern.

---

## Adding New Test Cases

### Add a new SOAP operation test

1. Update WSDL in `schemas/wsdl/` if the operation is new
2. Add WireMock mapping in `wiremock/mappings/soap-order-service.json`
3. Add client method in `src/clients/soap-client.ts`
4. Add Pact test in `tests/contract/soap-consumer.pact.spec.ts`
5. Add virtual test in `tests/integration/virtual/soap-virtual.spec.ts`
6. Add staging test in `tests/integration/staging/soap-staging.spec.ts`

### Add a new Pub/Sub event

1. Create JSON Schema in `schemas/messages/`
2. Add WireMock mapping in `wiremock/mappings/pubsub-integration-layer.json`
3. Add types and client method in `src/clients/pubsub-client.ts`
4. Add Pact test in `tests/contract/pubsub-consumer.pact.spec.ts`
5. Add schema test in `tests/schema/message-schema.spec.ts`
6. Add virtual test in `tests/integration/virtual/pubsub-virtual.spec.ts`

### Add a new ETL validation

1. Add query method in `src/clients/snowflake-client.ts`
2. Add assertions in `tests/integration/staging/etl-staging.spec.ts`

---

## Technology Stack

| Tool | Purpose |
|------|---------|
| [Playwright](https://playwright.dev/) | UI and API testing (TypeScript) |
| [Pact](https://pact.io/) | Consumer-side contract testing |
| [WireMock](https://wiremock.org/) | Service virtualization (SOAP + REST stubs) |
| [AJV](https://ajv.js.org/) | JSON Schema validation for Pub/Sub messages |
| [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) | SOAP XML parsing and WSDL validation |
| [Snowflake SDK](https://docs.snowflake.com/en/developer-guide/node-js/nodejs-driver) | ETL data warehouse queries |
| [Docker](https://www.docker.com/) | WireMock containerization |
| [GitHub Actions](https://github.com/features/actions) | CI/CD pipeline |