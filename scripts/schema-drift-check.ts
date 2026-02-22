/**
 * Schema Drift Detection Script
 *
 * Compares stored WSDL and message schemas against live staging APIs.
 * Detects when 3rd-party systems (App2, Integration Layer) change their
 * API contracts without notification.
 *
 * Run: npm run schema:drift-check
 * Scheduled: Nightly via GitHub Actions
 */

import * as fs from "fs";
import * as path from "path";
import { XMLParser } from "fast-xml-parser";

// ── Types ───────────────────────────────────────────────────────────────────

interface DriftResult {
  schema: string;
  drifted: boolean;
  details: string[];
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Schema Drift Detection");
  console.log("═══════════════════════════════════════════════════════════\n");

  const results: DriftResult[] = [];

  // 1. Check WSDL drift
  results.push(await checkWsdlDrift());

  // 2. Check message schema drift
  results.push(await checkMessageSchemaDrift());

  // Generate report
  generateReport(results);

  // Exit with error if drift detected
  const hasDrift = results.some((r) => r.drifted);
  if (hasDrift) {
    console.error("\n⚠️  Schema drift detected! Review the report above.");
    process.exit(1);
  } else {
    console.log("\n✅ No schema drift detected.");
  }
}

// ── WSDL Drift Check ────────────────────────────────────────────────────────

async function checkWsdlDrift(): Promise<DriftResult> {
  const result: DriftResult = {
    schema: "App2 WSDL (order-service.wsdl)",
    drifted: false,
    details: [],
  };

  const wsdlPath = path.resolve("schemas/wsdl/order-service.wsdl");
  if (!fs.existsSync(wsdlPath)) {
    result.details.push("Local WSDL file not found");
    result.drifted = true;
    return result;
  }

  const app2Url = process.env.APP2_STAGING_URL;
  if (!app2Url) {
    result.details.push(
      "APP2_STAGING_URL not set — skipping live WSDL fetch"
    );
    return result;
  }

  try {
    // Fetch live WSDL from App2 staging
    const liveResponse = await fetch(`${app2Url}/ws/orders?wsdl`);
    if (!liveResponse.ok) {
      result.details.push(
        `Failed to fetch live WSDL: HTTP ${liveResponse.status}`
      );
      result.drifted = true;
      return result;
    }

    const liveWsdl = await liveResponse.text();
    const localWsdl = fs.readFileSync(wsdlPath, "utf-8");

    // Parse both and compare operations
    const parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
    });

    const localParsed = parser.parse(localWsdl);
    const liveParsed = parser.parse(liveWsdl);

    const localOps = extractOperationNames(localParsed);
    const liveOps = extractOperationNames(liveParsed);

    // Check for removed operations
    for (const op of localOps) {
      if (!liveOps.includes(op)) {
        result.details.push(`Operation REMOVED from live WSDL: ${op}`);
        result.drifted = true;
      }
    }

    // Check for new operations
    for (const op of liveOps) {
      if (!localOps.includes(op)) {
        result.details.push(`New operation in live WSDL: ${op}`);
        result.drifted = true;
      }
    }

    if (!result.drifted) {
      result.details.push("All operations match");
    }
  } catch (error: any) {
    result.details.push(`Error checking WSDL drift: ${error.message}`);
  }

  return result;
}

function extractOperationNames(parsed: any): string[] {
  const binding = parsed.definitions?.binding;
  if (!binding) return [];

  const operations = Array.isArray(binding.operation)
    ? binding.operation
    : [binding.operation];

  return operations
    .map((op: any) => op["@_name"])
    .filter(Boolean);
}

// ── Message Schema Drift Check ──────────────────────────────────────────────

async function checkMessageSchemaDrift(): Promise<DriftResult> {
  const result: DriftResult = {
    schema: "Integration Layer Message Schemas",
    drifted: false,
    details: [],
  };

  const integrationLayerUrl = process.env.INTEGRATION_LAYER_URL;
  if (!integrationLayerUrl) {
    result.details.push(
      "INTEGRATION_LAYER_URL not set — skipping live schema fetch"
    );
    return result;
  }

  try {
    // Check if the Integration Layer exposes its schema
    const schemaResponse = await fetch(
      `${integrationLayerUrl}/api/schemas/order-events`
    );

    if (!schemaResponse.ok) {
      result.details.push(
        "Integration Layer does not expose schemas via API — manual check required"
      );
      return result;
    }

    const liveSchema = (await schemaResponse.json()) as { required?: string[] };

    // Compare with local schemas
    const localSchemaPath = path.resolve(
      "schemas/messages/order-created-event.schema.json"
    );
    const localSchema = JSON.parse(
      fs.readFileSync(localSchemaPath, "utf-8")
    ) as { required?: string[] };

    // Compare required fields
    const localRequired = localSchema.required || [];
    const liveRequired = liveSchema.required || [];

    for (const field of localRequired) {
      if (!liveRequired.includes(field)) {
        result.details.push(
          `Required field removed from live schema: ${field}`
        );
        result.drifted = true;
      }
    }

    for (const field of liveRequired) {
      if (!localRequired.includes(field)) {
        result.details.push(
          `New required field in live schema: ${field}`
        );
        result.drifted = true;
      }
    }

    if (!result.drifted) {
      result.details.push("Message schemas match");
    }
  } catch (error: any) {
    result.details.push(
      `Error checking message schema drift: ${error.message}`
    );
  }

  return result;
}

// ── Report Generator ────────────────────────────────────────────────────────

function generateReport(results: DriftResult[]): void {
  const reportDir = path.resolve("reports/drift");
  fs.mkdirSync(reportDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(reportDir, `drift-report-${timestamp}.json`);

  const report = {
    timestamp: new Date().toISOString(),
    results,
    summary: {
      total: results.length,
      drifted: results.filter((r) => r.drifted).length,
      clean: results.filter((r) => !r.drifted).length,
    },
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to: ${reportPath}`);

  // Print summary
  console.log("\n┌─────────────────────────────────────────────┐");
  console.log("│  Drift Detection Summary                    │");
  console.log("├─────────────────────────────────────────────┤");
  for (const result of results) {
    const icon = result.drifted ? "❌" : "✅";
    console.log(`│  ${icon} ${result.schema.padEnd(40)} │`);
    for (const detail of result.details) {
      console.log(`│     ${detail.padEnd(38)} │`);
    }
  }
  console.log("└─────────────────────────────────────────────┘");
}

// ── Run ─────────────────────────────────────────────────────────────────────

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
