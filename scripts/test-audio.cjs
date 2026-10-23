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
  const body = "<!-- TECH_TOPICS_CHAPTERS_V1\\n" + JSON.stringify(data) + "\\n-->";
  const chapters = chaptersFromNotes(body);
  assert.equal(chapters.length, 4);
  assert.deepEqual(chapters.map(ch => ch.sentenceIndex), [0, 0, 1, 2]);
  assert.deepEqual(chapters.map(ch => ch.blockIndex), [0, 1, 1, 1]);
});
