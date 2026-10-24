const { createServer } = require("node:http");
const { readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

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
if (!options.has("--chapters-dir")) throw new Error("Pass --chapters-dir with the read-only snapshot of existing chapters");
if (!basePath.startsWith("/") || !basePath.endsWith("/")) throw new Error("--base-path must begin and end with /");
const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fileExists = async file => { try { await readFile(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
const typeFor = file => file.endsWith(".js") ? "text/javascript" : file.endsWith(".json") ? "application/json" : file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream";

async function main() {
  let chromium;
  const playwrightPath = process.env.TECH_TOPICS_PLAYWRIGHT || "playwright";
  try { ({ chromium } = require(playwrightPath)); }
  catch (error) { throw new Error(`Playwright unavailable; set TECH_TOPICS_PLAYWRIGHT to its module path (${error.message})`); }
  const catalog = JSON.parse(await readFile(path.join(dist, "assets/articles-catalog.json"), "utf8"));
  const lexicon = JSON.parse(await readFile(path.join(dist, "content/tts-lexicon.json"), "utf8"));
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
    await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
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
        const compact = (units, elements) => units.map(unit => ({
          blockIndex: elements.indexOf(unit.node), sentenceIndex: unit.sentenceIndex,
          text: unit.segments.map(segment => segment.text).join("").normalize("NFC").trim(),
          runs: unit.segments.map(segment => ({ text: segment.text, lang: segment.lang }))
        }));
        const cloneElements = window.TechTopicsAudio.readingNodes({ querySelector: selector => holder.querySelector(selector) });
        const cloneUnits = compact(window.TechTopicsSpeech.buildBlocks(
          rootsFor(header.querySelector("#article-heading"), header.querySelector("#article-dek"), body), articleLexicon), cloneElements);
        const mountedElements = window.TechTopicsAudio.readingNodes(document);
        const mountedUnits = compact(window.TechTopicsSpeech.buildBlocks(rootsFor(
          document.querySelector("#article-heading"), document.querySelector("#article-dek"), document.querySelector("#article-body")), articleLexicon), mountedElements);
        return { cloneUnits, mountedUnits };
      }, lexicon);
      const { cloneUnits: units, mountedUnits } = audit;
      const mountedCloneMatches = JSON.stringify(units) === JSON.stringify(mountedUnits);
      const firstMountedCloneMismatch = units.findIndex((unit, index) => JSON.stringify(unit) !== JSON.stringify(mountedUnits[index]));
      const chapterPath = path.join(chaptersDir, `${slug}.json`);
      const hasChapters = await fileExists(chapterPath);
      let chapter = null;
      if (hasChapters) chapter = JSON.parse(await readFile(chapterPath, "utf8"));
      const chapterUnits = chapter?.chapters ?? [];
      const firstIndexMismatch = units.findIndex((unit, index) => chapterUnits[index]?.block_index !== unit.blockIndex || chapterUnits[index]?.sentence_index !== unit.sentenceIndex);
      const indexesMatch = hasChapters && chapterUnits.length === units.length && firstIndexMismatch < 0;
      const compactUnits = units.map(unit => ({ blockIndex: unit.blockIndex, sentenceIndex: unit.sentenceIndex, textSha256: digest(unit.text), runs: unit.runs.map(run => ({ lang: run.lang, textSha256: digest(run.text) })) }));
      const compactChapters = chapterUnits.map(item => ({ start: item.start, blockIndex: item.block_index, sentenceIndex: item.sentence_index, labelSha256: digest(item.label ?? "") }));
      records.push({ slug, chapterFile: hasChapters ? `${slug}.json` : null, chapterVersion: chapter?.version ?? null,
        domUnits: units.length, chapterUnits: chapterUnits.length, indexesMatch, firstIndexMismatch: firstIndexMismatch < 0 ? null : firstIndexMismatch,
        mountedCloneMatches, firstMountedCloneMismatch: firstMountedCloneMismatch < 0 ? null : firstMountedCloneMismatch,
        domSignature: digest(compactUnits), chaptersSignature: digest(compactChapters),
        units: compactUnits, chapters: compactChapters,
        limitations: ["DOM and chapters are compared structurally; this does not prove acoustic quality.", "Chapter labels may be truncated, so only their hashes are retained; index correspondence does not prove text identity."] });
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  const report = { schemaVersion: 1, sourceRoot: root, distRoot: dist, basePath, articleCount: records.length,
    matchingArticles: records.filter(record => record.indexesMatch).length,
    mountedCloneMatchingArticles: records.filter(record => record.mountedCloneMatches).length,
    mountedCloneMismatches: records.filter(record => !record.mountedCloneMatches).map(({ slug, firstMountedCloneMismatch }) => ({ slug, firstMountedCloneMismatch })),
    mismatches: records.filter(record => !record.indexesMatch).map(({ slug, domUnits, chapterUnits, firstIndexMismatch, chapterVersion }) => ({ slug, domUnits, chapterUnits, firstIndexMismatch, chapterVersion })),
    articles: records };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) await writeFile(outputPath, serialized, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({ schemaVersion: report.schemaVersion, articleCount: report.articleCount,
    mountedCloneMatchingArticles: report.mountedCloneMatchingArticles, mountedCloneMismatches: report.mountedCloneMismatches,
    chapterIndexMatchingArticles: report.matchingArticles, chapterIndexMismatches: report.mismatches,
    reportPath: outputPath }, null, 2)}\n`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
