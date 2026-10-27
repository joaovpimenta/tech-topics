const { createServer } = require("node:http");
const { readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");

const options = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (!key.startsWith("--") || !process.argv[i + 1]) throw new Error(`Expected --name value, got ${key}`);
  options.set(key, process.argv[i + 1]);
}
const root = path.resolve(options.get("--root") ?? path.resolve(__dirname, ".."));
const dist = path.resolve(root, options.get("--dist") ?? "dist");
const chaptersDir = path.resolve(options.get("--chapters-dir") ?? "");
const basePath = options.get("--base-path") ?? "/tech-topics/";
const sourceSha = options.get("--source-sha");
const outputPath = options.get("--output") ? path.resolve(options.get("--output")) : null;
const detail = options.get("--detail") ?? "summary";
if (!["summary", "full"].includes(detail)) throw new Error("--detail must be summary or full");
const baselinePath = path.resolve(root, options.get("--baseline") ?? "docs/migrations/baselines/capture-v3/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json");
if (!options.has("--chapters-dir")) throw new Error("Pass --chapters-dir with the read-only snapshot of existing chapters");
if (!sourceSha) throw new Error("Pass --source-sha with the full commit SHA used to build dist");
if (!basePath.startsWith("/") || !basePath.endsWith("/")) throw new Error("--base-path must begin and end with /");
const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fileExists = async file => { try { await readFile(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
const typeFor = file => file.endsWith(".js") ? "text/javascript" : file.endsWith(".json") ? "application/json" : file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream";

async function main() {
  const { nativeDomUnitHash } = await import(pathToFileURL(path.join(__dirname, "lib", "migration-baseline.mjs")));
  const { instrumentSpeechBuildBlocks, spokenRunsSignature } = await import(pathToFileURL(path.join(__dirname, "lib", "migration-dom-signature.mjs")));
  const { verifyMarkdownSiteArtifact } = await import(pathToFileURL(path.join(__dirname, "lib", "markdown-site-artifact.mjs")));
  const distIdentity = await verifyMarkdownSiteArtifact(dist, sourceSha);
  let chromium;
  const playwrightPath = process.env.TECH_TOPICS_PLAYWRIGHT || "playwright";
  try { ({ chromium } = require(playwrightPath)); }
  catch (error) { throw new Error(`Playwright unavailable; set TECH_TOPICS_PLAYWRIGHT to its module path (${error.message})`); }
  const catalog = JSON.parse(await readFile(path.join(dist, "assets/articles-catalog.json"), "utf8"));
  const lexicon = JSON.parse(await readFile(path.join(dist, "content/tts-lexicon.json"), "utf8"));
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const baselineBySlug = new Map(baseline.articles.map(article => [article.slug, article]));
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://local").pathname);
      if (!pathname.startsWith(basePath)) throw new Error("outside base path");
      const relative = pathname.slice(basePath.length) || "index.html";
      const file = path.resolve(dist, relative);
      if (file !== dist && !file.startsWith(`${dist}${path.sep}`)) throw new Error("path escapes dist");
      response.setHeader("Content-Type", typeFor(file));
      response.end(await readFile(file));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  const records = [];
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.TECH_TOPICS_CHROMIUM || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const page = await browser.newPage({ serviceWorkers: "block" });
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== "127.0.0.1") return route.abort();
      if (url.pathname.endsWith("/speech.js")) {
        const response = await route.fetch();
        const instrumentedSource = instrumentSpeechBuildBlocks(await response.text());
        const body = `${instrumentedSource}\n;(() => { const originalMount = window.TechTopicsSpeech.mount; window.TechTopicsSpeech.mount = function(options) { const player = originalMount(options); window.__actualBlocks = player?.blocks ?? null; return player; }; })();`;
        return route.fulfill({ response, body });
      }
      return route.continue();
    });
    await page.addInitScript(() => {
      window.__articleReady = false;
      document.addEventListener("tech-topics:article-ready", () => { window.__articleReady = true; });
      Object.defineProperty(window, "speechSynthesis", { value: { getVoices: () => [], speak() { throw new Error("Speech synthesis is disabled during this audit"); }, cancel() {}, pause() {}, resume() {}, addEventListener() {} } });
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    });
    for (const article of catalog) {
      const slug = article.slug;
      await page.goto(`http://127.0.0.1:${server.address().port}${basePath}article.html?slug=${encodeURIComponent(slug)}`);
      await page.waitForFunction(() => window.__articleReady, undefined, { timeout: 15000 });
      const audit = await page.evaluate(articleLexicon => {
        const header = document.querySelector(".article-header").cloneNode(true);
        const body = document.querySelector("#article-body").cloneNode(true);
        const holder = document.createElement("div");
        holder.lang = "pt-BR";
        holder.append(header, body);
        const rootsFor = (heading, dek, content) => [heading, dek, content];
        const compact = (units, elements) => {
          const nodeIds = new WeakMap();
          let nextNodeId = 0;
          const nodeId = node => {
            if (!nodeIds.has(node)) nodeIds.set(node, String(++nextNodeId));
            return nodeIds.get(node);
          };
          return units.map(unit => ({
            blockIndex: elements.indexOf(unit.node), sentenceIndex: unit.sentenceIndex,
            segments: unit.segments.map(segment => ({ text: segment.text, lang: segment.lang,
              separatorBefore: segment.separatorBefore,
              words: segment.words.map(({ start, end, nodes }) => ({ start, end, nodeIds: nodes.map(nodeId) })) }))
          }));
        };
        const cloneElements = window.TechTopicsAudio.readingNodes({ querySelector: selector => holder.querySelector(selector) });
        const cloneUnits = compact(window.TechTopicsSpeech.buildBlocks(
          rootsFor(header.querySelector("#article-heading"), header.querySelector("#article-dek"), body), articleLexicon), cloneElements);
        const mountedElements = window.TechTopicsAudio.readingNodes(document);
        if (!Array.isArray(window.__actualBlocks)) throw new Error("Could not capture original speech mount blocks");
        const mountedUnits = compact(window.__actualBlocks, mountedElements);
        return { cloneUnits, mountedUnits };
      }, lexicon);
      const units = audit.cloneUnits;
      const mountedUnits = audit.mountedUnits;
      const mountedCloneMatches = JSON.stringify(units) === JSON.stringify(mountedUnits);
      const firstMountedCloneMismatch = units.findIndex((unit, index) => JSON.stringify(unit) !== JSON.stringify(mountedUnits[index]));
      const chapterPath = path.join(chaptersDir, `${slug}.json`);
      const hasChapters = await fileExists(chapterPath);
      let chapter = null;
      if (hasChapters) chapter = JSON.parse(await readFile(chapterPath, "utf8"));
      const chapterUnits = chapter?.chapters ?? [];
      const firstIndexMismatch = units.findIndex((unit, index) => chapterUnits[index]?.block_index !== unit.blockIndex || chapterUnits[index]?.sentence_index !== unit.sentenceIndex);
      const indexesMatch = hasChapters && chapterUnits.length === units.length && firstIndexMismatch < 0;
      const compactChapters = chapterUnits.map(item => ({ start: item.start, blockIndex: item.block_index, sentenceIndex: item.sentence_index, labelSha256: digest(item.label ?? "") }));
      const pythonBaseline = baselineBySlug.get(slug);
      const domUnitSignatures = units.map(unit => ({ blockIndex: unit.blockIndex, sentenceIndex: unit.sentenceIndex,
        sha256: nativeDomUnitHash(unit), spokenRunsSha256: spokenRunsSignature(unit.segments) }));
      const mountedDomUnitSignatures = mountedUnits.map(unit => ({ blockIndex: unit.blockIndex, sentenceIndex: unit.sentenceIndex,
        sha256: nativeDomUnitHash(unit), spokenRunsSha256: spokenRunsSignature(unit.segments) }));
      records.push({ slug, chapterFile: hasChapters ? `${slug}.json` : null, chapterVersion: chapter?.version ?? null,
        domUnits: units.length, chapterUnits: chapterUnits.length, indexesMatch, firstIndexMismatch: firstIndexMismatch < 0 ? null : firstIndexMismatch,
        mountedCloneMatches, firstMountedCloneMismatch: firstMountedCloneMismatch < 0 ? null : firstMountedCloneMismatch,
        domSignature: digest(domUnitSignatures), mountedDomSignature: digest(mountedDomUnitSignatures),
        domUnitSignatures, mountedDomUnitSignatures,
        pythonSignatures: { structure: pythonBaseline?.signatures.structure ?? null,
          editorialSentences: pythonBaseline?.signatures.editorialSentences ?? null, legacyChunks: pythonBaseline?.signatures.legacyChunks ?? null },
        chaptersSignature: digest(compactChapters),
        ...(detail === "full" ? { units, chapters: compactChapters } : {}),
        limitations: ["Python sentences map to DOM units by order and normalized spoken language/text runs; numeric frame indices are not used for that correspondence.", "DOM/chapter index correspondence does not prove acoustic identity; no audio was rendered or heard."] });
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  const report = { schemaVersion: 3, baselineSourceSha: baseline.sha, sourceSha: distIdentity.sourceSha,
    buildId: distIdentity.buildId, artifactFileCount: distIdentity.fileCount, sourceRoot: ".", distRoot: path.relative(root, dist).replaceAll("\\", "/"),
    baselinePath: path.relative(root, baselinePath).replaceAll("\\", "/"), baselineSha: baseline.sha,
    distIdentityVerified: true, basePath, articleCount: records.length,
    contracts: { python: "native extractor sentence signatures from the initial baseline", dom: "native player segment and word-node records hashed per unit",
      crossContractComparison: "ordered Python sentence runs are matched to normalized DOM speech language/text runs" },
    chapterIndexMatchingArticles: records.filter(record => record.indexesMatch).length,
    mountedCloneMatchingArticles: records.filter(record => record.mountedCloneMatches).length,
    mountedCloneMismatches: records.filter(record => !record.mountedCloneMatches).map(({ slug, firstMountedCloneMismatch }) => ({ slug, firstMountedCloneMismatch })),
    pythonNativeSignatureSha256: digest(records.map(record => ({ slug: record.slug, signatures: record.pythonSignatures }))),
    domNativeSignatureSha256: digest(records.map(record => ({ slug: record.slug, signature: record.domSignature }))),
    mountedDomNativeSignatureSha256: digest(records.map(record => ({ slug: record.slug, signature: record.mountedDomSignature }))),
    chapterIndexMismatches: records.filter(record => !record.indexesMatch).map(({ slug, domUnits, chapterUnits, firstIndexMismatch, chapterVersion }) => ({ slug, domUnits, chapterUnits, firstIndexMismatch, chapterVersion })),
    articles: records };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) await writeFile(outputPath, serialized, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({ schemaVersion: report.schemaVersion, articleCount: report.articleCount,
    mountedCloneMatchingArticles: report.mountedCloneMatchingArticles, mountedCloneMismatches: report.mountedCloneMismatches,
    chapterIndexMatchingArticles: report.chapterIndexMatchingArticles,
    pythonNativeSignatureSha256: report.pythonNativeSignatureSha256,
    domNativeSignatureSha256: report.domNativeSignatureSha256,
    crossContractComparison: report.contracts.crossContractComparison,
    chapterIndexMismatches: report.chapterIndexMismatches,
    reportPath: outputPath }, null, 2)}\n`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
