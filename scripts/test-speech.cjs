const assert = require("node:assert/strict");
const { test } = require("node:test");
const speech = require("../speech.js");

test("unknown initialisms are spelled in Portuguese, independently of surrounding language", () => {
  const parts = speech.pronounce("Use API, SQL e APIs; api.example/API_v2.", "en-US", {});
  assert.equal(parts.map(part => part.text).join(""), "Use a pê i, ésse quê éle e a pê is; api.example/API_v2.");
  assert.equal(parts.find(part => part.text === "a pê i").lang, "pt-BR");
});

test("lexicon wins over spelling and can change the next reading without editing the article", () => {
  assert.equal(speech.pronounce("SQL", "pt-BR", {})[0].text, "ésse quê éle");
  const lexicon = { SQL: { speak: "sequel", lang: "en-US" } };
  assert.deepEqual(speech.pronounce("SQL", "pt-BR", lexicon), [
    { text: "sequel", lang: "en-US", start: 0, end: 3, replacement: true }
  ]);
});

test("expanded speech retains the original visible range", () => {
  const api = speech.pronounce("Uma API segura.", "pt-BR", {}).find(part => part.replacement);
  assert.equal(api.text, "a pê i");
  assert.deepEqual([api.start, api.end], [4, 7]);
});

test("lexicon rejects malformed pronunciation entries", () => {
  assert.throws(() => speech.validateLexicon({ API: { speak: "", lang: "pt-BR" } }), /inválida/);
  assert.throws(() => speech.validateLexicon([]), /inválido/);
});

test("mixed-case initialisms and plurals use the same fallback", () => {
  assert.equal(speech.pronounce("mTLS e gRPC", "pt-BR", {}).map(part => part.text).join(""), "ême tê éle ésse e gê érre pê cê");
});

function playerFixture() {
  const utterances = [];
  const synthesis = { getVoices: () => [], speak: utterance => utterances.push(utterance), cancel() {}, pause() {}, resume() {} };
  const blocks = [
    { segments: [{ text: "Um", lang: "pt-BR", words: [] }, { text: "two", lang: "en-US", words: [] }] },
    { segments: [{ text: "Três", lang: "pt-BR", words: [] }] }
  ];
  const player = speech.createPlayer({ blocks, synthesis, Utterance: class { constructor(text) { this.text = text; } } });
  return { player, utterances };
}

test("next skips a whole paragraph and ignores late events from canceled speech", () => {
  const { player, utterances } = playerFixture();
  player.start();
  const canceled = utterances[0];
  player.next();
  assert.equal(utterances.at(-1).text, "Três");
  canceled.onend();
  canceled.onerror({ error: "synthesis-failed" });
  assert.equal(player.snapshot().blockIndex, 1);
  assert.equal(player.snapshot().state, "speaking");
  assert.equal(utterances.length, 2);
});

test("seeking while paused stays paused and resumes at the selected paragraph", () => {
  const { player, utterances } = playerFixture();
  player.start();
  player.toggle();
  player.next();
  assert.equal(player.snapshot().state, "paused");
  assert.equal(utterances.length, 1);
  player.toggle();
  assert.equal(utterances.at(-1).text, "Três");
  player.stop();
  utterances.at(-1).onend();
  assert.equal(player.snapshot().state, "idle");
});

test("device TTS smoke: browser synthesis speaks PT-BR and English without MP3", () => {
  const utterances = [];
  const voices = [{ lang: "pt-BR", name: "Português" }, { lang: "en-US", name: "English" }];
  const synthesis = {
    getVoices: () => voices,
    speak: utterance => utterances.push(utterance),
    cancel() {}, pause() {}, resume() {}
  };
  const blocks = [{ segments: [
    { text: "O padrão", lang: "pt-BR", words: [] },
    { text: "Bulkhead", lang: "en-US", words: [] }
  ] }];
  const player = speech.createPlayer({
    blocks, synthesis,
    Utterance: class { constructor(text) { this.text = text; } }
  });
  player.start();
  assert.equal(utterances.length, 1);
  assert.equal(utterances[0].text, "O padrão");
  assert.equal(utterances[0].lang, "pt-BR");
  assert.equal(utterances[0].voice, voices[0]);
  utterances[0].onend();
  assert.equal(utterances.length, 2);
  assert.equal(utterances[1].text, "Bulkhead");
  assert.equal(utterances[1].lang, "en-US");
  assert.equal(utterances[1].voice, voices[1]);
  utterances[1].onend();
  assert.equal(player.snapshot().state, "idle");
});


test("native narration rate is adjustable through shared player without losing paragraph position", () => {
  const { player, utterances } = playerFixture();
  player.start(1);
  assert.equal(utterances.at(-1).rate, 1);
  player.setRate(1.25);
  assert.equal(player.getRate(), 1.25);
  assert.equal(player.snapshot().blockIndex, 1);
  assert.equal(utterances.at(-1).rate, 1.25);
  assert.equal(utterances.at(-1).text, "Três");
  player.toggle();
  player.setRate(1.5);
  assert.equal(player.snapshot().state, "paused");
  assert.equal(player.getRate(), 1.5);
  player.toggle();
  assert.equal(player.snapshot().state, "speaking");
});
