import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSiteArtifact } from "./lib/site-artifact.mjs";

if (process.argv.length > 2) {
  console.error("Usage: node scripts/build-site.mjs (output: dist/; run validate-site first)");
  process.exitCode = 1;
} else {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const artifact = await buildSiteArtifact({ root });
    console.log(`Built public site in dist/ with ${artifact.files.length} files; local references verified.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
