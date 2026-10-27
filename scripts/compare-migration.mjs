import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import { compileMarkdownArticle, fromLegacyArticle } from "./lib/markdown-article.mjs";
import { articleForNarrationExtraction, baselineCoverageBlockers, baselineReplayBlockers, compareAgainstInitialBaseline, compareDomAgainstInitialBaseline, compareArticleStates, assertCommitSha, validateDomAuditReport, validateIndependentBaseline, toolFingerprint, discoverArticleSources, firstAdditionDate, isArticleNavigationLink, runGitText } from "./lib/migration-compare.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const value = flag => { const index = argv.indexOf(flag); return index < 0 ? undefined : argv[index + 1]; };
const beforeSha = value("--before"), afterSha = value("--after"), baselinePath = value("--baseline"), domBaselinePath = value("--dom-baseline");
if (!beforeSha || !afterSha || !baselinePath || !domBaselinePath) throw new Error("Usage: node scripts/compare-migration.mjs --before <full-sha> --after <full-sha> --baseline <independent-baseline.json> --dom-baseline <initial-dom-audit.json> --dom-before <audit.json> --dom-after <audit.json> [--allow-remove <slug>]");
assertCommitSha(beforeSha, "--before");
assertCommitSha(afterSha, "--after");
if (beforeSha === afterSha) throw new Error("--before and --after must identify different commits");
const baseline = validateIndependentBaseline(JSON.parse(await readFile(path.resolve(root, baselinePath), "utf8")));
const domBaseline = validateDomAuditReport(JSON.parse(await readFile(path.resolve(root, domBaselinePath), "utf8")), {
  expectedSourceSha: baseline.sha, baselineSha: baseline.sha, label: "--dom-baseline"
});
const domBeforePath = value("--dom-before"), domAfterPath = value("--dom-after");
if (!domBeforePath || !domAfterPath) throw new Error("both --dom-before and --dom-after audit reports are required");
const domBeforeInput = JSON.parse(await readFile(path.resolve(root, domBeforePath), "utf8"));
const domAfterInput = JSON.parse(await readFile(path.resolve(root, domAfterPath), "utf8"));
if (domBeforeInput.commitSha !== beforeSha || domAfterInput.commitSha !== afterSha || !domBeforeInput.report || !domAfterInput.report) {
  throw new Error("DOM inputs must wrap each audit as {commitSha, report} and match the explicitly supplied before/after SHAs");
}
const domBefore = validateDomAuditReport(domBeforeInput.report, {
  expectedSourceSha: beforeSha, baselineSha: baseline.sha, label: "--dom-before"
});
const domAfter = validateDomAuditReport(domAfterInput.report, {
  expectedSourceSha: afterSha, baselineSha: baseline.sha, label: "--dom-after"
});
const git = (...args) => runGitText(root, ...args);
for (const sha of [beforeSha, afterSha, baseline.sha]) git("cat-file", "-e", `${sha}^{commit}`);

function treeAt(sha) {
  return new Map(git("ls-tree", "-r", sha).split(/\r?\n/).filter(Boolean).map(line => {
    const match = line.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/);
    return match && [match[2], match[1]];
  }).filter(Boolean));
}
function sourceInventory(sha, tree) {
  return discoverArticleSources(tree.keys(), sha);
}
function historyAddedAt(sha, slug) {
  const paths = [`content/articles/${slug}.json`, `content/articles/${slug}.md`];
  const log = git("log", "--reverse", "--diff-filter=A", "--format=%cI", sha, "--", ...paths);
  try { return firstAdditionDate(log, slug); }
  catch { throw new Error(`${sha}: Git history has no first addition for ${slug}`); }
}
function metadataFromFrontmatter(source) {
  const match = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) throw new Error("Markdown frontmatter was not found");
  const document = parseDocument(match[1], { version: "1.2", schema: "core", strict: true });
  if (document.errors.length) throw new Error(`Markdown frontmatter is invalid: ${document.errors.map(error => error.message).join("; ")}`);
  return document.toJS();
}

