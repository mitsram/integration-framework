/**
 * Schema Validation Test — SOAP WSDL Compliance
 *
 * Validates that App1's SOAP requests and responses conform to
 * App2's published WSDL schema. This is the "Schema-Driven" element
 * from Option 4 — using the 3rd party's own schema as truth.
 *
 * Also performs drift detection by comparing the stored WSDL
 * against expected operations and elements.
 */

import { test, expect } from "@playwright/test";
import { WsdlValidator } from "../../src/schemas/wsdl-validator";
import {
  buildCreateOrderEnvelope,
  buildGetOrderStatusEnvelope,
} from "../../src/clients/soap-client";
import { createSampleOrderRequest } from "../../src/utils/test-helpers";

// ── WSDL Structure Validation ───────────────────────────────────────────────

test.describe("WSDL Schema: Structure Validation", () => {
  let wsdlValidator: WsdlValidator;

  test.beforeEach(() => {
    wsdlValidator = new WsdlValidator();
    wsdlValidator.loadWsdl("schemas/wsdl/order-service.wsdl");
  });

  test("should parse all expected operations from WSDL", () => {
    const operations = wsdlValidator.getOperations();
    const operationNames = operations.map((op) => op.name);

    expect(operationNames).toContain("CreateOrder");
    expect(operationNames).toContain("GetOrderStatus");
  });

  test("should have correct SOAP actions for each operation", () => {
    const operations = wsdlValidator.getOperations();

    const createOrder = operations.find((op) => op.name === "CreateOrder");
    expect(createOrder?.soapAction).toBe(
      "http://app2.example.com/orders/CreateOrder"
    );

    const getStatus = operations.find(
      (op) => op.name === "GetOrderStatus"
    );
    expect(getStatus?.soapAction).toBe(
      "http://app2.example.com/orders/GetOrderStatus"
    );
  });

  test("should have required fields in CreateOrderRequest", () => {
    const operations = wsdlValidator.getOperations();
    const createOrder = operations.find((op) => op.name === "CreateOrder");

    const inputFieldNames = createOrder!.input.map((f) => f.name);
    expect(inputFieldNames).toContain("customerId");
    expect(inputFieldNames).toContain("orderDate");
    expect(inputFieldNames).toContain("items");
    expect(inputFieldNames).toContain("shippingAddress");
  });

  test("should have required fields in CreateOrderResponse", () => {
    const operations = wsdlValidator.getOperations();
    const createOrder = operations.find((op) => op.name === "CreateOrder");

    const outputFieldNames = createOrder!.output.map((f) => f.name);
    expect(outputFieldNames).toContain("orderId");
    expect(outputFieldNames).toContain("status");
    expect(outputFieldNames).toContain("estimatedDelivery");
    expect(outputFieldNames).toContain("totalAmount");
    expect(outputFieldNames).toContain("confirmationNumber");
  });
});

// ── SOAP Body Validation against WSDL ───────────────────────────────────────

test.describe("WSDL Schema: SOAP Body Compliance", () => {
  let wsdlValidator: WsdlValidator;

  test.beforeEach(() => {
    wsdlValidator = new WsdlValidator();
    wsdlValidator.loadWsdl("schemas/wsdl/order-service.wsdl");
  });

  test("should validate CreateOrder request body against WSDL", () => {
    const orderRequest = createSampleOrderRequest();
    const envelope = buildCreateOrderEnvelope(orderRequest);

    const result = wsdlValidator.validateSoapBody(
      envelope,
      "CreateOrder",
      "input"
    );

    expect(result.valid).toBe(true);
    expect(result.missingElements).toHaveLength(0);
  });

  test("should validate CreateOrder response body against WSDL", () => {
    // Simulate a response from App2/WireMock
    const responseXml = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ns="http://app2.example.com/orders">
  <soap:Body>
    <ns:CreateOrderResponse>
      <ns:orderId>ORD-2026-00042</ns:orderId>
      <ns:status>Confirmed</ns:status>
      <ns:estimatedDelivery>2026-03-05T10:00:00Z</ns:estimatedDelivery>
      <ns:totalAmount>299.97</ns:totalAmount>
      <ns:confirmationNumber>CONF-ABC-12345</ns:confirmationNumber>
    </ns:CreateOrderResponse>
  </soap:Body>
</soap:Envelope>`;

    const result = wsdlValidator.validateSoapBody(
      responseXml,
      "CreateOrder",
      "output"
    );

    expect(result.valid).toBe(true);
    expect(result.missingElements).toHaveLength(0);
  });

  test("should detect missing required fields in SOAP request", () => {
    // Incomplete request — missing shippingAddress
    const incompleteXml = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ns="http://app2.example.com/orders">
  <soap:Body>
    <ns:CreateOrderRequest>
      <ns:customerId>CUST-12345</ns:customerId>
      <ns:orderDate>2026-02-22T10:00:00Z</ns:orderDate>
    </ns:CreateOrderRequest>
  </soap:Body>
</soap:Envelope>`;

    const result = wsdlValidator.validateSoapBody(
      incompleteXml,
      "CreateOrder",
      "input"
    );

    expect(result.valid).toBe(false);
    expect(result.missingElements.length).toBeGreaterThan(0);
  });

  test("should validate GetOrderStatus request against WSDL", () => {
    const envelope = buildGetOrderStatusEnvelope({ orderId: "ORD-2026-00042" });

    const result = wsdlValidator.validateSoapBody(
      envelope,
      "GetOrderStatus",
      "input"
    );

    expect(result.valid).toBe(true);
  });
});
