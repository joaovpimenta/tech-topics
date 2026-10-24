import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { articleSignatures, compareBaselines, compareCaptureTools, validateBaseline } from "./lib/migration-baseline.mjs";

const exec = (...args) => execFileSync(...args);
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
const articlePaths = tree.map(item => item.file).filter(file => file.startsWith("content/articles/") && file.endsWith(".json") && !["index.json", "catalog.json"].includes(path.posix.basename(file))).sort();
if (!articlePaths.length) throw new Error(`No article source JSON files at ${sha}`);

const articles = [];
for (const file of articlePaths) {
  const article = JSON.parse(await git("show", `${sha}:${file}`));
  if (article.slug !== path.posix.basename(file, ".json")) throw new Error(`${file}: slug does not match path`);
  const addedLog = (await git("log", "--follow", "--diff-filter=A", "--format=%cI", sha, "--", file)).trim().split("\n").filter(Boolean);
  const addedAt = addedLog.at(-1) ?? "";
  if (!addedAt) throw new Error(`${file}: Git history has no original addition date`);
  articles.push({ article, file, addedAt, sourceBlob: treeByPath.get(file) });
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
let extracted;
try {
  const result = exec(python, ["-X", "utf8", extractor], { cwd: root, input: payload, maxBuffer: 50 * 1024 * 1024, encoding: "utf8",
    env: { ...process.env, TECH_TOPICS_BASELINE_TTS_DIR: historicalTtsDir } });
  extracted = JSON.parse(result);
} catch (error) {
  throw new Error(`Model-free HTML/narration extraction failed (${python}): ${error.message}`);
} finally {
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
const captureFiles = ["scripts/capture-migration-baseline.mjs", "scripts/lib/migration-baseline.mjs", "scripts/lib/migration-baseline-extract.py"];
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
