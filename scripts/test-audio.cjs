const assert = require("node:assert/strict");
const { test } = require("node:test");
const { findAudio, lookupAudio, chaptersFromNotes, formatTime, createPlayer } = require("../audio.js");

test("format elapsed/total including long technical talks", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(79), "1:19");
  assert.equal(formatTime(3672), "1:01:12");
  assert.equal(formatTime(Infinity), "0:00");
});

test("find exact article release asset only, never generate false MP3 links", async () => {
  let asked = "";
  const fetchImpl = async (url, options) => {
    asked = url;
    assert.equal(options.cache, "no-store");
    return { ok: true, async json() {
      return { assets: [{ name: "wrong.mp3" }, { name: "hedged-requests.mp3", state: "uploaded" }] };
    } };
  };
  assert.equal(await findAudio("hedged-requests", fetchImpl),
    "https://github.com/joaovpimenta/tech-topics/releases/download/tts-hedged-requests/hedged-requests.mp3");
  assert.match(asked, /releases\/tags\/tts-hedged-requests$/);
  assert.equal(await findAudio("bulkhead", async () => ({ status: 404 })), null);
  assert.equal(await findAudio("bulkhead", async () => ({ ok: true, json: async () => ({ assets: [] }) })), null);
  await assert.rejects(findAudio("../bad", fetchImpl), /Slug/);
  await assert.rejects(findAudio("bulkhead", async () => ({ ok: false, status: 403 })), /indisponível/);
});

class Element extends EventTarget {
  constructor() {
    super();
    this.hidden = true;
    this.textContent = "";
    this.value = "0";
    this.disabled = false;
    this.attrs = {};
    this.dataset = {};
    this.properties = {};
    this.style = { setProperty: (key, value) => { this.properties[key] = value; } };
    this.icons = { ".recording-icon-play": { hidden: false }, ".recording-icon-pause": { hidden: true } };
  }
  setAttribute(name, value) { this.attrs[name] = value; }
  querySelector(query) { return this.icons[query] || { textContent: "" }; }
  click() { this.dispatchEvent(new Event("click")); }
}

class AudioMock extends EventTarget {
  constructor() {
    super();
    this.paused = true; this.ended = false;
    this.readyState = 4;
    this.currentTime = 0; this.duration = 105;
    this.playbackRate = 1;
    this.playCalls = 0;
    this.playPlan = null;
    this.buffered = { length: 1, start: () => 0, end: () => this.duration };
    this.seekable = { length: 1, start: () => 0, end: () => this.duration };
  }
  play() {
    this.playCalls += 1;
    if (this.playPlan) return this.playPlan();
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    this.dispatchEvent(new Event("playing"));
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
}

test("recorded MP3 dock: discover, play, time, seek, speed, Media Session and native exclusion", async () => {
  const ids = [
    "listen-recording", "recording-player", "recording-title", "recording-subtitle",
    "recording-cover", "recording-ring", "recording-play", "recording-previous", "recording-skip", "recording-follow",
    "recording-close", "recording-seek", "recording-elapsed",
    "recording-duration", "recording-rate", "recording-status"
  ];
  const nodes = Object.fromEntries(ids.map(id => ["#" + id, new Element()]));
  nodes["#listen-recording"].hidden = false;
  const classes = new Set();
  const document = {
    baseURI: "https://joaovpimenta.github.io/tech-topics/article.html?slug=bulkhead",
    querySelector: selector => nodes[selector],
    body: {
      classList: {
        toggle(name, active) { if (active) classes.add(name); else classes.delete(name); }
      }
    }
  };
  const actions = {};
  const positions = [];
  const mediaSession = {
    playbackState: "none", metadata: null,
    setActionHandler(name, fn) { actions[name] = fn; },
    setPositionState(info) { positions.push(info); }
  };
  const audio = new AudioMock();
  let deviceStops = 0;
  const player = createPlayer({
    document,
    navigator: { mediaSession },
    article: { slug: "bulkhead", title: "Bulkhead: isolar falhas" },
    cover: { src: "assets/bulkhead/cover.jpg" },
    audio,
    fetchAudio: async () => ({
      url: "https://github.com/joaovpimenta/tech-topics/releases/download/tts-bulkhead/bulkhead.mp3",
      chapters: [{start: 0}, {start: 30}, {start: 80}, {start: 103}]
    }),
    stopDevice: () => { deviceStops++; }
  });
  assert.equal(player.snapshot().available, false);
  await player.discover();
  assert.equal(player.snapshot().available, true);
  assert.equal(nodes["#listen-recording"].hidden, false);
  await player.play();
  assert.equal(deviceStops, 1);
  assert.equal(audio.paused, false);
  assert.equal(nodes["#recording-play"].dataset.playing, "true", "play must show pause icon");
  assert(classes.has("recording-open"));
  assert.equal(nodes["#recording-title"].textContent, "Bulkhead: isolar falhas");
  assert.equal(mediaSession.playbackState, "playing");
  assert.equal(nodes["#recording-player"].hidden, false);
  audio.currentTime = 65;
  audio.dispatchEvent(new Event("timeupdate"));
  assert.equal(nodes["#recording-elapsed"].textContent, "1:05");
  assert.equal(nodes["#recording-duration"].textContent, "1:45");
  assert(positions.length > 0);
  assert.equal(nodes["#recording-skip"].hidden, false);
  assert.equal(nodes["#recording-previous"].hidden, false);
  nodes["#recording-skip"].click();
  assert.equal(audio.currentTime, 80, "next narration block, not plus 15 seconds");
  nodes["#recording-seek"].value = "500";
  nodes["#recording-seek"].dispatchEvent(new Event("input"));
  nodes["#recording-seek"].dispatchEvent(new Event("change"));
  assert.equal(audio.currentTime, 52.5);
  nodes["#recording-rate"].click();
  assert.equal(audio.playbackRate, 1.25);
  actions.nexttrack();
  assert.equal(audio.currentTime, 80);
  actions.previoustrack();
  assert.equal(audio.currentTime, 30);
  nodes["#recording-previous"].click();
  assert.equal(audio.currentTime, 0);
  nodes["#recording-play"].click();
  assert.equal(mediaSession.playbackState, "paused");
  assert.equal(audio.paused, true);
  assert.equal(nodes["#recording-play"].dataset.playing, "false", "pause must show play icon");
  nodes["#recording-close"].click();
  assert.equal(nodes["#recording-player"].hidden, true);
  assert.equal(mediaSession.playbackState, "none");
  assert.equal(actions.play, null);
});

test("inline article player and floating dock share one audio session across scroll visibility", async () => {
  const ids = [
    "listen-recording", "inline-recording-anchor", "inline-recording-seek",
    "inline-recording-elapsed", "inline-recording-duration", "inline-recording-rate",
    "inline-recording-previous", "inline-recording-next",
    "recording-player", "recording-title", "recording-subtitle", "recording-cover",
    "recording-ring", "recording-play", "recording-previous", "recording-skip",
    "recording-follow", "recording-close", "recording-seek",
    "recording-elapsed", "recording-duration", "recording-rate", "recording-status"
  ];
  const nodes = Object.fromEntries(ids.map(id => ["#" + id, new Element()]));
  const classes = new Set();
  let observer;
  const oldObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe(target) { assert.equal(target, nodes["#inline-recording-anchor"]); }
    emit(visible) { this.callback([{ isIntersecting: visible }]); }
  };
  try {
    const doc = {
      baseURI: "https://joaovpimenta.github.io/tech-topics/article.html?slug=bulkhead",
      querySelector: selector => nodes[selector],
      body: { classList: { toggle(name, active) {
        if (active) classes.add(name);
        else classes.delete(name);
      } } }
    };
    const audio = new AudioMock();
    const player = createPlayer({
      document: doc, navigator: {},
      article: { slug: "bulkhead", title: "Bulkhead" },
      cover: { src: "assets/bulkhead/cover.jpg" }, audio,
      fetchAudio: async () => ({ url: "https://example.org/bulkhead.mp3",
        chapters: [{ start: 0 }, { start: 30 }, { start: 80 }] })
    });
    await player.discover();
    assert.equal(nodes["#inline-recording-next"].hidden, false);
    assert.equal(nodes["#inline-recording-previous"].hidden, false);
    assert.equal(nodes["#recording-player"].hidden, true, "dock starts hidden");
    nodes["#listen-recording"].click();
    await Promise.resolve();
    assert.equal(audio.paused, false);
    assert.equal(nodes["#recording-player"].hidden, true, "inline player owns initial playback");
    assert.equal(nodes["#listen-recording"].dataset.playing, "true");
    assert.equal(classes.has("recording-open"), false);

    audio.currentTime = 30;
    audio.dispatchEvent(new Event("timeupdate"));
    assert.equal(nodes["#inline-recording-elapsed"].textContent, "0:30");
    assert.equal(nodes["#inline-recording-duration"].textContent, "1:45");
    nodes["#inline-recording-seek"].value = "500";
    nodes["#inline-recording-seek"].dispatchEvent(new Event("input"));
    nodes["#inline-recording-seek"].dispatchEvent(new Event("change"));
    assert.equal(audio.currentTime, 52.5);
    nodes["#inline-recording-rate"].click();
    assert.equal(audio.playbackRate, 1.25);
    assert.equal(nodes["#inline-recording-rate"].textContent, "1.25×");
    nodes["#inline-recording-next"].click();
    assert.equal(audio.currentTime, 80);
    nodes["#inline-recording-previous"].click();
    assert.equal(audio.currentTime, 30);

    observer.emit(false);
    assert.equal(nodes["#recording-player"].hidden, false, "scrolled away displays dock");
    assert.equal(classes.has("recording-open"), true);
    assert.equal(nodes["#recording-elapsed"].textContent, nodes["#inline-recording-elapsed"].textContent);
    nodes["#recording-play"].click();
    assert.equal(audio.paused, true);
    assert.equal(nodes["#listen-recording"].dataset.playing, "false", "both playback controls stay in sync");
    observer.emit(true);
    assert.equal(nodes["#recording-player"].hidden, true, "returning to inline player hides dock");
    assert.equal(classes.has("recording-open"), false);
    nodes["#listen-recording"].click();
    await Promise.resolve();
    assert.equal(audio.paused, false, "reproduction resumes at its current position");
    observer.emit(false);
    nodes["#recording-close"].click();
    assert.equal(nodes["#recording-player"].hidden, true);
    assert.equal(classes.has("recording-open"), false);
    assert.equal(player.snapshot().open, false);
  } finally {
    if (oldObserver === undefined) delete globalThis.IntersectionObserver;
    else globalThis.IntersectionObserver = oldObserver;
  }
});

