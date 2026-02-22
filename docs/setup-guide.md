# Test Infrastructure Setup Guide

Step-by-step instructions for setting up and running the integration testing framework locally and in CI/CD.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Project Setup](#2-project-setup)
3. [WireMock — Service Virtualization](#3-wiremock--service-virtualization)
4. [Pact — Consumer Contract Testing](#4-pact--consumer-contract-testing)
5. [Playwright — API & UI Testing](#5-playwright--api--ui-testing)
6. [Schema Validation (AJV & WSDL)](#6-schema-validation-ajv--wsdl)
7. [Snowflake — ETL Pipeline Validation](#7-snowflake--etl-pipeline-validation)
8. [Environment Configuration](#8-environment-configuration)
9. [Running Tests Locally](#9-running-tests-locally)
10. [GitHub Actions CI/CD](#10-github-actions-cicd)
11. [Pact Broker (Optional)](#11-pact-broker-optional)
12. [AWS Deployment](#12-aws-deployment)
13. [Schema Drift Detection](#13-schema-drift-detection)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Prerequisites

Install the following before proceeding:

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | >= 20.0.0 | Runtime |
| **npm** | >= 9 | Package manager (ships with Node.js) |
| **Docker** | >= 24 | Runs WireMock container |
| **Docker Compose** | >= 2.20 (plugin) | Orchestrates containers |
| **Git** | >= 2.40 | Version control |

Verify installations:

```bash
node -v          # v20.x.x or higher
npm -v           # 9.x.x or higher
docker -v        # Docker version 24.x or higher
docker compose version   # v2.20 or higher
git --version    # 2.40 or higher
```

---

## 2. Project Setup

### 2.1 Clone the Repository

```bash
git clone <your-repo-url> integration-framework
cd integration-framework
```

### 2.2 Install Dependencies

```bash
npm install
```

This installs all packages defined in `package.json`:

| Package | Role |
|---------|------|
| `@pact-foundation/pact` | Consumer contract test library (Pact V4) |
| `@playwright/test` | API & browser-based UI testing |
| `ajv` / `ajv-formats` | JSON Schema validation engine |
| `fast-xml-parser` | SOAP XML and WSDL parsing |
| `snowflake-sdk` | Snowflake data warehouse connectivity |
| `uuid` | UUID generation for test data |
| `jest` / `ts-jest` | Test runner for Pact contract tests |
| `typescript` | TypeScript compiler |
| `dotenv` | Loads `.env` files into `process.env` |

### 2.3 Install Playwright Browsers

```bash
npx playwright install --with-deps chromium
```

This downloads the Chromium browser binary needed for UI and API tests. Only Chromium is required — skip `firefox` and `webkit` to save time.

### 2.4 Create Environment File

```bash
cp .env.example .env
```

Edit `.env` with your values (see [Section 8](#8-environment-configuration) for details).

---

## 3. WireMock — Service Virtualization

WireMock simulates the external systems (App2 SOAP API and the Integration Layer Pub/Sub API) so you can run integration tests without access to staging environments.

### 3.1 How It Works

- WireMock runs as a Docker container on port **8080**
- Stub mappings in `wiremock/mappings/` define request-response pairs
- Two mapping files are included:
  - `soap-order-service.json` — Simulates App2's SOAP OrderService (CreateOrder success, SOAP fault, GetOrderStatus, timeout)
  - `pubsub-integration-layer.json` — Simulates the Integration Layer Pub/Sub API (publish, subscribe, acknowledge, health check)

### 3.2 Start WireMock

```bash
npm run wiremock:start
```

This runs `docker compose up -d wiremock`, which:
1. Pulls the `wiremock/wiremock:3.9.1` image (first run only)
2. Starts the container in detached mode
3. Mounts `./wiremock/mappings` into the container
4. Exposes port **8080**

### 3.3 Verify WireMock Is Running

```bash
curl http://localhost:8080/__admin/health
```

Expected response:

```json
{ "status": "healthy" }
```

You can also list loaded stubs:

```bash
curl http://localhost:8080/__admin/mappings
```

### 3.4 Stop WireMock

```bash
npm run wiremock:stop
```

### 3.5 Adding or Modifying Stubs

Stubs live in `wiremock/mappings/`. Each JSON file can contain multiple mappings under a `"mappings"` array. To add a new stub:

1. Create or edit a `.json` file in `wiremock/mappings/`
2. Follow the WireMock JSON mapping format:

```json
{
  "mappings": [
    {
      "name": "My New Stub",
      "request": {
        "method": "POST",
        "url": "/my/endpoint",
        "headers": {
          "Content-Type": { "contains": "application/json" }
        }
      },
      "response": {
        "status": 200,
        "headers": { "Content-Type": "application/json" },
        "jsonBody": { "status": "ok" }
      }
    }
  ]
}
```

3. Restart WireMock or hot-reload mappings:

```bash
# Hot reload (no restart needed)
curl -X POST http://localhost:8080/__admin/mappings/reset

# Or restart
npm run wiremock:stop && npm run wiremock:start
```

### 3.6 WireMock in CI (GitHub Actions)

In CI, WireMock runs as a **service container** — Docker is not required in your workflow steps. The service is defined in the workflow file and starts automatically. Mappings are loaded via a `curl` POST to `/__admin/mappings/import` after the container is healthy (see `.github/workflows/integration-tests.yml`).

---

## 4. Pact — Consumer Contract Testing

Pact generates contract files documenting App1's expectations of the external APIs. Since App2 and Siebel are 3rd-party systems, we run **consumer-side only** — no provider verification.

### 4.1 How It Works

- Tests are located in `tests/contract/`
- Two contract test files:
  - `soap-consumer.pact.spec.ts` — App1 ↔ App2 SOAP contract (CreateOrder, GetOrderStatus)
  - `pubsub-consumer.pact.spec.ts` — App1 ↔ Integration Layer Pub/Sub contract (publish OrderCreated, subscribe OrderUpdated)
- Pact V4 spins up an in-process mock server per test — **no external service needed**
- Generated contract files (`.json`) are saved to the `pacts/` directory

### 4.2 Configuration

Pact tests use **Jest** as the test runner, configured in `jest.config.ts`:

| Setting | Value |
|---------|-------|
| Preset | `ts-jest` |
| Test environment | `node` |
| Test match pattern | `**/*.pact.spec.ts` |
| Output directory for contracts | `pacts/` |
| JUnit report | `reports/pact-junit-results.xml` |

### 4.3 Run Contract Tests

```bash
npm run test:contract
```

After running, contract files appear in `pacts/`:

```
pacts/
  App1-App2-OrderService.json
  App1-IntegrationLayer-PubSub.json
```

### 4.4 Pact Test Structure

Each Pact test follows the same pattern:

```typescript
import { PactV4, MatchersV3 } from "@pact-foundation/pact";

const provider = new PactV4({
  consumer: "App1",
  provider: "App2-OrderService",
  dir: path.resolve(process.cwd(), "pacts"),
});

describe("My Contract", () => {
  it("should do something", async () => {
    await provider
      .addInteraction()
      .given("some provider state")
      .uponReceiving("a description of the request")
      .withRequest("POST", "/endpoint", (builder) => {
        builder.headers({ "Content-Type": "application/json" });
        builder.jsonBody({ key: "value" });
      })
      .willRespondWith(200, (builder) => {
        builder.jsonBody({ result: "ok" });
      })
      .executeTest(async (mockserver) => {
        // Call endpoint on mockserver.url and make assertions
      });
  });
});
```

### 4.5 Key Design Decision: Consumer-Side Only

Because App2 and Siebel are 3rd-party systems we don't control, we cannot run provider-side verification against them. The generated contract files serve as:

- **Living documentation** of what App1 expects
- **Baseline for drift detection** — compare against actual responses
- **Version-controlled artifacts** committed to the repository or published to a Pact Broker

---

## 5. Playwright — API & UI Testing

Playwright serves two roles in this framework:

1. **API testing** — SOAP and REST calls via `APIRequestContext` (no browser needed)
2. **UI testing** — Browser-based E2E tests with the Page Object pattern

### 5.1 Configuration

Defined in `playwright.config.ts` with four projects:

| Project | Directory | Base URL | Purpose |
|---------|-----------|----------|---------|
| `schema-validation` | `tests/schema/` | WireMock (`localhost:8080`) | Validate payloads against WSDL/JSON schemas |
| `virtual-integration` | `tests/integration/virtual/` | WireMock (`localhost:8080`) | Integration tests against stubs |
| `staging-integration` | `tests/integration/staging/` | App2 staging URL | Integration tests against real environments |
| `e2e-ui` | `tests/e2e/` | App1 base URL | Browser-based order flow tests |

### 5.2 Run Specific Test Projects

```bash
# Schema validation only
npm run test:schema

# Virtual integration (against WireMock)
npm run test:virtual

# Staging integration (requires staging environments)
npm run test:staging

# E2E UI tests (requires App1 running)
npm run test:e2e
```

### 5.3 Test Reports

Playwright generates reports in:
- `reports/playwright/` — HTML report (open with `npx playwright show-report reports/playwright`)
- `reports/junit-results.xml` — JUnit XML for CI integration
- `test-results/` — Traces, screenshots, videos (on failure)

---

## 6. Schema Validation (AJV & WSDL)

Schema validation ensures App1's payloads conform to the published API contracts, even before hitting real systems.

### 6.1 JSON Schema Validation

JSON schemas for Pub/Sub messages are stored in `schemas/messages/`:

| Schema File | Event |
|-------------|-------|
| `order-created-event.schema.json` | OrderCreated (App1 → Integration Layer → Siebel) |
| `order-updated-event.schema.json` | OrderUpdated (Siebel → Integration Layer → App1) |

The `SchemaValidator` class (in `src/schemas/schema-validator.ts`) uses **AJV** to compile and validate payloads against these schemas.

### 6.2 WSDL Validation

The App2 SOAP WSDL is stored in `schemas/wsdl/order-service.wsdl`.

The `WsdlValidator` class (in `src/schemas/wsdl-validator.ts`) parses the WSDL using `fast-xml-parser` and validates SOAP request/response bodies contain the correct elements.

### 6.3 Run Schema Tests

```bash
npm run test:schema
```

This runs tests in `tests/schema/` that verify:
- WSDL structure (operations, SOAP actions, required fields)
- SOAP body compliance (request/response match WSDL definitions)
- JSON message validity (valid events pass, invalid events are rejected)

### 6.4 Updating Schemas

When a 3rd-party system publishes a new contract:

1. Replace the WSDL file in `schemas/wsdl/`
2. Replace or update JSON schemas in `schemas/messages/`
3. Run schema tests to verify App1's payloads still conform
4. Update WireMock stubs if response structures changed

---

## 7. Snowflake — ETL Pipeline Validation

ETL staging tests validate that data flows correctly through the pipeline:
**App1 → Fivetran → Coalesce → Snowflake → Power BI**

### 7.1 Configuration

Snowflake credentials are set via environment variables (see `.env.example`):

```env
SNOWFLAKE_ACCOUNT=your_account.region
SNOWFLAKE_USERNAME=your_username
SNOWFLAKE_PASSWORD=your_password
SNOWFLAKE_DATABASE=APP1_DW
SNOWFLAKE_SCHEMA=PUBLIC
SNOWFLAKE_WAREHOUSE=COMPUTE_WH
```

### 7.2 What ETL Tests Validate

Tests in `tests/integration/staging/etl-staging.spec.ts` check:

- **Data landing** — `ORDERS` and `ORDER_ITEMS` tables are populated
- **Specific record lookup** — An order created in App1 appears in Snowflake
- **Data freshness** — Data was synced within the last 24 hours
- **Data quality** — No NULL values in required columns, no negative amounts, valid statuses, referential integrity
- **Power BI availability** — Dataset is accessible via the Power BI REST API (optional)

### 7.3 Run ETL Tests

```bash
# Runs as part of the staging suite
npm run test:staging
```

> **Note:** ETL tests require Snowflake credentials and a populated warehouse. They run in the staging and nightly CI pipelines only.

---

## 8. Environment Configuration

### 8.1 Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```env
# WireMock (local development — usually no change needed)
WIREMOCK_URL=http://localhost:8080

# App1 (your application under test)
APP1_BASE_URL=http://localhost:3000

# App2 Staging (3rd-party SOAP service)
APP2_STAGING_URL=http://app2-staging.example.com:8443

# Integration Layer (Pub/Sub gateway to Siebel)
INTEGRATION_LAYER_URL=http://integration-layer-staging.example.com:8080

# Snowflake (ETL data warehouse)
SNOWFLAKE_ACCOUNT=your_account.region
SNOWFLAKE_USERNAME=your_username
SNOWFLAKE_PASSWORD=your_password
SNOWFLAKE_DATABASE=APP1_DW
SNOWFLAKE_SCHEMA=PUBLIC
SNOWFLAKE_WAREHOUSE=COMPUTE_WH

# Pact Broker (optional)
# PACT_BROKER_URL=https://your-broker.pactflow.io
# PACT_BROKER_TOKEN=your_token

# Power BI (optional)
# POWERBI_API_URL=https://api.powerbi.com
# POWERBI_ACCESS_TOKEN=your_token
```

### 8.2 Which Variables Are Needed Per Test Suite

| Variable | CI Tests | Staging | E2E | Drift Check |
|----------|:--------:|:-------:|:---:|:-----------:|
| `WIREMOCK_URL` | ✅ | — | — | — |
| `APP1_BASE_URL` | — | ✅ | ✅ | — |
| `APP2_STAGING_URL` | — | ✅ | — | ✅ |
| `INTEGRATION_LAYER_URL` | — | ✅ | ✅ | ✅ |
| `SNOWFLAKE_*` | — | ✅ | — | — |
| `PACT_BROKER_*` | optional | — | — | — |

---

## 9. Running Tests Locally

### 9.1 Quick Start (CI-level tests, no staging needed)

```bash
# 1. Install dependencies
npm install
npx playwright install --with-deps chromium

# 2. Start WireMock
npm run wiremock:start

# 3. Run CI test suite (contract + schema + virtual)
npm run test:ci

# 4. Stop WireMock when done
npm run wiremock:stop
```

### 9.2 Run All Test Suites

| Command | What It Runs | Requires |
|---------|-------------|----------|
| `npm run test:contract` | Pact consumer contract tests | Nothing (in-process mock) |
| `npm run test:schema` | WSDL + JSON schema validation | WireMock |
| `npm run test:virtual` | Virtual integration (SOAP + Pub/Sub) | WireMock |
| `npm run test:staging` | Staging integration (SOAP + Pub/Sub + ETL) | Staging environments + Snowflake |
| `npm run test:e2e` | E2E browser tests | App1 running + staging |
| `npm run test:ci` | Contract + Schema + Virtual | WireMock |
| `npm run test` | Everything | WireMock + staging + App1 |

### 9.3 View Test Reports

```bash
# Playwright HTML report
npx playwright show-report reports/playwright

# Pact contracts (raw JSON)
cat pacts/*.json | jq
```

---

## 10. GitHub Actions CI/CD

The workflow is defined in `.github/workflows/integration-tests.yml`.

### 10.1 Pipeline Jobs

| Job | Trigger | Dependencies | What It Does |
|-----|---------|-------------|--------------|
| **ci-tests** | Every push/PR | WireMock (service container) | Contract + Schema + Virtual tests |
| **staging-tests** | Nightly / manual | ci-tests pass | SOAP + Pub/Sub + ETL against staging |
| **e2e-tests** | Nightly / manual | staging-tests pass | Browser-based UI tests |
| **schema-drift-check** | Nightly / manual | None | Compares stored schemas vs live APIs |
| **notify** | Always (after all) | All jobs | Aggregates results into GitHub Step Summary |

### 10.2 Required GitHub Secrets

Configure these in your repository settings (**Settings → Secrets and variables → Actions**):

| Secret | Required For | Example |
|--------|-------------|---------|
| `APP2_STAGING_URL` | staging-tests, drift-check | `https://app2-staging.example.com:8443` |
| `APP1_STAGING_URL` | staging-tests, e2e-tests | `https://app1-staging.example.com` |
| `INTEGRATION_LAYER_URL` | staging-tests, e2e-tests, drift-check | `https://il-staging.example.com:8080` |
| `SNOWFLAKE_ACCOUNT` | staging-tests | `my_org.us-east-1` |
| `SNOWFLAKE_USERNAME` | staging-tests | `SVC_TEST_USER` |
| `SNOWFLAKE_PASSWORD` | staging-tests | `(secret)` |
| `SNOWFLAKE_DATABASE` | staging-tests | `APP1_DW` |
| `SNOWFLAKE_SCHEMA` | staging-tests | `PUBLIC` |
| `SNOWFLAKE_WAREHOUSE` | staging-tests | `COMPUTE_WH` |

### 10.3 GitHub Environment

Create a **staging** environment in your repository (**Settings → Environments → New environment**):

1. Name: `staging`
2. Add protection rules if desired (e.g., required reviewers)
3. Add the secrets listed above to this environment

### 10.4 Manual Trigger

You can trigger specific suites manually via **Actions → Integration Tests → Run workflow**:

| Input | Runs |
|-------|------|
| `ci` | Contract + Schema + Virtual |
| `staging` | Staging integration tests |
| `e2e` | E2E browser tests |
| `drift-check` | Schema drift detection |
| `all` | Everything |

### 10.5 CI Test Artifacts

Each job uploads artifacts that are downloadable from the GitHub Actions run page:

| Artifact | Contents | Retention |
|----------|----------|-----------|
| `pact-contracts` | Generated Pact JSON files | 30 days |
| `ci-test-reports` | Playwright + JUnit reports | 14 days |
| `staging-test-reports` | Staging test results | 30 days |
| `e2e-test-reports` | E2E reports, traces, screenshots | 30 days |
| `drift-detection-report` | Schema comparison results | 30 days |

---

## 11. Pact Broker (Optional)

A Pact Broker provides a central registry for contracts. This is optional because our 3rd-party providers won't run verification, but it's useful for:

- Versioned contract history
- Team visibility into API expectations
- Webhook-driven drift notifications

### 11.1 Option A: Pactflow (SaaS)

1. Sign up at [pactflow.io](https://pactflow.io)
2. Get your broker URL and API token
3. Set environment variables:

```bash
export PACT_BROKER_URL=https://your-org.pactflow.io
export PACT_BROKER_TOKEN=your_api_token
```

### 11.2 Option B: Self-Hosted Pact Broker

Run the open-source Pact Broker via Docker:

```bash
docker run -d \
  --name pact-broker \
  -p 9292:9292 \
  -e PACT_BROKER_DATABASE_URL=sqlite:////tmp/pact_broker.sqlite \
  pactfoundation/pact-broker
```

Then set:

```bash
export PACT_BROKER_URL=http://localhost:9292
```

### 11.3 Publish Contracts

After running contract tests:

```bash
npm run pact:publish
```

This reads `pacts/*.json` and publishes them via the Pact Broker REST API with the current Git SHA as the version.

---

## 12. AWS Deployment

This section covers hosting WireMock and Pact Broker on AWS, and connecting GitHub Actions to the deployed infrastructure.

### 12.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  GitHub Actions                                                 │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                │
│  │ ci-tests   │  │ staging    │  │ drift-check│                │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘                │
│        │ OIDC          │               │                        │
└────────┼───────────────┼───────────────┼────────────────────────┘
         │               │               │
         ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────┐
│  AWS Account                                                    │
│                                                                 │
│  ┌──────────── VPC (10.0.0.0/16) ──────────────────────────┐   │
│  │                                                          │   │
│  │  Public Subnets                                          │   │
│  │  ┌─────────────────────────────────────────────┐         │   │
│  │  │  ALB (Application Load Balancer)             │         │   │
│  │  │  ├── wiremock.test-infra.example.com:443    │         │   │
│  │  │  └── pact-broker.test-infra.example.com:443 │         │   │
│  │  └─────────────────────────────────────────────┘         │   │
│  │                       │                                  │   │
│  │  Private Subnets      ▼                                  │   │
│  │  ┌───────────────┐  ┌───────────────┐                    │   │
│  │  │ ECS Fargate   │  │ ECS Fargate   │                    │   │
│  │  │ WireMock      │  │ Pact Broker   │                    │   │
│  │  │ Service       │  │ Service       │                    │   │
│  │  └───────────────┘  └───────┬───────┘                    │   │
│  │                             │                            │   │
│  │                     ┌───────▼───────┐                    │   │
│  │                     │ RDS Postgres  │                    │   │
│  │                     │ (Pact Store)  │                    │   │
│  │                     └───────────────┘                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ ECR          │  │ S3           │  │ IAM OIDC     │          │
│  │ (images)     │  │ (artifacts)  │  │ (GH Actions) │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### 12.2 Prerequisites for AWS Deployment

| Tool | Purpose |
|------|---------|
| **AWS CLI** v2 | Interact with AWS services |
| **Terraform** >= 1.5 (recommended) | Infrastructure as code |
| **AWS Account** | With permissions for ECS, ECR, RDS, ALB, VPC, IAM |
| **Domain / Route 53 hosted zone** (optional) | Custom DNS for ALB endpoints |

```bash
aws --version        # aws-cli/2.x.x
terraform -version   # Terraform v1.5+
```

### 12.3 Deploy WireMock on AWS (ECS Fargate)

WireMock runs as a long-lived ECS Fargate service behind an ALB. Stubs are baked into a custom Docker image.

#### 12.3.1 Build a Custom WireMock Image

Create `wiremock/Dockerfile`:

```dockerfile
FROM wiremock/wiremock:3.9.1

# Copy stub mappings into the image
COPY mappings/ /home/wiremock/mappings/
```

Build and push to ECR:

```bash
# Create ECR repository (one-time)
aws ecr create-repository --repository-name integration-framework/wiremock \
  --region us-east-1

# Authenticate Docker to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Build and push
docker build -t integration-framework/wiremock:latest ./wiremock
docker tag integration-framework/wiremock:latest \
  <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/integration-framework/wiremock:latest
docker push \
  <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/integration-framework/wiremock:latest
```

#### 12.3.2 ECS Task Definition

Create `infra/wiremock-task-def.json`:

```json
{
  "family": "wiremock",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::<ACCOUNT_ID>:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "wiremock",
      "image": "<ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/integration-framework/wiremock:latest",
      "portMappings": [
        { "containerPort": 8080, "protocol": "tcp" }
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:8080/__admin/health || exit 1"],
        "interval": 10,
        "timeout": 5,
        "retries": 3
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/wiremock",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "wiremock"
        }
      }
    }
  ]
}
```

#### 12.3.3 Create the ECS Service

```bash
# Register task definition
aws ecs register-task-definition \
  --cli-input-json file://infra/wiremock-task-def.json

# Create ECS cluster (one-time)
aws ecs create-cluster --cluster-name test-infra

# Create service behind ALB
aws ecs create-service \
  --cluster test-infra \
  --service-name wiremock \
  --task-definition wiremock \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxxxx],securityGroups=[sg-xxxxx],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...:targetgroup/wiremock-tg/...,containerName=wiremock,containerPort=8080"
```

#### 12.3.4 Updating Stubs on AWS

When you modify WireMock stubs, rebuild and redeploy:

```bash
# Rebuild image with updated mappings
docker build -t integration-framework/wiremock:latest ./wiremock
docker tag integration-framework/wiremock:latest \
  <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/integration-framework/wiremock:latest
docker push \
  <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/integration-framework/wiremock:latest

# Force new deployment
aws ecs update-service --cluster test-infra --service wiremock --force-new-deployment
```

Alternatively, use the WireMock Admin API to hot-reload stubs at runtime:

```bash
WIREMOCK_URL=https://wiremock.test-infra.example.com

for mapping in wiremock/mappings/*.json; do
  curl -s -X POST "$WIREMOCK_URL/__admin/mappings/import" \
    -H "Content-Type: application/json" \
    -d @"$mapping"
done
```

### 12.4 Deploy Pact Broker on AWS (ECS Fargate + RDS)

The Pact Broker needs a persistent database. We use RDS PostgreSQL.

#### 12.4.1 Create RDS PostgreSQL Instance

```bash
# Create a DB subnet group
aws rds create-db-subnet-group \
  --db-subnet-group-name test-infra-db \
  --db-subnet-group-description "Subnets for test infra databases" \
  --subnet-ids subnet-xxxxx subnet-yyyyy

# Create RDS instance
aws rds create-db-instance \
  --db-instance-identifier pact-broker-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 15 \
  --master-username pactbroker \
  --master-user-password '<STRONG_PASSWORD>' \
  --allocated-storage 20 \
  --db-subnet-group-name test-infra-db \
  --vpc-security-group-ids sg-xxxxx \
  --no-publicly-accessible \
  --storage-encrypted \
  --backup-retention-period 7
```

Note the RDS endpoint after creation:

```bash
aws rds describe-db-instances --db-instance-identifier pact-broker-db \
  --query 'DBInstances[0].Endpoint.Address' --output text
# → pact-broker-db.xxxx.us-east-1.rds.amazonaws.com
```

#### 12.4.2 ECS Task Definition for Pact Broker

Create `infra/pact-broker-task-def.json`:

```json
{
  "family": "pact-broker",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::<ACCOUNT_ID>:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "pact-broker",
      "image": "pactfoundation/pact-broker:latest",
      "portMappings": [
        { "containerPort": 9292, "protocol": "tcp" }
      ],
      "environment": [
        { "name": "PACT_BROKER_DATABASE_URL", "value": "postgres://pactbroker:<PASSWORD>@pact-broker-db.xxxx.us-east-1.rds.amazonaws.com/pactbroker" },
        { "name": "PACT_BROKER_PORT", "value": "9292" },
        { "name": "PACT_BROKER_LOG_LEVEL", "value": "INFO" },
        { "name": "PACT_BROKER_BASE_URL", "value": "https://pact-broker.test-infra.example.com" }
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:9292/diagnostic/status/heartbeat || exit 1"],
        "interval": 10,
        "timeout": 5,
        "retries": 3
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/pact-broker",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "pact-broker"
        }
      }
    }
  ]
}
```

> **Security tip:** Store `PACT_BROKER_DATABASE_URL` in AWS Secrets Manager and reference it via `secrets` instead of `environment` in the task definition. See [ECS Secrets documentation](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data-secrets.html).

#### 12.4.3 Create the Pact Broker ECS Service

```bash
aws ecs register-task-definition \
  --cli-input-json file://infra/pact-broker-task-def.json

aws ecs create-service \
  --cluster test-infra \
  --service-name pact-broker \
  --task-definition pact-broker \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxxxx],securityGroups=[sg-xxxxx],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...:targetgroup/pact-broker-tg/...,containerName=pact-broker,containerPort=9292"
```

#### 12.4.4 Verify Pact Broker

```bash
curl https://pact-broker.test-infra.example.com/diagnostic/status/heartbeat
# → {"ok":true}

# View the dashboard
open https://pact-broker.test-infra.example.com
```

### 12.5 Networking & Security

#### 12.5.1 VPC Layout

| Component | Subnet Type | Why |
|-----------|------------|-----|
| ALB | Public | Accepts HTTPS traffic from GitHub Actions runners |
| ECS Tasks (WireMock, Pact Broker) | Private | Not directly internet-exposed |
| RDS PostgreSQL | Private | Database accessible only from ECS tasks |

#### 12.5.2 Security Groups

| Security Group | Inbound Rules | Attached To |
|---------------|---------------|-------------|
| `sg-alb` | TCP 443 from `0.0.0.0/0` (HTTPS) | ALB |
| `sg-ecs-wiremock` | TCP 8080 from `sg-alb` | WireMock ECS tasks |
| `sg-ecs-pact-broker` | TCP 9292 from `sg-alb` | Pact Broker ECS tasks |
| `sg-rds` | TCP 5432 from `sg-ecs-pact-broker` | RDS instance |

> **Restricting access:** For tighter security, replace ALB's `0.0.0.0/0` rule with [GitHub Actions IP ranges](https://api.github.com/meta) or use AWS PrivateLink with a self-hosted runner.

#### 12.5.3 ALB Configuration

Create an Application Load Balancer with two target groups:

```bash
# Create ALB
aws elbv2 create-load-balancer \
  --name test-infra-alb \
  --subnets subnet-public-a subnet-public-b \
  --security-groups sg-alb \
  --scheme internet-facing \
  --type application

# Create target groups
aws elbv2 create-target-group \
  --name wiremock-tg \
  --protocol HTTP --port 8080 \
  --target-type ip \
  --vpc-id vpc-xxxxx \
  --health-check-path /__admin/health

aws elbv2 create-target-group \
  --name pact-broker-tg \
  --protocol HTTP --port 9292 \
  --target-type ip \
  --vpc-id vpc-xxxxx \
  --health-check-path /diagnostic/status/heartbeat

# Create HTTPS listener with host-based routing
aws elbv2 create-listener \
  --load-balancer-arn <ALB_ARN> \
  --protocol HTTPS --port 443 \
  --certificates CertificateArn=<ACM_CERT_ARN> \
  --default-actions Type=fixed-response,FixedResponseConfig="{StatusCode=404}"

# Add routing rules
aws elbv2 create-rule \
  --listener-arn <LISTENER_ARN> \
  --priority 10 \
  --conditions Field=host-header,Values=wiremock.test-infra.example.com \
  --actions Type=forward,TargetGroupArn=<WIREMOCK_TG_ARN>

aws elbv2 create-rule \
  --listener-arn <LISTENER_ARN> \
  --priority 20 \
  --conditions Field=host-header,Values=pact-broker.test-infra.example.com \
  --actions Type=forward,TargetGroupArn=<PACT_BROKER_TG_ARN>
```

#### 12.5.4 DNS (Route 53)

Create CNAME or Alias records pointing to the ALB:

```
wiremock.test-infra.example.com    → test-infra-alb-xxxxx.us-east-1.elb.amazonaws.com
pact-broker.test-infra.example.com → test-infra-alb-xxxxx.us-east-1.elb.amazonaws.com
```

### 12.6 GitHub Actions → AWS Authentication (OIDC)

Use OpenID Connect (OIDC) so GitHub Actions assumes an IAM role **without storing long-lived AWS credentials** as secrets.

#### 12.6.1 Create the OIDC Identity Provider (One-Time)

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

#### 12.6.2 Create IAM Role for GitHub Actions

Create `infra/github-actions-trust-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:<GITHUB_ORG>/<REPO_NAME>:*"
        }
      }
    }
  ]
}
```

```bash
aws iam create-role \
  --role-name GitHubActionsTestInfra \
  --assume-role-policy-document file://infra/github-actions-trust-policy.json

# Attach minimal permissions (ECR pull, ECS describe, etc.)
aws iam attach-role-policy \
  --role-name GitHubActionsTestInfra \
  --policy-arn arn:aws:iam::aws:policy/AmazonECS_FullAccess
```

#### 12.6.3 Add Role ARN to GitHub Secrets

In your repository settings (**Settings → Secrets → Actions**):

| Secret | Value |
|--------|-------|
| `AWS_ROLE_ARN` | `arn:aws:iam::<ACCOUNT_ID>:role/GitHubActionsTestInfra` |
| `AWS_REGION` | `us-east-1` |

### 12.7 Updated GitHub Actions Workflow for AWS

Below is how the CI workflow changes when WireMock is hosted on AWS instead of as a local service container.

#### 12.7.1 CI Tests Against AWS-Hosted WireMock

```yaml
  ci-tests-aws:
    name: CI Tests (Against AWS WireMock)
    runs-on: ubuntu-latest
    permissions:
      id-token: write   # Required for OIDC
      contents: read

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ secrets.AWS_REGION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Load WireMock stubs (hot-reload on AWS)
        run: |
          WIREMOCK_URL=${{ secrets.WIREMOCK_AWS_URL }}
          echo "Resetting WireMock stubs..."
          curl -s -X POST "$WIREMOCK_URL/__admin/mappings/reset"
          for mapping in wiremock/mappings/*.json; do
            echo "Loading: $mapping"
            curl -s -X POST "$WIREMOCK_URL/__admin/mappings/import" \
              -H "Content-Type: application/json" \
              -d @"$mapping"
          done

      - name: Run Pact Consumer Contract Tests
        run: npm run test:contract

      - name: Run Schema Validation Tests
        run: npm run test:schema
        env:
          WIREMOCK_URL: ${{ secrets.WIREMOCK_AWS_URL }}

      - name: Run Virtual Integration Tests
        run: npm run test:virtual
        env:
          WIREMOCK_URL: ${{ secrets.WIREMOCK_AWS_URL }}

      - name: Publish Pact Contracts to Broker
        run: npm run pact:publish
        env:
          PACT_BROKER_URL: ${{ secrets.PACT_BROKER_AWS_URL }}
          PACT_BROKER_TOKEN: ${{ secrets.PACT_BROKER_TOKEN }}
```

#### 12.7.2 Additional GitHub Secrets for AWS

Add these secrets alongside the existing ones:

| Secret | Example Value | Purpose |
|--------|--------------|----------|
| `AWS_ROLE_ARN` | `arn:aws:iam::123456789012:role/GitHubActionsTestInfra` | OIDC role assumption |
| `AWS_REGION` | `us-east-1` | AWS region |
| `WIREMOCK_AWS_URL` | `https://wiremock.test-infra.example.com` | AWS-hosted WireMock |
| `PACT_BROKER_AWS_URL` | `https://pact-broker.test-infra.example.com` | AWS-hosted Pact Broker |
| `PACT_BROKER_TOKEN` | `(token)` | Pact Broker auth token (if enabled) |

### 12.8 Terraform Reference (Infrastructure as Code)

Below is a condensed Terraform module structure for deploying the full stack. Use it as a starting point.

#### 12.8.1 Directory Layout

```
infra/
├── main.tf               # Provider, VPC, subnets
├── alb.tf                # ALB, listeners, target groups
├── ecs.tf                # ECS cluster, task defs, services
├── rds.tf                # RDS PostgreSQL for Pact Broker
├── iam.tf                # ECS execution role, GitHub OIDC role
├── ecr.tf                # ECR repository for WireMock image
├── security-groups.tf    # All security group rules
├── dns.tf                # Route 53 records
├── variables.tf          # Input variables
├── outputs.tf            # ALB URL, service endpoints
└── terraform.tfvars      # Environment-specific values
```

#### 12.8.2 Key Terraform Resources

```hcl
# ── VPC ──────────────────────────────────────────────────────────
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "test-infra-vpc"
  cidr = "10.0.0.0/16"

  azs             = ["us-east-1a", "us-east-1b"]
  public_subnets  = ["10.0.1.0/24", "10.0.2.0/24"]
  private_subnets = ["10.0.10.0/24", "10.0.11.0/24"]

  enable_nat_gateway = true
  single_nat_gateway = true           # Cost-saving for non-prod
}

# ── ECS Cluster ──────────────────────────────────────────────────
resource "aws_ecs_cluster" "test_infra" {
  name = "test-infra"
}

# ── WireMock Service ─────────────────────────────────────────────
resource "aws_ecs_service" "wiremock" {
  name            = "wiremock"
  cluster         = aws_ecs_cluster.test_infra.id
  task_definition = aws_ecs_task_definition.wiremock.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.ecs_wiremock.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.wiremock.arn
    container_name   = "wiremock"
    container_port   = 8080
  }
}

# ── GitHub Actions OIDC ──────────────────────────────────────────
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

resource "aws_iam_role" "github_actions" {
  name = "GitHubActionsTestInfra"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = aws_iam_openid_connect_provider.github.arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_org}/${var.github_repo}:*"
        }
      }
    }]
  })
}
```

#### 12.8.3 Deploy

```bash
cd infra/
terraform init
terraform plan -out=plan.out
terraform apply plan.out

# Outputs
terraform output wiremock_url
terraform output pact_broker_url
```

### 12.9 Cost Considerations

| Resource | Estimated Monthly Cost (us-east-1) | Notes |
|----------|-----------------------------------|-------|
| ECS Fargate — WireMock (0.5 vCPU, 1 GB) | ~$15 | Can scale to 0 when idle |
| ECS Fargate — Pact Broker (0.5 vCPU, 1 GB) | ~$15 | Always-on for dashboard access |
| RDS PostgreSQL (db.t3.micro, 20 GB) | ~$15 | Free tier eligible for 12 months |
| ALB | ~$16 + LCU charges | Minimal LCU for test traffic |
| NAT Gateway | ~$32 + data | Biggest cost — consider VPC endpoints |
| ECR | < $1 | Storage for WireMock image |
| **Total** | **~$95/month** | Non-production test infrastructure |

**Cost optimization tips:**
- Use a single NAT Gateway (`single_nat_gateway = true`)
- Schedule ECS services to scale to 0 outside business hours using [ECS scheduled scaling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html)
- Use `db.t3.micro` for the Pact Broker database (free for 12 months)
- Consider replacing the NAT Gateway with VPC endpoints for ECR and CloudWatch if those are the only outbound targets

### 12.10 Switching Between Local and AWS

The test framework is environment-agnostic — it resolves endpoints from environment variables. To switch between local and AWS:

| Mode | `WIREMOCK_URL` | `PACT_BROKER_URL` |
|------|---------------|--------------------|
| Local (Docker) | `http://localhost:8080` | `http://localhost:9292` |
| AWS | `https://wiremock.test-infra.example.com` | `https://pact-broker.test-infra.example.com` |

Update your `.env` file (local) or GitHub Secrets (CI) accordingly. No code changes are needed.

---

## 13. Schema Drift Detection

The drift detection script compares stored schemas against live 3rd-party APIs to detect breaking changes early.

### 13.1 What It Checks

| Check | Source | Comparison |
|-------|--------|------------|
| WSDL drift | `GET {APP2_STAGING_URL}/ws/orders?wsdl` | `schemas/wsdl/order-service.wsdl` |
| Message schema drift | `GET {INTEGRATION_LAYER_URL}/api/schemas/order-created` | `schemas/messages/order-created-event.schema.json` |

### 13.2 Run Locally

```bash
# Requires APP2_STAGING_URL and INTEGRATION_LAYER_URL to be set
npm run schema:drift-check
```

### 13.3 Output

- Console summary with pass/fail per schema
- JSON report saved to `reports/drift/drift-report.json`
- Exit code `1` if drift is detected (fails CI)

### 13.4 Scheduled Runs

The GitHub Actions workflow runs drift detection nightly at **2:00 AM UTC** via cron. The drift report is uploaded as an artifact.

---

## 14. Troubleshooting

### WireMock won't start

```bash
# Check if port 8080 is already in use
lsof -i :8080

# Kill the process using that port
kill -9 <PID>

# Retry
npm run wiremock:start
```

### WireMock returns 404 for stubs

Stubs might not be loaded. Manually import them:

```bash
for mapping in wiremock/mappings/*.json; do
  curl -s -X POST http://localhost:8080/__admin/mappings/import \
    -H "Content-Type: application/json" \
    -d @"$mapping"
done
```

### Pact tests fail with `Cannot find module` errors

Ensure dependencies are installed:

```bash
rm -rf node_modules package-lock.json
npm install
```

### Playwright tests fail with "browser not found"

Install the required browsers:

```bash
npx playwright install --with-deps chromium
```

### Snowflake connection fails

1. Verify credentials in `.env`
2. Check your network/VPN is connected
3. Test connectivity:

```bash
node -e "
  const sf = require('snowflake-sdk');
  const conn = sf.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT,
    username: process.env.SNOWFLAKE_USERNAME,
    password: process.env.SNOWFLAKE_PASSWORD
  });
  conn.connect((err) => {
    if (err) console.error('Failed:', err.message);
    else console.log('Connected!');
    conn.destroy(() => {});
  });
"
```

### TypeScript compilation errors

```bash
# Check for errors
npx tsc --noEmit

# If @types packages are missing
npm install --save-dev @types/jest @types/uuid @types/node
```

### CI pipeline fails on WireMock health check

The workflow retries 30 times with 2-second intervals (60 seconds total). If WireMock still isn't ready:

- Check the GitHub Actions service container logs
- Ensure `wiremock/mappings/` files are valid JSON — malformed stubs can crash WireMock on startup

---

## Project Structure Reference

```
integration-framework/
├── .github/workflows/
│   └── integration-tests.yml      # CI/CD pipeline (5 jobs)
├── docs/
│   ├── integration-testing-options.md
│   └── setup-guide.md             # This file
├── schemas/
│   ├── messages/
│   │   ├── order-created-event.schema.json
│   │   └── order-updated-event.schema.json
│   └── wsdl/
│       └── order-service.wsdl
├── scripts/
│   ├── publish-pacts.ts           # Publish contracts to Pact Broker
│   └── schema-drift-check.ts     # Nightly drift detection
├── src/
│   ├── clients/
│   │   ├── pubsub-client.ts       # Integration Layer Pub/Sub client
│   │   ├── snowflake-client.ts    # Snowflake data warehouse client
│   │   └── soap-client.ts        # App2 SOAP OrderService client
│   ├── schemas/
│   │   ├── schema-validator.ts    # AJV-based JSON Schema validator
│   │   └── wsdl-validator.ts     # WSDL structural validator
│   └── utils/
│       └── test-helpers.ts        # Factories, assertions, config
├── tests/
│   ├── contract/                  # Pact consumer tests (Jest)
│   │   ├── pubsub-consumer.pact.spec.ts
│   │   └── soap-consumer.pact.spec.ts
│   ├── e2e/                       # E2E browser tests (Playwright)
│   │   └── order-flow.spec.ts
│   ├── integration/
│   │   ├── staging/               # Real integration tests (Playwright)
│   │   │   ├── etl-staging.spec.ts
│   │   │   ├── pubsub-staging.spec.ts
│   │   │   └── soap-staging.spec.ts
│   │   └── virtual/              # WireMock-backed tests (Playwright)
│   │       ├── pubsub-virtual.spec.ts
│   │       └── soap-virtual.spec.ts
│   └── schema/                    # Schema validation tests (Playwright)
│       ├── message-schema.spec.ts
│       └── soap-schema.spec.ts
├── wiremock/
│   └── mappings/
│       ├── pubsub-integration-layer.json
│       └── soap-order-service.json
├── .env.example
├── .gitignore
├── docker-compose.yml
├── jest.config.ts
├── package.json
├── playwright.config.ts
├── README.md
└── tsconfig.json
```
