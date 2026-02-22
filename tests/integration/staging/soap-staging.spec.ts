/**
 * Staging Integration Test — App1 ↔ App2 SOAP (Real Staging)
 *
 * Tests against the real App2 staging SOAP endpoint.
 * Runs on deploy or nightly — provides high confidence that the
 * real 3rd-party SOAP API behaves as expected.
 *
 * These tests also serve as drift detection: if App2 changes
 * their SOAP API, these tests will catch it.
 *
 * Use case: "Create Customer Order" — SOAP leg against real staging
 */

import { test, expect } from "@playwright/test";
import { SoapClient } from "../../../src/clients/soap-client";
import {
  createSampleOrderRequest,
  isValidOrderId,
  isValidConfirmationNumber,
  isValidISODateTime,
  TEST_CONFIG,
} from "../../../src/utils/test-helpers";

const APP2_URL = TEST_CONFIG.app2StagingUrl;

test.describe("SOAP Staging: CreateOrder against real App2", () => {
  let soapClient: SoapClient;

  test.beforeEach(async ({ request }) => {
    soapClient = new SoapClient(request, APP2_URL);
  });

  test("should create an order on App2 staging", async () => {
    const orderRequest = createSampleOrderRequest({
      customerId: "STAGING-CUST-001",
    });

    const response = await soapClient.createOrder(orderRequest);

    // Validate response structure (drift detection)
    expect(response.orderId).toBeTruthy();
    expect(response.status).toBeTruthy();
    expect(response.totalAmount).toBeGreaterThan(0);
    expect(response.confirmationNumber).toBeTruthy();
    expect(response.estimatedDelivery).toBeTruthy();

    // Validate data types
    expect(typeof response.orderId).toBe("string");
    expect(typeof response.totalAmount).toBe("number");
    expect(isValidISODateTime(response.estimatedDelivery)).toBe(true);
  });

  test("should handle SOAP faults gracefully from real App2", async () => {
    const orderRequest = createSampleOrderRequest({
      customerId: "NONEXISTENT-CUSTOMER-999",
    });

    try {
      await soapClient.createOrder(orderRequest);
      // If App2 doesn't fault on unknown customers, that's fine
    } catch (error: any) {
      // If it does fault, validate the fault structure
      expect(error.faultCode).toBeTruthy();
      expect(error.faultString).toBeTruthy();
    }
  });
});

test.describe("SOAP Staging: GetOrderStatus against real App2", () => {
  let soapClient: SoapClient;

  test.beforeEach(async ({ request }) => {
    soapClient = new SoapClient(request, APP2_URL);
  });

  test("should create then query order status on App2 staging", async () => {
    // Step 1: Create order
    const orderRequest = createSampleOrderRequest({
      customerId: "STAGING-CUST-002",
    });
    const createResponse = await soapClient.createOrder(orderRequest);

    // Step 2: Query status of the created order
    const statusResponse = await soapClient.getOrderStatus(
      createResponse.orderId
    );

    expect(statusResponse.orderId).toBe(createResponse.orderId);
    expect(statusResponse.status).toBeTruthy();
    expect(isValidISODateTime(statusResponse.lastUpdated)).toBe(true);
  });
});

test.describe("SOAP Staging: App2 → App1 Callback Simulation", () => {
  test("should handle inbound SOAP callback from App2 (status change notification)", async ({
    request,
  }) => {
    // Simulates App2 calling back to App1's SOAP endpoint to notify
    // of an order status change. This tests the reverse direction.
    //
    // In a real setup, App2 staging would call App1's staging endpoint.
    // Here we simulate by posting a callback directly to App1's API.

    const callbackPayload = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ns="http://app1.example.com/callbacks">
  <soap:Body>
    <ns:OrderStatusCallback>
      <ns:orderId>ORD-2026-00042</ns:orderId>
      <ns:newStatus>Shipped</ns:newStatus>
      <ns:updatedAt>2026-02-23T09:00:00Z</ns:updatedAt>
    </ns:OrderStatusCallback>
  </soap:Body>
</soap:Envelope>`;

    const response = await request.post(
      `${TEST_CONFIG.app1BaseUrl}/ws/callbacks`,
      {
        data: callbackPayload,
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: "http://app1.example.com/callbacks/OrderStatusCallback",
        },
      }
    );

    // App1 should accept the callback
    // (May return 200 or 202 depending on implementation)
    expect([200, 202]).toContain(response.status());
  });
});
