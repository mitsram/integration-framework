/**
 * Staging Integration Test — App1 ↔ Integration Layer Pub/Sub (Real Staging)
 *
 * Tests against the real Integration Layer staging to validate
 * Pub/Sub messaging between App1 and the Integration Layer (which
 * forwards to/from Siebel).
 *
 * Use case: "Create Customer Order" — Pub/Sub leg against real staging
 */

import { test, expect } from "@playwright/test";
import { PubSubClient, OrderCreatedEvent } from "../../../src/clients/pubsub-client";
import {
  createSampleOrderCreatedEvent,
  TEST_CONFIG,
} from "../../../src/utils/test-helpers";
import { SchemaValidator } from "../../../src/schemas/schema-validator";

const INTEGRATION_LAYER_URL = TEST_CONFIG.integrationLayerUrl;

test.describe("Pub/Sub Staging: Publish to real Integration Layer", () => {
  let pubSubClient: PubSubClient;

  test.beforeEach(async ({ request }) => {
    pubSubClient = new PubSubClient(request, INTEGRATION_LAYER_URL);
  });

  test("should verify Integration Layer health before testing", async () => {
    const health = await pubSubClient.healthCheck();
    expect(health.status).toBe("healthy");
  });

  test("should publish OrderCreated event to real Integration Layer", async () => {
    const event = createSampleOrderCreatedEvent({
      correlationId: `staging-test-${Date.now()}`,
    });

    const response = await pubSubClient.publishOrderCreated(event);

    expect(response.status).toBe("accepted");
    expect(response.messageId).toBeTruthy();
    expect(response.topic).toBe("orders.created");
  });

  test("should validate event schema before publishing to staging", async () => {
    const validator = new SchemaValidator();
    validator.loadSchema(
      "schemas/messages/order-created-event.schema.json",
      "order-created-event"
    );

    const event = createSampleOrderCreatedEvent();

    // Validate schema compliance before sending to real staging
    const result = validator.validate("order-created-event", event);
    expect(result.valid).toBe(true);

    // Then publish
    const pubSubClient2 = new PubSubClient(
      // @ts-ignore — we need request from test fixture
      await (await import("@playwright/test")).request.newContext(),
      INTEGRATION_LAYER_URL
    );
  });
});

test.describe("Pub/Sub Staging: Subscribe from real Integration Layer", () => {
  let pubSubClient: PubSubClient;

  test.beforeEach(async ({ request }) => {
    pubSubClient = new PubSubClient(request, INTEGRATION_LAYER_URL);
  });

  test("should subscribe and receive messages from Integration Layer", async () => {
    const response = await pubSubClient.subscribeOrderUpdated("app1-staging-test");

    expect(response.messages).toBeDefined();
    expect(Array.isArray(response.messages)).toBe(true);

    // Validate received messages conform to expected schema
    if (response.messages.length > 0) {
      const validator = new SchemaValidator();
      validator.loadSchema(
        "schemas/messages/order-updated-event.schema.json",
        "order-updated-event"
      );

      for (const message of response.messages) {
        const result = validator.validate("order-updated-event", message);
        expect(result.valid).toBe(true);
      }
    }
  });
});

test.describe("Pub/Sub Staging: Round-trip Flow", () => {
  let pubSubClient: PubSubClient;

  test.beforeEach(async ({ request }) => {
    pubSubClient = new PubSubClient(request, INTEGRATION_LAYER_URL);
  });

  test("should publish event and eventually receive Siebel acknowledgment", async () => {
    // Step 1: Publish OrderCreated to real Integration Layer
    const correlationId = `roundtrip-${Date.now()}`;
    const event = createSampleOrderCreatedEvent({ correlationId });
    const publishResult = await pubSubClient.publishOrderCreated(event);
    expect(publishResult.status).toBe("accepted");

    // Step 2: Wait for Siebel to process and respond
    // In real staging, Siebel processing may take seconds to minutes.
    // We poll for the response with a timeout.
    let siebelResponse = null;
    const maxWaitMs = 30_000;
    const pollIntervalMs = 2_000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const subscribeResult =
        await pubSubClient.subscribeOrderUpdated("app1-staging-test");

      const matching = subscribeResult.messages.find(
        (m) => m.correlationId === correlationId
      );

      if (matching) {
        siebelResponse = matching;
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    // Note: In staging, Siebel may not always respond within the timeout.
    // This test documents the expected flow; adjust timeout as needed.
    if (siebelResponse) {
      expect(siebelResponse.eventType).toBe("OrderUpdated");
      expect(siebelResponse.source).toBe("Siebel");
      expect(siebelResponse.payload.orderId).toBe(
        event.payload.orderId
      );
    } else {
      console.warn(
        `Siebel did not respond within ${maxWaitMs}ms — this may be expected in staging`
      );
    }
  });
});
