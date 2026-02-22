/**
 * Pact Contract Publishing Script
 *
 * Publishes generated Pact contracts to a Pact Broker (if configured).
 * Since App2 and Siebel are 3rd-party and won't run provider verification,
 * the Pact Broker serves as a documentation and versioning repository.
 *
 * Run: npm run pact:publish
 */

import * as path from "path";
import * as fs from "fs";

async function main(): Promise<void> {
  const pactDir = path.resolve("pacts");

  if (!fs.existsSync(pactDir)) {
    console.log("No pact files found. Run 'npm run test:contract' first.");
    process.exit(0);
  }

  const pactFiles = fs
    .readdirSync(pactDir)
    .filter((f) => f.endsWith(".json"));

  if (pactFiles.length === 0) {
    console.log("No pact files found in pacts/ directory.");
    process.exit(0);
  }

  console.log(`Found ${pactFiles.length} Pact contract(s):`);
  for (const file of pactFiles) {
    console.log(`  - ${file}`);
  }

  const brokerUrl = process.env.PACT_BROKER_URL;
  const brokerToken = process.env.PACT_BROKER_TOKEN;

  if (!brokerUrl) {
    console.log(
      "\nPACT_BROKER_URL not set. Contracts saved locally in pacts/ directory."
    );
    console.log(
      "To publish to a broker, set PACT_BROKER_URL and PACT_BROKER_TOKEN."
    );
    return;
  }

  // Publish to Pact Broker
  const version =
    process.env.GITHUB_SHA?.substring(0, 8) || `local-${Date.now()}`;
  const branch = process.env.GITHUB_REF_NAME || "local";

  console.log(`\nPublishing to Pact Broker: ${brokerUrl}`);
  console.log(`  Version: ${version}`);
  console.log(`  Branch: ${branch}`);

  for (const file of pactFiles) {
    const pactContent = fs.readFileSync(
      path.join(pactDir, file),
      "utf-8"
    );
    const pact = JSON.parse(pactContent);

    const consumer = pact.consumer?.name || "unknown";
    const provider = pact.provider?.name || "unknown";

    const publishUrl = `${brokerUrl}/pacts/provider/${encodeURIComponent(provider)}/consumer/${encodeURIComponent(consumer)}/version/${version}`;

    try {
      const response = await fetch(publishUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(brokerToken
            ? { Authorization: `Bearer ${brokerToken}` }
            : {}),
        },
        body: pactContent,
      });

      if (response.ok) {
        console.log(`  ✅ Published: ${consumer} → ${provider}`);
      } else {
        console.error(
          `  ❌ Failed to publish ${file}: ${response.status} ${response.statusText}`
        );
      }
    } catch (error: any) {
      console.error(`  ❌ Error publishing ${file}: ${error.message}`);
    }
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
