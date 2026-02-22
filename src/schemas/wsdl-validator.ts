/**
 * WSDL Validator — validates SOAP XML payloads against the WSDL definition.
 *
 * Parses the WSDL to extract element definitions, then validates that
 * App1's SOAP requests and App2's responses contain the required elements.
 *
 * This is a structural validator (element presence and basic types),
 * not a full XSD validator — sufficient for integration drift detection.
 */

import { XMLParser } from "fast-xml-parser";
import * as fs from "fs";
import * as path from "path";

// ── Types ───────────────────────────────────────────────────────────────────

export interface WsdlElement {
  name: string;
  type: string;
  required: boolean;
  children?: WsdlElement[];
}

export interface WsdlOperation {
  name: string;
  soapAction: string;
  input: WsdlElement[];
  output: WsdlElement[];
}

export interface WsdlValidationResult {
  valid: boolean;
  missingElements: string[];
  unexpectedElements: string[];
  operation: string;
}

// ── WSDL Parser ─────────────────────────────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  attributeNamePrefix: "@_",
});

export class WsdlValidator {
  private operations: Map<string, WsdlOperation> = new Map();
  private rawElements: Map<string, any> = new Map();

  /**
   * Load and parse a WSDL file.
   */
  loadWsdl(wsdlPath: string): void {
    const absolutePath = path.resolve(wsdlPath);
    const wsdlContent = fs.readFileSync(absolutePath, "utf-8");
    const parsed = xmlParser.parse(wsdlContent);

    this.extractElements(parsed);
    this.extractOperations(parsed);
  }

  private extractElements(parsed: any): void {
    const schema = parsed.definitions?.types?.schema;
    if (!schema) return;

    const elements = Array.isArray(schema.element)
      ? schema.element
      : [schema.element];

    for (const element of elements) {
      if (element?.["@_name"]) {
        this.rawElements.set(element["@_name"], element);
      }
    }
  }

  private extractOperations(parsed: any): void {
    const binding = parsed.definitions?.binding;
    if (!binding) return;

    const operations = Array.isArray(binding.operation)
      ? binding.operation
      : [binding.operation];

    for (const op of operations) {
      const name = op["@_name"];
      const soapAction = op.operation?.["@_soapAction"] || "";

      const inputElement = this.getElementFields(`${name}Request`);
      const outputElement = this.getElementFields(`${name}Response`);

      this.operations.set(name, {
        name,
        soapAction,
        input: inputElement,
        output: outputElement,
      });
    }
  }

  private getElementFields(elementName: string): WsdlElement[] {
    const element = this.rawElements.get(elementName);
    if (!element) return [];

    const sequence =
      element.complexType?.sequence?.element ||
      element.complexType?.sequence;

    if (!sequence) return [];

    const items = Array.isArray(sequence) ? sequence : [sequence];
    return items
      .filter((item: any) => item?.["@_name"])
      .map((item: any) => ({
        name: item["@_name"],
        type: item["@_type"] || "complex",
        required: item["@_minOccurs"] !== "0",
      }));
  }

  /**
   * Get all parsed operations.
   */
  getOperations(): WsdlOperation[] {
    return Array.from(this.operations.values());
  }

  /**
   * Validate a SOAP XML body against the expected operation elements.
   */
  validateSoapBody(
    xml: string,
    operationName: string,
    direction: "input" | "output"
  ): WsdlValidationResult {
    const operation = this.operations.get(operationName);
    if (!operation) {
      return {
        valid: false,
        missingElements: [`Operation not found: ${operationName}`],
        unexpectedElements: [],
        operation: operationName,
      };
    }

    const expectedFields =
      direction === "input" ? operation.input : operation.output;

    const parsed = xmlParser.parse(xml);
    const body = parsed.Envelope?.Body;
    if (!body) {
      return {
        valid: false,
        missingElements: ["SOAP Body not found"],
        unexpectedElements: [],
        operation: operationName,
      };
    }

    const responseName =
      direction === "input"
        ? `${operationName}Request`
        : `${operationName}Response`;

    const responseBody = body[responseName];
    if (!responseBody) {
      return {
        valid: false,
        missingElements: [`${responseName} element not found in SOAP Body`],
        unexpectedElements: [],
        operation: operationName,
      };
    }

    const missingElements: string[] = [];
    const actualKeys = Object.keys(responseBody);

    for (const field of expectedFields) {
      if (field.required && !actualKeys.includes(field.name)) {
        missingElements.push(field.name);
      }
    }

    const expectedNames = expectedFields.map((f) => f.name);
    const unexpectedElements = actualKeys.filter(
      (k) => !expectedNames.includes(k) && !k.startsWith("@_")
    );

    return {
      valid: missingElements.length === 0,
      missingElements,
      unexpectedElements,
      operation: operationName,
    };
  }
}
