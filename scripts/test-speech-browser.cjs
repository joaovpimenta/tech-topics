const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

async function main() {
  let chromium;
  try { ({ chromium } = require(process.env.TECH_TOPICS_PLAYWRIGHT || "playwright")); }
  catch (error) {
    if (process.env.TECH_TOPICS_PLAYWRIGHT || error.code !== "MODULE_NOT_FOUND") throw error;
    console.log("SKIP: browser speech checks require Playwright; set TECH_TOPICS_PLAYWRIGHT to its module path.");
    return;
  }
  const server = createServer(async (request, response) => {
    try {
      const file = decodeURIComponent(new URL(request.url, "http://localhost").pathname).slice(1);
      if (!file || file.includes("..") || path.isAbsolute(file)) throw Error("Invalid path");
      response.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".json") ? "application/json" : file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream");
      response.end(await readFile(path.join(root, file)));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.TECH_TOPICS_CHROMIUM || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/scripts/fixtures/speech-browser.html`);
    const message = await page.locator("#result").innerText();
    assert.match(message, /^PASS:/, message);
    console.log(message);
    await page.addInitScript(() => {
      window.testUtterances = [];
      Object.defineProperty(window, "speechSynthesis", { value: { getVoices: () => [], speak: item => window.testUtterances.push(item), cancel() {}, pause() {}, resume() {} } });
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    });
    await page.route("https://**/*", route => route.abort());
    await page.route("https://api.github.com/repos/joaovpimenta/tech-topics/releases/tags/tts-*", route =>
      route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({
          body: "\n<!-- TECH_TOPICS_CHAPTERS_V1\n" +
            JSON.stringify({ version: 1, chapters: [{start: 0}, {start: 35}, {start: 85}] }) + "\n-->\n",
          assets: [{ name: "cqrs-projecoes-e-consistencia.mp3", state: "uploaded" }]
        }) }));
    await page.addInitScript(() => {
      // Simulate playback rather than requiring audio hardware or downloading an MP3.
      HTMLMediaElement.prototype.play = function () {
        const range = { length: 1, start: () => 0, end: () => this.duration };
        Object.defineProperty(this, "readyState", { configurable: true, value: 4 });
        Object.defineProperty(this, "buffered", { configurable: true, value: range });
        Object.defineProperty(this, "seekable", { configurable: true, value: range });
        Object.defineProperty(this, "paused", { configurable: true, value: false });
        this.dispatchEvent(new Event("play"));
        this.dispatchEvent(new Event("playing"));
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function () {
        Object.defineProperty(this, "paused", { configurable: true, value: true });
        this.dispatchEvent(new Event("pause"));
      };
    });
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${base}/article.html?slug=cqrs-projecoes-e-consistencia`);
      await page.waitForSelector(".recording-readable");
      assert.equal(await page.locator("#speech-player").count(), 0, "only bottom player exists");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no document overflow at ${width}px`);
      await page.locator("#listen-recording").waitFor({ state: "visible" });
      await page.evaluate(() => {
        const recording = document.querySelector("#article-recording");
        Object.defineProperty(recording, "duration", { configurable: true, value: 125 });
        Object.defineProperty(recording, "readyState", { configurable: true, value: 4 });
        const range = { length: 1, start: () => 0, end: () => recording.duration };
        Object.defineProperty(recording, "buffered", { configurable: true, value: range });
        Object.defineProperty(recording, "seekable", { configurable: true, value: range });
        recording.dispatchEvent(new Event("durationchange"));
      });
      await page.locator("#listen-recording").click();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.locator("#recording-player").waitFor({ state: "visible" });
      assert.equal(await page.locator("#recording-play").getAttribute("data-playing"), "true");
      assert(await page.locator("#recording-skip").isVisible(), "chapter skip visible");
      await page.locator("#recording-skip").click();
      assert.equal(await page.locator("#article-recording").evaluate(element => element.currentTime), 35);
      await page.locator("#recording-previous").click();
      assert.equal(await page.locator("#article-recording").evaluate(element => element.currentTime), 0);
      const dock = await page.evaluate(() => ({
        title: document.querySelector("#recording-title").textContent,
        duration: document.querySelector("#recording-duration").textContent,
        bounds: document.querySelector("#recording-player").getBoundingClientRect().toJSON(),
        viewport: { width: innerWidth, height: innerHeight }
      }));
      assert.match(dock.title, /CQRS/i);
      assert.equal(dock.duration, "2:05");
      assert(dock.bounds.bottom <= dock.viewport.height && dock.bounds.left >= 0, "bottom dock visible");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "recording controls don't overflow");

      // Switching engines retains the very same bottom dock and artwork.
      await page.locator(".recording-options summary").click();
      await page.locator("#listen-article").click();
      assert(await page.locator("#recording-player").isVisible(), "native TTS reuses bottom dock");
      assert.match(await page.locator("#recording-subtitle").innerText(), /Voz do dispositivo/);
      assert.equal(await page.locator("#recording-play").getAttribute("data-playing"), "true");
      assert.match(await page.locator("#recording-elapsed").innerText(), /^\d+\/\d+$/, "device speech shows an editorial passage index instead of a fabricated clock");
      assert.equal(await page.locator("#recording-duration").innerText(), "por trecho");
      assert.equal(await page.locator("#speech-player").count(), 0, "device mode reuses the single dock");
      assert(await page.evaluate(() => document.querySelectorAll(".recording-block-active, .recording-sentence-active").length > 0
        || Boolean(window.CSS?.highlights?.has("tech-topics-current-sentence"))), "native paragraph highlighted");
      assert.equal(await page.locator("#article-recording").evaluate(element => element.paused), true, "explicitly choosing device speech pauses the recorded source");
      const speedBefore = await page.locator("#recording-rate").getAttribute("aria-label");
      const utterancesBeforeSpeed = await page.evaluate(() => window.testUtterances.length);
      await page.locator("#recording-rate").click();
      assert.equal(await page.locator("#recording-rate").innerText(), "1.25×", "visible rate control advances to the next supported speed");
      assert(await page.evaluate(() => window.testUtterances.length) > utterancesBeforeSpeed, "changing device rate restarts only the selected native passage");
      assert.match(speedBefore, /1 vez/);
      const utterancesBefore = await page.evaluate(() => window.testUtterances.length);
      await page.locator("#article-body p.recording-readable").first().click();
      assert(await page.evaluate(() => window.testUtterances.length) > utterancesBefore, "click paragraph starts device TTS at that paragraph");
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.locator("#recording-player").waitFor({ state: "visible" });
      await page.locator("#recording-skip").click();
      assert(await page.locator("#recording-elapsed").innerText() !== "0:00", "native player reports paragraph instead of fake time");
      await page.locator("#recording-play").click();
      assert.equal(await page.locator("#recording-play").getAttribute("data-playing"), "false", "native pause changes icon");
      await page.locator("#recording-play").click();
      assert.equal(await page.locator("#recording-play").getAttribute("data-playing"), "true", "native resume changes icon");
      await page.locator(".recording-options summary").click();
      await page.locator("#listen-article").click();
      assert.match(await page.locator("#recording-subtitle").innerText(), /Narração/);
      assert.equal(await page.locator("#recording-player").isVisible(), true, "return to MP3 in same dock");
      await page.locator("#recording-close").click();
      assert(await page.locator("#recording-player").isHidden());
      assert.equal(await page.locator("#article-recording").evaluate(element => element.paused), true, "closing the dock stops the recorded source");
    }
    const racePage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    racePage.setDefaultTimeout(3000);
    const raceClockStart = new Date("2026-10-25T12:00:00Z");
    await racePage.clock.install({ time: raceClockStart });
    await racePage.clock.pauseAt(raceClockStart);
    await racePage.addInitScript(() => {
      window.testUtterances = [];
      window.__playCalls = 0;
      Object.defineProperty(window, "TechTopicsAudio", { configurable: true, set(api) {
        const createPlayer = api.createPlayer;
        api.createPlayer = options => {
          const player = createPlayer(options);
          window.__recordingPlayer = player;
          return player;
        };
        Object.defineProperty(window, "TechTopicsAudio", { configurable: true, writable: true, value: api });
      } });
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], speak(item) { window.testUtterances.push(item); item.onstart?.(); }, cancel() {}, pause() {}, resume() {} } });
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
      HTMLMediaElement.prototype.play = function () {
        window.__playCalls++;
        return new Promise(resolve => { window.__resolveLatePlay = resolve; });
      };
      HTMLMediaElement.prototype.pause = function () {
        Object.defineProperty(this, "paused", { configurable: true, value: true });
        this.dispatchEvent(new Event("pause"));
      };
    });
    await racePage.route("https://**/*", route => route.abort());
    await racePage.route("https://api.github.com/repos/joaovpimenta/tech-topics/releases/tags/tts-*", route =>
      route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ body: "", assets: [{ name: "cqrs-projecoes-e-consistencia.mp3", state: "uploaded" }] }) }));
    await racePage.goto(`${base}/article.html?slug=cqrs-projecoes-e-consistencia`);
    await racePage.locator("#listen-recording").waitFor({ state: "visible" });
    await racePage.waitForFunction(() => document.querySelector("#article-recording")?.src.includes(".mp3"));
    await racePage.evaluate(() => {
      const recording = document.querySelector("#article-recording");
      Object.defineProperty(recording, "duration", { configurable: true, value: 125 });
      Object.defineProperty(recording, "readyState", { configurable: true, value: 4 });
      const range = { length: 1, start: () => 0, end: () => 125 };
      Object.defineProperty(recording, "buffered", { configurable: true, value: range });
      Object.defineProperty(recording, "seekable", { configurable: true, value: range });
    });
    await racePage.locator("#listen-recording").click();
    await racePage.waitForFunction(() => document.querySelector("#recording-status")?.textContent.includes("Aguardando início do MP3"));
    await racePage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await racePage.locator("#recording-player").waitFor({ state: "visible" });
    const pendingPlayerState = await racePage.evaluate(() => window.__recordingPlayer.snapshot());
    assert.deepEqual(pendingPlayerState, { available: true, discovered: true, mediaReady: true, recordedPending: true, open: true, mode: "recorded", playing: false });
    await racePage.locator(".recording-options summary").click();
    const sourceChoiceBeforeClick = await racePage.evaluate(() => ({
      button: document.querySelector("#listen-article")?.textContent.trim(),
      subtitle: document.querySelector("#recording-subtitle")?.textContent,
      playing: document.querySelector("#recording-play")?.dataset.playing,
      status: document.querySelector("#recording-status")?.textContent
    }));
    assert.deepEqual(sourceChoiceBeforeClick, { button: "Usar voz do dispositivo", subtitle: "Tech Topics · Narração", playing: "false", status: "Aguardando início do MP3…" });
    await racePage.locator("#listen-article").click();
    await racePage.waitForFunction(() => window.__recordingPlayer?.snapshot().mode === "device");
    const sourceChoiceAfterClick = await racePage.evaluate(() => ({ player: window.__recordingPlayer.snapshot(),
      subtitle: document.querySelector("#recording-subtitle")?.textContent,
      playing: document.querySelector("#recording-play")?.dataset.playing,
      status: document.querySelector("#recording-status")?.textContent
    }));
    assert.deepEqual(sourceChoiceAfterClick, { player: { available: true, discovered: true, mediaReady: true, recordedPending: false, open: true, mode: "device", playing: true }, subtitle: "Tech Topics · Voz do dispositivo", playing: "true", status: "" }, `explicit device choice clears the canceled MP3 status: ${JSON.stringify(sourceChoiceAfterClick)}`);
    assert.equal(await racePage.locator("#recording-play").getAttribute("data-playing"), "true");
    assert.equal(await racePage.locator("#article-recording").evaluate(element => element.paused), true, "reader choice pauses the unresolved recorded attempt");
    assert.deepEqual(await racePage.evaluate(() => ({ playCalls: window.__playCalls, utterances: window.testUtterances.length })), { playCalls: 1, utterances: 1 });
    await racePage.evaluate(() => window.__resolveLatePlay());
    await racePage.clock.runFor(1300);
    await racePage.waitForTimeout(50);
    assert.equal(await racePage.locator("#recording-subtitle").innerText(), "Tech Topics · Voz do dispositivo", "late play resolution cannot override the reader's source choice");
    assert.equal(await racePage.locator("#recording-play").getAttribute("data-playing"), "true");
    assert.equal(await racePage.locator("#article-recording").evaluate(element => element.paused), true);
    assert.deepEqual(await racePage.evaluate(() => ({ playCalls: window.__playCalls, utterances: window.testUtterances.length })), { playCalls: 1, utterances: 1 });
    await racePage.close();
    assert.deepEqual(errors, []);
    console.log("PASS: actual article loads with pronunciation, toolbar, desktop/mobile layout and clean stop.");
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
