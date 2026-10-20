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
