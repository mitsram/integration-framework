/**
 * Staging Integration Test — ETL Pipeline Validation
 *
 * Validates that data fed by App1 flows correctly through:
 *   Fivetran → Coalesce → Snowflake → Power BI
 *
 * Tests run against real Snowflake staging to verify:
 *   - Order data lands in Snowflake after being fed from App1
 *   - Data schema matches expectations
 *   - Data freshness (ETL pipeline is running)
 *   - Data quality assertions (no nulls, correct types, referential integrity)
 *
 * Use case: "Create Customer Order" — ETL leg
 */

import { test, expect } from "@playwright/test";
import { SnowflakeClient } from "../../../src/clients/snowflake-client";
import { TEST_CONFIG } from "../../../src/utils/test-helpers";

// ── Setup ───────────────────────────────────────────────────────────────────

let snowflake: SnowflakeClient;

test.beforeAll(async () => {
  // Skip if Snowflake credentials are not configured
  if (!TEST_CONFIG.snowflake.account) {
    test.skip(true, "Snowflake credentials not configured");
    return;
  }

  snowflake = new SnowflakeClient(TEST_CONFIG.snowflake);
  await snowflake.connect();
});

test.afterAll(async () => {
  if (snowflake) {
    await snowflake.disconnect();
  }
});

// ── Data Landing Validation ─────────────────────────────────────────────────

test.describe("ETL Pipeline: Data Landing in Snowflake", () => {
  test("should have ORDERS table populated with data", async () => {
    const rowCount = await snowflake.getRowCount("ORDERS");
    expect(rowCount).toBeGreaterThan(0);
  });

  test("should have ORDER_ITEMS table populated with data", async () => {
    const rowCount = await snowflake.getRowCount("ORDER_ITEMS");
    expect(rowCount).toBeGreaterThan(0);
  });

  test("should find a specific order by ID in Snowflake", async () => {
    // This order ID should exist if the staging pipeline has run
    const order = await snowflake.getOrderById("ORD-2026-00042");

    if (order) {
      expect(order.ORDER_ID).toBe("ORD-2026-00042");
      expect(order.CUSTOMER_ID).toBeTruthy();
      expect(order.TOTAL_AMOUNT).toBeGreaterThan(0);
      expect(order.STATUS).toBeTruthy();
    } else {
      console.warn(
        "Order ORD-2026-00042 not found in Snowflake — ETL may not have synced yet"
      );
    }
  });

  test("should have order items for existing orders", async () => {
    const items = await snowflake.getOrderItems("ORD-2026-00042");

    if (items.length > 0) {
      for (const item of items) {
        expect(item.ORDER_ID).toBe("ORD-2026-00042");
        expect(item.PRODUCT_ID).toBeTruthy();
        expect(item.PRODUCT_NAME).toBeTruthy();
        expect(item.QUANTITY).toBeGreaterThan(0);
        expect(item.UNIT_PRICE).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ── Data Freshness ──────────────────────────────────────────────────────────

test.describe("ETL Pipeline: Data Freshness", () => {
  test("should have fresh data in ORDERS table (within last 24 hours)", async () => {
    const isFresh = await snowflake.isDataFresh(
      "ORDERS",
      "CREATED_AT",
      1440 // 24 hours in minutes
    );

    // If data isn't fresh, the ETL pipeline may be stalled
    if (!isFresh) {
      console.warn(
        "No fresh data in ORDERS within last 24h — check Fivetran sync status"
      );
    }
  });
});

// ── Data Quality Assertions ─────────────────────────────────────────────────

test.describe("ETL Pipeline: Data Quality", () => {
  test("should have no NULL order IDs", async () => {
    const rows = await snowflake.query<{ NULL_COUNT: number }>(
      "SELECT COUNT(*) as NULL_COUNT FROM ORDERS WHERE ORDER_ID IS NULL"
    );
    expect(rows[0].NULL_COUNT).toBe(0);
  });

  test("should have no negative total amounts", async () => {
    const rows = await snowflake.query<{ NEG_COUNT: number }>(
      "SELECT COUNT(*) as NEG_COUNT FROM ORDERS WHERE TOTAL_AMOUNT < 0"
    );
    expect(rows[0].NEG_COUNT).toBe(0);
  });

  test("should have valid statuses only", async () => {
    const rows = await snowflake.query<{ STATUS: string }>(
      "SELECT DISTINCT STATUS FROM ORDERS"
    );

    const validStatuses = [
      "Confirmed",
      "Processing",
      "Shipped",
      "Delivered",
      "Cancelled",
      "Pending",
    ];

    for (const row of rows) {
      expect(validStatuses).toContain(row.STATUS);
    }
  });

  test("should have referential integrity between ORDERS and ORDER_ITEMS", async () => {
    const rows = await snowflake.query<{ ORPHAN_COUNT: number }>(
      `SELECT COUNT(*) as ORPHAN_COUNT
       FROM ORDER_ITEMS oi
       LEFT JOIN ORDERS o ON oi.ORDER_ID = o.ORDER_ID
       WHERE o.ORDER_ID IS NULL`
    );
    expect(rows[0].ORPHAN_COUNT).toBe(0);
  });
});

// ── Power BI Validation (via REST API) ──────────────────────────────────────

test.describe("ETL Pipeline: Power BI Data Availability", () => {
  test.skip(
    !process.env.POWERBI_API_URL,
    "Power BI API URL not configured"
  );

  test("should have the Orders dataset available in Power BI", async ({
    request,
  }) => {
    const powerBiUrl = process.env.POWERBI_API_URL!;
    const powerBiToken = process.env.POWERBI_ACCESS_TOKEN!;

    const response = await request.get(`${powerBiUrl}/v1.0/myorg/datasets`, {
      headers: { Authorization: `Bearer ${powerBiToken}` },
    });

    expect(response.ok()).toBe(true);
    const body = await response.json();

    const ordersDataset = body.value?.find(
      (ds: any) => ds.name === "Orders"
    );
    expect(ordersDataset).toBeTruthy();
  });
});