const trees = new Map([[beforeSha, treeAt(beforeSha)], [afterSha, treeAt(afterSha)]]);
const inventories = new Map([...trees].map(([sha, tree]) => [sha, sourceInventory(sha, tree)]));
const lexiconPath = "content/tts-lexicon.json";
const pythonCommand = process.env.TECH_TOPICS_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const lexiconBlobs = [beforeSha, afterSha].map(sha => trees.get(sha).get(lexiconPath));
if (!lexiconBlobs[0] || lexiconBlobs[0] !== lexiconBlobs[1]) throw new Error("before and after must use the exact same committed TTS lexicon");
const lexicon = JSON.parse(git("show", `${beforeSha}:${lexiconPath}`));
const knownTagsBySha = new Map([...inventories].map(([sha, inventory]) => [sha, new Set(inventory.flatMap(({ file }) => {
  const text = git("show", `${sha}:${file}`);
  if (file.endsWith(".json")) return JSON.parse(text).tags ?? [];
  return metadataFromFrontmatter(text).tags ?? [];
}))]));
const ttsPaths = ["tools/tts/article_selection.py", "tools/tts/narration_text.py", "tools/tts/segmentation.py", "tools/tts/kokoro_release.py", lexiconPath];
for (const file of ttsPaths) {
  if (trees.get(beforeSha).get(file) !== trees.get(afterSha).get(file)) throw new Error(`before and after use different extractor inputs: ${file}`);
}

