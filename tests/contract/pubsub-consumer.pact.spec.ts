/**
 * Pact Consumer Contract Test — App1 ↔ Integration Layer (Pub/Sub)
 *
 * Documents App1's expectations when publishing OrderCreated events to the
 * Integration Layer, and when consuming OrderUpdated events from Siebel.
 *
 * Since Siebel and the Integration Layer are 3rd-party-adjacent, these
 * contracts are consumer-side only — used for documentation and drift detection.
 *
 * Use case: "Create Customer Order"
 *   1. App1 publishes OrderCreated event → Integration Layer → Siebel
 *   2. Siebel processes → publishes OrderUpdated → Integration Layer → App1
 */

import { PactV4, MatchersV3 } from "@pact-foundation/pact";
import path from "path";

const { like, eachLike, uuid } = MatchersV3;

const provider = new PactV4({
  consumer: "App1",
  provider: "IntegrationLayer-PubSub",
  dir: path.resolve(process.cwd(), "pacts"),
  logLevel: "warn",
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("App1 → Integration Layer: Publish OrderCreated", () => {
  it("should accept an OrderCreated event for forwarding to Siebel", async () => {
    const orderCreatedEvent = {
      eventId: "550e8400-e29b-41d4-a716-446655440000",
      eventType: "OrderCreated",
      timestamp: "2026-02-22T10:00:00.000Z",
      source: "App1",
      correlationId: "corr-12345",
      payload: {
        orderId: "ORD-2026-00042",
        customerId: "CUST-12345",
        orderDate: "2026-02-22T10:00:00.000Z",
        items: [
          {
            productId: "PROD-001",
            productName: "Widget Alpha",
            quantity: 2,
            unitPrice: 49.99,
          },
        ],
        totalAmount: 99.98,
        shippingAddress: "123 Test Street",
        confirmationNumber: "CONF-ABC-12345",
      },
    };

    await provider
      .addInteraction()
      .given("Integration Layer is available")
      .uponReceiving("an OrderCreated event from App1")
      .withRequest("POST", "/api/events/publish", (builder) => {
        builder.headers({ "Content-Type": "application/json" });
        builder.jsonBody(
          like({
            eventId: uuid(),
            eventType: "OrderCreated",
            timestamp: like("2026-02-22T10:00:00.000Z"),
            source: "App1",
            payload: like({
              orderId: like("ORD-2026-00042"),
              customerId: like("CUST-12345"),
              items: eachLike({
                productId: like("PROD-001"),
                productName: like("Widget Alpha"),
                quantity: like(2),
                unitPrice: like(49.99),
              }),
              totalAmount: like(99.98),
            }),
          })
        );
      })
      .willRespondWith(202, (builder) => {
        builder.headers({ "Content-Type": "application/json" });
        builder.jsonBody(
          like({
            status: "accepted",
            messageId: like("MSG-2026-00042"),
            topic: "orders.created",
            timestamp: like("2026-02-22T14:30:00Z"),
          })
        );
      })
      .executeTest(async (mockserver) => {
        const response = await fetch(
          `${mockserver.url}/api/events/publish`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(orderCreatedEvent),
          }
        );

        expect(response.status).toBe(202);
        const body = (await response.json()) as { status: string; messageId: string; topic: string };
        expect(body.status).toBe("accepted");
        expect(body.messageId).toBeDefined();
        expect(body.topic).toBe("orders.created");
      });
  });
});

describe("Integration Layer → App1: Subscribe OrderUpdated", () => {
  it("should receive OrderUpdated events from Siebel via Integration Layer", async () => {
    await provider
      .addInteraction()
      .given("Siebel has acknowledged order ORD-2026-00042")
      .uponReceiving("a subscription request for OrderUpdated events")
      .withRequest("GET", "/api/events/subscribe", (builder) => {
        builder.query({
          topic: "orders.updated",
          consumerId: "app1",
        });
      })
      .willRespondWith(200, (builder) => {
        builder.headers({ "Content-Type": "application/json" });
        builder.jsonBody(
          like({
            messages: eachLike({
              eventId: uuid(),
              eventType: "OrderUpdated",
              timestamp: like("2026-02-22T15:00:00Z"),
              source: "Siebel",
              correlationId: like("corr-12345"),
              payload: like({
                orderId: like("ORD-2026-00042"),
                status: like("Acknowledged"),
                updatedFields: like({
                  siebelCaseId: like("SR-2026-99001"),
                }),
              }),
            }),
          })
        );
      })
      .executeTest(async (mockserver) => {
        const response = await fetch(
          `${mockserver.url}/api/events/subscribe?topic=orders.updated&consumerId=app1`
        );

        expect(response.status).toBe(200);
        const body = (await response.json()) as { messages: Array<{ eventType: string; source: string; payload: { orderId: string; status: string } }> };
        expect(body.messages).toBeDefined();
        expect(body.messages.length).toBeGreaterThan(0);

        const message = body.messages[0];
        expect(message.eventType).toBe("OrderUpdated");
        expect(message.source).toBe("Siebel");
        expect(message.payload.orderId).toBeDefined();
        expect(message.payload.status).toBeDefined();
      });
  });
});
