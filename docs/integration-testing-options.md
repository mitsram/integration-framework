# Integration Testing Framework — Architecture Options

## Context & Constraints

### System Landscape

```
                        ┌──────────────┐
                        │    App2      │
                        │ (3rd party)  │
                        └──────┬───────┘
                               │ SOAP (bidirectional)
                        ┌──────┴───────┐
        Pub/Sub         │    App1      │──── Data Feed
  ┌─────────────────────┤  (we own)    │
  │                     └──────────────┘
  │  Integration                          
  │    Layer                          Fivetran → Coalesce → Snowflake → Power BI
  │                            
┌─┴────────────┐
│   Siebel     │
│ (3rd party)  │
└──────────────┘
```

### Key Constraints

| Constraint | Impact on Testing Strategy |
|---|---|
| **App2 is 3rd-party** | We cannot run Pact provider verification on App2. We must treat its SOAP interface as an external contract we consume and validate from our side only. |
| **Siebel is 3rd-party** | We cannot instrument Siebel or run provider-side tests. The Integration Layer is the boundary we control. |
| **We own only App1 + Integration Layer** | All test infrastructure must be App1-centric. We test *our side* of every boundary. |
| **Full staging available** | We can run integration tests against real staging for App2, Siebel, and ETL pipeline — high confidence is achievable. |
| **All integrations equally important** | Framework must cover SOAP, Pub/Sub, and ETL from day one. |

### Technology Stack

| Concern | Tool |
|---|---|
| UI & API Testing | Playwright (TypeScript) |
| Contract Testing | Pact (consumer-side only, since providers are 3rd-party) |
| Service Virtualization | WireMock |
| Data Validation | Snowflake SDK / SQL assertions |

---

## Option 1: Hybrid Real + Virtual with Consumer-Side Contracts

**Philosophy:** Use real staging environments as the primary test target. Virtualize 3rd-party systems only for fast CI feedback and when staging is unavailable. Consumer-side Pact contracts document our expectations and detect drift.

### Test Layers

| Layer | Tool | Scope |
|---|---|---|
| **Consumer Contracts** | Pact (consumer-side) | Record App1's expectations of App2 SOAP and Integration Layer messages. No provider verification — instead, contracts are validated against staging responses periodically. |
| **SOAP Integration (Real)** | Playwright API | Call App2 staging SOAP endpoints directly. Validate request/response against WSDL. Test both directions (App1→App2, App2→App1 via callback simulation). |
| **SOAP Integration (Virtual)** | WireMock | Stub App2 SOAP for fast CI runs. Stubs derived from recorded staging traffic + WSDL. |
| **Pub/Sub Integration (Real)** | Playwright API + Message Client | Publish/consume messages to Integration Layer staging. Validate Siebel-bound messages reach the layer and App1 processes Siebel-sourced messages. |
| **Pub/Sub Integration (Virtual)** | WireMock + Custom Pub/Sub Stub | Simulate Integration Layer for CI. Publish synthetic messages to test App1's consumer logic. |
| **ETL Data Validation** | Playwright + Snowflake SDK | Trigger data feed from App1 → validate data lands in Snowflake staging → spot-check Power BI via API. |
| **E2E UI** | Playwright UI | App1 UI workflows that trigger cross-system integrations. Run against staging. |

### How it works

```
CI Pipeline (fast, virtual):
  Pact consumer tests  ──→  generate contract files
  WireMock SOAP stubs  ──→  Playwright API tests (App1↔App2 virtual)
  Pub/Sub stubs         ──→  Playwright API tests (App1↔Integration Layer virtual)

Staging Pipeline (slower, real):
  Playwright API        ──→  real App2 SOAP staging
  Message client        ──→  real Integration Layer staging
  Snowflake queries     ──→  real ETL pipeline staging
  Playwright UI         ──→  real App1 UI → cross-system flows

Contract Drift Detection (scheduled):
  Record staging responses  ──→  compare against Pact contracts  ──→  alert on drift
```

### Pros & Cons

| ✅ Pros | ❌ Cons |
|---|---|
| High confidence from real staging tests | Staging tests are slower and can be flaky |
| Fast CI feedback from virtualized tests | WireMock stubs can drift from real 3rd-party behavior |
| Consumer contracts document expectations | No provider-side verification (3rd-party limitation) |
| Balanced speed vs. confidence | Requires maintaining both virtual and real test suites |
| Pragmatic — works without 3rd-party cooperation | Drift detection is periodic, not guaranteed |