async function extract(sha) {
  const tree = trees.get(sha), inventory = inventories.get(sha);
  const articles = [];
  const knownSlugs = new Set(inventory.map(article => article.slug));
  const knownTags = knownTagsBySha.get(sha);
  for (const source of inventory) {
    const text = git("show", `${sha}:${source.file}`);
    const context = { sourcePath: source.file, rootPath: root, knownTags, knownSlugs,
      assetExists: file => tree.has(file) };
    const compiled = source.extension === "json"
      ? fromLegacyArticle(JSON.parse(text), context)
      : await compileMarkdownArticle({ source: text, ...context });
    if (compiled.metadata.slug !== source.slug) throw new Error(`${sha}:${source.file}: metadata slug does not match filename`);
    articles.push({ slug: source.slug, metadata: compiled.metadata,
      bodyHtml: compiled.slots.body,
      addedAt: historyAddedAt(sha, source.slug) });
  }
  const payload = JSON.stringify({ articles: articles.map(articleForNarrationExtraction), lexicon });
  const extractor = path.join(root, "scripts/lib/migration-baseline-extract.py");
  const { spawnSync } = await import("node:child_process");
  const snapshot = await mkdtemp(path.join(root, ".tmp-migration-compare-tools-"));
  try {
    const historicalTtsDir = path.join(snapshot, "tools", "tts");
    await mkdir(historicalTtsDir, { recursive: true });
    for (const file of ttsPaths) {
      const content = git("show", `${sha}:${file}`);
      const destination = path.join(snapshot, file);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, content, "utf8");
    }
    const result = spawnSync(pythonCommand, ["-X", "utf8", extractor], { cwd: root, input: payload, encoding: "utf8", maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, PYTHONUTF8: "1", TECH_TOPICS_BASELINE_TTS_DIR: historicalTtsDir } });
    if (result.status !== 0) throw new Error(`${sha}: narration extraction failed: ${result.stderr || result.error?.message}`);
    const extracted = JSON.parse(result.stdout);
    if (result.stdout.includes("\uFFFD")) throw new Error(`${sha}: narration extraction contains U+FFFD; refusing a corrupted comparison`);
    const ordered = articles.map((article, index) => {
      const source = inventory[index];
      const extractedArticle = extracted.articles[index];
      const assets = [...extractedArticle.assets.filter(asset => !isArticleNavigationLink(asset)), { tag: "article", attribute: "image", value: article.metadata.image }].map(asset => {
        const normalized = asset.value.split(/[?#]/, 1)[0].replace(/^\.\//, "");
        return { ...asset, gitBlob: tree.get(normalized) ?? null };
      });
      return { ...article, ...extractedArticle, source: source.file, sourceBlob: tree.get(source.file) ?? null, assets };
    })
      .sort((a, b) => b.metadata.publishedAt.localeCompare(a.metadata.publishedAt) ||
        (Date.parse(b.addedAt) || 0) - (Date.parse(a.addedAt) || 0) || a.slug.localeCompare(b.slug));
    return { sha, articles: ordered.map((article, index) => ({ ...article, order: index + 1 })) };
  } finally { await rm(snapshot, { recursive: true, force: true }); }
}
const [before, after] = await Promise.all([extract(beforeSha), extract(afterSha)]);
const currentToolFingerprint = toolFingerprint([
  { path: "scripts/lib/markdown-article.mjs", content: await readFile(path.join(root, "scripts/lib/markdown-article.mjs"), "utf8") },
  { path: "scripts/compare-migration.mjs", content: await readFile(fileURLToPath(import.meta.url), "utf8") },
  { path: "scripts/lib/migration-compare.mjs", content: await readFile(path.join(root, "scripts/lib/migration-compare.mjs"), "utf8") },
  { path: "scripts/lib/migration-dom-signature.mjs", content: await readFile(path.join(root, "scripts/lib/migration-dom-signature.mjs"), "utf8") },
  { path: "scripts/lib/migration-baseline-extract.py", content: await readFile(path.join(root, "scripts/lib/migration-baseline-extract.py"), "utf8") },
  ...ttsPaths.map(file => ({ path: file, content: git("show", `${beforeSha}:${file}`) }))
]);
const initialTools = new Map([...baseline.capture.sourceTools, ...baseline.capture.captureTools].map(tool => [tool.path, tool.sha256]));
const initialToolDrift = currentToolFingerprint.flatMap(tool => {
  const expected = initialTools.get(tool.path);
  return expected && expected !== tool.sha256 ? [{ path: tool.path, initial: expected, current: tool.sha256 }] : [];
});
const authorizedRemovals = value("--allow-remove")?.split(",").filter(Boolean) ?? [];
const changes = compareArticleStates(before, after, { authorizedRemovals, domBefore, domAfter });
if (initialToolDrift.length) changes.blockers.push({ kind: "baseline-toolchain", reason: "capture or narration tools differ from the independent initial baseline", files: initialToolDrift.map(item => item.path) });
const baselineDrift = { before: compareAgainstInitialBaseline(before, baseline),
  after: compareAgainstInitialBaseline(after, baseline, { authorizedRemovals }) };
const domBaselineDrift = { before: compareDomAgainstInitialBaseline(domBefore, domBaseline),
  after: compareDomAgainstInitialBaseline(domAfter, domBaseline, { authorizedRemovals }) };
changes.blockers.push(...baselineCoverageBlockers({ baselineDrift, domBaselineDrift }));
changes.blockers.push(...baselineReplayBlockers({ baseline, before, after, baselineDrift, domBaselineDrift }));
changes.selection = changes.selection.filter(slug => !changes.blockers.some(blocker => !blocker.slug || blocker.slug === slug));
const pythonVersion = execFileSync(pythonCommand, ["-c", "import sys; print(sys.version.split()[0])"], { cwd: root, encoding: "utf8" }).trim();
const output = { schemaVersion: 1, before: beforeSha, after: afterSha, initialBaseline: { sha: baseline.sha, sourceCount: baseline.sourceCount },
  runtime: { node: process.version, python: pythonVersion },
  rendererAndExtractor: { commonToBothCommits: true, lexiconBlob: lexiconBlobs[0], fingerprint: currentToolFingerprint,
    initialToolDrift },
  narration: changes.narration, framing: changes.framing, selection: changes.selection, blockers: changes.blockers, baselineDrift, domBaselineDrift };
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (changes.blockers.length) process.exitCode = 2;
