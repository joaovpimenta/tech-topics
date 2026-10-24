const { createServer } = require("node:http");
const { readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "../dist");
const percentile = (values, p) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
};

async function main() {
  let chromium;
  try { ({ chromium } = require(process.env.TECH_TOPICS_PLAYWRIGHT || "playwright")); }
  catch (error) { throw new Error(`Playwright unavailable: ${error.message}`); }
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const prefix = "/tech-topics/";
      if (!pathname.startsWith(prefix)) throw Error("unexpected base path");
      const relative = pathname.slice(prefix.length);
      if (!relative || relative.endsWith("/")) throw Error("invalid path");
      if (relative === "__perf_mermaid.mjs") {
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.end("export default {initialize(){},async render(){return {svg:'<svg></svg>'}}};");
        return;
      }
      const file = path.resolve(root, relative);
      const fromRoot = path.relative(root, file);
      if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) throw Error("path escapes dist");
      const contents = await readFile(file);
      if (relative === "mermaid-theme.js") {
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.end(contents.toString("utf8").replace("https://cdn.jsdelivr.net/npm/mermaid@12.0.0/dist/mermaid.esm.min.mjs", "/tech-topics/__perf_mermaid.mjs"));
        return;
      }
      res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".json") ? "application/json" : file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.end(contents);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.TECH_TOPICS_CHROMIUM || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const base = `http://127.0.0.1:${server.address().port}/tech-topics`;
    const rows = [];
    async function scenario(kind, cold, context) {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 4_000_000 / 8, uploadThroughput: 512_000 / 8, connectionType: "cellular3g" });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: cold });
      await page.addInitScript(() => {
        window.__perf = { speechStart: null, cls: 0, longTasks: [] };
        window.__lcp = null;
        new PerformanceObserver(list => { const e = list.getEntries(); if (e.length) window.__lcp = e.at(-1).startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
        new PerformanceObserver(list => window.__perf.longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ type: "longtask", buffered: true });
        Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [{ lang: "pt-BR", name: "Mock" }], speak(u) { window.__perf.speechStart = performance.now(); u.onstart?.(); }, cancel() {}, pause() {}, resume() {} } });
        window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
        HTMLMediaElement.prototype.play = function () { this.dispatchEvent(new Event("playing")); return new Promise(() => {}); };
        HTMLMediaElement.prototype.pause = function () {};
        const nativeFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const url = typeof input === "string" ? input : input.url;
          if (url.startsWith("https://api.github.com/repos/joaovpimenta/tech-topics/releases/tags/tts-")) return new Promise(resolve => setTimeout(() => resolve(new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } })), 600));
          return nativeFetch(input, init);
        };
      });
      const start = performance.now();
      await page.goto(`${base}/${kind === "home" ? "index.html" : "article.html?slug=cqrs-projecoes-e-consistencia"}`, { waitUntil: "domcontentloaded" });
      if (kind === "article") await page.waitForFunction(() => { const body = document.querySelector("#article-body"); return body?.textContent?.trim() && !body.textContent.includes("Carregando o conteúdo"); }, null, { timeout: 15000 });
      else await page.waitForSelector(".recent-item", { timeout: 15000 });
      const contentMs = performance.now() - start;
      if (kind === "article") await page.locator("#listen-recording").waitFor({ state: "visible", timeout: 15000 });
      const pageSample = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0];
        const resources = performance.getEntriesByType("resource");
        const marks = Object.fromEntries(performance.getEntriesByType("mark").filter(e => e.name.startsWith("tt:")).map(e => [e.name.slice(3), e.startTime]));
        return { bytes: resources.reduce((n, e) => n + (e.transferSize || 0), 0), requests: resources.length, lcp: window.__lcp, cls: window.__perf.cls, dom: nav?.domContentLoadedEventEnd ?? null, marks, longTasks: window.__perf.longTasks, resources: resources.map(e => ({ name: e.name, start: e.startTime, duration: e.duration, bytes: e.transferSize || 0 })) };
      });
      let interaction = null;
      if (kind === "article") {
        const clickAt = await page.evaluate(() => performance.now());
        await page.locator("#listen-recording").click();
        await page.waitForFunction(() => window.__perf.speechStart !== null, null, { timeout: 3000 }).catch(() => {});
        interaction = await page.evaluate(click => ({ clickToSpeechStartMs: window.__perf.speechStart == null ? null : window.__perf.speechStart - click, acousticLatency: null }), clickAt);
        await page.waitForFunction(() => performance.getEntriesByName("tt:audio-discovery-complete").length > 0, null, { timeout: 3000 }).catch(() => {});
      }
      rows.push({ scenario: kind, cache: cold ? "cold-http" : "warm-http", contentMs, interaction, sw: { mode: "blocked" }, ...pageSample });
      await page.close();
    }
    for (const kind of ["home", "article"]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: "block" });
      for (let i = 0; i < 10; i++) await scenario(kind, true, context);
      for (let i = 0; i < 10; i++) await scenario(kind, false, context);
      await context.close();
    }
    const summary = {};
    for (const kind of ["home", "article"]) for (const cache of ["cold-http", "warm-http"]) {
      const group = rows.filter(row => row.scenario === kind && row.cache === cache);
      summary[`${kind}-${cache}`] = {
        samples: group.length,
        contentP75ms: percentile(group.map(x => x.contentMs), .75),
        navigationToTextP75ms: kind === "article" ? percentile(group.map(x => x.marks["article-body-ready"]), .75) : null,
        bodyToControlsP75ms: kind === "article" ? percentile(group.map(x => x.marks["article-controls-ready"] - x.marks["article-body-ready"]), .75) : null,
        lcpP75ms: percentile(group.map(x => x.lcp), .75),
        clsP75: percentile(group.map(x => x.cls), .75),
        bytesP75: percentile(group.map(x => x.bytes), .75),
        requestsP75: percentile(group.map(x => x.requests), .75),
        longTaskCount: group.reduce((n, x) => n + x.longTasks.length, 0),
        clickToSpeechStartP75ms: kind === "article" ? percentile(group.map(x => x.interaction?.clickToSpeechStartMs), .75) : null,
        discoveryToCanplayP75ms: kind === "article" ? percentile(group.map(x => x.marks["audio-canplay"] - x.marks["audio-discovery-complete"]), .75) : null,
        samplesWithoutLcp: group.filter(x => x.lcp == null).length
      };
    }
    const dirtyFiles = execFileSync("git", ["status", "--short", "--untracked-files=no"], { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
    const report = {
      revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      dirtyFiles,
      instrumentationDirty: dirtyFiles.some(line => /(?:article|audio|speech)\.js|perf-baseline|test-loader-regressions/.test(line)),
      runtime: { node: process.version, browser: browser.version() },
      profile: { viewport: "390x844", cpu: "4x", network: "4Mbps / RTT150ms", httpCold: "CDP cache disabled", httpWarm: "same profile, cache enabled, Cache-Control max-age=3600", serviceWorker: "blocked for this HTTP-cache comparison", serverPath: "/tech-topics/ (Pages prefix)", mock: "Release API returns delayed 404; Web Speech callback is synchronous; acoustic latency N/A", nextSentencePromotion: "N/A; feature does not exist in measured revision", fieldInp: "not measured" },
      summary, samples: rows
    };
    if (process.argv[2]) { await writeFile(path.resolve(process.argv[2]), `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify({ output: path.resolve(process.argv[2]), summary }, null, 2)); }
    else console.log(JSON.stringify(report, null, 2));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
