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
    this.currentTime = 0; this.duration = 105;
    this.playbackRate = 1;
  }
  async play() {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
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
  assert.match(html, /styles\.css\?v=20261023-responsive-audio-dock/);
  assert.match(home, /styles\.css\?v=20261023-responsive-audio-dock/);
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
  const blocks = [first, intro, paragraph].map(node => ({ node }));
  let snap = { state: "idle", blockIndex: 0, count: blocks.length };
  const updates = [];
  const device = {
    blocks,
    snapshot: () => ({ ...snap }),
    start(index = 0) {
      snap = { ...snap, state: "speaking", blockIndex: index };
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
      chapters: [{ start: 0, block_index: 0 }, { start: 12, block_index: 1 }, { start: 30, block_index: 2 }] })
  });
  await controller.discover();
  // The single header button starts the MP3 by default.
  nodes["#listen-recording"].click();
  await Promise.resolve();
  assert.equal(controller.snapshot().mode, "recorded");
  nodes["#listen-article"].click();
  assert.equal(controller.snapshot().mode, "device");
  assert.equal(nodes["#recording-player"].hidden, false);
  assert.equal(nodes["#recording-subtitle"].textContent, "Tech Topics · Voz do dispositivo");
  assert.equal(nodes["#recording-play"].dataset.playing, "true");
  assert.equal(audio.paused, true, "MP3 paused when device synth starts");
  nodes["#recording-skip"].click();
  assert.equal(snap.blockIndex, 1);
  assert(intro.classes.has("recording-block-active"));
  nodes["#recording-previous"].click();
  assert.equal(snap.blockIndex, 0);
  paragraph.click();
  assert.equal(snap.blockIndex, 2, "clicking a paragraph keeps native source");
  assert.equal(controller.snapshot().mode, "device");
  assert.deepEqual(updates.at(-1), ["start", 2]);
  nodes["#recording-rate"].click();
  assert.equal(deviceRate, 1.25);
  nodes["#recording-play"].click();
  assert.equal(nodes["#recording-play"].dataset.playing, "false");
  assert.equal(nodes["#recording-elapsed"].textContent, "3/3");
  nodes["#recording-play"].click();
  assert.equal(nodes["#recording-play"].dataset.playing, "true");
  nodes["#listen-article"].click();
  await Promise.resolve();
  assert.equal(controller.snapshot().mode, "recorded");
  assert.equal(snap.state, "idle", "native synthesis stops when MP3 takes over");
  assert.equal(nodes["#recording-player"].hidden, false);
  nodes["#recording-close"].click();
  assert.equal(nodes["#recording-player"].hidden, true);
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
