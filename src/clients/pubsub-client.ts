/**
 * Pub/Sub Client for App1 ↔ Integration Layer communication.
 *
 * Handles publishing events (App1 → Siebel direction) and subscribing
 * to events (Siebel → App1 direction) via the Integration Layer HTTP API.
 */

import { APIRequestContext } from "@playwright/test";

// ── Types ───────────────────────────────────────────────────────────────────

export interface OrderCreatedEvent {
  eventId: string;
  eventType: "OrderCreated";
  timestamp: string;
  source: "App1";
  correlationId?: string;
  payload: {
    orderId: string;
    customerId: string;
    orderDate: string;
    items: Array<{
      productId: string;
      productName: string;
      quantity: number;
      unitPrice: number;
    }>;
    totalAmount: number;
    shippingAddress?: string;
    confirmationNumber?: string;
  };
}

export interface OrderUpdatedEvent {
  eventId: string;
  eventType: "OrderUpdated";
  timestamp: string;
  source: "Siebel";
  correlationId?: string;
  payload: {
    orderId: string;
    status: string;
    updatedFields: Record<string, unknown>;
    updatedBy?: string;
  };
}

export interface PublishResponse {
  status: string;
  messageId: string;
  topic: string;
  timestamp: string;
}

export interface SubscribeResponse {
  messages: OrderUpdatedEvent[];
}

export interface HealthResponse {
  status: string;
  version: string;
  uptime: string;
}

// ── Pub/Sub Client ──────────────────────────────────────────────────────────

export class PubSubClient {
  constructor(
    private readonly request: APIRequestContext,
    private readonly baseUrl: string
  ) {}

  /**
   * Publish an OrderCreated event to the Integration Layer.
   * The Integration Layer forwards it to Siebel via Pub/Sub.
   */
  async publishOrderCreated(
    event: OrderCreatedEvent
  ): Promise<PublishResponse> {
    const response = await this.request.post(
      `${this.baseUrl}/api/events/publish`,
      {
        data: event,
        headers: { "Content-Type": "application/json" },
      }
    );

    if (!response.ok()) {
      throw new Error(
        `Failed to publish event: ${response.status()} ${await response.text()}`
      );
    }

    return response.json();
  }

  /**
   * Subscribe to OrderUpdated events from the Integration Layer.
   * These originate from Siebel and are forwarded to App1.
   */
  async subscribeOrderUpdated(
    consumerId: string = "app1"
  ): Promise<SubscribeResponse> {
    const response = await this.request.get(
      `${this.baseUrl}/api/events/subscribe`,
      {
        params: {
          topic: "orders.updated",
          consumerId,
        },
      }
    );

    if (!response.ok()) {
      throw new Error(
        `Failed to subscribe: ${response.status()} ${await response.text()}`
      );
    }

    return response.json();
  }

  /**
   * Acknowledge receipt of a message from the Integration Layer.
   */
  async acknowledgeMessage(messageId: string): Promise<void> {
    const response = await this.request.post(
      `${this.baseUrl}/api/events/acknowledge`,
      {
        data: { messageId },
        headers: { "Content-Type": "application/json" },
      }
    );

    if (!response.ok()) {
      throw new Error(
        `Failed to acknowledge message: ${response.status()} ${await response.text()}`
      );
    }
  }

  /**
   * Check Integration Layer health.
   */
  async healthCheck(): Promise<HealthResponse> {
    const response = await this.request.get(`${this.baseUrl}/api/health`);
    return response.json();
  }
}
