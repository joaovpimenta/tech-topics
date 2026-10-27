import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMarkdownPreview } from "./lib/markdown-site-artifact.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < args.length; index += 1) {
  const key = args[index];
  if (!["--root", "--output-dir", "--source-sha"].includes(key)) throw new Error(`Unknown option: ${key}`);
  if (options.has(key)) throw new Error(`${key} may be provided only once`);
  const value = args[++index];
  if (!value) throw new Error(`${key} requires a value`);
  options.set(key, value);
}
if (!options.has("--output-dir")) {
  throw new Error("Usage: node scripts/build-markdown-preview.mjs --output-dir <new-temp-directory> [--root <repository>] [--source-sha <full-sha>]");
}

try {
  const result = await buildMarkdownPreview({
    root: options.get("--root") ?? root,
    destination: options.get("--output-dir"),
    sourceSha: options.get("--source-sha"),
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
