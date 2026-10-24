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
const outputPath = options.get("--output") ? path.resolve(options.get("--output")) : null;
const detail = options.get("--detail") ?? "summary";
if (!["summary", "full"].includes(detail)) throw new Error("--detail must be summary or full");
const baselinePath = path.resolve(root, options.get("--baseline") ?? "docs/migrations/baselines/capture-v2/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json");
if (!options.has("--chapters-dir")) throw new Error("Pass --chapters-dir with the read-only snapshot of existing chapters");
if (!basePath.startsWith("/") || !basePath.endsWith("/")) throw new Error("--base-path must begin and end with /");
const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const textHash = value => crypto.createHash("sha256").update(value).digest("hex");
const canonicalNarrationText = value => value.normalize("NFC").replace(/\s+/g, " ").trim().replace(/\s*([,;:!?])\s*/g, "$1");
const fileExists = async file => { try { await readFile(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
const typeFor = file => file.endsWith(".js") ? "text/javascript" : file.endsWith(".json") ? "application/json" : file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream";

async function main() {
  const { playerSemanticTokens } = await import(pathToFileURL(path.join(__dirname, "lib", "migration-baseline.mjs")));
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
        const body = `${await response.text()}\n;(() => { const originalMount = window.TechTopicsSpeech.mount; window.TechTopicsSpeech.mount = function(options) { const player = originalMount(options); window.__actualBlocks = player?.blocks ?? null; return player; }; })();`;
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
            text: unit.segments.map(segment => segment.text).join("").normalize("NFC").trim(),
            runs: unit.segments.map(segment => ({ text: segment.text, lang: segment.lang })),
            segments: unit.segments.map(segment => ({ text: segment.text, lang: segment.lang,
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
      const units = audit.cloneUnits.map(unit => ({ ...unit, tokens: playerSemanticTokens(unit.segments) }));
      const mountedUnits = audit.mountedUnits.map(unit => ({ ...unit, tokens: playerSemanticTokens(unit.segments) }));
      const mountedCloneMatches = JSON.stringify(units) === JSON.stringify(mountedUnits);
      const firstMountedCloneMismatch = units.findIndex((unit, index) => JSON.stringify(unit) !== JSON.stringify(mountedUnits[index]));
      const editorialUnits = units.map(unit => ({ blockIndex: unit.blockIndex, sentenceIndex: unit.sentenceIndex,
        canonicalTextSha256: textHash(canonicalNarrationText(unit.text)),
        punctuationSha256: textHash((unit.text.match(/[\p{P}\p{S}]+/gu) ?? []).join("")),
        semanticTokens: unit.tokens.map(token => ({
          lang: token.lang.toLowerCase(),
          textSha256: textHash(token.text.replace(/[\p{P}\p{S}]/gu, "").normalize("NFC"))
        })).filter(token => token.textSha256 !== textHash("")) }));
      const expectedEditorialUnits = baselineBySlug.get(slug)?.editorialSentences.map(sentence => ({
        blockIndex: sentence.blockIndex, sentenceIndex: sentence.sentenceIndex,
        canonicalTextSha256: sentence.canonicalTextSha256,
        punctuationSha256: sentence.punctuationSha256,
        semanticTokens: sentence.semanticTokens ?? null })) ?? null;
      const contentShape = unit => ({ sentenceIndex: unit.sentenceIndex,
        punctuationSha256: unit.punctuationSha256, semanticTokens: unit.semanticTokens });
      const indexShape = unit => ({ blockIndex: unit.blockIndex, sentenceIndex: unit.sentenceIndex });
      const baselineContentMatches = expectedEditorialUnits !== null && expectedEditorialUnits.every(unit => Array.isArray(unit.semanticTokens)) &&
        JSON.stringify(editorialUnits.map(contentShape)) === JSON.stringify(expectedEditorialUnits.map(contentShape));
      const baselineIndexMatches = expectedEditorialUnits !== null &&
        JSON.stringify(editorialUnits.map(indexShape)) === JSON.stringify(expectedEditorialUnits.map(indexShape));
      const baselineMatches = baselineContentMatches && baselineIndexMatches;
      const rawTextMatches = expectedEditorialUnits !== null && JSON.stringify(editorialUnits.map(({ blockIndex, sentenceIndex, canonicalTextSha256 }) => ({ blockIndex, sentenceIndex, canonicalTextSha256 }))) ===
        JSON.stringify(expectedEditorialUnits.map(({ blockIndex, sentenceIndex, canonicalTextSha256 }) => ({ blockIndex, sentenceIndex, canonicalTextSha256 })));
      let firstBaselineMismatch = expectedEditorialUnits ? editorialUnits.findIndex((unit, index) => {
        const expected = expectedEditorialUnits[index];
        return !expected || JSON.stringify(contentShape(unit)) !== JSON.stringify(contentShape(expected)) ||
          JSON.stringify(indexShape(unit)) !== JSON.stringify(indexShape(expected));
      }) : 0;
      if (expectedEditorialUnits && firstBaselineMismatch < 0 && editorialUnits.length !== expectedEditorialUnits.length) firstBaselineMismatch = Math.min(editorialUnits.length, expectedEditorialUnits.length);
      const mismatchContext = firstBaselineMismatch >= 0 && expectedEditorialUnits?.[firstBaselineMismatch] ? {
        index: firstBaselineMismatch,
        previous: firstBaselineMismatch > 0 ? { expected: expectedEditorialUnits[firstBaselineMismatch - 1], observed: editorialUnits[firstBaselineMismatch - 1] } : null,
        expected: expectedEditorialUnits[firstBaselineMismatch], observed: editorialUnits[firstBaselineMismatch]
      } : null;
      const chapterPath = path.join(chaptersDir, `${slug}.json`);
      const hasChapters = await fileExists(chapterPath);
      let chapter = null;
      if (hasChapters) chapter = JSON.parse(await readFile(chapterPath, "utf8"));
      const chapterUnits = chapter?.chapters ?? [];
      const firstIndexMismatch = units.findIndex((unit, index) => chapterUnits[index]?.block_index !== unit.blockIndex || chapterUnits[index]?.sentence_index !== unit.sentenceIndex);
      const indexesMatch = hasChapters && chapterUnits.length === units.length && firstIndexMismatch < 0;
      const compactUnitsFor = sourceUnits => sourceUnits.map(unit => ({ blockIndex: unit.blockIndex, sentenceIndex: unit.sentenceIndex,
        textSha256: digest(unit.text), canonicalTextSha256: textHash(canonicalNarrationText(unit.text)),
        punctuationSha256: textHash((unit.text.match(/[\p{P}\p{S}]+/gu) ?? []).join("")),
        runs: unit.runs.map(run => ({ lang: run.lang, textSha256: digest(run.text) })),
        semanticTokens: unit.tokens.map(token => ({ lang: token.lang.toLowerCase(), textSha256: textHash(token.text.replace(/[\p{P}\p{S}]/gu, "").normalize("NFC")) })).filter(token => token.textSha256 !== textHash("")) }));
      const compactUnits = compactUnitsFor(units);
      const compactMountedUnits = compactUnitsFor(mountedUnits);
      const compactChapters = chapterUnits.map(item => ({ start: item.start, blockIndex: item.block_index, sentenceIndex: item.sentence_index, labelSha256: digest(item.label ?? "") }));
      const pythonBaseline = baselineBySlug.get(slug);
      records.push({ slug, chapterFile: hasChapters ? `${slug}.json` : null, chapterVersion: chapter?.version ?? null,
        domUnits: units.length, baselineUnits: expectedEditorialUnits?.length ?? 0, chapterUnits: chapterUnits.length, indexesMatch, firstIndexMismatch: firstIndexMismatch < 0 ? null : firstIndexMismatch,
        mountedCloneMatches, firstMountedCloneMismatch: firstMountedCloneMismatch < 0 ? null : firstMountedCloneMismatch,
        baselineMatches, baselineContentMatches, baselineIndexMatches, rawTextMatches,
        firstBaselineMismatch: firstBaselineMismatch < 0 ? null : firstBaselineMismatch, mismatchContext,
        domSignature: digest(compactUnits), mountedDomSignature: digest(compactMountedUnits),
        pythonSignatures: { structure: pythonBaseline?.signatures.structure ?? null,
          editorialSentences: pythonBaseline?.signatures.editorialSentences ?? null },
        chaptersSignature: digest(compactChapters),
        ...(detail === "full" ? { units: compactUnits, chapters: compactChapters } : {}),
        limitations: ["DOM and chapters are compared structurally; this does not prove acoustic quality.", "Chapter labels may be truncated, so only their hashes are retained; index correspondence does not prove text identity."] });
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  const report = { schemaVersion: 1, sourceSha: baseline.sha, sourceRoot: ".", distRoot: path.relative(root, dist).replaceAll("\\", "/"),
    baselinePath: path.relative(root, baselinePath).replaceAll("\\", "/"), baselineSha: baseline.sha, basePath, articleCount: records.length,
    matchingArticles: records.filter(record => record.indexesMatch).length,
    mountedCloneMatchingArticles: records.filter(record => record.mountedCloneMatches).length,
    mountedCloneMismatches: records.filter(record => !record.mountedCloneMatches).map(({ slug, firstMountedCloneMismatch }) => ({ slug, firstMountedCloneMismatch })),
    baselineMatchingArticles: records.filter(record => record.baselineMatches).length,
    baselineContentMatchingArticles: records.filter(record => record.baselineContentMatches).length,
    baselineIndexMatchingArticles: records.filter(record => record.baselineIndexMatches).length,
    baselineMismatches: records.filter(record => !record.baselineMatches).map(({ slug, firstBaselineMismatch, domUnits, baselineUnits, baselineContentMatches, baselineIndexMatches }) => ({
      slug, firstBaselineMismatch, domUnits, baselineUnits, contentMismatch: !baselineContentMatches, indexMismatch: !baselineIndexMatches })),
    rawTextMatchingArticles: records.filter(record => record.rawTextMatches).length,
    mismatches: records.filter(record => !record.indexesMatch).map(({ slug, domUnits, chapterUnits, firstIndexMismatch, chapterVersion }) => ({ slug, domUnits, chapterUnits, firstIndexMismatch, chapterVersion })),
    articles: records };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) await writeFile(outputPath, serialized, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({ schemaVersion: report.schemaVersion, articleCount: report.articleCount,
    mountedCloneMatchingArticles: report.mountedCloneMatchingArticles, mountedCloneMismatches: report.mountedCloneMismatches,
    semanticBaselineMatchingArticles: report.baselineMatchingArticles,
    semanticBaselineContentMatchingArticles: report.baselineContentMatchingArticles,
    semanticBaselineIndexMatchingArticles: report.baselineIndexMatchingArticles,
    semanticBaselineMismatches: report.baselineMismatches,
    rawTextMatchingArticles: report.rawTextMatchingArticles,
    chapterIndexMatchingArticles: report.matchingArticles, chapterIndexMismatches: report.mismatches,
    reportPath: outputPath }, null, 2)}\n`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
