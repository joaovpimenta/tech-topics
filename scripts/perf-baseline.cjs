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
        window.__lcpCandidate = null;
        new PerformanceObserver(list => { const e = list.getEntries(); if (e.length) { const last = e.at(-1); window.__lcp = last.startTime; window.__lcpCandidate = { url: last.url || null, size: last.size, tag: last.element?.tagName || null, id: last.element?.id || null, className: typeof last.element?.className === "string" ? last.element.className : null }; } }).observe({ type: "largest-contentful-paint", buffered: true });
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
      const visualSettle = await page.evaluate(async kindName => {
        const timeout = ms => new Promise(resolve => setTimeout(() => resolve("timeout"), ms));
        const images = kindName === "article" ? [...document.querySelectorAll("#article-image")] : [...document.querySelectorAll("#recent-list img")].slice(0, 2);
        const imageResultsPromise = Promise.all(images.map(async image => {
          if (!image.complete) await Promise.race([new Promise(resolve => { image.addEventListener("load", resolve, { once: true }); image.addEventListener("error", resolve, { once: true }); }), timeout(4000)]);
          return { src: image.currentSrc || image.src, complete: image.complete, naturalWidth: image.naturalWidth };
        }));
        const fontsPromise = Promise.race([document.fonts?.ready?.then(() => "ready") || Promise.resolve("unsupported"), timeout(4000)]);
        const [imageResults, fonts] = await Promise.all([imageResultsPromise, fontsPromise]);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { images: imageResults, fonts, timeoutPerResourceMs: 4000, animationFrames: 2 };
      }, kind);
      const pageSample = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0];
        const resources = performance.getEntriesByType("resource");
        const marks = Object.fromEntries(performance.getEntriesByType("mark").filter(e => e.name.startsWith("tt:")).map(e => [e.name.slice(3), e.startTime]));
        const unknownExternal = resources.filter(e => new URL(e.name).origin !== location.origin && e.transferSize === 0).map(e => e.name);
        return { bytes: resources.reduce((n, e) => n + (e.transferSize || 0), nav?.transferSize || 0), documentBytes: nav?.transferSize ?? null, externalBytesUnknownDueToTimingOrCache: unknownExternal, requests: resources.length + 1, lcp: window.__lcp, lcpCandidate: window.__lcpCandidate, cls: window.__perf.cls, dom: nav?.domContentLoadedEventEnd ?? null, marks, longTasks: window.__perf.longTasks, resources: resources.map(e => ({ name: e.name, start: e.startTime, duration: e.duration, bytes: e.transferSize || 0 })) };
      });
      let interaction = null;
      let audioReadiness = null;
      if (kind === "article") {
        const clickAt = await page.evaluate(() => performance.now());
        await page.locator("#listen-recording").click();
        await page.waitForFunction(() => window.__perf.speechStart !== null, null, { timeout: 3000 }).catch(() => {});
        interaction = await page.evaluate(click => ({ clickToSpeechStartMs: window.__perf.speechStart == null ? null : window.__perf.speechStart - click, acousticLatency: null }), clickAt);
        await page.waitForFunction(() => performance.getEntriesByName("tt:audio-discovery-complete").length > 0, null, { timeout: 3000 }).catch(() => {});
        audioReadiness = await page.evaluate(() => {
          const time = name => performance.getEntriesByName(`tt:${name}`)[0]?.startTime ?? null;
          const discovery = time("audio-discovery-complete");
          const ready = time("audio-canplay");
          return { discoveryMs: discovery, metadataMs: time("audio-metadata"), canplayMs: ready, playingMs: time("audio-playing"), discoveryToCanplayMs: discovery != null && ready != null ? ready - discovery : null, reasonWhenNull: ready == null ? "Release lookup returned no MP3; media readiness is not applicable in this page-opening lane" : null };
        });
      }
      rows.push({ scenario: kind, cache: cold ? "cold-http" : "warm-http", contentMs, visualSettle, interaction, audioReadiness, sw: { mode: "blocked" }, ...pageSample });
      await page.close();
    }
    if (!process.argv.includes("--sw-only")) for (const kind of ["home", "article"]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: "block" });
      for (let i = 0; i < 10; i++) await scenario(kind, true, context);
      for (let i = 0; i < 10; i++) await scenario(kind, false, context);
      await context.close();
    }
    const swSmoke = await (async () => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: "allow" });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 4_000_000 / 8, uploadThroughput: 512_000 / 8, connectionType: "cellular3g" });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await page.addInitScript(() => {
        window.__speechStart = null;
        Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [{ lang: "pt-BR", name: "Mock" }], speak(u) { window.__speechStart = performance.now(); u.onstart?.(); }, cancel() {}, pause() {}, resume() {} } });
        window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
        const nativeFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const url = typeof input === "string" ? input : input.url;
          if (url.startsWith("https://api.github.com/repos/joaovpimenta/tech-topics/releases/tags/tts-")) return new Promise(resolve => setTimeout(() => resolve(new Response("{}", { status: 404 })), 300));
          return nativeFetch(input, init);
        };
      });
      let result;
      try {
        await page.goto(`${base}/index.html`, { waitUntil: "domcontentloaded" });
        const registration = await page.evaluate(async () => {
          if (!("serviceWorker" in navigator)) return { supported: false, controller: false };
          const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(Error("service worker install timeout")), 15000))]);
          return { supported: true, active: Boolean(reg.active), scope: reg.scope };
        });
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector(".recent-item", { timeout: 10000 });
        const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
        await page.goto(`${base}/article.html?slug=cqrs-projecoes-e-consistencia`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => { const body = document.querySelector("#article-body"); return body?.textContent?.trim() && !body.textContent.includes("Carregando o conteúdo"); }, null, { timeout: 15000 });
        await page.waitForTimeout(300);
        const online = await page.evaluate(() => ({ controller: Boolean(navigator.serviceWorker.controller), workerStartedResources: performance.getEntriesByType("resource").filter(e => e.workerStart > 0).length, requestCount: performance.getEntriesByType("resource").length + 1, documentBytes: performance.getEntriesByType("navigation")[0]?.transferSize ?? null, articleText: document.querySelector("#article-body")?.textContent.trim().length || 0 }));
        await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: "none" });
        await page.goto(`${base}/article.html?slug=cqrs-projecoes-e-consistencia`, { waitUntil: "domcontentloaded", timeout: 10000 });
        await page.waitForFunction(() => document.querySelector("#article-heading")?.textContent.trim() !== "Carregando artigo…", null, { timeout: 10000 }).catch(() => {});
        const offline = await page.evaluate(() => ({ controller: Boolean(navigator.serviceWorker.controller), articleText: document.querySelector("#article-body")?.textContent.trim().length || 0, heading: document.querySelector("#article-heading")?.textContent.trim() || "" }));
        result = { registration, controlled, online, offline, offlineArticleServed: offline.articleText > 100 && offline.heading !== "Artigo indisponível", sampleCount: 1, limitation: "SW smoke, not a 10x statistical comparison; offline has API/media unavailable and depends on previously visited article in this context." };
      } catch (error) { result = { error: error.message, sampleCount: 0 }; }
      await context.close();
      return result;
    })();
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
        discoveryToCanplayP75ms: kind === "article" ? percentile(group.map(x => x.audioReadiness?.discoveryToCanplayMs), .75) : null,
        samplesWithoutLcp: group.filter(x => x.lcp == null).length
      };
    }
    const dirtyFiles = execFileSync("git", ["status", "--short", "--untracked-files=no"], { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
    const report = {
      revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      dirtyFiles,
      instrumentationDirty: dirtyFiles.some(line => /(?:article|audio|speech)\.js|perf-baseline|test-loader-regressions/.test(line)),
      runtime: { node: process.version, browser: browser.version() },
      profile: { viewport: "390x844", cpu: "4x", network: "4Mbps decimal / RTT150ms", httpCold: "CDP cache disabled", httpWarm: "same profile, cache enabled, Cache-Control max-age=3600", serviceWorker: "blocked for HTTP profile; separate real-SW smoke follows", visualSettle: "first 2 home cover images or article hero image plus document.fonts.ready in parallel, each with 4s timeout; then two animation frames; contentMs remains the earlier first-text time", serverPath: "/tech-topics/ (Pages prefix)", bytes: "resource transferSize plus navigation transferSize; cross-origin zero transferSize reported as unknown because cache and Timing-Allow-Origin cannot be distinguished", mock: "Release API returns delayed 404; Web Speech callback is synchronous; acoustic latency N/A", nextSentencePromotion: "N/A; feature does not exist in measured revision", fieldInp: "not measured" },
      summary, samples: rows, serviceWorkerSmoke: swSmoke
    };
    if (process.argv[2]) { await writeFile(path.resolve(process.argv[2]), `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify({ output: path.resolve(process.argv[2]), summary }, null, 2)); }
    else console.log(JSON.stringify(report, null, 2));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