---

## Option 2: Virtualization-First with Contract Snapshots

**Philosophy:** Since we can't enforce contracts on 3rd parties, prioritize full virtualization for speed and reliability. Periodically "snapshot" real 3rd-party behavior to keep stubs honest.

### Test Layers

| Layer | Tool | Scope |
|---|---|---|
| **SOAP Virtualization** | WireMock (recording mode) | Record real App2 SOAP interactions from staging into WireMock mappings. All CI tests run against these recordings. |
| **Pub/Sub Virtualization** | WireMock + Custom Message Stub | Record Integration Layer message patterns. Stub both publish and subscribe sides. |
| **Contract Snapshots** | Pact (consumer-side) + snapshot comparator | Generate Pact contracts from App1's expectations. Periodically replay against staging and compare. Flag any behavioral drift. |
| **ETL Virtualization** | Mocked Fivetran triggers + Snowflake test schema | Use a dedicated Snowflake test schema. Simulate Fivetran sync completion events. |
| **Regression via Replay** | Recorded traffic replay | Replay recorded SOAP and Pub/Sub traffic against App1 to catch regressions. |
| **E2E Smoke (Staging)** | Playwright UI + API | Minimal set of E2E tests against full staging — run nightly or pre-release only. |

### How it works

```
Recording Phase (weekly/on-demand):
  WireMock Proxy Mode   ──→  sits between App1 and App2 staging
                         ──→  captures SOAP request/response pairs
                         ──→  captures Pub/Sub message patterns
                         ──→  saves as WireMock mappings + Pact snapshots

CI Pipeline (fast, fully virtual):
  All tests run against WireMock  ──→  SOAP, Pub/Sub, even ETL triggers
  Pact consumer tests validate expectations against snapshots

Drift Detection (scheduled):
  Replay recorded interactions against live staging
  Compare current responses to saved snapshots
  Alert on structural or behavioral changes
```

### Pros & Cons

| ✅ Pros | ❌ Cons |
|---|---|
| Fastest CI pipeline — everything is virtual | Snapshots can go stale if not refreshed regularly |
| No staging dependency for daily development | Recording infrastructure adds complexity |
| Recorded interactions are realistic (from real systems) | May miss new 3rd-party behaviors between recordings |
| Replay-based regression is powerful | ETL virtualization is approximate at best |
| Low 3rd-party coordination needed | E2E confidence relies on nightly staging runs |

---

## Option 3: Boundary Gateway Testing with Adapter Pattern

**Philosophy:** Treat each 3rd-party integration as a "gateway" with an adapter. Test the adapter in isolation using WireMock, and test App1 business logic against adapter interfaces. Staging tests validate the adapters work against real systems.

### Test Layers

| Layer | Tool | Scope |
|---|---|---|
| **SOAP Gateway Adapter** | Playwright API + WireMock | Isolated test suite for the App1↔App2 SOAP adapter. WireMock simulates App2. Tests cover: marshalling, error handling, retries, timeouts. |
| **Pub/Sub Gateway Adapter** | Playwright API + WireMock | Isolated test suite for App1↔Integration Layer adapter. Tests message serialization, acknowledgment, dead-letter handling. |
| **ETL Gateway Adapter** | Playwright API + Snowflake SDK | Isolated suite for data feed logic. Validate data transformation, schema compliance, feed triggers. |
| **App1 Core Logic** | Unit tests (vitest/jest) | App1 business logic tested with mocked gateway adapters — no WireMock needed. |
| **Adapter Staging Validation** | Playwright API | Each adapter tested against its real staging counterpart. Runs on deploy or nightly. |
| **Cross-Gateway E2E** | Playwright UI | Rare critical paths crossing multiple gateways. Real staging only. |

### Architecture

```
┌─────────────────────────────────────────────────┐
│                    App1                          │
│                                                 │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│   │  SOAP    │  │  Pub/Sub │  │  ETL     │     │
│   │ Gateway  │  │ Gateway  │  │ Gateway  │     │
│   │ Adapter  │  │ Adapter  │  │ Adapter  │     │
│   └─────┬────┘  └─────┬────┘  └─────┬────┘     │
│         │              │              │          │
└─────────┼──────────────┼──────────────┼──────────┘
          │              │              │
    ┌─────┴─────┐  ┌─────┴──────┐  ┌───┴───────────────┐
    │   App2    │  │ Integration│  │ Fivetran/Snowflake │
    │ (staging  │  │   Layer    │  │    (staging)       │
    │  or mock) │  │ (staging   │  │                    │
    │           │  │  or mock)  │  │                    │
    └───────────┘  └────────────┘  └────────────────────┘
```