test("article controls keep favorites and sharing icon-only, accessible, and consistent with the home", () => {
  const fs = require("node:fs");
  const html = fs.readFileSync("article.html", "utf8");
  const script = fs.readFileSync("article.js", "utf8");
  assert.match(html, /id="favorite-article"[^>]*aria-pressed="false"/);
  assert.match(html, /id="share-article"[^>]*aria-label="Compartilhar artigo"/);
  assert.match(html, /id="inline-recording-anchor"/);
  assert.match(html, /id="inline-recording-seek"/);
  assert.match(html, /id="inline-recording-rate"/);
  assert.match(html, /id="inline-recording-previous"/);
  assert.match(html, /id="inline-recording-next"/);
  const css = fs.readFileSync("styles.css", "utf8");
  assert.match(css, /\.article-page \.inline-recording-rate\s*\{[^}]*display:\s*inline-grid/s,
    "the speed control must stay visible on narrow screens");
  assert.match(css, /\.article-page \.inline-recording\s*\{[^}]*background:\s*var\(--paper\)/s,
    "the inline player has a white editorial background");
  assert.match(css, /\.article-page \.article-actions\s*\{\s*display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(0,\s*460px\) max-content;/,
    "audio and social actions share an aligned row");
  assert.match(css, /\.article-page \.inline-recording\s*\{[^}]*height:\s*40px;/s,
    "the inline player has the same height as action buttons");
  assert.match(css, /\.article-page \.article-icon-button\s*\{[^}]*width:\s*40px;[^}]*height:\s*40px;/s,
    "like and share have equal 40px dimensions");
  assert.match(css, /@media \(max-width:\s*620px\)\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) max-content;/,
    "mobile shrinks the player, never moving buttons to another row");
  assert.match(css, /\.article-page \.inline-recording-skip\[hidden\]\s*\{\s*display:\s*none;/,
    "hidden chapter controls do not consume horizontal space");
  assert.match(html, /id="recording-player"/);
  assert.match(script, /tech-topics:favorites:v1/, "articles use the exact home favorite storage key");
  assert.match(script, /localStorage\.setItem\(FAVORITES_KEY/, "favorite click persists locally");
});

test("responsive inline transport and floating dock share a compact visual contract", () => {
  const fs = require("node:fs");
  const css = fs.readFileSync("styles.css", "utf8");
  const html = fs.readFileSync("article.html", "utf8");
  const home = fs.readFileSync("index.html", "utf8");
  const styles = css.slice(css.indexOf("/* Compact transport: seek is the only compressible control."));
  assert.ok(styles.startsWith("/* Compact transport:"),
    "the responsive constraints must be present after older mobile rules");
  assert.match(styles, /\.article-page \.inline-recording-seek\s*\{[^}]*flex:\s*1 1 0px;[^}]*min-width:\s*0;/s,
    "the seek input, not the speed/favorite/share buttons, absorbs narrow widths");
  assert.match(styles, /\.article-page \.article-social-actions\s*\{\s*flex-wrap:\s*nowrap;/,
    "like and share remain side by side");
  assert.match(styles, /\.article-page \.recording-dock\s*\{[^}]*display:\s*flex;/s,
    "the floating player must be compact on one row");
  assert.match(styles, /\.article-page \.recording-cover-ring\s*\{\s*display:\s*none;/,
    "no bulky cover image in the scroll player");
  assert.match(styles, /\.article-page \.recording-info,\s*\.article-page \.recording-progress,\s*\.article-page \.recording-actions\s*\{\s*display:\s*contents;/,
    "the floating controls and progress share one row without changing event targets");
  assert.match(styles, /\.article-page \.recording-dock #recording-seek\s*\{[^}]*flex:\s*1 1 0px;[^}]*min-width:\s*0;/s,
    "the floating progress track also shrinks first");
  assert.match(styles, /\.article-page \.recording-dock \.recording-play\s*\{[^}]*border-radius:\s*50%;[^}]*background:\s*var\(--accent\);/s,
    "the floating play button uses the inline green circle");
  assert.match(styles, /\.article-page \.recording-dock \.recording-rate\s*\{[^}]*border:\s*1px solid var\(--line\);/s,
    "the floating speed control matches the inline outlined chip");
  const articleCss = html.match(/styles\.css\?v=([a-z0-9-]+)/)?.[1];
  const homeCss = home.match(/styles\.css\?v=([a-z0-9-]+)/)?.[1];
  assert.ok(articleCss, "the article must reference a versioned stylesheet");
  assert.equal(articleCss, homeCss, "both pages must use the same stylesheet revision");
});

test("inline transport reserves speed, chapter controls and social actions before optional progress", () => {
  const fs = require("node:fs");
  const css = fs.readFileSync("styles.css", "utf8");
  const html = fs.readFileSync("article.html", "utf8");
  const audioScript = fs.readFileSync("audio.js", "utf8");
  const layout = css.slice(css.indexOf("/* Single-row transport."));
  assert.ok(layout.startsWith("/* Single-row transport."));
  assert.match(layout, /\.article-page \.inline-recording-timeline\[hidden\]\s*\{\s*display:\s*none !important;/,
    "the entire timeline, rather than only the range track, must disappear");
  assert.match(layout, /\.article-page \.inline-recording-rate\s*\{[^}]*flex:\s*0 0 52px;[^}]*min-width:\s*52px;/s,
    "speed labels such as 1.25× get fixed width");
  assert.match(layout, /\.article-page \.inline-recording-play,\s*\.article-page \.inline-recording-skip,\s*\.article-page \.inline-recording-rate\s*\{\s*flex-shrink:\s*0;/,
    "all transport controls have priority over the timeline");
  assert.match(layout, /\.article-page \.inline-recording-timeline\s*\{[^}]*flex:\s*1 1 0px;[^}]*min-width:\s*0;/s,
    "progress alone consumes the remaining space");
  assert.match(css, /\.article-page \.inline-recording-skip:not\(\[hidden\]\)\s*\{\s*display:\s*grid;/,
    "chapter controls remain visible on small phones");
  assert.match(html, /id="inline-recording-timeline" hidden/,
    "the optional timeline starts hidden to prevent first-paint overlap");
  assert.match(audioScript, /function updateInlineTimeline\(\)/);
  assert.match(audioScript, /new root\.ResizeObserver\(updateInlineTimeline\)\.observe\(inlineAnchor\)/,
    "timeline visibility must react to actual article layout changes");
  assert.match(audioScript, /const minTimeline = Math\.max\(120, Math\.ceil\(labels \* 7\) \+ 64\)/,
    "duration labels must contribute to required space");
  assert.match(audioScript, /inlineTimeline\.hidden = !fits;/,
    "the timeline is hidden instead of allowing progress to overlap fixed buttons");
  for (const id of ["listen-recording", "inline-recording-previous", "inline-recording-next",
    "inline-recording-rate", "favorite-article", "share-article"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
});

test("release chapter metadata is available through CORS-safe GitHub API response", async () => {
  const body = "\n<!-- TECH_TOPICS_CHAPTERS_V1\n" +
    JSON.stringify({ version: 1, chapters: [{ start: 0 }, { start: 18.45 }, { start: 43 }] }) +
    "\n-->\n";
  const info = await lookupAudio("hedged-requests", async () => ({
    ok: true, async json() {
      return { body, assets: [{ name: "hedged-requests.mp3" }, { name: "hedged-requests.chapters.json" }] };
    }
  }));
  assert.deepEqual(info.chapters.map(chapter => chapter.start), [0, 18.45, 43]);
  assert.match(info.url, /hedged-requests.mp3$/);
  assert.deepEqual(chaptersFromNotes("No markers"), []);
  assert.deepEqual(chaptersFromNotes("<!-- TECH_TOPICS_CHAPTERS_V1\nnot-json\n-->"), []);
  assert.deepEqual(chaptersFromNotes("<!-- TECH_TOPICS_CHAPTERS_V1\n" +
    JSON.stringify({ version: 1, chapters: [{ start: 0 }, { start: -1 }] }) + "\n-->"), []);
});

test("legacy MP3 has no fake 15-second paragraph skip; device remains available", async () => {
  const ids = ["listen-recording", "recording-player", "recording-title", "recording-subtitle",
    "recording-cover", "recording-ring", "recording-play", "recording-previous", "recording-skip", "recording-follow",
    "recording-close", "recording-seek", "recording-elapsed",
    "recording-duration", "recording-rate", "recording-status"];
  const nodes = Object.fromEntries(ids.map(id => ["#" + id, new Element()]));
  const doc = {
    baseURI: "https://joaovpimenta.github.io/tech-topics/",
    querySelector: id => nodes[id],
    body: { classList: { toggle() {} } }
  };
  let starts = 0;
  const audio = new AudioMock();
  const player = createPlayer({ document: doc, navigator: {}, article: { slug: "bulkhead", title: "Bulkhead" },
    cover: { src: "assets/bulkhead/cover.jpg" }, audio, fetchAudio: async () => null,
    startDevice: () => starts++ });
  nodes["#listen-recording"].click();
  assert.equal(starts, 1);
  await player.discover();
  assert.equal(player.snapshot().available, false);
  assert.equal(nodes["#recording-skip"].hidden, true);
});


class ReadingNode extends EventTarget {
  constructor(tag, text, children = []) {
    super();
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.textContent = text;
    this.children = children;
    this.classes = new Set();
    this.classList = {
      add: name => this.classes.add(name),
      remove: name => this.classes.delete(name)
    };
    this.scrolls = 0;
    this.tabIndex = -1;
  }
  matches(selectors) {
    return selectors.split(",").some(selector => selector.trim() === this.tagName.toLowerCase());
  }
  querySelector() { return null; }
  hasAttribute() { return false; }
  closest() { return null; }
  scrollIntoView() { this.scrolls++; }
  click() { this.dispatchEvent(new Event("click")); }
}

async function playerFixture({ readyState = 4, playbackTimeoutMs = 30, playPlan = null, buffered, seekable, deviceAvailable = true, fetchAudio, autoDiscover = true } = {}) {
  const ids = ["listen-recording", "inline-recording-anchor", "inline-recording-timeline", "inline-recording",
    "inline-recording-seek", "inline-recording-elapsed", "inline-recording-duration", "inline-recording-rate",
    "inline-recording-previous", "inline-recording-next", "recording-player", "recording-title",
    "recording-subtitle", "recording-cover", "recording-ring", "recording-play", "recording-previous",
    "recording-skip", "recording-follow", "recording-close", "recording-seek", "recording-elapsed",
    "recording-duration", "recording-rate", "recording-status", "listen-article"];
  const nodes = Object.fromEntries(ids.map(id => ["#" + id, new Element()]));
  nodes["#listen-recording"].hidden = false;
  nodes["#recording-follow"].checked = true;
  const heading = new ReadingNode("h1", "Artigo");
  const dek = new ReadingNode("p", "Resumo");
  const paragraph = new ReadingNode("p", "Primeira frase. Segunda frase.");
  const body = new ReadingNode("article", "", [paragraph]);
  const menu = { open: false, hidden: true };
  const doc = {
    visibilityState: "visible",
    baseURI: "https://joaovpimenta.github.io/tech-topics/article.html?slug=bulkhead",
    querySelector(selector) {
      if (selector === "#article-heading") return heading;
      if (selector === "#article-dek") return dek;
      if (selector === "#article-body") return body;
      if (selector === ".recording-options") return menu;
      return nodes[selector] || null;
    },
    getSelection() { return { toString: () => "" }; },
    body: { classList: { toggle() {} } }
  };
  const audio = new AudioMock();
  audio.readyState = readyState;
  if (buffered !== undefined) audio.buffered = buffered;
  if (seekable !== undefined) audio.seekable = seekable;
  if (playPlan) audio.playPlan = () => playPlan(audio);
  const blocks = [{ node: heading, sentenceIndex: 0, words: [] }, { node: dek, sentenceIndex: 0, words: [] }, { node: paragraph, sentenceIndex: 0, words: [] }];
  let state = { state: "idle", blockIndex: 0, count: blocks.length };
  let rate = 1;
  let controller;
  const starts = [];
  const devicePlayer = {
    blocks,
    snapshot: () => ({ ...state }),
    start(index = 0, paused = false) { state = { ...state, state: paused ? "paused" : "speaking", blockIndex: index }; starts.push(index); controller.deviceChanged(this.snapshot()); },
    toggle() { state = { ...state, state: state.state === "speaking" ? "paused" : "speaking" }; controller.deviceChanged(this.snapshot()); },
    stop() { state = { ...state, state: "idle", blockIndex: 0 }; controller.deviceChanged(this.snapshot()); },
    setRate(value) { rate = value; if (state.state !== "idle") controller.deviceChanged(this.snapshot()); },
    getRate: () => rate,
    next() { this.start(Math.min(blocks.length - 1, state.blockIndex + 1)); },
    previous() { this.start(Math.max(0, state.blockIndex - 1)); },
    seek(index) { this.start(index); }
  };
  controller = createPlayer({
    document: doc, navigator: {}, article: { slug: "bulkhead", title: "Bulkhead" },
    cover: { src: "assets/bulkhead/cover.jpg" }, audio, devicePlayer: deviceAvailable ? devicePlayer : null, playbackTimeoutMs,
    startDevice: () => starts.push("unavailable"),
    fetchAudio: fetchAudio || (async () => ({ url: "https://example.org/bulkhead.mp3", chapters: [{ start: 0 }, { start: 30 }, { start: 80 }] }))
  });
  const discovery = controller.discover();
  if (autoDiscover) await discovery;
  return { audio, controller, devicePlayer, starts, nodes, paragraph, discovery };
}

test("discovered MP3 with readyState zero uses device speech after the gesture", async () => {
  const fixture = await playerFixture({ readyState: 0 });
  assert.equal(fixture.controller.snapshot().discovered, true);
  assert.equal(fixture.controller.snapshot().mediaReady, false);
  await fixture.controller.play();
  assert.equal(fixture.audio.playCalls, 0, "unready media is not treated as playable");
  assert.equal(fixture.controller.snapshot().mode, "device");
  assert.equal(fixture.starts.length, 1, "the available local source starts immediately");
  assert.equal(fixture.audio.paused, true, "MP3 remains silent while device speech is active");
  const resumed = await playerFixture({ readyState: 0 });
  resumed.controller.beginDevice(2);
  await resumed.controller.play();
  assert.deepEqual(resumed.starts, [2, 2], "fallback resumes at the same device block instead of restarting at the beginning");
  const unbuffered = await playerFixture({ buffered: { length: 0 }, seekable: { length: 0 } });
  assert.equal(unbuffered.controller.snapshot().mediaReady, false, "metadata without a confirmed seekable buffer is not ready");
  await unbuffered.controller.play();
  assert.equal(unbuffered.audio.playCalls, 0);
  assert.equal(unbuffered.controller.snapshot().mode, "device");
  let finishLoad;
  const noSpeech = await playerFixture({ readyState: 1, deviceAvailable: false, playbackTimeoutMs: 10,
    playPlan: () => new Promise(resolve => { finishLoad = resolve; }) });
  const noSpeechAttempt = noSpeech.controller.play();
  assert.equal(noSpeech.audio.playCalls, 1, "a user gesture still asks the discovered MP3 to load");
  assert.equal(noSpeech.nodes["#recording-status"].textContent, "Carregando áudio gravado…");
  await noSpeechAttempt;
  assert.equal(noSpeech.controller.snapshot().mode, null);
  assert.equal(noSpeech.controller.snapshot().open, false);
  assert.match(noSpeech.nodes["#recording-status"].textContent, /MP3 ainda não iniciou/);
  finishLoad();
});

test("initial unmapped playback may start device block zero, but never after recorded progress", async () => {
  const initial = await playerFixture({ readyState: 0,
    fetchAudio: async () => ({ url: "https://example.org/bulkhead.mp3", chapters: [] }) });
  await initial.controller.play();
  assert.deepEqual(initial.starts, [0], "an initial play gesture can start the device reader at its known beginning");
  assert.equal(initial.controller.snapshot().mode, "device");

  const advanced = await playerFixture({
    fetchAudio: async () => ({ url: "https://example.org/bulkhead.mp3", chapters: [] })
  });
  await advanced.controller.play();
  advanced.audio.currentTime = 85;
  advanced.audio.dispatchEvent(new Event("timeupdate"));
  advanced.audio.currentTime = 0;
  advanced.audio.dispatchEvent(new Event("seeking"));
  advanced.audio.dispatchEvent(new Event("seeked"));
  advanced.audio.dispatchEvent(new Event("error"));
  assert.deepEqual(advanced.starts, [], "returning to time zero does not erase the fact that recorded playback advanced");
  assert.equal(advanced.controller.snapshot().mode, null);
  assert.equal(advanced.audio.paused, true);
  assert.equal(advanced.audio.currentTime, 0, "the actual seek position remains intact");
  assert.match(advanced.nodes["#recording-status"].textContent, /capítulos não correspondem ao texto/);

  let resolvePendingPlay;
  const pending = await playerFixture({ playbackTimeoutMs: 1000,
    fetchAudio: async () => ({ url: "https://example.org/bulkhead.mp3", chapters: [] }),
    playPlan: audio => new Promise(resolve => {
      resolvePendingPlay = () => {
        audio.paused = false;
        audio.dispatchEvent(new Event("playing"));
        resolve();
      };
    }) });
  const pendingAttempt = pending.controller.play();
  pending.audio.currentTime = 85;
  pending.audio.dispatchEvent(new Event("timeupdate"));
  pending.audio.dispatchEvent(new Event("error"));
  await pendingAttempt;
  assert.deepEqual(pending.starts, [], "pending playback that advances cannot use the initial-zero fallback");
  assert.equal(pending.controller.snapshot().mode, null);
  assert.equal(pending.audio.currentTime, 85);
  resolvePendingPlay();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(pending.starts, [], "a late play resolution cannot start block zero after cancellation");

  let resolveSource;
  const lateCatalog = await playerFixture({ autoDiscover: false,
    fetchAudio: () => new Promise(resolve => { resolveSource = resolve; }) });
  await lateCatalog.controller.play();
  assert.deepEqual(lateCatalog.starts, [0], "a first gesture before discovery starts at the known reader beginning");
  resolveSource({ url: "https://example.org/bulkhead.mp3", chapters: [] });
  await lateCatalog.discovery;
  assert.equal(lateCatalog.controller.snapshot().mode, "device", "late metadata does not automatically promote the reader to MP3");
  assert.equal(lateCatalog.audio.playCalls, 0);
});

test("pending and rejected media playback fall back within a bound and ignore late starts", async () => {
  let resolveLate;
  const fixture = await playerFixture({
    playbackTimeoutMs: 10,
    playPlan: audio => {
      audio.paused = false;
      audio.dispatchEvent(new Event("play"));
      return new Promise(resolve => {
        resolveLate = () => {
          audio.paused = false;
          audio.dispatchEvent(new Event("play"));
          audio.dispatchEvent(new Event("playing"));
          resolve();
        };
      });
    }
  });
  const attempt = fixture.controller.play();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(fixture.controller.snapshot().mode, "device", "a pending play promise cannot hold the reader");
  assert.equal(fixture.controller.snapshot().recordedPending, false);
  assert.equal(fixture.audio.paused, true);
  assert.equal(fixture.starts.length, 1);
  resolveLate();
  await attempt;
  await Promise.resolve();
  assert.equal(fixture.controller.snapshot().mode, "device", "a late MP3 result cannot take over local speech");
  assert.equal(fixture.audio.paused, true, "a late playing event is paused before becoming a second source");

  const rejected = await playerFixture({
    playPlan: audio => {
      audio.paused = false;
      audio.dispatchEvent(new Event("play"));
      return Promise.reject(new Error("decode failed"));
    }
  });
  await rejected.controller.play();
  assert.equal(rejected.controller.snapshot().mode, "device");
  assert.equal(rejected.audio.paused, true);
  assert.equal(rejected.nodes["#recording-status"].textContent, "Não foi possível iniciar o MP3; usando voz do dispositivo.");
});

test("pause, seek, close and explicit device choice cancel pending MP3 attempts", async () => {
  for (const action of ["pause", "seek", "close", "device"]) {
    let resolveLate;
    const fixture = await playerFixture({
      playbackTimeoutMs: 1000,
      playPlan: audio => {
        audio.paused = false;
        audio.dispatchEvent(new Event("play"));
        return new Promise(resolve => {
          resolveLate = () => {
            audio.paused = false;
            audio.dispatchEvent(new Event("play"));
            audio.dispatchEvent(new Event("playing"));
            resolve();
          };
        });
      }
    });
    if (action === "device") fixture.controller.beginDevice(2);
    const attempt = fixture.controller.play();
    assert.equal(fixture.controller.snapshot().recordedPending, true);
    if (action === "pause") fixture.nodes["#recording-play"].click();
    if (action === "seek") {
      fixture.nodes["#recording-seek"].value = "500";
      fixture.nodes["#recording-seek"].dispatchEvent(new Event("input"));
      fixture.nodes["#recording-seek"].dispatchEvent(new Event("change"));
    }
    if (action === "close") fixture.controller.close();
    if (action === "device") {
      assert.equal(fixture.nodes["#recording-status"].textContent, "Aguardando início do MP3…");
      fixture.nodes["#listen-article"].click();
      assert.equal(fixture.nodes["#recording-status"].textContent, "", "explicit source choice clears the canceled MP3 waiting message");
    }
    await attempt;
    assert.equal(fixture.controller.snapshot().recordedPending, false, `${action} clears the pending attempt`);
    assert.deepEqual(fixture.starts, action === "device" ? [2, 2] : [], `${action} does not trigger an unrelated fallback or lose the local position`);
    resolveLate();
    await Promise.resolve();
    assert.equal(fixture.audio.paused, true, `${action} pauses any late MP3 start`);
    if (action === "close") assert.equal(fixture.controller.snapshot().open, false);
    if (action === "device") assert.equal(fixture.controller.snapshot().mode, "device");
  }
});

test("a late play result from an older request cannot pause a newer recorded session", async () => {
  const resolutions = [];
  const fixture = await playerFixture({
    playbackTimeoutMs: 1000,
    playPlan: audio => {
      audio.paused = false;
      audio.dispatchEvent(new Event("play"));
      return new Promise(resolve => {
        resolutions.push(() => {
          audio.paused = false;
          audio.dispatchEvent(new Event("play"));
          audio.dispatchEvent(new Event("playing"));
          resolve();
        });
      });
    }
  });
  const firstAttempt = fixture.controller.play();
  fixture.nodes["#recording-play"].click();
  await firstAttempt;

  const secondAttempt = fixture.controller.play();
  resolutions[1]();
  await secondAttempt;
  assert.equal(fixture.controller.snapshot().playing, true);
  assert.equal(fixture.audio.paused, false);

  resolutions[0]();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fixture.controller.snapshot().mode, "recorded");
  assert.equal(fixture.controller.snapshot().playing, true, "the stale request cannot interrupt the newer session");
  assert.equal(fixture.audio.paused, false);
});

test("pagehide closes playback after repeated bfcache restore cycles", async () => {
  const oldAdd = globalThis.addEventListener;
  const oldRemove = globalThis.removeEventListener;
  const listeners = new Map();
  globalThis.addEventListener = (type, fn, options) => {
    const listener = (...args) => {
      fn(...args);
      if (options?.once) listeners.delete(type);
    };
    listener.original = fn;
    listeners.set(type, listener);
  };
  globalThis.removeEventListener = (type, fn) => {
    if (listeners.get(type)?.original === fn) listeners.delete(type);
  };
  try {
    const fixture = await playerFixture();
    const dispatch = type => listeners.get(type)?.();
    assert.equal(typeof listeners.get("pagehide"), "function");
    await fixture.controller.play();
    dispatch("pagehide");
    assert.equal(fixture.controller.snapshot().open, false);
    assert.equal(fixture.audio.paused, true);

    dispatch("pageshow");
    await fixture.controller.play();
    assert.equal(fixture.controller.snapshot().playing, true, "playback can resume after bfcache restoration");
    assert.equal(typeof listeners.get("pagehide"), "function", "the listener remains registered after restoration");
    dispatch("pagehide");
    assert.equal(fixture.controller.snapshot().open, false, "the second pagehide still closes the restored session");
    assert.equal(fixture.audio.paused, true);
  } finally {
    if (oldAdd === undefined) delete globalThis.addEventListener;
    else globalThis.addEventListener = oldAdd;
    if (oldRemove === undefined) delete globalThis.removeEventListener;
    else globalThis.removeEventListener = oldRemove;
  }
});

test("media error during pending recorded playback returns to the originating device block", async () => {
  const fixture = await playerFixture({ playbackTimeoutMs: 1000, playPlan: () => new Promise(() => {}) });
  fixture.controller.beginDevice(2);
  const attempt = fixture.controller.play();
  assert.equal(fixture.controller.snapshot().recordedPending, true);
  fixture.audio.dispatchEvent(new Event("error"));
  await attempt;
  assert.deepEqual(fixture.starts, [2, 2], "the source error resumes where device playback started");
  assert.equal(fixture.controller.snapshot().mode, "device");
});

test("media error during active MP3 playback falls back at the current chapter", async () => {
  const fixture = await playerFixture();
  await fixture.controller.play();
  fixture.audio.currentTime = 85;
  fixture.audio.dispatchEvent(new Event("timeupdate"));
  fixture.audio.dispatchEvent(new Event("error"));
  assert.deepEqual(fixture.starts, [2], "active playback resumes from the chapter matching the current MP3 position");
  assert.equal(fixture.controller.snapshot().mode, "device");
});

test("MP3 errors with no proven chapter mapping stop safely without guessing device block zero", async () => {
  const unavailableMapping = async () => ({ url: "https://example.org/bulkhead.mp3",
    chapters: [{ start: 0 }, { start: 30 }] });
  const active = await playerFixture({ fetchAudio: unavailableMapping });
  await active.controller.play();
  active.audio.currentTime = 85;
  active.audio.playbackRate = 1.25;
  active.audio.dispatchEvent(new Event("error"));
  assert.deepEqual(active.starts, [], "no synthetic block is guessed when the chapter mapping is absent");
  assert.equal(active.controller.snapshot().mode, null);
  assert.equal(active.audio.paused, true);
  assert.equal(active.audio.currentTime, 85, "the advanced MP3 position is left intact");
  assert.equal(active.audio.playbackRate, 1.25);
  assert.equal(active.devicePlayer.snapshot().state, "idle", "no device reader session is invented");
  assert.match(active.nodes["#recording-status"].textContent, /capítulos não correspondem ao texto/);

  let resolveLate;
  const pending = await playerFixture({ playbackTimeoutMs: 1000, fetchAudio: unavailableMapping,
    playPlan: audio => {
      audio.paused = false;
      audio.dispatchEvent(new Event("play"));
      return new Promise(resolve => {
        resolveLate = () => {
          audio.paused = false;
          audio.dispatchEvent(new Event("playing"));
          resolve();
        };
      });
    } });
  pending.audio.currentTime = 85;
  const attempt = pending.controller.play();
  assert.equal(pending.controller.snapshot().recordedPending, true);
  pending.audio.playbackRate = 1.5;
  pending.audio.dispatchEvent(new Event("error"));
  await attempt;
  assert.deepEqual(pending.starts, [], "pending failure does not guess block zero");
  assert.equal(pending.controller.snapshot().mode, null);
  assert.equal(pending.audio.paused, true);
  assert.equal(pending.audio.currentTime, 85);
  assert.equal(pending.audio.playbackRate, 1.5);
  assert.match(pending.nodes["#recording-status"].textContent, /capítulos não correspondem ao texto/);
  resolveLate();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(pending.starts, [], "a late playing event cannot launch an unmapped device block");
  assert.equal(pending.controller.snapshot().mode, null);
  assert.equal(pending.audio.paused, true);

  const valid = { url: "https://example.org/bulkhead.mp3", chapters: [
    { start: 0, block_index: 0, sentence_index: 0 },
    { start: 30, block_index: 1, sentence_index: 0 },
    { start: 80, block_index: 2, sentence_index: 0 }
  ] };
  const stale = { ...valid, chapters: valid.chapters.map(chapter => ({ ...chapter, block_index: chapter.block_index + 10 })) };
  let catalog = valid;
  const refreshed = await playerFixture({ fetchAudio: async () => catalog });
  await refreshed.controller.play();
  catalog = stale;
  await refreshed.controller.discover();
  refreshed.audio.currentTime = 85;
  refreshed.audio.playbackRate = 1.75;
  refreshed.audio.dispatchEvent(new Event("error"));
  assert.deepEqual(refreshed.starts, [], "an invalid replacement catalog cannot reuse the old text mapping");
  assert.equal(refreshed.controller.snapshot().mode, null);
  assert.equal(refreshed.audio.currentTime, 85);
  assert.equal(refreshed.audio.playbackRate, 1.75);
  assert.match(refreshed.nodes["#recording-status"].textContent, /não correspondem ao texto/);
});

test("exact chapter timestamps highlight and auto-scroll the corresponding paragraph; click seeks", async () => {
  const ids = ["listen-recording", "recording-player", "recording-title", "recording-subtitle",
    "recording-cover", "recording-ring", "recording-play", "recording-previous",
    "recording-skip", "recording-follow", "recording-close", "recording-seek",
    "recording-elapsed", "recording-duration", "recording-rate", "recording-status"];
  const nodes = Object.fromEntries(ids.map(id => ["#" + id, new Element()]));
  const heading = new ReadingNode("h1", "Bulkhead");
  const dek = new ReadingNode("p", "Introdução");
  const first = new ReadingNode("p", "Texto do primeiro parágrafo.");
  const second = new ReadingNode("p", "Texto do segundo parágrafo.");
  const body = new ReadingNode("article", "", [first, second]);
  nodes["#recording-follow"].checked = true;
  const doc = {
    visibilityState: "visible",
    baseURI: "https://joaovpimenta.github.io/tech-topics/article.html?slug=bulkhead",
    querySelector(selector) {
      return ({
        "#article-heading": heading,
        "#article-dek": dek,
        "#article-body": body
      })[selector] || nodes[selector];
    },
    body: { classList: { toggle() {} } }
  };
  const chapters = [
    { start: 0, block_index: 0 },
    { start: 8, block_index: 1 },
    { start: 23, block_index: 2 },
    { start: 48, block_index: 3 }
  ];
  const audio = new AudioMock();
  const player = createPlayer({
    document: doc, navigator: {}, article: { slug: "bulkhead", title: "Bulkhead" },
    cover: { src: "assets/bulkhead/cover.jpg" }, audio,
    fetchAudio: async () => ({ url: "https://example.com/bulkhead.mp3", chapters })
  });
  await player.discover();
  await player.play();
  assert(heading.classes.has("recording-block-active"));
  assert.equal(heading.scrolls, 1);
  audio.currentTime = 25;
  audio.dispatchEvent(new Event("timeupdate"));
  assert(first.classes.has("recording-block-active"));
  assert(!heading.classes.has("recording-block-active"));
  assert.equal(first.scrolls, 1);
  second.click();
  assert.equal(audio.currentTime, 48);
  assert(second.classes.has("recording-block-active"));
  nodes["#recording-previous"].click();
  assert.equal(audio.currentTime, 23);
  nodes["#recording-follow"].checked = false;
  audio.currentTime = 48;
  audio.dispatchEvent(new Event("timeupdate"));
  assert.equal(second.scrolls, 1, "follow disabled suppresses automatic scrolling");
  player.close();
  assert(!second.classes.has("recording-block-active"));
});

test("chapter-to-DOM drift disables unsafe text highlighting without blocking audio", async () => {
  const ids = ["listen-recording", "recording-player", "recording-title", "recording-subtitle",
    "recording-cover", "recording-ring", "recording-play", "recording-previous",
    "recording-skip", "recording-follow", "recording-close", "recording-seek",
    "recording-elapsed", "recording-duration", "recording-rate", "recording-status"];
  const nodes = Object.fromEntries(ids.map(id => ["#" + id, new Element()]));
  const paragraph = new ReadingNode("p", "One paragraph");
  const doc = {
    querySelector(selector) {
      if (selector === "#article-body") return new ReadingNode("article", "", [paragraph]);
      return nodes[selector];
    },
    body: { classList: { toggle() {} } }
  };
  const audio = new AudioMock();
  const player = createPlayer({
    document: doc, navigator: {}, article: { slug: "bulkhead", title: "Bulkhead" },
    cover: { src: "cover.jpg" }, audio,
    fetchAudio: async () => ({ url: "https://example.com/bulkhead.mp3",
      chapters: [{ start: 0 }, { start: 30 }, { start: 80 }] })
  });
  await player.discover();
  assert.equal(paragraph.classes.has("recording-readable"), false);
  await player.play();
  nodes["#recording-skip"].click();
  assert.equal(audio.currentTime, 30);
  assert.equal(paragraph.scrolls, 0);
});


test("same bottom dock controls native synthesis, chapter seeking, speed, and switch back to MP3", async () => {
  const ids = ["listen-recording", "recording-player", "recording-title", "recording-subtitle",
    "recording-cover", "recording-ring", "recording-play", "recording-previous", "recording-skip",
    "recording-follow", "recording-close", "recording-seek", "recording-elapsed",
    "recording-duration", "recording-rate", "recording-status", "listen-article"];
  const nodes = Object.fromEntries(ids.map(id => ["#" + id, new Element()]));
  const menu = { open: true };
  const first = new ReadingNode("h1", "Bulkhead");
  const intro = new ReadingNode("p", "Introdução");
  const paragraph = new ReadingNode("p", "Parágrafo seguinte");
  nodes["#recording-follow"].checked = true;
  const doc = {
    visibilityState: "visible",
    baseURI: "https://joaovpimenta.github.io/tech-topics/article.html",
    querySelector(selector) {
      return ({
        "#article-heading": first,
        "#article-dek": intro,
        "#article-body": new ReadingNode("article", "", [paragraph]),
        ".recording-options": menu
      })[selector] || nodes[selector];
    },
    body: { classList: { toggle() {} } }
  };
  const audio = new AudioMock();
  let controller;
  let deviceRate = 1;
  const blocks = [first, intro, paragraph].map(node => ({ node, sentenceIndex: 0 }));
  let snap = { state: "idle", blockIndex: 0, count: blocks.length };
  const updates = [];
  const device = {
    blocks,
    snapshot: () => ({ ...snap }),
    start(index = 0, paused = false) {
      snap = { ...snap, state: paused ? "paused" : "speaking", blockIndex: index };
      updates.push(["start", index]);
      controller.deviceChanged(this.snapshot());
    },
    toggle() {
      if (snap.state === "idle") return this.start();
      snap = { ...snap, state: snap.state === "speaking" ? "paused" : "speaking" };
      controller.deviceChanged(this.snapshot());
    },
    seek(index) {
      snap = { ...snap, blockIndex: index };
      controller.deviceChanged(this.snapshot());
    },
    next() { this.seek(Math.min(blocks.length - 1, snap.blockIndex + 1)); },
    previous() { this.seek(Math.max(0, snap.blockIndex - 1)); },
    stop() {
      snap = { ...snap, state: "idle", blockIndex: 0 };
      controller.deviceChanged(this.snapshot());
    },
    getRate: () => deviceRate,
    setRate(value) { deviceRate = value; controller.deviceChanged(this.snapshot()); }
  };
  controller = createPlayer({
    document: doc, navigator: {},
    article: { slug: "bulkhead", title: "Bulkhead" },
    cover: { src: "assets/bulkhead/cover.jpg" }, audio, devicePlayer: device,
    fetchAudio: async () => ({ url: "https://example.org/bulkhead.mp3",
      chapters: [{ start: 0, block_index: 0, sentence_index: 0 }, { start: 12, block_index: 1, sentence_index: 0 }, { start: 30, block_index: 2, sentence_index: 0 }] })
  });
  await controller.discover();
  // The single header button starts the MP3 by default.
  nodes["#listen-recording"].click();
  await Promise.resolve();
  assert.equal(controller.snapshot().mode, "recorded");
  audio.currentTime = 18.2;
  nodes["#listen-article"].click();
  assert.equal(controller.snapshot().mode, "device");
  assert.deepEqual(updates.at(-1), ["start", 1], "recorded to device uses the chapter validated at the current MP3 position");
  assert.equal(nodes["#recording-player"].hidden, false);
  assert.equal(nodes["#recording-subtitle"].textContent, "Tech Topics · Voz do dispositivo");
  assert.equal(nodes["#recording-play"].dataset.playing, "true");
  assert.equal(audio.paused, true, "MP3 paused when device synth starts");
  nodes["#recording-skip"].click();
  assert.equal(snap.blockIndex, 2);
  assert(paragraph.classes.has("recording-block-active"));
  nodes["#recording-previous"].click();
  assert.equal(snap.blockIndex, 1);
  paragraph.click();
  assert.equal(snap.blockIndex, 2, "clicking a paragraph keeps native source");
  assert.equal(controller.snapshot().mode, "device");
  assert.deepEqual(updates.at(-1), ["start", 2]);
  nodes["#recording-rate"].click();
  assert.equal(deviceRate, 1.25);
  assert.equal(audio.playbackRate, 1.25, "speed selection is shared with recorded playback");
  assert.equal(nodes["#recording-rate"].textContent, "1.25×");
  assert.equal(nodes["#recording-rate"].attrs["aria-label"], "Velocidade da narração: 1.25 vezes");
  nodes["#recording-play"].click();
  assert.equal(nodes["#recording-play"].dataset.playing, "false");
  assert.equal(nodes["#recording-elapsed"].textContent, "3/3");
  nodes["#recording-play"].click();
  assert.equal(nodes["#recording-play"].dataset.playing, "true");
  audio.currentTime = 35.901;
  audio.dispatchEvent(new Event("timeupdate"));
  nodes["#listen-article"].click();
  await Promise.resolve();
  assert.equal(controller.snapshot().mode, "recorded");
  assert.equal(audio.currentTime, 30, "device block switches back at its validated chapter timestamp");
  assert.equal(snap.state, "idle", "native synthesis stops when MP3 takes over");
  assert.equal(audio.playbackRate, 1.25, "switching to MP3 preserves the selected speed");
  assert.equal(nodes["#recording-rate"].textContent, "1.25×");
  assert.equal(nodes["#recording-rate"].attrs["aria-label"], "Velocidade da narração: 1.25 vezes");
  nodes["#recording-rate"].click();
  assert.equal(audio.playbackRate, 1.5);
  assert.equal(nodes["#recording-rate"].attrs["aria-label"], "Velocidade da narração: 1.5 vezes");
  nodes["#listen-article"].click();
  assert.equal(controller.snapshot().mode, "device");
  assert.equal(deviceRate, 1.5, "switching back to device speech preserves the new speed");
  assert.equal(nodes["#recording-rate"].textContent, "1.5×");
  assert.equal(nodes["#recording-rate"].attrs["aria-label"], "Velocidade da narração: 1.5 vezes");
  assert.equal(nodes["#recording-player"].hidden, false);
  nodes["#recording-play"].click();
  const playCallsBeforePausedSwitch = audio.playCalls;
  nodes["#listen-article"].click();
  assert.equal(controller.snapshot().mode, "recorded");
  assert.equal(audio.paused, true, "a paused device session remains paused after switching sources");
  assert.equal(audio.currentTime, 30, "paused reverse switch still seeks the validated chapter");
  assert.equal(audio.playCalls, playCallsBeforePausedSwitch, "switching a paused source does not start a transient MP3");
  const deviceStartsBeforePausedSwitch = updates.filter(([kind]) => kind === "start").length;
  nodes["#listen-article"].click();
  assert.equal(controller.snapshot().mode, "device");
  assert.equal(snap.state, "paused", "switching a paused MP3 keeps device speech paused");
  assert.equal(snap.blockIndex, 2, "paused switch keeps the validated sentence index");
  assert.equal(updates.filter(([kind]) => kind === "start").length, deviceStartsBeforePausedSwitch + 1);
  nodes["#recording-close"].click();
  assert.equal(nodes["#recording-player"].hidden, true);
});

test("explicit source switches refuse unproved chapter mappings without disturbing either source", async () => {
  const fixture = await playerFixture({ fetchAudio: async () => ({ url: "https://example.org/bulkhead.mp3",
    chapters: [{ start: 0 }, { start: 30 }] }) });
  await fixture.controller.play();
  fixture.audio.currentTime = 35.901;
  fixture.audio.playbackRate = 1.25;
  fixture.audio.dispatchEvent(new Event("timeupdate"));
  const playCalls = fixture.audio.playCalls;
  fixture.nodes["#listen-article"].click();
  assert.equal(fixture.controller.snapshot().mode, "recorded");
  assert.equal(fixture.audio.paused, false, "the selected source keeps playing");
  assert.equal(fixture.audio.currentTime, 35.901, "the recorded position is untouched");
  assert.equal(fixture.audio.playbackRate, 1.25, "the selected rate is untouched");
  assert.equal(fixture.audio.playCalls, playCalls, "rejected source choice does not restart playback");
  assert.match(fixture.nodes["#recording-status"].textContent, /capítulos não correspondem ao texto/);

  const reverse = await playerFixture({ fetchAudio: async () => ({ url: "https://example.org/bulkhead.mp3",
    chapters: [{ start: 0 }, { start: 30 }] }) });
  reverse.controller.beginDevice(2);
  reverse.devicePlayer.setRate(1.25);
  reverse.nodes["#listen-article"].click();
  assert.equal(reverse.controller.snapshot().mode, "device", "unmapped reverse switch keeps device speech active");
  assert.equal(reverse.devicePlayer.snapshot().state, "speaking");
  assert.equal(reverse.devicePlayer.snapshot().blockIndex, 2);
  assert.match(reverse.nodes["#recording-status"].textContent, /capítulos não correspondem ao texto/);

  const unready = await playerFixture({ readyState: 0 });
  unready.controller.beginDevice(2, true);
  unready.devicePlayer.setRate(1.25);
  unready.nodes["#listen-article"].click();
  assert.equal(unready.controller.snapshot().mode, "device", "an unready MP3 cannot replace the selected device source");
  assert.equal(unready.devicePlayer.snapshot().state, "paused", "unready retry leaves device playback paused");
  assert.equal(unready.devicePlayer.snapshot().blockIndex, 2, "unready retry preserves device position");
  assert.equal(unready.devicePlayer.getRate(), 1.25, "unready retry preserves speech rate");
  assert.equal(unready.audio.currentTime, 0, "failed readiness check restores the recorded element position");
  assert.match(unready.nodes["#recording-status"].textContent, /MP3 ainda não está pronto/);
});

test("sentence metadata v2 supports repeated editorial blocks with different timestamps", () => {
  const data = { version: 2, chapters: [
    { start: 0, block_index: 0, sentence_index: 0 },
    { start: 3.2, block_index: 1, sentence_index: 0 },
    { start: 9.8, block_index: 1, sentence_index: 1 },
    { start: 15.1, block_index: 1, sentence_index: 2 }
  ] };
  const body = "<!-- TECH_TOPICS_CHAPTERS_V1\n" + JSON.stringify(data) + "\n-->";
  const chapters = chaptersFromNotes(body);
  assert.equal(chapters.length, 4);
  assert.deepEqual(chapters.map(ch => ch.sentenceIndex), [0, 0, 1, 2]);
  assert.deepEqual(chapters.map(ch => ch.blockIndex), [0, 1, 1, 1]);
});


test("recorded v2 highlights exactly one sentence and skips comma-sized chunks", async () => {
  const ids = ["listen-recording", "recording-player", "recording-title", "recording-subtitle",
    "recording-cover", "recording-ring", "recording-play", "recording-previous", "recording-skip",
    "recording-follow", "recording-close", "recording-seek", "recording-elapsed",
    "recording-duration", "recording-rate", "recording-status"];
  const nodes = Object.fromEntries(ids.map(id => ["#" + id, new Element()]));
  const heading = new ReadingNode("h1", "Título");
  const dek = new ReadingNode("p", "Descrição.");
  const paragraph = new ReadingNode("p", "Frase primeira, com vírgula. Segunda frase.");
  const body = new ReadingNode("article", "", [paragraph]);
  const words = Array.from({ length: 4 }, () => new ReadingNode("span", "palavra"));
  const highlights = new Map();
  class FakeHighlight {
    constructor(range) { this.ranges = [range]; }
  }
  const ranges = [];
  const units = [
    { node: heading, sentenceIndex: 0, words: [words[0]] },
    { node: dek, sentenceIndex: 0, words: [words[1]] },
    { node: paragraph, sentenceIndex: 0, words: [words[2]] },
    { node: paragraph, sentenceIndex: 1, words: [words[3]] }
  ];
  const doc = {
    visibilityState: "visible",
    baseURI: "https://joaovpimenta.github.io/tech-topics/article.html?slug=bulkhead",
    defaultView: { CSS: { highlights }, Highlight: FakeHighlight },
    createRange() {
      const range = {
        setStartBefore(node) { this.startBefore = node; },
        setEndAfter(node) { this.endAfter = node; }
      };
      ranges.push(range);
      return range;
    },
    querySelector(id) {
      return ({ "#article-heading": heading, "#article-dek": dek, "#article-body": body })[id] || nodes[id];
    },
    body: { classList: { toggle() {} } }
  };
  nodes["#recording-follow"].checked = true;
  const audio = new AudioMock();
  const player = createPlayer({ document: doc, navigator: {},
    article: { slug: "bulkhead", title: "Bulkhead" }, cover: { src: "assets/bulkhead/cover.jpg" },
    audio, devicePlayer: { blocks: units, stop() {} },
    fetchAudio: async () => ({url: "https://example.com/bulkhead.mp3", chapters: [
      {start: 0, block_index: 0, sentence_index: 0},
      {start: 5, block_index: 1, sentence_index: 0},
      {start: 10, block_index: 2, sentence_index: 0},
      {start: 26, block_index: 2, sentence_index: 1}
    ]}) });
  await player.discover();
  await player.play();
  audio.currentTime = 12;
  audio.dispatchEvent(new Event("timeupdate"));
  assert.equal(ranges.at(-1).startBefore, words[2], "range begins at first word of current phrase");
  assert.equal(ranges.at(-1).endAfter, words[2], "range ends after last word, including whitespace between");
  assert(highlights.has("tech-topics-current-sentence"), "MP3 uses contiguous CSS Highlight API");
  assert(!words[3].classes.has("recording-sentence-active"));
  nodes["#recording-skip"].click();
  assert.equal(audio.currentTime, 26);
  assert.equal(ranges.at(-1).startBefore, words[3]);
  assert.equal(ranges.at(-1).endAfter, words[3]);
  assert.equal(highlights.size, 1, "old sentence highlight is replaced");
  assert(!paragraph.classes.has("recording-block-active"), "only active sentence is highlighted");
  nodes["#recording-previous"].click();
  assert.equal(audio.currentTime, 10);
  player.close();
  assert.equal(highlights.size, 0, "closing MP3 player removes the highlight");
});
