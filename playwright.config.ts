import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ["html", { outputFolder: "reports/playwright" }],
    ["junit", { outputFile: "reports/junit-results.xml" }],
    ["list"],
  ],
  use: {
    trace: "on-first-retry",
    baseURL: process.env.APP1_BASE_URL || "http://localhost:3000",
  },

  projects: [
    // ── Schema Validation ───────────────────────────────────────────────
    // Validates App1 SOAP requests/responses and Pub/Sub messages conform
    // to published WSDL and JSON schemas. Runs against WireMock stubs
    // generated from schemas. No staging needed.
    {
      name: "schema-validation",
      testDir: "./tests/schema",
      use: {
        baseURL: process.env.WIREMOCK_URL || "http://localhost:8080",
      },
    },

    // ── Virtual Integration (CI) ────────────────────────────────────────
    // Fast integration tests against WireMock stubs. Covers SOAP and
    // Pub/Sub interactions without any staging dependency.
    {
      name: "virtual-integration",
      testDir: "./tests/integration/virtual",
      use: {
        baseURL: process.env.WIREMOCK_URL || "http://localhost:8080",
      },
    },

    // ── Staging Integration ─────────────────────────────────────────────
    // Tests against real staging environments for App2, Integration Layer,
    // and Snowflake. Higher confidence, slower execution.
    {
      name: "staging-integration",
      testDir: "./tests/integration/staging",
      use: {
        baseURL: process.env.APP2_STAGING_URL || "http://app2-staging:8443",
      },
    },

    // ── E2E UI ──────────────────────────────────────────────────────────
    // Full end-to-end UI tests via App1 that trigger cross-system flows.
    {
      name: "e2e-ui",
      testDir: "./tests/e2e",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.APP1_BASE_URL || "http://localhost:3000",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
      },
    },
  ],
});