### Pros & Cons

| ✅ Pros | ❌ Cons |
|---|---|
| Clear separation of concerns — each gateway testable independently | Requires adapter pattern in App1's codebase (may need refactoring) |
| Fast unit/adapter tests with WireMock | More test suites to maintain |
| Staging validation ensures adapters work with real systems | Cross-gateway bugs only caught by E2E tests |
| Easy to add new integrations (new gateway, new adapter) | Initial design effort is higher |
| Natural ownership model — one team per gateway | Adapter pattern may not fit all integration styles |

---

## Option 4: Schema-Driven Testing with WSDL/AsyncAPI Validation

**Philosophy:** Since 3rd parties own their APIs, use their published schemas (WSDL for SOAP, AsyncAPI/JSON Schema for Pub/Sub) as the source of truth. Validate App1's behavior against schemas rather than relying on contracts the provider won't verify.

### Test Layers

| Layer | Tool | Scope |
|---|---|---|
| **WSDL Schema Validation** | Playwright API + WSDL parser | Validate every SOAP request App1 sends conforms to App2's published WSDL. Validate responses App1 handles match WSDL. |
| **Message Schema Validation** | Pact + JSON Schema / AsyncAPI | Validate Pub/Sub messages App1 produces and consumes match the Integration Layer's published message schemas. |
| **Schema-Driven Stubs** | WireMock (auto-generated from WSDL/schemas) | Generate WireMock stubs directly from WSDL and message schemas — stubs are always schema-compliant. |
| **Negative/Edge Testing** | WireMock (fault injection) | Use WireMock to simulate schema-valid but edge-case responses: timeouts, partial data, SOAP faults, malformed messages. |
| **ETL Schema Validation** | Snowflake SDK + dbt tests | Validate data App1 feeds matches expected schema in Snowflake. Use dbt-style assertions for data quality. |
| **Staging Smoke** | Playwright API + UI | Lightweight smoke tests against real staging to confirm schema assumptions hold. |

### How it works

```
Schema Registry (maintained):
  App2 WSDL              ──→  stored in repo, versioned
  Integration Layer schemas ──→  stored in repo, versioned
  Snowflake DDL           ──→  stored in repo, versioned

CI Pipeline:
  Auto-generate WireMock stubs from schemas
  Run Playwright API tests against generated stubs
  Validate App1 requests/messages against schemas
  Run negative/edge-case scenarios

Schema Drift Detection:
  Periodically fetch latest WSDL/schemas from staging
  Compare against stored versions
  Alert + fail CI on unexpected changes
```

### Pros & Cons

| ✅ Pros | ❌ Cons |
|---|---|
| Schemas are the 3rd party's own truth — no need for provider Pact verification | 3rd parties may not publish schemas or keep them updated |
| Auto-generated stubs stay in sync with schemas | Schema compliance ≠ behavioral compliance (valid schema, wrong semantics) |
| Excellent for negative/edge-case testing | WSDL parsing and stub generation requires tooling investment |
| Schema drift detection catches breaking changes early | Pub/Sub schemas may be informal or undocumented |
| Works well without any 3rd-party cooperation | Doesn't test business logic correctness, only structural compliance |

---

## Option 5: Traffic-Based Testing with Record & Replay

**Philosophy:** Don't make assumptions about 3rd-party behavior — record real traffic and use it as the test baseline. Detect regressions by replaying recorded interactions and comparing outcomes.

### Test Layers

| Layer | Tool | Scope |
|---|---|---|
| **Traffic Recording** | WireMock (proxy/record mode) or custom proxy | Sit between App1 and App2/Integration Layer in staging. Record all SOAP and Pub/Sub interactions. |
| **Replay Testing** | WireMock (playback mode) | Replay recorded interactions in CI. App1 processes recorded inputs, and outputs are compared to recorded outputs. |
| **Regression Detection** | Custom diff engine | Compare current App1 responses to recorded baselines. Flag semantic differences (ignore timestamps, IDs, etc.). |
| **Pact as Documentation** | Pact (consumer-side) | Generate Pact contracts from recorded traffic — serve as living documentation of integration behavior. |
| **ETL Regression** | Snowflake snapshot comparison | Take Snowflake table snapshots before/after data feeds. Compare against baseline snapshots. |
| **E2E Golden Path** | Playwright UI | Record and replay critical UI→integration flows. Compare screenshots and data outcomes to golden baselines. |

