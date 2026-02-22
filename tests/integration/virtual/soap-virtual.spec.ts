/**
 * Virtual Integration Test — App1 ↔ App2 SOAP (via WireMock)
 *
 * Tests the full SOAP client flow against WireMock stubs.
 * Runs in CI without any staging dependency.
 *
 * Use case: "Create Customer Order" — SOAP leg
 *   1. App1 sends CreateOrder to WireMock (simulating App2)
 *   2. Validates response parsing, error handling, and edge cases
 */

import { test, expect } from "@playwright/test";
import { SoapClient } from "../../../src/clients/soap-client";
import {
  createSampleOrderRequest,
  isValidOrderId,
  isValidConfirmationNumber,
} from "../../../src/utils/test-helpers";

const WIREMOCK_URL = process.env.WIREMOCK_URL || "http://localhost:8080";

test.describe("SOAP Virtual Integration: CreateOrder", () => {
  let soapClient: SoapClient;

  test.beforeEach(async ({ request }) => {
    soapClient = new SoapClient(request, WIREMOCK_URL);
  });

  test("should create an order successfully via SOAP", async () => {
    const orderRequest = createSampleOrderRequest();
    const response = await soapClient.createOrder(orderRequest);

    expect(response.orderId).toBeTruthy();
    expect(response.status).toBe("Confirmed");
    expect(response.totalAmount).toBeGreaterThan(0);
    expect(response.confirmationNumber).toBeTruthy();
    expect(response.estimatedDelivery).toBeTruthy();
  });

  test("should receive a SOAP fault for invalid customer", async () => {
    const orderRequest = createSampleOrderRequest({
      customerId: "INVALID-CUSTOMER",
    });

    try {
      await soapClient.createOrder(orderRequest);
      throw new Error("Expected SOAP fault was not thrown");
    } catch (error: any) {
      expect(error.faultCode).toBe("soap:Client");
      expect(error.faultString).toContain("Customer not found");
    }
  });

  test("should parse all required fields from CreateOrder response", async () => {
    const orderRequest = createSampleOrderRequest();
    const response = await soapClient.createOrder(orderRequest);

    // Validate all response fields are present and correctly typed
    expect(typeof response.orderId).toBe("string");
    expect(typeof response.status).toBe("string");
    expect(typeof response.estimatedDelivery).toBe("string");
    expect(typeof response.totalAmount).toBe("number");
    expect(typeof response.confirmationNumber).toBe("string");
  });
});

test.describe("SOAP Virtual Integration: GetOrderStatus", () => {
  let soapClient: SoapClient;

  test.beforeEach(async ({ request }) => {
    soapClient = new SoapClient(request, WIREMOCK_URL);
  });

  test("should retrieve order status for an existing order", async () => {
    const response = await soapClient.getOrderStatus("ORD-2026-00042");

    expect(response.orderId).toBe("ORD-2026-00042");
    expect(response.status).toBe("Confirmed");
    expect(response.lastUpdated).toBeTruthy();
  });
});
