const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const root = path.resolve(__dirname, "../dist");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  let chromium;
  try { ({ chromium } = require(process.env.TECH_TOPICS_PLAYWRIGHT || "playwright")); }
  catch (error) { if (error.code === "MODULE_NOT_FOUND") throw Error("Set TECH_TOPICS_PLAYWRIGHT to an existing Playwright module."); throw error; }
  const server = createServer(async (req, res) => {
    try {
      const p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const file = path.resolve(root, `.${p}`);
      if (!file.startsWith(root)) throw Error("bad path");
      res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".json") ? "application/json" : file.endsWith(".css") ? "text/css" : "text/html; charset=utf-8");
      res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.TECH_TOPICS_CHROMIUM || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function pageWithMocks() {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.addInitScript(() => {
        window.__speechCalls = 0;
        window.__mediaPlayCalls = 0;
        Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [{ lang: "pt-BR", name: "Mock" }], speak(u) { window.__speechCalls++; u.onstart?.(); }, cancel() {}, pause() {}, resume() {} } });
        window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
        HTMLMediaElement.prototype.play = function () { window.__mediaPlayCalls++; return new Promise(() => {}); };
        HTMLMediaElement.prototype.pause = function () {};
      });
      await page.route("https://cdn.jsdelivr.net/npm/mermaid@12.0.0/dist/mermaid.esm.min.mjs", route => route.fulfill({ status: 200, contentType: "text/javascript", body: "export default {initialize(){},async render(){return {svg:'<svg></svg>'}}};" }));
      return page;
    }
    const observations = [];
    for (const dependency of ["mermaid", "lexicon"]) {
      const page = await pageWithMocks();
      let release;
      const held = new Promise(resolve => { release = resolve; });
      if (dependency === "mermaid") {
        await page.route("https://cdn.jsdelivr.net/npm/mermaid@12.0.0/dist/mermaid.esm.min.mjs", async route => { await held; await route.fulfill({ status: 200, contentType: "text/javascript", body: "export default {initialize(){},async render(){return {svg:'<svg></svg>'}}};" }); });
      } else {
        await page.route("**/content/tts-lexicon.json", async route => { await held; await route.fulfill({ status: 200, contentType: "application/json", body: "{}" }); });
      }
      await page.goto(`${base}/article.html?slug=consenso-raft`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#article-body:not(:empty)");
      await sleep(120);
      await page.evaluate(() => document.querySelector("#listen-article").click());
      const blocked = await page.evaluate(() => ({ body: Boolean(document.querySelector("#article-body")?.textContent.trim()), actions: Boolean(document.querySelector("#article-actions") && !document.querySelector("#article-actions").hidden), speechCalls: window.__speechCalls, dock: !document.querySelector("#recording-player")?.hidden }));
      assert.equal(blocked.body, true);
      assert.equal(blocked.actions, false);
      assert.equal(blocked.speechCalls, 0, "visible inline affordance is inert until mount finishes");
      release();
      await page.locator("#article-actions").waitFor({ state: "visible" });
      observations.push({ case: `pending-${dependency}`, current: blocked, desiredContract: { player: true, actions: true }, status: "KNOWN_REGRESSION: user-visible controls wait on unrelated dependency" });
      await page.close();
    }

    async function audioCase(apiPending) {
      const page = await pageWithMocks();
      if (apiPending) {
        await page.route("https://api.github.com/repos/joaovpimenta/tech-topics/releases/tags/tts-*", async route => { await sleep(1200); await route.fulfill({ status: 404, body: "{}" }); });
      } else {
        await page.route("https://api.github.com/repos/joaovpimenta/tech-topics/releases/tags/tts-*", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ body: "", assets: [{ name: "consenso-raft.mp3", state: "uploaded" }] }) }));
        await page.route("https://github.com/joaovpimenta/tech-topics/releases/download/**", route => route.abort());
      }
      await page.goto(`${base}/article.html?slug=consenso-raft`, { waitUntil: "domcontentloaded" });
      await page.locator("#article-actions").waitFor({ state: "visible" });
      if (!apiPending) await page.waitForFunction(() => document.querySelector("#article-recording")?.src.includes(".mp3"));
      await page.locator("#listen-recording").click();
      await sleep(100);
      const result = await page.evaluate(() => ({ speechCalls: window.__speechCalls, mediaPlayCalls: window.__mediaPlayCalls, mediaReadyState: document.querySelector("#article-recording")?.readyState, subtitle: document.querySelector("#recording-subtitle")?.textContent, playing: document.querySelector("#recording-play")?.dataset.playing }));
      if (apiPending) assert(result.speechCalls > 0, `API failure should use available device speech: ${JSON.stringify(result)}`);
      else { assert.equal(result.speechCalls, 0, "discovered MP3 suppresses device voice even while playback promise remains pending"); assert.equal(result.mediaReadyState, 0, "discovered MP3 has not produced media metadata"); assert.equal(result.mediaPlayCalls, 1, "click awaited a pending media play promise"); }
      await page.close();
      return result;
    }
    observations.push({ case: "release-api-pending-or-failed", current: await audioCase(true), desiredContract: "Local speech starts on the first user gesture while lookup continues" });
    observations.push({ case: "mp3-discovered-media-not-ready-play-pending", current: await audioCase(false), desiredContract: "Discovery does not imply readiness; start local speech if MP3 cannot begin" });
    console.log(JSON.stringify({ source: "real dist/article.html, article.js, speech.js and audio.js; DOM/services and network responses mocked", observations }, null, 2));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
