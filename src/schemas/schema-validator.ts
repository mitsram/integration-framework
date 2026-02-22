/**
 * Schema Validator — validates JSON payloads against JSON Schema definitions.
 *
 * Used for:
 * - Validating Pub/Sub messages conform to published message schemas
 * - Drift detection (comparing live responses against stored schemas)
 */

import Ajv, { ValidateFunction, ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import * as fs from "fs";
import * as path from "path";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: ErrorObject[] | null;
  schemaId: string;
}

// ── Schema Validator ────────────────────────────────────────────────────────

export class SchemaValidator {
  private ajv: Ajv;
  private validators: Map<string, ValidateFunction> = new Map();

  constructor() {
    this.ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(this.ajv);
  }

  /**
   * Load a JSON Schema from the schemas directory.
   */
  loadSchema(schemaPath: string, schemaId?: string): void {
    const absolutePath = path.resolve(schemaPath);
    const schemaContent = JSON.parse(fs.readFileSync(absolutePath, "utf-8"));
    const id = schemaId || schemaContent.$id || absolutePath;

    const validate = this.ajv.compile(schemaContent);
    this.validators.set(id, validate);
  }

  /**
   * Load all message schemas from the schemas/messages directory.
   */
  loadAllMessageSchemas(schemasDir: string = "schemas/messages"): void {
    const absoluteDir = path.resolve(schemasDir);
    const files = fs.readdirSync(absoluteDir).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      const filePath = path.join(absoluteDir, file);
      const schemaId = file.replace(".schema.json", "");
      this.loadSchema(filePath, schemaId);
    }
  }

  /**
   * Validate a payload against a loaded schema.
   */
  validate(schemaId: string, payload: unknown): ValidationResult {
    const validate = this.validators.get(schemaId);
    if (!validate) {
      throw new Error(
        `Schema not loaded: ${schemaId}. Available: ${Array.from(this.validators.keys()).join(", ")}`
      );
    }

    const valid = validate(payload) as boolean;
    return {
      valid,
      errors: valid ? null : (validate.errors ?? null),
      schemaId,
    };
  }

  /**
   * Validate and throw if invalid — convenience for tests.
   */
  assertValid(schemaId: string, payload: unknown): void {
    const result = this.validate(schemaId, payload);
    if (!result.valid) {
      const errorMessages = result.errors
        ?.map((e) => `${e.instancePath} ${e.message}`)
        .join("; ");
      throw new Error(
        `Schema validation failed for ${schemaId}: ${errorMessages}`
      );
    }
  }
}

// ── Singleton for convenience ───────────────────────────────────────────────

let defaultValidator: SchemaValidator | null = null;

export function getSchemaValidator(): SchemaValidator {
  if (!defaultValidator) {
    defaultValidator = new SchemaValidator();
    defaultValidator.loadAllMessageSchemas();
  }
  return defaultValidator;
}
