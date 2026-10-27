import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import { compileMarkdownArticle } from "./lib/markdown-article.mjs";
import { discoverArticleSources, firstAdditionDate } from "./lib/migration-compare.mjs";
import { articleSignatures, compareBaselines, compareCaptureTools, validateBaseline } from "./lib/migration-baseline.mjs";

const historicalArticleModule = existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "lib/historical-article.mjs"))
  ? "./lib/historical-article.mjs"
  : "./lib/markdown-article.mjs";
const { fromLegacyArticle } = await import(historicalArticleModule);

const exec = (command, commandArgs, options) => {
  const result = spawnSync(command, commandArgs, options);
  // The managed runner can report EPERM after a child has exited successfully;
  // the non-zero/null status remains the command failure signal.
  if (result.status !== 0) throw result.error ?? new Error(result.stderr || `${command} exited with ${result.status}`);
  return result.stdout;
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const value = flag => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const sha = value("--sha") ?? "fca72c31fcb57ffe9741a2390a04c2035639e14a";
const previousPath = value("--previous");
const outputRoot = path.resolve(root, value("--output-root") ?? "docs/migrations/baselines");
if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("--sha must be a full lowercase Git SHA");

async function git(...gitArgs) {
  return exec("git", gitArgs, { cwd: root, maxBuffer: 50 * 1024 * 1024, encoding: "utf8" });
}
const tree = (await git("ls-tree", "-r", sha)).trim().split("\n").filter(Boolean).map(line => {
  const match = line.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/);
  return match && { blob: match[1], file: match[2] };
}).filter(Boolean);
const treeByPath = new Map(tree.map(item => [item.file, item.blob]));
const inventory = discoverArticleSources(tree.map(item => item.file), sha);
const isLegacyCorpus = inventory.every(source => source.extension === "json");
const sourceTexts = await Promise.all(inventory.map(async source => ({
  ...source, text: await git("show", `${sha}:${source.file}`)
})));
function metadataFor(source) {
  if (source.extension === "json") return JSON.parse(source.text);
  const match = source.text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) throw new Error(`${source.file}: Markdown frontmatter was not found`);
  const document = parseDocument(match[1], { version: "1.2", schema: "core", strict: true });
  if (document.errors.length) throw new Error(`${source.file}: Markdown frontmatter is invalid: ${document.errors.map(error => error.message).join("; ")}`);
  return document.toJS();
}
const knownTags = new Set(sourceTexts.flatMap(source => metadataFor(source).tags ?? []));
const knownSlugs = new Set(inventory.map(source => source.slug));
const articles = [];
for (const source of sourceTexts) {
  let article, addedAt;
  if (isLegacyCorpus) {
    article = JSON.parse(source.text);
    if (article.slug !== source.slug) throw new Error(`${source.file}: slug does not match path`);
    const addedLog = (await git("log", "--follow", "--diff-filter=A", "--format=%cI", sha, "--", source.file)).trim().split("\n").filter(Boolean);
    addedAt = addedLog.at(-1) ?? "";
    if (!addedAt) throw new Error(`${source.file}: Git history has no original addition date`);
  } else {
    const metadata = metadataFor(source);
    const context = { sourcePath: source.file, rootPath: root, knownTags, knownSlugs,
      assetExists: asset => treeByPath.has(asset) };
    const compiled = source.extension === "json"
      ? fromLegacyArticle(metadata, context)
      : await compileMarkdownArticle({ source: source.text, ...context });
    if (compiled.metadata.slug !== source.slug) throw new Error(`${source.file}: slug does not match path`);
    article = { ...compiled.metadata, bodyHtml: compiled.slots.body };
    const history = await git("log", "--reverse", "--diff-filter=A", "--format=%cI", sha, "--",
      `content/articles/${source.slug}.json`, `content/articles/${source.slug}.md`);
    addedAt = firstAdditionDate(history, source.slug);
  }
  articles.push({ article, file: source.file, addedAt, sourceBlob: treeByPath.get(source.file) });
}
articles.sort((a, b) => b.article.publishedAt.localeCompare(a.article.publishedAt) || (Date.parse(b.addedAt) || 0) - (Date.parse(a.addedAt) || 0) || a.article.slug.localeCompare(b.article.slug));

