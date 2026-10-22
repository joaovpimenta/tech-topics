const assert = require("node:assert/strict");
const { test } = require("node:test");
const { findAudio, formatTime, createPlayer } = require("../audio.js");

test("format elapsed/total including long technical talks", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(79), "1:19");
  assert.equal(formatTime(3672), "1:01:12");
  assert.equal(formatTime(Infinity), "0:00");
});

test("find article MP3 in media branch first, then fallback to legacy Release", async () => {
  const asked = [];
  const fetchImpl = async (url, options) => {
    asked.push(url);
    assert.equal(options.cache, "no-store");
    if (url.includes("/contents/audio/")) {
      return { ok: true, status: 200, json: async () => ({
        type: "file", name: "hedged-requests.mp3", size: 2048,
        sha: "a".repeat(40)
      }) };
    }
    throw Error("Should not query Releases after discovering repository MP3");
  };
  assert.equal(await findAudio("hedged-requests", fetchImpl),
    "https://raw.githubusercontent.com/joaovpimenta/tech-topics/audio/audio/hedged-requests.mp3?v=" + "a".repeat(40));
  assert.deepEqual(asked, [
    "https://api.github.com/repos/joaovpimenta/tech-topics/contents/audio/hedged-requests.mp3?ref=audio"
  ]);

  const legacy = [];
  const fallBack = async url => {
    legacy.push(url);
    if (url.includes("/contents/audio/")) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => ({
      assets: [{ name: "wrong.mp3" }, { name: "bulkhead.mp3", state: "uploaded" }]
    }) };
  };
  assert.equal(await findAudio("bulkhead", fallBack),
    "https://github.com/joaovpimenta/tech-topics/releases/download/tts-bulkhead/bulkhead.mp3");
  assert.equal(legacy.length, 2);
  const bothMissing = async () => ({ ok: false, status: 404 });
  assert.equal(await findAudio("other-article", bothMissing), null);
  await assert.rejects(findAudio("../bad", bothMissing), /Slug/);
  await assert.rejects(findAudio("bulkhead", async () => ({ ok: false, status: 403 })), /indisponível/);
  const invalid = async url => {
    if (url.includes("/contents/audio/")) return { ok: true, json: async () => ({ type: "dir", name: "bulkhead.mp3", size: 0 }) };
    return { ok: false, status: 404 };
  };
  assert.equal(await findAudio("bulkhead", invalid), null);
});

class Element extends EventTarget {
  constructor() {
    super();
    this.hidden = true;
    this.textContent = "";
    this.value = "0";
    this.disabled = false;
    this.attrs = {};
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
    fetchAudio: async () => "https://github.com/joaovpimenta/tech-topics/releases/download/tts-bulkhead/bulkhead.mp3",
    stopDevice: () => { deviceStops++; }
  });
  assert.equal(player.snapshot().available, false);
  await player.discover();
  assert.equal(player.snapshot().available, true);
  assert.equal(nodes["#listen-recording"].hidden, false);
  await player.play();
  assert.equal(deviceStops, 1);
  assert.equal(audio.paused, false);
  assert(classes.has("recording-open"));
  assert.equal(nodes["#recording-title"].textContent, "Bulkhead: isolar falhas");
  assert.equal(mediaSession.playbackState, "playing");
  assert.equal(nodes["#recording-player"].hidden, false);
  audio.currentTime = 65;
  audio.dispatchEvent(new Event("timeupdate"));
  assert.equal(nodes["#recording-elapsed"].textContent, "1:05");
  assert.equal(nodes["#recording-duration"].textContent, "1:45");
  assert(positions.length > 0);
  nodes["#recording-skip"].click();
  assert.equal(audio.currentTime, 80);
  nodes["#recording-seek"].value = "500";
  nodes["#recording-seek"].dispatchEvent(new Event("input"));
  nodes["#recording-seek"].dispatchEvent(new Event("change"));
  assert.equal(audio.currentTime, 52.5);
  nodes["#recording-rate"].click();
  assert.equal(audio.playbackRate, 1.25);
  actions.seekforward({ seekOffset: 10 });
  assert.equal(audio.currentTime, 62.5);
  nodes["#recording-play"].click();
  assert.equal(mediaSession.playbackState, "paused");
  assert.equal(audio.paused, true);
  nodes["#recording-close"].click();
  assert.equal(nodes["#recording-player"].hidden, true);
  assert.equal(mediaSession.playbackState, "none");
  assert.equal(actions.play, null);
});
