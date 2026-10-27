import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMarkdownPreview, buildMarkdownSiteArtifact } from "./lib/markdown-site-artifact.mjs";

const args = process.argv.slice(2);
const preview = args.length === 1 && args[0] === "--preview";
if (args.length > 0 && !preview) {
  console.error("Usage: node scripts/build-site.mjs [--preview] (production output: dist/; run validate-site first)");
  process.exitCode = 1;
} else {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    if (preview) {
      const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "tech-topics-site-validation-"));
      let artifact;
      try {
        artifact = await buildMarkdownPreview({ root, destination: path.join(temporaryRoot, "dist") });
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
      console.log(`Built temporary HTML preview with ${artifact.files.length} files; local references verified.`);
    } else {
      const artifact = await buildMarkdownSiteArtifact({ root });
      console.log(`Built public site in dist/ with ${artifact.files.length} files; local references verified.`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
