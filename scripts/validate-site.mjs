import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  ["Validate generation registry", ["scripts/validate-generation.mjs"]],
  ["Run generation composer tests", ["scripts/test-generation.cjs"]],
  ["Build article manifest", ["scripts/build-articles.mjs"]],
  ["Lint article content", ["scripts/lint-articles.mjs"]],
  ["Check application syntax", ["--check", "app.js"]],
  ["Check article syntax", ["--check", "article.js"]],
  ["Check simulator syntax", ["--check", "fgs-simulator.js"]],
  ["Check Mermaid syntax", ["--check", "mermaid-theme.js"]],
  ["Run PWA tests", ["scripts/test-pwa.cjs"]],
  ["Run FGS tests", ["scripts/test-fgs.cjs"]],
  ["Run diagram tests", ["scripts/test-diagrams.cjs"]]
];

function run(label, args) {
  return new Promise((resolve, reject) => {
    console.log("\n=== " + label + " ===");
    const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(label + " failed with exit code " + code));
    });
  });
}

for (const [label, args] of checks) {
  try {
    await run(label, args);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

console.log("\nPASS: all Tech Topics validation gates passed.");
