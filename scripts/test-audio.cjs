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
    "recording-cover", "recording-ring", "recording-play", "recording-skip",
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
  const body = "\\n<!-- TECH_TOPICS_CHAPTERS_V1\\n" +
    JSON.stringify({ version: 1, chapters: [{ start: 0 }, { start: 18.45 }, { start: 43 }] }) +
    "\\n-->\\n";
  const info = await lookupAudio("hedged-requests", async () => ({
    ok: true, async json() {
      return { body, assets: [{ name: "hedged-requests.mp3" }, { name: "hedged-requests.chapters.json" }] };
    }
  }));
  assert.deepEqual(info.chapters.map(chapter => chapter.start), [0, 18.45, 43]);
  assert.match(info.url, /hedged-requests.mp3$/);
  assert.deepEqual(chaptersFromNotes("No markers"), []);
  assert.deepEqual(chaptersFromNotes("<!-- TECH_TOPICS_CHAPTERS_V1\\nnot-json\\n-->"), []);
  assert.deepEqual(chaptersFromNotes("<!-- TECH_TOPICS_CHAPTERS_V1\\n" +
    JSON.stringify({ version: 1, chapters: [{ start: 0 }, { start: -1 }] }) + "\\n-->"), []);
});

test("legacy MP3 has no fake 15-second paragraph skip; device remains available", async () => {
  const ids = ["listen-recording", "recording-player", "recording-title", "recording-subtitle",
    "recording-cover", "recording-ring", "recording-play", "recording-skip",
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
