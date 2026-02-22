/**
 * SOAP Client for App1 ↔ App2 OrderService integration.
 *
 * Builds SOAP envelopes, sends requests, and parses XML responses.
 * Used by both virtual (WireMock) and staging integration tests.
 */

import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { APIRequestContext } from "@playwright/test";

// ── Types ───────────────────────────────────────────────────────────────────

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

export interface CreateOrderRequest {
  customerId: string;
  orderDate: string;
  items: OrderItem[];
  shippingAddress: string;
}

export interface CreateOrderResponse {
  orderId: string;
  status: string;
  estimatedDelivery: string;
  totalAmount: number;
  confirmationNumber: string;
}

export interface GetOrderStatusRequest {
  orderId: string;
}

export interface GetOrderStatusResponse {
  orderId: string;
  status: string;
  lastUpdated: string;
}

export interface SoapFault {
  faultCode: string;
  faultString: string;
  detail?: string;
}

// ── SOAP Envelope Builder ───────────────────────────────────────────────────

const NAMESPACE = "http://app2.example.com/orders";

export function buildCreateOrderEnvelope(request: CreateOrderRequest): string {
  const items = request.items
    .map(
      (item) => `
        <ns:item>
          <ns:productId>${item.productId}</ns:productId>
          <ns:productName>${item.productName}</ns:productName>
          <ns:quantity>${item.quantity}</ns:quantity>
          <ns:unitPrice>${item.unitPrice}</ns:unitPrice>
        </ns:item>`
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ns="${NAMESPACE}">
  <soap:Body>
    <ns:CreateOrderRequest>
      <ns:customerId>${request.customerId}</ns:customerId>
      <ns:orderDate>${request.orderDate}</ns:orderDate>
      <ns:items>${items}
      </ns:items>
      <ns:shippingAddress>${request.shippingAddress}</ns:shippingAddress>
    </ns:CreateOrderRequest>
  </soap:Body>
</soap:Envelope>`;
}

export function buildGetOrderStatusEnvelope(
  request: GetOrderStatusRequest
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ns="${NAMESPACE}">
  <soap:Body>
    <ns:GetOrderStatusRequest>
      <ns:orderId>${request.orderId}</ns:orderId>
    </ns:GetOrderStatusRequest>
  </soap:Body>
</soap:Envelope>`;
}

// ── SOAP Response Parser ────────────────────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
});

export function parseCreateOrderResponse(xml: string): CreateOrderResponse {
  const parsed = xmlParser.parse(xml);
  const body = parsed.Envelope.Body;

  if (body.Fault) {
    throw parseSoapFault(body.Fault);
  }

  const resp = body.CreateOrderResponse;
  return {
    orderId: resp.orderId,
    status: resp.status,
    estimatedDelivery: resp.estimatedDelivery,
    totalAmount: Number(resp.totalAmount),
    confirmationNumber: resp.confirmationNumber,
  };
}

export function parseGetOrderStatusResponse(
  xml: string
): GetOrderStatusResponse {
  const parsed = xmlParser.parse(xml);
  const body = parsed.Envelope.Body;

  if (body.Fault) {
    throw parseSoapFault(body.Fault);
  }

  const resp = body.GetOrderStatusResponse;
  return {
    orderId: resp.orderId,
    status: resp.status,
    lastUpdated: resp.lastUpdated,
  };
}

function parseSoapFault(fault: any): SoapFault {
  return {
    faultCode: fault.faultcode,
    faultString: fault.faultstring,
    detail: fault.detail ? JSON.stringify(fault.detail) : undefined,
  };
}

// ── SOAP Client (uses Playwright APIRequestContext) ─────────────────────────

export class SoapClient {
  constructor(
    private readonly request: APIRequestContext,
    private readonly baseUrl: string
  ) {}

  async createOrder(
    order: CreateOrderRequest
  ): Promise<CreateOrderResponse> {
    const envelope = buildCreateOrderEnvelope(order);
    const response = await this.request.post(`${this.baseUrl}/ws/orders`, {
      data: envelope,
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `${NAMESPACE}/CreateOrder`,
      },
    });

    const responseXml = await response.text();

    if (response.status() === 500) {
      const fault = xmlParser.parse(responseXml);
      throw parseSoapFault(fault.Envelope.Body.Fault);
    }

    return parseCreateOrderResponse(responseXml);
  }

  async getOrderStatus(
    orderId: string
  ): Promise<GetOrderStatusResponse> {
    const envelope = buildGetOrderStatusEnvelope({ orderId });
    const response = await this.request.post(`${this.baseUrl}/ws/orders`, {
      data: envelope,
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `${NAMESPACE}/GetOrderStatus`,
      },
    });

    const responseXml = await response.text();
    return parseGetOrderStatusResponse(responseXml);
  }
}
