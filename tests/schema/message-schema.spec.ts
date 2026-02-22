/**
 * Schema Validation Test — Pub/Sub Message Schema Compliance
 *
 * Validates that messages App1 produces and consumes conform
 * to the published JSON Schema definitions.
 *
 * This is the "Schema-Driven" element from Option 4:
 * - OrderCreated events (App1 → Integration Layer → Siebel)
 * - OrderUpdated events (Siebel → Integration Layer → App1)
 */

import { test, expect } from "@playwright/test";
import { SchemaValidator } from "../../src/schemas/schema-validator";
import { createSampleOrderCreatedEvent } from "../../src/utils/test-helpers";

// ── OrderCreated Event Schema ───────────────────────────────────────────────

test.describe("Message Schema: OrderCreated Event", () => {
  let validator: SchemaValidator;

  test.beforeEach(() => {
    validator = new SchemaValidator();
    validator.loadSchema(
      "schemas/messages/order-created-event.schema.json",
      "order-created-event"
    );
  });

  test("should validate a well-formed OrderCreated event", () => {
    const event = createSampleOrderCreatedEvent();
    const result = validator.validate("order-created-event", event);

    expect(result.valid).toBe(true);
    expect(result.errors).toBeNull();
  });

  test("should reject event missing required eventId", () => {
    const event = createSampleOrderCreatedEvent();
    const { eventId, ...withoutId } = event;

    const result = validator.validate("order-created-event", withoutId);

    expect(result.valid).toBe(false);
    expect(result.errors).not.toBeNull();
    expect(result.errors!.some((e) => e.message?.includes("eventId") || e.params?.missingProperty === "eventId")).toBe(true);
  });

  test("should reject event with wrong eventType", () => {
    const event = createSampleOrderCreatedEvent();
    (event as any).eventType = "WrongType";

    const result = validator.validate("order-created-event", event);
    expect(result.valid).toBe(false);
  });

  test("should reject event with wrong source", () => {
    const event = createSampleOrderCreatedEvent();
    (event as any).source = "NotApp1";

    const result = validator.validate("order-created-event", event);
    expect(result.valid).toBe(false);
  });

  test("should reject event with empty items array", () => {
    const event = createSampleOrderCreatedEvent();
    event.payload.items = [];

    const result = validator.validate("order-created-event", event);
    expect(result.valid).toBe(false);
  });

  test("should reject event with negative quantity", () => {
    const event = createSampleOrderCreatedEvent();
    event.payload.items[0].quantity = -1;

    const result = validator.validate("order-created-event", event);
    expect(result.valid).toBe(false);
  });

  test("should accept event with optional correlationId", () => {
    const event = createSampleOrderCreatedEvent();
    delete (event as any).correlationId;

    const result = validator.validate("order-created-event", event);
    expect(result.valid).toBe(true);
  });
});

// ── OrderUpdated Event Schema ───────────────────────────────────────────────

test.describe("Message Schema: OrderUpdated Event", () => {
  let validator: SchemaValidator;

  test.beforeEach(() => {
    validator = new SchemaValidator();
    validator.loadSchema(
      "schemas/messages/order-updated-event.schema.json",
      "order-updated-event"
    );
  });

  test("should validate a well-formed OrderUpdated event from Siebel", () => {
    const event = {
      eventId: "550e8400-e29b-41d4-a716-446655440001",
      eventType: "OrderUpdated",
      timestamp: "2026-02-22T15:00:00Z",
      source: "Siebel",
      correlationId: "corr-12345",
      payload: {
        orderId: "ORD-2026-00042",
        status: "Acknowledged",
        updatedFields: {
          siebelCaseId: "SR-2026-99001",
        },
        updatedBy: "siebel-system",
      },
    };

    const result = validator.validate("order-updated-event", event);
    expect(result.valid).toBe(true);
  });

  test("should reject OrderUpdated with invalid status", () => {
    const event = {
      eventId: "550e8400-e29b-41d4-a716-446655440001",
      eventType: "OrderUpdated",
      timestamp: "2026-02-22T15:00:00Z",
      source: "Siebel",
      payload: {
        orderId: "ORD-2026-00042",
        status: "InvalidStatus",
        updatedFields: {},
      },
    };

    const result = validator.validate("order-updated-event", event);
    expect(result.valid).toBe(false);
  });

  test("should reject OrderUpdated with wrong source", () => {
    const event = {
      eventId: "550e8400-e29b-41d4-a716-446655440001",
      eventType: "OrderUpdated",
      timestamp: "2026-02-22T15:00:00Z",
      source: "NotSiebel",
      payload: {
        orderId: "ORD-2026-00042",
        status: "Acknowledged",
        updatedFields: {},
      },
    };

    const result = validator.validate("order-updated-event", event);
    expect(result.valid).toBe(false);
  });

  test("should accept all valid status values", () => {
    const validStatuses = [
      "Acknowledged",
      "Processing",
      "Shipped",
      "Delivered",
      "Cancelled",
    ];

    for (const status of validStatuses) {
      const event = {
        eventId: "550e8400-e29b-41d4-a716-446655440001",
        eventType: "OrderUpdated",
        timestamp: "2026-02-22T15:00:00Z",
        source: "Siebel",
        payload: {
          orderId: "ORD-2026-00042",
          status,
          updatedFields: {},
        },
      };

      const result = validator.validate("order-updated-event", event);
      expect(result.valid).toBe(true);
    }
  });
});
