import { execFileSync } from "node:child_process";
import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileMarkdownArticle, fromLegacyArticle, renderArticleEnvelope } from "./lib/markdown-article.mjs";
import { assertCommitSha, discoverArticleSources } from "./lib/migration-compare.mjs";

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < args.length; index += 1) {
  const key = args[index];
  if (key === "--inventory-only") {
    if (options.has(key)) throw new Error(`${key} may be provided only once`);
    options.set(key, true);
    continue;
  }
  if (!["--repository", "--sha", "--output-dir", "--slug"].includes(key)) throw new Error(`Unknown option: ${key}`);
  const value = args[++index];
  if (!value) throw new Error(`${key} requires a value`);
  if (key === "--slug") options.set(key, [...(options.get(key) ?? []), value]);
  else if (options.has(key)) throw new Error(`${key} may be provided only once`);
  else options.set(key, value);
}

const repository = path.resolve(options.get("--repository") ?? toolRoot);
const sha = options.get("--sha");
const outputDirectory = path.resolve(options.get("--output-dir") ?? "");
assertCommitSha(sha, "--sha");
const inventoryOnly = options.has("--inventory-only");
if (inventoryOnly && (options.has("--output-dir") || options.has("--slug"))) {
  throw new Error("--inventory-only cannot be combined with --output-dir or --slug");
}
if (!inventoryOnly && !options.has("--output-dir")) throw new Error("--output-dir is required");
const tempRoot = path.resolve(os.tmpdir());
if (!inventoryOnly && (outputDirectory === tempRoot || !outputDirectory.startsWith(`${tempRoot}${path.sep}`))) {
  throw new Error("--output-dir must be a dedicated directory beneath the system temporary directory");
}

const git = (...gitArgs) => execFileSync("git", gitArgs, { cwd: repository, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
git("cat-file", "-e", `${sha}^{commit}`);
const treeLines = git("ls-tree", "-r", sha).split(/\r?\n/).filter(Boolean);
const tree = new Map(treeLines.map(line => {
  const match = line.match(/^(\d+) blob ([0-9a-f]+)\t(.+)$/);
  if (match && match[1] !== "100644" && match[1] !== "100755"
      && /^(?:articles|content\/articles)\//.test(match[3])) {
    throw new Error(`${sha}: article source or asset is not a regular file: ${match[3]}`);
  }
  return match && [match[3], match[2]];
}).filter(Boolean));
const inventory = discoverArticleSources(tree.keys(), sha);
if (inventoryOnly) {
  const records = inventory.map(source => ({ ...source, blob: tree.get(source.file) }));
  process.stdout.write(`${JSON.stringify(records)}\n`);
  process.exit(0);
}
const wanted = options.get("--slug") ? new Set(options.get("--slug")) : null;
if (wanted) {
  for (const slug of wanted) if (!inventory.some(source => source.slug === slug)) throw new Error(`${sha}: article not found: ${slug}`);
}
const articles = new Map();
for (const source of inventory) {
  const text = git("show", `${sha}:${source.file}`);
  articles.set(source.slug, { source, text });
}

let tagRegistry;
try {
  tagRegistry = JSON.parse(git("show", `${sha}:generation/taxonomy/tags.json`));
} catch (error) {
  if (inventory.some(source => source.extension === "md")) {
    throw new Error(`${sha}: Markdown source requires generation/taxonomy/tags.json`);
  }
  tagRegistry = { tags: {} };
}
if (!tagRegistry || typeof tagRegistry !== "object" || !tagRegistry.tags || Array.isArray(tagRegistry.tags)) {
  throw new Error(`${sha}: generation/taxonomy/tags.json has an invalid tag registry`);
}
const tags = new Set(Object.keys(tagRegistry.tags));

await mkdir(outputDirectory, { recursive: true });
const outputStats = await lstat(outputDirectory);
if (!outputStats.isDirectory() || outputStats.isSymbolicLink()) throw new Error("--output-dir must be a regular directory");
if ((await readdir(outputDirectory)).length) throw new Error("--output-dir must be empty");
const knownSlugs = new Set(inventory.map(source => source.slug));
let rendered = 0;
for (const [slug, { source, text }] of articles) {
  if (wanted && !wanted.has(slug)) continue;
  const context = { sourcePath: source.file, rootPath: repository, knownTags: tags, knownSlugs, assetExists: file => tree.has(file) };
  const compiled = source.extension === "json"
    ? fromLegacyArticle(JSON.parse(text), context)
    : await compileMarkdownArticle({ source: text, ...context });
  if (compiled.metadata.slug !== slug) throw new Error(`${sha}:${source.file}: metadata slug does not match filename`);
  await writeFile(path.join(outputDirectory, `${slug}.html`), renderArticleEnvelope(compiled, { buildId: sha }), { flag: "wx" });
  rendered += 1;
}
process.stdout.write(`Rendered ${rendered} compiled HTML article(s) from ${sha}.\n`);
