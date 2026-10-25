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
      let dependencyEntered = false;
      let notifyDependencyEntered;
      const dependencyStarted = new Promise(resolve => { notifyDependencyEntered = resolve; });
      const held = new Promise(resolve => { release = resolve; });
      if (dependency === "mermaid") {
        await page.route("https://cdn.jsdelivr.net/npm/mermaid@12.0.0/dist/mermaid.esm.min.mjs", async route => { dependencyEntered = true; notifyDependencyEntered(); await held; await route.fulfill({ status: 200, contentType: "text/javascript", body: "export default {initialize(){},async render(){return {svg:'<svg></svg>'}}};" }); });
      } else {
        await page.route("**/content/tts-lexicon.json", async route => { dependencyEntered = true; notifyDependencyEntered(); await held; await route.fulfill({ status: 200, contentType: "application/json", body: "{}" }); });
      }
      await page.goto(`${base}/article.html?slug=consenso-raft`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => { const body = document.querySelector("#article-body")?.textContent.trim(); return body && !body.includes("Carregando o conteúdo") && body.length > 1000; });
      if (dependency === "mermaid") {
        await dependencyStarted;
        assert.equal(dependencyEntered, true, "Mermaid must still be allowed to load progressively");
      }
      await page.locator("#article-actions").waitFor({ state: "visible", timeout: 1500 });
      const beforeGesture = await page.evaluate(() => ({
        body: Boolean(document.querySelector("#article-body")?.textContent.trim()),
        actions: Boolean(document.querySelector("#article-actions") && !document.querySelector("#article-actions").hidden),
        speechCalls: window.__speechCalls,
        lexicon: window.TechTopicsSpeechLexicon?.HTTP?.speak || null
      }));
      assert.equal(beforeGesture.body, true);
      assert.equal(beforeGesture.actions, true, `${dependency} must not block article actions`);
      assert.equal(beforeGesture.speechCalls, 0, "opening the article must not emit an utterance");
      assert.equal(beforeGesture.lexicon, "agá tê tê pê", "generated shell lexicon is available synchronously");
      if (dependency === "lexicon") assert.equal(dependencyEntered, false, "article startup must not request the legacy JSON before controls mount");
      await page.locator("#listen-recording").click();
      await page.waitForFunction(() => window.__speechCalls > 0, null, { timeout: 1500 });
      const afterGesture = await page.evaluate(() => ({ speechCalls: window.__speechCalls, actions: !document.querySelector("#article-actions").hidden }));
      assert.equal(afterGesture.actions, true);
      assert.equal(afterGesture.speechCalls, 1, "one user gesture starts device speech without waiting for Mermaid or JSON");
      if (dependency === "mermaid") release();
      observations.push({ case: dependency === "mermaid" ? "pending-mermaid" : "legacy-lexicon-request-not-used", beforeGesture, afterGesture, dependencyEntered });
      await page.close();
    }

    async function audioCase(mode) {
      const apiPending = mode === "pending";
      const mp3Discovered = mode === "mp3";
      const page = await pageWithMocks();
      let lookupPending = false;
      let releaseLookup;
      let notifyStarted;
      const heldLookup = new Promise(resolve => { releaseLookup = resolve; });
      const requestStarted = new Promise(resolve => { notifyStarted = resolve; });
      if (apiPending) {
        await page.route("https://api.github.com/repos/joaovpimenta/tech-topics/releases/tags/tts-*", async route => { lookupPending = true; notifyStarted(); await heldLookup; lookupPending = false; await route.fulfill({ status: 404, body: "{}" }); });
      } else if (mp3Discovered) {
        await page.route("https://api.github.com/repos/joaovpimenta/tech-topics/releases/tags/tts-*", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ body: "", assets: [{ name: "consenso-raft.mp3", state: "uploaded" }] }) }));
        await page.route("https://github.com/joaovpimenta/tech-topics/releases/download/**", route => route.abort());
      } else {
        await page.route("https://api.github.com/repos/joaovpimenta/tech-topics/releases/tags/tts-*", route => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
      }
      await page.goto(`${base}/article.html?slug=consenso-raft`, { waitUntil: "domcontentloaded" });
      await page.locator("#article-actions").waitFor({ state: "visible" });
      if (apiPending) await requestStarted;
      else await page.waitForFunction(() => performance.getEntriesByType("resource").some(entry => entry.name.includes("api.github.com/repos/joaovpimenta/tech-topics/releases/tags/tts-")));
      if (mp3Discovered) await page.waitForFunction(() => document.querySelector("#article-recording")?.src.includes(".mp3"));
      await page.locator("#listen-recording").click();
      await sleep(100);
      const result = { ...(await page.evaluate(() => ({ speechCalls: window.__speechCalls, mediaPlayCalls: window.__mediaPlayCalls, mediaReadyState: document.querySelector("#article-recording")?.readyState, subtitle: document.querySelector("#recording-subtitle")?.textContent, playing: document.querySelector("#recording-play")?.dataset.playing }))), lookupPendingAtGesture: apiPending && lookupPending };
      if (!mp3Discovered) assert(result.speechCalls > 0, `API failure should use available device speech: ${JSON.stringify(result)}`);
      else if (mp3Discovered) { assert.equal(result.speechCalls, 0, "discovered MP3 suppresses device voice even while playback promise remains pending"); assert.equal(result.mediaReadyState, 0, "discovered MP3 has not produced media metadata"); assert.equal(result.mediaPlayCalls, 1, "click awaited a pending media play promise"); }
      if (apiPending) { assert.equal(result.lookupPendingAtGesture, true, "Release request must still be unresolved at the user gesture"); releaseLookup(); await page.waitForFunction(() => performance.getEntriesByType("resource").some(entry => entry.name.includes("api.github.com/repos/joaovpimenta/tech-topics/releases/tags/tts-"))); }
      await page.close();
      return result;
    }
    observations.push({ case: "release-api-pending", current: await audioCase("pending"), desiredContract: "Local speech starts on the first user gesture while lookup continues" });
    observations.push({ case: "release-api-404-complete", current: await audioCase("404"), desiredContract: "Local speech starts after completed 404 lookup" });
    observations.push({ case: "mp3-discovered-media-not-ready-play-pending", current: await audioCase("mp3"), desiredContract: "Discovery does not imply readiness; start local speech if MP3 cannot begin" });
    console.log(JSON.stringify({ source: "real dist/article.html, article.js, speech.js and audio.js; DOM/services and network responses mocked", observations }, null, 2));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
