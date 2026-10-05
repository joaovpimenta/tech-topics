import path from "node:path";
import { fileURLToPath } from "node:url";
import { diagnoseRepository } from "./lib/repository-health.mjs";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: node scripts/doctor.mjs [--json]\nRead-only local diagnostics, commands and navigation. Python/TTS is optional for site tasks.");
} else if (args.some(arg => arg !== "--json")) {
  console.error("Unknown argument; use --help");
  process.exitCode = 1;
} else {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = await diagnoseRepository({ root });
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Tech Topics: ${result.status}`);
    for (const check of result.checks) console.log(`${check.status.toUpperCase()} ${check.name}${check.message ? ": " + check.message : ""}`);
    console.log(`\nNavigation: ${result.navigation}`);
    for (const [label, command] of Object.entries(result.commands)) console.log(`${label}: ${command}`);
  }
  if (result.status === "error") process.exitCode = 1;
}
