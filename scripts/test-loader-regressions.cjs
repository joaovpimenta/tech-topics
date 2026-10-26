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
    async function pageWithMocks({ speech = "ready", play = "pending" } = {}) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.addInitScript(({ speech, play }) => {
        window.__speechCalls = 0;
        window.__mediaPlayCalls = 0;
        window.__clickToSpeechMs = null;
        document.addEventListener("click", event => {
          if (event.target.closest?.("#listen-recording")) window.__listenGestureAt = performance.now();
        }, true);
        if (speech !== "absent") {
          const voices = speech === "ready" ? [{ lang: "pt-BR", name: "Mock" }] : [];
          let voiceListener;
          Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => voices, addEventListener(type, listener) { if (type === "voiceschanged") voiceListener = listener; }, speak(u) { window.__speechCalls++; u.onstart?.(); window.__clickToSpeechMs = performance.now() - window.__listenGestureAt; }, cancel() {}, pause() {}, resume() {}, dispatchEvent(event) { if (event.type === "voiceschanged") voiceListener?.(event); } } });
          window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
          window.__testVoices = voices;
          window.__emitVoicesChanged = () => window.speechSynthesis.dispatchEvent(new Event("voiceschanged"));
        } else {
          Object.defineProperty(window, "speechSynthesis", { configurable: true, value: undefined });
          Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: undefined });
        }
        HTMLMediaElement.prototype.play = function () {
          window.__mediaPlayCalls++;
          if (play === "reject") return Promise.reject(new DOMException("Autoplay denied", "NotAllowedError"));
          return new Promise(() => {});
        };
        HTMLMediaElement.prototype.pause = function () {};
      }, { speech, play });
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
      if (dependency === "mermaid") {
        assert(await page.locator(".mermaid-source").count() > 0, "diagram source remains readable while its module is pending");
        assert(await page.locator(".mermaid-figure figcaption").first().isVisible(), "diagram legend remains visible while its module is pending");
      }
      await page.locator("#listen-recording").click();
      await page.waitForFunction(() => window.__speechCalls > 0, null, { timeout: 1500 });
      const afterGesture = await page.evaluate(() => ({ speechCalls: window.__speechCalls, actions: !document.querySelector("#article-actions").hidden, clickToMockSpeechCallbackMs: window.__clickToSpeechMs }));
      assert.equal(afterGesture.actions, true);
      assert.equal(afterGesture.speechCalls, 1, "one user gesture starts device speech without waiting for Mermaid or JSON");
      if (dependency === "mermaid") release();
      observations.push({ case: dependency === "mermaid" ? "pending-mermaid" : "legacy-lexicon-request-not-used", beforeGesture, afterGesture, dependencyEntered });
      await page.close();
    }

    {
      const page = await pageWithMocks();
      await page.route("https://cdn.jsdelivr.net/npm/mermaid@12.0.0/dist/mermaid.esm.min.mjs", route => route.fulfill({ status: 200, contentType: "text/javascript", body: "export default {initialize(){},async render(){await new Promise(resolve=>setTimeout(resolve,900));return {svg:'<svg></svg>'}}};" }));
      await page.goto(`${base}/article.html?slug=consenso-raft`, { waitUntil: "domcontentloaded" });
      await page.locator("#article-actions").waitFor({ state: "visible" });
      const pendingFallback = await page.evaluate(() => ({
        sources: document.querySelectorAll(".mermaid-source").length,
        captions: [...document.querySelectorAll(".mermaid-figure figcaption")].filter(node => node.textContent.trim()).length,
        rendered: document.querySelectorAll(".mermaid-diagram svg").length,
        actionVisible: !document.querySelector("#article-actions").hidden
      }));
      assert(pendingFallback.sources > 0 && pendingFallback.sources === pendingFallback.captions, "heavy Mermaid render keeps readable source and captions until it finishes");
      assert(await page.locator(".mermaid-source").first().isVisible(), "diagram source remains visibly readable during slow render");
      assert(await page.locator(".mermaid-figure figcaption").first().isVisible(), "diagram caption remains visible during slow render");
      assert.equal(pendingFallback.rendered, 0);
      assert.equal(pendingFallback.actionVisible, true);
      await page.locator("#listen-recording").click();
      await page.waitForFunction(() => window.__speechCalls === 1);
      assert.equal(await page.locator("#recording-play").getAttribute("data-playing"), "true");
      await page.waitForFunction(() => {
        const diagrams = [...document.querySelectorAll(".mermaid-diagram[data-mermaid='true']")];
        return diagrams.length > 0 && diagrams.every(diagram => diagram.querySelector("svg"));
      }, null, { timeout: 8000 });
      assert.equal(await page.evaluate(() => window.__speechCalls), 1, "late diagram rendering does not duplicate speech");
      observations.push({ case: "mermaid-heavy-render-progressive", pendingFallback, clickToMockSpeechCallbackMs: await page.evaluate(() => window.__clickToSpeechMs), rendered: await page.locator(".mermaid-diagram svg").count() });
      await page.close();
    }

    {
      const page = await pageWithMocks();
      await page.route("https://cdn.jsdelivr.net/npm/mermaid@12.0.0/dist/mermaid.esm.min.mjs", route => route.abort("failed"));
      await page.goto(`${base}/article.html?slug=consenso-raft`, { waitUntil: "domcontentloaded" });
      await page.locator("#article-actions").waitFor({ state: "visible" });
      await page.waitForFunction(() => document.querySelectorAll(".mermaid-error-message").length > 0);
      const diagramFallback = await page.evaluate(() => ({
        failures: document.querySelectorAll(".mermaid-error-message").length,
        diagrams: document.querySelectorAll(".mermaid-diagram[data-mermaid='true']").length,
        sources: [...document.querySelectorAll(".mermaid-source")].filter(node => node.textContent.trim().length > 0).length,
        captions: [...document.querySelectorAll(".mermaid-figure figcaption")].filter(node => node.textContent.trim().length > 0).length,
        controls: !document.querySelector("#article-actions").hidden,
        bodyLength: document.querySelector("#article-body").textContent.trim().length
      }));
      assert(diagramFallback.failures > 0 && diagramFallback.failures === diagramFallback.diagrams, "every diagram reports an import/render failure");
      assert.equal(diagramFallback.sources, diagramFallback.diagrams, "all failed diagrams preserve the original readable source");
      assert.equal(diagramFallback.captions, diagramFallback.diagrams, "all failed diagrams keep their accessible captions");
      assert(await page.locator(".mermaid-source").first().isVisible(), "failed diagram source remains visible");
      assert(await page.locator(".mermaid-error-message").first().isVisible(), "failed diagram status is visible");
      assert.equal(diagramFallback.controls, true);
      assert(diagramFallback.bodyLength > 1000);
      assert.equal(await page.locator("#recording-player").count(), 1, "the one shared audio dock is mounted");
      assert.equal(await page.locator("#speech-player").count(), 0, "no duplicate speech player is mounted");
      await page.locator("#listen-recording").click();
      await page.waitForFunction(() => window.__speechCalls === 1);
      assert.equal(await page.locator("#recording-play").getAttribute("data-playing"), "true");
      observations.push({ case: "mermaid-import-failed-preserves-fallback-and-legend", diagramFallback, speechCallsAfterGesture: await page.evaluate(() => window.__speechCalls) });
      await page.close();
    }

    async function audioCase(mode) {
      const apiPending = mode === "pending";
      const mp3Discovered = mode === "mp3";
      const page = await pageWithMocks({ speech: mode.startsWith("no-speech") ? "absent" : mode === "empty-voices" || mode === "late-voices" ? "empty" : "ready", play: mode === "autoplay" ? "reject" : "pending" });
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
      } else if (["403", "429"].includes(mode)) {
        await page.route("https://api.github.com/repos/joaovpimenta/tech-topics/releases/tags/tts-*", route => route.fulfill({ status: Number(mode), contentType: "application/json", body: JSON.stringify({ message: mode === "403" ? "API rate limit exceeded" : "Too many requests" }) }));
      } else if (mode === "offline") {
        await page.route("https://api.github.com/repos/joaovpimenta/tech-topics/releases/tags/tts-*", route => route.abort("internetdisconnected"));
      } else if (["autoplay", "empty-voices", "late-voices", "no-speech-mp3-unready"].includes(mode)) {
        await page.route("https://api.github.com/repos/joaovpimenta/tech-topics/releases/tags/tts-*", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ body: "", assets: [{ name: "consenso-raft.mp3", state: "uploaded" }] }) }));
        await page.route("https://github.com/joaovpimenta/tech-topics/releases/download/**", route => route.abort());
      } else {
        await page.route("https://api.github.com/repos/joaovpimenta/tech-topics/releases/tags/tts-*", route => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
      }
      await page.goto(`${base}/article.html?slug=consenso-raft`, { waitUntil: "domcontentloaded" });
      await page.locator("#article-actions").waitFor({ state: "visible" });
      if (apiPending) await requestStarted;
      else await page.waitForFunction(() => performance.getEntriesByType("resource").some(entry => entry.name.includes("api.github.com/repos/joaovpimenta/tech-topics/releases/tags/tts-")));
      if (mp3Discovered || ["autoplay", "empty-voices", "late-voices", "no-speech-mp3-unready"].includes(mode)) await page.waitForFunction(() => document.querySelector("#article-recording")?.src.includes(".mp3"));
      const voiceStatusBeforeGesture = ["empty-voices", "late-voices"].includes(mode) ? await page.locator("#listen-status").innerText() : null;
      if (mode === "late-voices") {
        await page.waitForFunction(() => document.querySelector("#listen-status")?.textContent.includes("Nenhuma voz"));
        await page.evaluate(() => {
          window.__testVoices.push({ lang: "pt-BR", name: "Late mock" });
          window.__emitVoicesChanged();
        });
        await sleep(50);
        assert.equal(await page.evaluate(() => window.__speechCalls), 0, "late voice availability never speaks without a user gesture");
        assert.equal(await page.locator("#listen-status").innerText(), "", "late PT-BR voice clears the initial unavailable status");
      }
      if (mode === "autoplay") await page.evaluate(() => {
        const audio = document.querySelector("#article-recording");
        Object.defineProperty(audio, "readyState", { configurable: true, value: 4 });
        Object.defineProperty(audio, "duration", { configurable: true, value: 90 });
        const range = { length: 1, start: () => 0, end: () => 90 };
        Object.defineProperty(audio, "seekable", { configurable: true, value: range });
        Object.defineProperty(audio, "buffered", { configurable: true, value: range });
      });
      if (mode === "no-speech-mp3-unready") await page.evaluate(() => {
        Object.defineProperty(document.querySelector("#article-recording"), "readyState", { configurable: true, value: 0 });
      });
      await page.locator("#listen-recording").click();
      await sleep(100);
      const statusBeforeFallbackTimeout = mode === "no-speech-mp3-unready" ? await page.locator("#recording-status").innerText() : null;
      if (mode === "no-speech-mp3-unready") await page.waitForFunction(() => document.querySelector("#recording-status")?.textContent.includes("MP3 ainda não iniciou"), null, { timeout: 3000 });
      const result = { ...(await page.evaluate(() => ({ speechCalls: window.__speechCalls, mediaPlayCalls: window.__mediaPlayCalls, mediaReadyState: document.querySelector("#article-recording")?.readyState, subtitle: document.querySelector("#recording-subtitle")?.textContent, playing: document.querySelector("#recording-play")?.dataset.playing, clickToMockSpeechCallbackMs: window.__clickToSpeechMs }))), lookupPendingAtGesture: apiPending && lookupPending };
      if (mode.startsWith("no-speech")) {
        assert.equal(result.speechCalls, 0);
        assert.match(await page.locator("#recording-status").innerText(), mode === "no-speech-mp3-unready" ? /MP3 ainda não iniciou/i : /não oferece leitura por voz/i);
        if (mode === "no-speech-mp3-unready") assert.match(statusBeforeFallbackTimeout, /Carregando áudio gravado/i, "before the bounded play wait, the UI reports a pending load rather than claiming playback started");
        assert.equal(await page.locator("#article-actions").isVisible(), true, "missing Web Speech leaves article actions available");
      } else {
        assert(result.speechCalls > 0, `an unready/unknown MP3 must use available device speech: ${JSON.stringify(result)}`);
        assert.match(result.subtitle, /^Tech Topics · Voz do dispositivo · trecho 1 de \d+$/, "device speech keeps its source label and reports the current phrase position");
      }
      if (["403", "429", "offline"].includes(mode)) {
        assert.equal(result.mediaPlayCalls, 0, `${mode} must not attempt unknown media`);
        assert(result.speechCalls > 0, `${mode} should leave the local voice available`);
      }
      if (mode === "empty-voices" || mode === "late-voices") {
        assert.match(voiceStatusBeforeGesture, /voz|português/i, "empty voice list is described before a user gesture without blocking article text");
        assert.equal(await page.locator("#recording-play").getAttribute("data-playing"), "true", "voice availability changes do not auto-start speech");
      }
      if (mode === "autoplay") {
        assert.equal(result.mediaPlayCalls, 1, "the gesture attempts the ready MP3 once");
        assert(result.speechCalls > 0, "autoplay rejection falls back to device speech");
        assert.match(await page.locator("#recording-status").innerText(), /usando voz do dispositivo/i);
      }
      if (mp3Discovered) {
        assert.equal(result.mediaReadyState, 0, "discovered MP3 has not produced media metadata");
        assert.equal(result.mediaPlayCalls, 0, "readyState=0 falls back before calling play()");
      } else if (mode === "no-speech-mp3-unready") assert.equal(result.mediaPlayCalls, 1, "the player tries the discovered MP3 while waiting for a real start");
      else if (mode !== "autoplay") assert.equal(result.mediaPlayCalls, 0, "unknown or missing MP3 does not invoke media playback");
      if (apiPending) {
        assert.equal(result.lookupPendingAtGesture, true, "Release request must still be unresolved at the user gesture");
        releaseLookup();
        await sleep(100);
        const afterDiscovery = await page.evaluate(() => ({ speechCalls: window.__speechCalls, mediaPlayCalls: window.__mediaPlayCalls, subtitle: document.querySelector("#recording-subtitle")?.textContent }));
        assert.deepEqual(afterDiscovery, { speechCalls: result.speechCalls, mediaPlayCalls: 0, subtitle: result.subtitle }, "late Release discovery cannot promote, restart, or change phrase metadata in an explicit local session");
      }
      await page.close();
      return result;
    }
    observations.push({ case: "release-api-pending", current: await audioCase("pending"), desiredContract: "Local speech starts on the first user gesture while lookup continues" });
    observations.push({ case: "release-api-404-complete", current: await audioCase("404"), desiredContract: "Local speech starts after completed 404 lookup" });
    observations.push({ case: "mp3-discovered-media-not-ready-play-pending", current: await audioCase("mp3"), desiredContract: "Discovery does not imply readiness; start local speech if MP3 cannot begin" });
    for (const mode of ["403", "429", "offline", "autoplay", "no-speech", "no-speech-mp3-unready", "empty-voices", "late-voices"]) observations.push({ case: `release-${mode}`, current: await audioCase(mode) });
    console.log(JSON.stringify({ source: "real dist/article.html, article.js, speech.js and audio.js; DOM/services and network responses mocked", observations }, null, 2));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