### How it works

```
Recording (staging, scheduled or on-demand):
  App1 ──→ WireMock Proxy ──→ App2 staging    (records SOAP traffic)
  App1 ──→ Message Proxy  ──→ Integration Layer staging  (records Pub/Sub)
  
  Recordings saved to: tests/recordings/{date}/{integration}/

CI Pipeline:
  WireMock Playback ──→ replays recorded App2 traffic
  Message Playback  ──→ replays recorded Pub/Sub traffic
  App1 processes replayed inputs
  Diff engine compares outputs to recorded baselines
  
Regression Alert:
  Output differs from baseline?  ──→  Flag for review
  Output matches baseline?       ──→  Pass ✅

Baseline Refresh:
  After intentional App1 changes  ──→  re-record and update baselines
```

### Pros & Cons

| ✅ Pros | ❌ Cons |
|---|---|
| Tests based on real 3rd-party behavior — no guessing | Recording infrastructure is non-trivial to build |
| Powerful regression detection | Baseline maintenance burden grows over time |
| Zero 3rd-party cooperation needed | Dynamic data (timestamps, IDs) requires smart diffing |
| Pact contracts auto-generated from real traffic | Doesn't cover new scenarios — only what was recorded |
| Good for legacy integrations with poor documentation | Replay may not work well for stateful interactions |

---

## Comparison Matrix

| Criteria | Option 1: Hybrid | Option 2: Virtual-First | Option 3: Gateway | Option 4: Schema-Driven | Option 5: Record & Replay |
|---|---|---|---|---|---|
| **Speed of CI feedback** | ⚡⚡⚡ | ⚡⚡⚡⚡⚡ | ⚡⚡⚡⚡ | ⚡⚡⚡⚡ | ⚡⚡⚡⚡ |
| **Confidence level** | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **3rd-party cooperation needed** | None | None | None | Minimal (schemas) | None |
| **Initial setup effort** | Medium | Medium-High | High | Medium-High | High |
| **Maintenance burden** | Medium | Medium (refresh recordings) | Medium | Low-Medium | High (baselines) |
| **SOAP coverage** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Pub/Sub coverage** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **ETL coverage** | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Drift detection** | Periodic staging runs | Periodic snapshot refresh | Staging adapter validation | Schema diff on fetch | Baseline comparison |
| **Best for** | Balanced teams that want pragmatism | Teams that need fast, stable CI above all | Teams with clean architecture and clear boundaries | Integrations with well-documented APIs | Legacy integrations with poor/no documentation |

---

## Recommendation

Given the constraints:
- **We own only App1 and the Integration Layer**
- **App2 and Siebel are 3rd-party** (no provider-side contract verification possible)
- **Full staging is available** for all systems
- **All integrations are equally important**

### Primary Recommendation: **Option 1 (Hybrid Real + Virtual)** with elements from **Option 4 (Schema-Driven)**

This combination provides:

1. **Real staging tests** for high confidence — since staging is available for everything
2. **WireMock virtualization** for fast CI — no staging dependency for daily development
3. **Schema validation (WSDL + message schemas)** as drift detection — leverages 3rd-party published schemas without requiring their cooperation
4. **Consumer-side Pact contracts** as living documentation of our expectations

### Suggested Implementation Order

| Phase | Focus | Timeline |
|---|---|---|
| **Phase 1** | Project scaffolding, Playwright setup, WireMock SOAP stubs for App1↔App2 | Weeks 1-2 |
| **Phase 2** | Pub/Sub integration tests (virtual + staging), Pact consumer contracts | Weeks 3-4 |
| **Phase 3** | ETL pipeline validation (Snowflake queries, data assertions) | Weeks 5-6 |
| **Phase 4** | E2E UI flows, schema drift detection, CI/CD integration | Weeks 7-8 |
| **Phase 5** | Power BI validation, reporting, hardening | Weeks 9-10 |
