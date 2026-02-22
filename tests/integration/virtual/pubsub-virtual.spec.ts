/**
 * Virtual Integration Test — App1 ↔ Integration Layer Pub/Sub (via WireMock)
 *
 * Tests the complete Pub/Sub client flow against WireMock stubs.
 * Runs in CI without any staging dependency.
 *
 * Use case: "Create Customer Order" — Pub/Sub leg
 *   1. App1 publishes OrderCreated event → WireMock (simulating Integration Layer)
 *   2. App1 subscribes to OrderUpdated events ← WireMock (simulating Siebel response)
 *   3. App1 acknowledges received messages
 */

import { test, expect } from "@playwright/test";
import { PubSubClient } from "../../../src/clients/pubsub-client";
import { createSampleOrderCreatedEvent } from "../../../src/utils/test-helpers";
import { SchemaValidator } from "../../../src/schemas/schema-validator";

const WIREMOCK_URL = process.env.WIREMOCK_URL || "http://localhost:8080";

test.describe("Pub/Sub Virtual Integration: Publish OrderCreated", () => {
  let pubSubClient: PubSubClient;

  test.beforeEach(async ({ request }) => {
    pubSubClient = new PubSubClient(request, WIREMOCK_URL);
  });

  test("should publish OrderCreated event to Integration Layer", async () => {
    const event = createSampleOrderCreatedEvent();
    const response = await pubSubClient.publishOrderCreated(event);

    expect(response.status).toBe("accepted");
    expect(response.messageId).toBeTruthy();
    expect(response.topic).toBe("orders.created");
    expect(response.timestamp).toBeTruthy();
  });

  test("should publish event with all required payload fields", async () => {
    const event = createSampleOrderCreatedEvent();

    // Validate event structure before publishing
    expect(event.eventId).toBeTruthy();
    expect(event.eventType).toBe("OrderCreated");
    expect(event.source).toBe("App1");
    expect(event.payload.orderId).toBeTruthy();
    expect(event.payload.customerId).toBeTruthy();
    expect(event.payload.items.length).toBeGreaterThan(0);
    expect(event.payload.totalAmount).toBeGreaterThan(0);

    const response = await pubSubClient.publishOrderCreated(event);
    expect(response.status).toBe("accepted");
  });
});

test.describe("Pub/Sub Virtual Integration: Subscribe OrderUpdated", () => {
  let pubSubClient: PubSubClient;

  test.beforeEach(async ({ request }) => {
    pubSubClient = new PubSubClient(request, WIREMOCK_URL);
  });

  test("should receive OrderUpdated events from Siebel via Integration Layer", async () => {
    const response = await pubSubClient.subscribeOrderUpdated("app1");

    expect(response.messages).toBeDefined();
    expect(response.messages.length).toBeGreaterThan(0);

    const message = response.messages[0];
    expect(message.eventType).toBe("OrderUpdated");
    expect(message.source).toBe("Siebel");
    expect(message.payload.orderId).toBeTruthy();
    expect(message.payload.status).toBeTruthy();
  });

  test("should receive Siebel case ID in updated fields", async () => {
    const response = await pubSubClient.subscribeOrderUpdated("app1");
    const message = response.messages[0];

    expect(message.payload.updatedFields).toBeDefined();
    expect(
      (message.payload.updatedFields as any).siebelCaseId
    ).toBeTruthy();
  });
});

test.describe("Pub/Sub Virtual Integration: Full Order Flow", () => {
  let pubSubClient: PubSubClient;

  test.beforeEach(async ({ request }) => {
    pubSubClient = new PubSubClient(request, WIREMOCK_URL);
  });

  test("should complete full pub/sub flow: publish → subscribe → acknowledge", async () => {
    // Step 1: Publish OrderCreated event
    const event = createSampleOrderCreatedEvent();
    const publishResponse = await pubSubClient.publishOrderCreated(event);
    expect(publishResponse.status).toBe("accepted");

    // Step 2: Subscribe to OrderUpdated events
    const subscribeResponse =
      await pubSubClient.subscribeOrderUpdated("app1");
    expect(subscribeResponse.messages.length).toBeGreaterThan(0);

    // Step 3: Acknowledge each received message
    // (Using the messageId from publish since WireMock stubs are static)
    await pubSubClient.acknowledgeMessage(publishResponse.messageId);
    // If we get here without throwing, acknowledgment succeeded
  });

  test("should validate Integration Layer health before publishing", async () => {
    const health = await pubSubClient.healthCheck();

    expect(health.status).toBe("healthy");
    expect(health.version).toBeTruthy();
  });
});