const extractor = path.join(root, "scripts/lib/migration-baseline-extract.py");
const lexiconPath = "content/tts-lexicon.json";
const lexicon = JSON.parse(await git("show", `${sha}:${lexiconPath}`));
const speechFiles = ["tools/tts/article_selection.py", "tools/tts/narration_text.py", "tools/tts/segmentation.py", "tools/tts/kokoro_release.py", lexiconPath];
const snapshotDir = await mkdtemp(path.join(os.tmpdir(), "tech-topics-migration-baseline-"));
const historicalTtsDir = path.join(snapshotDir, "tools", "tts");
await mkdir(historicalTtsDir, { recursive: true });
const sha256 = value => createHash("sha256").update(value).digest("hex");
const speechToolSignatures = [];
for (const file of speechFiles) {
  const content = await git("show", `${sha}:${file}`);
  await mkdir(path.dirname(path.join(snapshotDir, file)), { recursive: true });
  await writeFile(path.join(snapshotDir, file), content, "utf8");
  speechToolSignatures.push({ path: file, gitBlob: treeByPath.get(file), sha256: sha256(content) });
}
let python = process.env.TECH_TOPICS_PYTHON ?? "python";
const payload = JSON.stringify({ articles: articles.map(({ article }) => article), lexicon });
const payloadPath = path.join(snapshotDir, "extractor-input.json");
await writeFile(payloadPath, payload, "utf8");
const payloadFd = openSync(payloadPath, "r");
let extracted;
try {
  const result = exec(python, ["-X", "utf8", extractor], { cwd: root, stdio: [payloadFd, "pipe", "pipe"], maxBuffer: 50 * 1024 * 1024, encoding: "utf8",
    env: { ...process.env, TECH_TOPICS_BASELINE_TTS_DIR: historicalTtsDir } });
  extracted = JSON.parse(result);
} catch (error) {
  throw new Error(`Model-free HTML/narration extraction failed (${python}): ${error.message}`);
} finally {
  closeSync(payloadFd);
  await rm(snapshotDir, { recursive: true, force: true });
}
const hasReplacementCharacter = value => typeof value === "string" ? value.includes("\uFFFD") :
  Array.isArray(value) ? value.some(hasReplacementCharacter) : value && typeof value === "object" ? Object.values(value).some(hasReplacementCharacter) : false;
if (hasReplacementCharacter(extracted)) throw new Error("UTF-8 extraction produced U+FFFD; refusing a corrupted baseline");
if (extracted.articles.length !== articles.length) throw new Error("Extractor returned a different article count");

const records = articles.map(({ article, file, addedAt, sourceBlob }, index) => {
  const extractedArticle = extracted.articles[index];
  const assets = [...extractedArticle.assets, { tag: "article", attribute: "image", value: article.image }].map(asset => {
    const raw = asset.value.split(/[?#]/, 1)[0];
    const normalized = raw.replace(/^\.\//, "");
    return { ...asset, gitBlob: treeByPath.get(normalized) ?? null };
  });
  const details = articleSignatures(article, extractedArticle, assets);
  return { slug: article.slug, source: file, sourceBlob, addedAt, publishedAt: article.publishedAt,
    order: index + 1, ...details };
});
const captureFiles = ["scripts/capture-migration-baseline.mjs", "scripts/lib/migration-baseline.mjs", "scripts/lib/migration-baseline-extract.py",
  ...(!isLegacyCorpus ? [...new Set(["scripts/lib/markdown-article.mjs", `scripts/lib/${path.basename(historicalArticleModule)}`, "scripts/lib/migration-compare.mjs"])] : [])];
const baseline = { schemaVersion: 3, sha, sourceCount: records.length,
  capture: { synthesis: false,
    contracts: { python: "native extractor editorial sentences and legacy chunks; exact text, language runs, indices, pauses and metadata", dom: "native player blocks; exact segment text, language, indices and original word-node mapping", comparison: "cross-contract equivalence is inconclusive and is not asserted" },
    narration: { editorialSentences: { preset: "equilibrado", settings: extracted.presets.equilibrado },
      legacyChunks: { preset: "atual", settings: extracted.presets.atual,
        meaning: "historical inference-plan chunks only; not editorial sentence indices or measured MP3/chapter timing" } },
    runtime: { node: process.version, python: exec(python, ["-c", "import sys; print(sys.version.split()[0])"], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/).at(-1) }, sourceTools: speechToolSignatures,
  captureTools: await Promise.all(captureFiles.map(async file => ({ path: file, sha256: sha256((await readFile(path.join(root, file), "utf8")).replace(/\r\n/g, "\n")) }))) },
  indexSourceCount: JSON.parse(await git("show", `${sha}:content/articles/index.json`)).length,
  articles: records };
if (previousPath) {
  const resolvedPrevious = path.resolve(root, previousPath);
  const previous = JSON.parse(await readFile(resolvedPrevious, "utf8"));
  baseline.previous = { sha: previous.sha, path: path.relative(root, resolvedPrevious).replaceAll("\\", "/") };
  baseline.diff = { articles: compareBaselines(previous, baseline), captureTools: compareCaptureTools(previous, baseline) };
}
const failures = validateBaseline(baseline);
if (failures.length) throw new Error(failures.join("\n"));
const destination = path.join(outputRoot, sha, "baseline.json");
await mkdir(path.dirname(destination), { recursive: true });
try { await readFile(destination); throw new Error(`Refusing to overwrite immutable baseline ${destination}`); }
catch (error) { if (error.code !== "ENOENT") throw error; }
await writeFile(destination, `${JSON.stringify(baseline, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ path: path.relative(root, destination).replaceAll("\\", "/"), sha, sourceCount: records.length, indexSourceCount: baseline.indexSourceCount }));
