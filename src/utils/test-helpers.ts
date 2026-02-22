/**
 * Test helpers and fixtures for the integration framework.
 *
 * Provides reusable test data, factory functions, and utilities
 * shared across contract, integration, and E2E tests.
 */

import { v4 as uuidv4 } from "uuid";
import { CreateOrderRequest, OrderItem } from "../clients/soap-client";
import { OrderCreatedEvent } from "../clients/pubsub-client";

// ── Test Data Factories ─────────────────────────────────────────────────────

export function createSampleOrderItems(): OrderItem[] {
  return [
    {
      productId: "PROD-001",
      productName: "Widget Alpha",
      quantity: 2,
      unitPrice: 49.99,
    },
    {
      productId: "PROD-002",
      productName: "Widget Beta",
      quantity: 1,
      unitPrice: 199.99,
    },
  ];
}

export function createSampleOrderRequest(
  overrides: Partial<CreateOrderRequest> = {}
): CreateOrderRequest {
  return {
    customerId: "CUST-12345",
    orderDate: new Date().toISOString(),
    items: createSampleOrderItems(),
    shippingAddress: "123 Test Street, Suite 100, Test City, TC 12345",
    ...overrides,
  };
}

export function createSampleOrderCreatedEvent(
  overrides: Partial<OrderCreatedEvent> = {}
): OrderCreatedEvent {
  const items = createSampleOrderItems();
  const totalAmount = items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  );

  return {
    eventId: uuidv4(),
    eventType: "OrderCreated",
    timestamp: new Date().toISOString(),
    source: "App1",
    correlationId: uuidv4(),
    payload: {
      orderId: "ORD-2026-00042",
      customerId: "CUST-12345",
      orderDate: new Date().toISOString(),
      items,
      totalAmount,
      shippingAddress: "123 Test Street, Suite 100, Test City, TC 12345",
      confirmationNumber: "CONF-ABC-12345",
    },
    ...overrides,
  };
}

// ── Assertion Helpers ───────────────────────────────────────────────────────

/**
 * Assert that a value matches a date-time format (ISO 8601).
 */
export function isValidISODateTime(value: string): boolean {
  const date = new Date(value);
  return !isNaN(date.getTime());
}

/**
 * Assert that a string matches an order ID pattern.
 */
export function isValidOrderId(value: string): boolean {
  return /^ORD-\d{4}-\d{5}$/.test(value);
}

/**
 * Assert that a string matches a confirmation number pattern.
 */
export function isValidConfirmationNumber(value: string): boolean {
  return /^CONF-[A-Z]{3}-\d{5}$/.test(value);
}

// ── Environment Helpers ─────────────────────────────────────────────────────

export function getEnvOrDefault(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

export const TEST_CONFIG = {
  wiremockUrl: getEnvOrDefault("WIREMOCK_URL", "http://localhost:8080"),
  app1BaseUrl: getEnvOrDefault("APP1_BASE_URL", "http://localhost:3000"),
  app2StagingUrl: getEnvOrDefault(
    "APP2_STAGING_URL",
    "http://app2-staging:8443"
  ),
  integrationLayerUrl: getEnvOrDefault(
    "INTEGRATION_LAYER_URL",
    "http://localhost:8080"
  ),
  snowflake: {
    account: getEnvOrDefault("SNOWFLAKE_ACCOUNT", ""),
    username: getEnvOrDefault("SNOWFLAKE_USERNAME", ""),
    password: getEnvOrDefault("SNOWFLAKE_PASSWORD", ""),
    database: getEnvOrDefault("SNOWFLAKE_DATABASE", "APP1_DW"),
    schema: getEnvOrDefault("SNOWFLAKE_SCHEMA", "PUBLIC"),
    warehouse: getEnvOrDefault("SNOWFLAKE_WAREHOUSE", "COMPUTE_WH"),
  },
};
