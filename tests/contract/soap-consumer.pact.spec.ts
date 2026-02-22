/**
 * Pact Consumer Contract Test — App1 ↔ App2 SOAP OrderService
 *
 * These tests document App1's expectations of App2's SOAP API.
 * Since App2 is 3rd-party, we run consumer-side only — no provider verification.
 * Generated Pact files serve as living documentation and drift detection baseline.
 *
 * Use case: "Create Customer Order"
 *   1. App1 sends CreateOrder SOAP request to App2
 *   2. App2 responds with order confirmation
 *   3. App1 queries order status from App2
 */

import { PactV4, MatchersV3 } from "@pact-foundation/pact";
import path from "path";

const { like, regex, string, integer, decimal } = MatchersV3;

// ── Pact Setup ──────────────────────────────────────────────────────────────

const provider = new PactV4({
  consumer: "App1",
  provider: "App2-OrderService",
  dir: path.resolve(process.cwd(), "pacts"),
  logLevel: "warn",
});

// ── SOAP Helpers ────────────────────────────────────────────────────────────

const SOAP_CONTENT_TYPE = "text/xml; charset=utf-8";
const NAMESPACE = "http://app2.example.com/orders";

function createOrderRequestBody(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ns="${NAMESPACE}">
  <soap:Body>
    <ns:CreateOrderRequest>
      <ns:customerId>CUST-12345</ns:customerId>
      <ns:orderDate>2026-02-22T10:00:00Z</ns:orderDate>
      <ns:items>
        <ns:item>
          <ns:productId>PROD-001</ns:productId>
          <ns:productName>Widget Alpha</ns:productName>
          <ns:quantity>2</ns:quantity>
          <ns:unitPrice>49.99</ns:unitPrice>
        </ns:item>
      </ns:items>
      <ns:shippingAddress>123 Test Street</ns:shippingAddress>
    </ns:CreateOrderRequest>
  </soap:Body>
</soap:Envelope>`;
}

function createOrderResponseBody(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ns="${NAMESPACE}">
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
}

function getOrderStatusRequestBody(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ns="${NAMESPACE}">
  <soap:Body>
    <ns:GetOrderStatusRequest>
      <ns:orderId>ORD-2026-00042</ns:orderId>
    </ns:GetOrderStatusRequest>
  </soap:Body>
</soap:Envelope>`;
}

function getOrderStatusResponseBody(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ns="${NAMESPACE}">
  <soap:Body>
    <ns:GetOrderStatusResponse>
      <ns:orderId>ORD-2026-00042</ns:orderId>
      <ns:status>Confirmed</ns:status>
      <ns:lastUpdated>2026-02-22T14:30:00Z</ns:lastUpdated>
    </ns:GetOrderStatusResponse>
  </soap:Body>
</soap:Envelope>`;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("App1 ↔ App2 SOAP Contract: CreateOrder", () => {
  it("should create an order and receive confirmation", async () => {
    await provider
      .addInteraction()
      .given("App2 OrderService is available")
      .uponReceiving("a CreateOrder SOAP request from App1")
      .withRequest("POST", "/ws/orders", (builder) => {
        builder.headers({
          "Content-Type": SOAP_CONTENT_TYPE,
          SOAPAction: `${NAMESPACE}/CreateOrder`,
        });
        builder.body(SOAP_CONTENT_TYPE, Buffer.from(createOrderRequestBody()));
      })
      .willRespondWith(200, (builder) => {
        builder.headers({ "Content-Type": SOAP_CONTENT_TYPE });
        builder.body(SOAP_CONTENT_TYPE, Buffer.from(createOrderResponseBody()));
      })
      .executeTest(async (mockserver) => {
        // Simulate what App1 does: send SOAP request, parse response
        const response = await fetch(`${mockserver.url}/ws/orders`, {
          method: "POST",
          headers: {
            "Content-Type": SOAP_CONTENT_TYPE,
            SOAPAction: `${NAMESPACE}/CreateOrder`,
          },
          body: createOrderRequestBody(),
        });

        expect(response.status).toBe(200);
        const body = await response.text();
        expect(body).toContain("CreateOrderResponse");
        expect(body).toContain("orderId");
        expect(body).toContain("confirmationNumber");
        expect(body).toContain("Confirmed");
      });
  });
});

describe("App1 ↔ App2 SOAP Contract: GetOrderStatus", () => {
  it("should retrieve order status from App2", async () => {
    await provider
      .addInteraction()
      .given("order ORD-2026-00042 exists in App2")
      .uponReceiving("a GetOrderStatus SOAP request from App1")
      .withRequest("POST", "/ws/orders", (builder) => {
        builder.headers({
          "Content-Type": SOAP_CONTENT_TYPE,
          SOAPAction: `${NAMESPACE}/GetOrderStatus`,
        });
        builder.body(SOAP_CONTENT_TYPE, Buffer.from(getOrderStatusRequestBody()));
      })
      .willRespondWith(200, (builder) => {
        builder.headers({ "Content-Type": SOAP_CONTENT_TYPE });
        builder.body(SOAP_CONTENT_TYPE, Buffer.from(getOrderStatusResponseBody()));
      })
      .executeTest(async (mockserver) => {
        const response = await fetch(`${mockserver.url}/ws/orders`, {
          method: "POST",
          headers: {
            "Content-Type": SOAP_CONTENT_TYPE,
            SOAPAction: `${NAMESPACE}/GetOrderStatus`,
          },
          body: getOrderStatusRequestBody(),
        });

        expect(response.status).toBe(200);
        const body = await response.text();
        expect(body).toContain("GetOrderStatusResponse");
        expect(body).toContain("ORD-2026-00042");
        expect(body).toContain("Confirmed");
      });
  });
});
