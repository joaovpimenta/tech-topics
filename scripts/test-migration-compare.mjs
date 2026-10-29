import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { stringify as stringifyYaml } from "yaml";
import { articleForNarrationExtraction, baselineCoverageBlockers, baselineReplayBlockers, compareArticleStates, compareAgainstInitialBaseline, compareDomAgainstInitialBaseline, discoverArticleSources, firstAdditionDate, isArticleNavigationLink, publishedArticleSlugs, runGitText, validateDomAuditReport, validateIndependentBaseline } from "./lib/migration-compare.mjs";
import { instrumentSpeechBuildBlocks, spokenRunsSignature } from "./lib/migration-dom-signature.mjs";
import { nativeDomUnitHash } from "./lib/migration-baseline.mjs";
import { migrationDomCatalogArticles } from "./lib/migration-dom-catalog.mjs";
let compileMarkdownArticle, fromLegacyArticle;
try { ({ compileMarkdownArticle, fromLegacyArticle } = await import("./lib/markdown-article.mjs")); }
catch (error) { if (error.code !== "ERR_MODULE_NOT_FOUND") throw error; }

const sha = letter => letter.repeat(40);
test("source inventory handles historical and nested layouts without treating assets as articles", () => {
  const inventory = discoverArticleSources(["content/articles/alpha.md", "articles/beta/article.md", "articles/beta/cover.jpg"], "test");
  assert.deepEqual(inventory, [{ slug: "alpha", file: "content/articles/alpha.md", extension: "md" },
    { slug: "beta", file: "articles/beta/article.md", extension: "md" }]);
  assert.throws(() => discoverArticleSources(["content/articles/alpha.md", "articles/alpha/article.md"], "test"), /duplicate sources/);
});
const sentence = (text, blockIndex = 0, sentenceIndex = 0) => ({ text, blockIndex, sentenceIndex, tag: "p", section: false,
  pauseKind: "paragraph", pauseAfterSeconds: 0.38, runs: [{ text, lang: "pt-BR" }] });
function article(slug, text = "Texto.", changes = {}) {
  return { slug, metadata: { slug, title: "Título", dek: "Resumo", language: "pt-BR", category: "Sistemas", ...(changes.metadata ?? {}) },
    addedAt: "2026-01-01T00:00:00Z", editorialSentences: [sentence(text)],
    structure: { ids: ["inicio"], elements: [{ tag: "p", id: "inicio" }], urls: [] },
    legacyChunks: [{ chunkIndex: 0, blockIndex: 0, tag: "p", section: false, plannedPauseAfterSeconds: 0.38, splitReason: "paragraph_end", text, runs: [{ text, lang: "pt-BR" }] }],
    assets: [], ...changes, metadata: { slug, title: "Título", dek: "Resumo", language: "pt-BR", category: "Sistemas", ...(changes.metadata ?? {}) } };
}
const audit = (slug, signature = "a", { frames = [[0, 0]], spokenTexts = frames.map(() => "Texto."), spokenRuns = spokenTexts.map(text => [{ text, lang: "pt-BR" }]), chapters = "same", mountedCloneMatches = true, mountedSignature = signature } = {}) => {
  const signatures = (value) => frames.map(([blockIndex, sentenceIndex], index) => ({ blockIndex, sentenceIndex,
    spokenRunsSha256: spokenRunsSignature(spokenRuns[index]),
    sha256: createHash("sha256").update(String(Array.isArray(value) ? value[index] : `${value}-${index}`)).digest("hex") }));
  return { articles: [{ slug, domUnitSignatures: signatures(signature), mountedDomUnitSignatures: signatures(mountedSignature),
    domUnits: frames.length, chapterUnits: frames.length, chaptersSignature: chapters, indexesMatch: true, mountedCloneMatches }] };
};
const state = (...articles) => ({ articles });

test("legacy JSON and equivalent Markdown share the production renderer result", async testContext => {
  if (!compileMarkdownArticle) return testContext.skip("production compiler dependencies are unavailable in this checkout");
  const metadata = { slug: "alpha", language: "pt-BR", title: "Título", category: "Sistemas", date: "1 de janeiro de 2026",
    publishedAt: "2026-01-01", read: "5 min", image: "assets/alpha/alpha-cover.jpg", alt: "Capa", dek: "Resumo", excerpt: "Resumo curto.", tags: ["sistemas"] };
  const context = { sourcePath: "content/articles/alpha.json", knownTags: new Set(["sistemas"]), knownSlugs: new Set(["alpha"]), assetExists: () => true };
  const legacy = fromLegacyArticle({ ...metadata, bodyHtml: "<p>Texto equivalente.</p>" }, context);
  const markdown = await compileMarkdownArticle({ source: `---\n${Object.entries(metadata).map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.map(item => `\"${item}\"`).join(", ")}]` : JSON.stringify(value)}`).join("\n")}\n---\n\nTexto equivalente.\n`,
    ...context, sourcePath: "content/articles/alpha.md" });
  assert.deepEqual(markdown.metadata, legacy.metadata);
  assert.deepEqual(markdown.slots, legacy.slots);
});

test("compiled metadata is flattened for the historical Python narration extractor", () => {
  const articleState = { metadata: { slug: "alpha", title: "Título", dek: "Resumo", language: "pt-BR" },
    bodyHtml: "<p>Texto.</p>" };
  assert.deepEqual(articleForNarrationExtraction(articleState), {
    slug: "alpha", title: "Título", dek: "Resumo", language: "pt-BR", bodyHtml: "<p>Texto.</p>"
  });
});

test("internal reader-page links are not mistaken for article assets", () => {
  assert.equal(isArticleNavigationLink({ tag: "a", attribute: "href", value: "article.html?slug=alpha" }), true);
  assert.equal(isArticleNavigationLink({ tag: "a", attribute: "href", value: "../index.html#latest" }), true);
  assert.equal(isArticleNavigationLink({ tag: "a", attribute: "href", value: "downloads/guide.pdf" }), false);
  assert.equal(isArticleNavigationLink({ tag: "img", attribute: "src", value: "article.html" }), false);
});

test("migration DOM audit accepts legacy and html-v1 article catalogs", () => {
  const articles = [{ slug: "alpha" }];
  assert.deepEqual(migrationDomCatalogArticles(articles), articles);
  assert.deepEqual(migrationDomCatalogArticles({ version: 1, transport: "html-v1", articles }), articles);
  assert.throws(() => migrationDomCatalogArticles({ articles: null }), /article catalog has no articles array/);
});

test("non-narratable metadata and equivalent JSON-to-Markdown renderings yield empty event arrays", () => {
  const before = state(article("alpha"));
  const after = state(article("alpha", "Texto.", { metadata: { category: "Nova categoria", read: "8 min" } }));
  assert.deepEqual(compareArticleStates(before, after, { domBefore: audit("alpha"), domAfter: audit("alpha") }), {
    narration: [], framing: [], selection: [], blockers: []
  });
});

test("a narratable change selects only its slug and reports its first divergence", () => {
  const oldAlpha = article("alpha", "Primeira.");
  oldAlpha.editorialSentences = [sentence("Primeira.", 0, 0), sentence("Segunda.", 0, 1)];
  const newAlpha = article("alpha", "Atualizada.");
  newAlpha.editorialSentences = [sentence("Atualizada.", 0, 0), sentence("Segunda.", 0, 1)];
  const before = state(oldAlpha, article("beta"));
  const after = state(newAlpha, article("beta"));
  const frames = [[0, 0], [0, 1]];
  const result = compareArticleStates(before, after, {
    domBefore: { articles: [...audit("alpha", ["old-unit", "stable-unit"], { frames, spokenTexts: ["Primeira.", "Segunda."] }).articles, ...audit("beta", "stable").articles] },
    domAfter: { articles: [...audit("alpha", ["new-unit", "stable-unit"], { frames, spokenTexts: ["Atualizada.", "Segunda."] }).articles, ...audit("beta", "stable").articles] }
  });
  assert.deepEqual(result.selection, ["alpha"]);
  assert.equal(result.narration[0].firstDivergence.path, "sentences[0].runs[0].text");
  assert.deepEqual(result.blockers, []);
});

test("narration changes map by spoken text when Python and DOM frame indices differ", () => {
  const beforeArticle = article("alpha", "Original.");
  beforeArticle.editorialSentences = [sentence("Original.", 16, 0)];
  const afterArticle = article("alpha", "Atualizada.");
  afterArticle.editorialSentences = [sentence("Atualizada.", 16, 0)];
  const result = compareArticleStates(state(beforeArticle), state(afterArticle), {
    domBefore: audit("alpha", "old-unit", { frames: [[17, 0]], spokenTexts: ["Original."] }),
    domAfter: audit("alpha", "new-unit", { frames: [[17, 0]], spokenTexts: ["Atualizada."] })
  });
  assert.deepEqual(result.selection, ["alpha"]);
  assert.deepEqual(result.blockers, []);
});

test("source sentences fail closed when their spoken runs do not match DOM units", () => {
  const result = compareArticleStates(state(article("alpha", "Texto.")), state(article("alpha", "Atualizado.")), {
    domBefore: audit("alpha", "old-unit", { spokenTexts: ["Outro texto."] }),
    domAfter: audit("alpha", "new-unit", { spokenTexts: ["Atualizado."] })
  });
  assert.deepEqual(result.selection, []);
  assert.ok(result.blockers.some(blocker => blocker.kind === "dom-chapters" && /cannot be mapped/.test(blocker.reason)));
});

test("production DOM segment limits preserve spaces in Python-to-DOM run signatures", async () => {
  const speechSource = await readFile(new URL("../speech.js", import.meta.url), "utf8");
  const module = { exports: {} };
  runInNewContext(instrumentSpeechBuildBlocks(speechSource), { module, exports: module.exports, globalThis: {} });
  const fakeDocument = {
    createDocumentFragment: () => ({ append() {} }),
    createTextNode: nodeValue => ({ nodeType: 3, nodeValue }),
    createElement: () => ({ nodeType: 1, className: "", textContent: "" })
  };
  const text = "palavra ".repeat(45) + "fim.";
  const textNode = { nodeType: 3, nodeValue: text, ownerDocument: fakeDocument, replaceWith() {} };
  const root = {
    nodeType: 1, childNodes: [textNode], matches: selector => selector.startsWith("h1,h2,h3,h4,p"),
    getAttribute: () => null, closest: () => ({ lang: "pt-BR" })
  };
  const [unit] = module.exports.buildBlocks([root]);
  assert.ok(unit.segments.length > 1, "fixture must exercise the production 240-character segment split");
  assert.equal(unit.segments[1].separatorBefore, true);
  const sourceSignature = spokenRunsSignature([{ text, lang: "pt-BR" }]);
  assert.equal(spokenRunsSignature(unit.segments), sourceSignature);
  const dom = audit("alpha", "long-sentence", { spokenRuns: [unit.segments] });
  const articleState = state(article("alpha", text));
  const result = compareArticleStates(articleState, articleState, { domBefore: dom, domAfter: dom });
  assert.deepEqual(result.blockers, []);
});

test("canonical speech mapping preserves words, word languages, punctuation and observed spaces across DOM runs", async () => {
  const speechSource = await readFile(new URL("../speech.js", import.meta.url), "utf8");
  const module = { exports: {} };
  runInNewContext(instrumentSpeechBuildBlocks(speechSource), { module, exports: module.exports, globalThis: {} });
  const fakeDocument = {
    createDocumentFragment: () => ({ append() {} }),
    createTextNode: nodeValue => ({ nodeType: 3, nodeValue, ownerDocument: fakeDocument, replaceWith() {} }),
    createElement: () => ({ nodeType: 1, className: "", textContent: "" })
  };
  function domRuns(ptText, { ptLanguage = "pt-BR", english = "Bulkhead" } = {}) {
    const text = value => ({ nodeType: 3, nodeValue: value, ownerDocument: fakeDocument, replaceWith() {} });
    const span = (lang, value) => ({ nodeType: 1, childNodes: [text(value)], matches: () => false,
      getAttribute: name => name === "lang" ? lang : null });
    const root = { nodeType: 1, childNodes: [span("en-US", english), span(ptLanguage, ptText)],
      matches: selector => selector.startsWith("h1,h2,h3,h4,p"), getAttribute: () => null,
      closest: () => ({ lang: "pt-BR" }) };
    return module.exports.buildBlocks([root])[0].segments;
  }
  const source = [{ lang: "en-us", text: "Bulkhead" }, { lang: "pt-br", text: ": isolar" }];
  const withObservedSpace = domRuns(": isolar");
  assert.equal(withObservedSpace.length, 2);
  assert.equal(withObservedSpace[1].separatorBefore, true,
    "the space from the real pt-BR text node must be recorded before the language boundary trims it");
  assert.equal(spokenRunsSignature(source), spokenRunsSignature(withObservedSpace),
    "case-insensitive language tags and punctuation moved to the adjacent run preserve the exact token sequence");

  const nodeIds = new Map();
  const nativeSegments = withObservedSpace.map(segment => ({ text: segment.text, lang: segment.lang,
    separatorBefore: segment.separatorBefore,
    words: segment.words.map(word => ({ start: word.start, end: word.end, nodeIds: word.nodes.map(node => {
      if (!nodeIds.has(node)) nodeIds.set(node, String(nodeIds.size + 1));
      return nodeIds.get(node);
    }) })) }));
  const nativeUnit = { blockIndex: 0, sentenceIndex: 0, segments: nativeSegments };
  const withoutAuditMetadata = { ...nativeUnit, segments: nativeSegments.map(({ separatorBefore: _separatorBefore, ...segment }) => segment) };
  assert.equal(nativeDomUnitHash(nativeUnit), nativeDomUnitHash(withoutAuditMetadata),
    "audit-only provenance metadata is excluded from the native DOM signature");

  const withoutObservedSpace = domRuns(":isolar");
  assert.equal(withoutObservedSpace[1].separatorBefore, false);
  assert.equal(spokenRunsSignature(source), spokenRunsSignature(withoutObservedSpace),
    "whitespace-only differences are neutral once lexical and punctuation tokens match");
  assert.equal(spokenRunsSignature(source), spokenRunsSignature([{ lang: "en-us", text: "Bulkhead" }, { lang: "pt-br", text: ":  \tisolar" }]),
    "whitespace kind and amount are ignored while preserving the same word boundaries");
  const separatedAcrossRuns = [{ lang: "en-US", text: "New" }, { lang: "en-US", text: "York", separatorBefore: true }];
  const joinedAcrossRuns = [{ lang: "en-US", text: "New" }, { lang: "en-US", text: "York" }];
  assert.notEqual(spokenRunsSignature(separatedAcrossRuns), spokenRunsSignature(joinedAcrossRuns),
    "New York remains different from NewYork even when the word boundary crosses DOM runs");
  assert.equal(spokenRunsSignature([{ lang: "en-US", text: "New" }, { lang: "en-us", text: "York" }]),
    spokenRunsSignature([{ lang: "en-us", text: "NewYork" }]),
    "a same-language word may continue across adjacent runs when no whitespace was observed");
  assert.notEqual(spokenRunsSignature([{ lang: "en-US", text: "New" }, { lang: "pt-BR", text: "York" }]),
    spokenRunsSignature([{ lang: "en-US", text: "NewYork" }]),
    "a word crossing a language boundary retains the language of each part");
  assert.equal(spokenRunsSignature([{ lang: "en-US", text: "New\t" }, { lang: "en-us", text: "\nYork" }]),
    spokenRunsSignature([{ lang: "en-us", text: "New York" }]),
    "tabs and newlines delimit the same lexical words while remaining whitespace-neutral");
  assert.equal(spokenRunsSignature([{ lang: "en-us", text: "Bulkhead" }, { lang: "pt-br", text: ": isolar" }]),
    spokenRunsSignature([{ lang: "en-US", text: "Bulkhead:" }, { lang: "pt-BR", text: " isolar" }]),
    "moving exact punctuation ownership between adjacent languages preserves word languages and punctuation order");
  assert.notEqual(spokenRunsSignature([{ lang: "pt-BR", text: "café" }]),
    spokenRunsSignature([{ lang: "pt-BR", text: "cafe\u0301" }]),
    "NFC and NFD spellings remain distinct code-point sequences");
  assert.notEqual(spokenRunsSignature(source), spokenRunsSignature([{ ...source[0] }, { lang: "pt-br", text: "; isolar" }]),
    "punctuation changes remain visible");
  assert.notEqual(spokenRunsSignature([{ lang: "pt-br", text: "A, B." }]),
    spokenRunsSignature([{ lang: "pt-br", text: "A. B," }]), "punctuation order remains visible");
  assert.notEqual(spokenRunsSignature(source), spokenRunsSignature([{ ...source[0], text: "Bulkheds" }, source[1]]),
    "lexical changes remain visible");
  assert.notEqual(spokenRunsSignature(source), spokenRunsSignature([{ ...source[0] }, { lang: "es-MX", text: ": isolar" }]),
    "word-language changes remain visible");
  assert.equal(spokenRunsSignature([{ lang: "en-us", text: "Bulkhead" }, { lang: "pt-br", text: ":  isolar" }]),
    spokenRunsSignature(source), "repeated whitespace is neutral without changing lexical token boundaries");
});

test("a narration edit does not hide a DOM signature regression in an unchanged sentence", () => {
  const oldAlpha = article("alpha", "Primeira.");
  oldAlpha.editorialSentences = [sentence("Primeira.", 0, 0), sentence("Segunda.", 0, 1)];
  const newAlpha = article("alpha", "Atualizada.");
  newAlpha.editorialSentences = [sentence("Atualizada.", 0, 0), sentence("Segunda.", 0, 1)];
  const frames = [[0, 0], [0, 1]];
  const result = compareArticleStates(state(oldAlpha), state(newAlpha), {
    domBefore: audit("alpha", ["old-unit", "stable-unit"], { frames, spokenTexts: ["Primeira.", "Segunda."] }),
    domAfter: audit("alpha", ["new-unit", "regressed-unit"], { frames, spokenTexts: ["Atualizada.", "Segunda."] })
  });
  assert.deepEqual(result.selection, []);
  assert.ok(result.blockers.some(blocker => blocker.kind === "dom-chapters" && /without narrated source change/.test(blocker.reason)));
});

test("a spoken title change permits only the heading DOM unit to change", () => {
  const before = article("alpha");
  const after = article("alpha", "Texto.", { metadata: { title: "Título narrado atualizado" } });
  const frames = [[0, 0], [1, 0], [2, 0]];
  before.editorialSentences = [sentence("Título", 0, 0), sentence("Resumo", 1, 0), sentence("Texto.", 2, 0)];
  after.editorialSentences = [sentence("Título narrado atualizado", 0, 0), sentence("Resumo", 1, 0), sentence("Texto.", 2, 0)];
  const result = compareArticleStates(state(before), state(after), {
    domBefore: audit("alpha", ["old-heading", "stable-dek", "stable-body"], { frames, spokenTexts: ["Título", "Resumo", "Texto."] }),
    domAfter: audit("alpha", ["new-heading", "stable-dek", "stable-body"], { frames, spokenTexts: ["Título narrado atualizado", "Resumo", "Texto."] })
  });
  assert.deepEqual(result.selection, ["alpha"]);
  assert.deepEqual(result.blockers, []);
});

test("a visible title edit with an unchanged speech alias permits only its mapped heading unit", () => {
  const before = article("alpha", "Texto.", { metadata: { title: "Título", speechMarkup: { title: [{ lang: "pt-BR", text: "Título", speak: "Título narrado" }] } } });
  const after = article("alpha", "Texto.", { metadata: { title: "Rótulo", speechMarkup: { title: [{ lang: "pt-BR", text: "Rótulo", speak: "Título narrado" }] } } });
  before.editorialSentences = [{ ...sentence("Título narrado", 0, 0), tag: "title" }, { ...sentence("Resumo", 1, 0), tag: "dek" }, sentence("Texto.", 2, 0)];
  after.editorialSentences = [{ ...sentence("Título narrado", 0, 0), tag: "title" }, { ...sentence("Resumo", 1, 0), tag: "dek" }, sentence("Texto.", 2, 0)];
  const frames = [[17, 0], [18, 0], [19, 0]];
  const result = compareArticleStates(state(before), state(after), {
    domBefore: audit("alpha", ["old-heading", "stable-dek", "stable-body"], { frames, spokenTexts: ["Título narrado", "Resumo", "Texto."] }),
    domAfter: audit("alpha", ["new-heading", "stable-dek", "stable-body"], { frames, spokenTexts: ["Título narrado", "Resumo", "Texto."] })
  });
  assert.deepEqual(result.selection, ["alpha"]);
  assert.deepEqual(result.blockers, []);
});

test("a title speech-markup edit cannot hide a dek DOM regression", () => {
  const before = article("alpha");
  before.metadata.speechMarkup = { title: [{ lang: "pt-BR", text: "Título", speak: "Título antigo" }] };
  before.editorialSentences = [sentence("Título antigo", 0, 0), sentence("Resumo", 1, 0), sentence("Texto.", 2, 0)];
  const after = article("alpha");
  after.metadata.speechMarkup = { title: [{ lang: "pt-BR", text: "Título", speak: "Título novo" }] };
  after.editorialSentences = [sentence("Título novo", 0, 0), sentence("Resumo", 1, 0), sentence("Texto.", 2, 0)];
  const frames = [[0, 0], [1, 0], [2, 0]];
  const result = compareArticleStates(state(before), state(after), {
    domBefore: audit("alpha", ["old-heading", "stable-dek", "stable-body"], { frames, spokenTexts: ["Título antigo", "Resumo", "Texto."] }),
    domAfter: audit("alpha", ["new-heading", "regressed-dek", "stable-body"], { frames, spokenTexts: ["Título novo", "Resumo", "Texto."] })
  });
  assert.deepEqual(result.selection, []);
  assert.ok(result.blockers.some(blocker => blocker.kind === "dom-chapters" && /without narrated source change/.test(blocker.reason)));
});

test("an unexplained native DOM signature change blocks even when the player matches its clone", () => {
  const result = compareArticleStates(state(article("alpha")), state(article("alpha")), {
    domBefore: audit("alpha", "original"), domAfter: audit("alpha", "regressed")
  });
  assert.ok(result.blockers.some(blocker => blocker.kind === "dom-chapters" && /without narrated source change/.test(blocker.reason)));
});

test("language and spoken aliases remain narratable differences", () => {
  const before = article("alpha", "Bulkhead", { structure: { ids: ["inicio"], elements: [{ tag: "p", id: "inicio", lang: "en-US", ttsSay: "bulkhead", ttsMode: "normal" }], urls: [] } });
  const after = article("alpha", "Bulkhead", { structure: { ids: ["inicio"], elements: [{ tag: "p", id: "inicio", lang: "pt-BR", ttsSay: "Bulkhead", ttsMode: "spell" }], urls: [] } });
  before.editorialSentences = [{ ...sentence("Bulkhead"), runs: [{ text: "Bulkhead", lang: "en-US" }] }];
  after.editorialSentences = [{ ...sentence("Bulkhead"), runs: [{ text: "Bulkhead", lang: "pt-BR" }] }];
  const spokenRuns = [[{ text: "Bulkhead", lang: "en-US" }]];
  const spokenRunsAfter = [[{ text: "Bulkhead", lang: "pt-BR" }]];
  const result = compareArticleStates(state(before), state(after), {
    domBefore: audit("alpha", "old-language", { spokenTexts: ["Bulkhead"], spokenRuns }),
    domAfter: audit("alpha", "new-language", { spokenTexts: ["Bulkhead"], spokenRuns: spokenRunsAfter })
  });
  assert.deepEqual(result.selection, ["alpha"]);
  assert.equal(result.blockers.length, 0);
  assert.equal(result.narration.length, 1);
});

test("same words with changed block boundaries block the migration", () => {
  const before = state(article("alpha", "Uma frase. Outra."));
  const changed = article("alpha", "Uma frase. Outra.");
  changed.editorialSentences = [sentence("Uma frase.", 0), sentence("Outra.", 1)];
  changed.structure = { ids: ["um", "dois"], elements: [{ tag: "p", id: "um" }, { tag: "p", id: "dois" }], urls: [] };
  const result = compareArticleStates(before, state(changed), { domBefore: audit("alpha"), domAfter: audit("alpha") });
  assert.deepEqual(result.selection, []);
  assert.ok(result.blockers.some(item => item.kind === "framing"));
  assert.equal(result.framing[0].firstDivergence.path, "sentenceFrames[1]");
});

test("DOM and chapters are compared independently and a first divergence blocks", () => {
  const result = compareArticleStates(state(article("alpha")), state(article("alpha")), {
    domBefore: audit("alpha"), domAfter: audit("alpha", "a", { chapters: "changed" })
  });
  assert.equal(result.blockers[0].kind, "dom-chapters");
  assert.equal(result.blockers[0].firstDivergence.path, "chapters");
});

test("global missing audit evidence and duplicate DOM records suppress the TTS selection", () => {
  const changed = article("alpha", "Texto atualizado.");
  assert.deepEqual(compareArticleStates(state(article("alpha")), state(changed)).selection, []);
  const duplicate = { articles: [...audit("alpha").articles, ...audit("alpha").articles] };
  const result = compareArticleStates(state(article("alpha")), state(changed), { domBefore: duplicate, domAfter: audit("alpha") });
  assert.deepEqual(result.selection, []);
  assert.ok(result.blockers.some(blocker => blocker.reason === "DOM/chapter audit contains duplicate article records"));
});

test("the original mounted player must agree with its DOM reconstruction", () => {
  const afterAudit = audit("alpha", "same", { mountedCloneMatches: false, mountedSignature: "different" });
  const result = compareArticleStates(state(article("alpha")), state(article("alpha")), {
    domBefore: audit("alpha"), domAfter: afterAudit
  });
  assert.ok(result.blockers.some(blocker => blocker.kind === "dom-chapters" && /mounted player/.test(blocker.reason)));
});

test("DOM and chapter signatures are also checked against their independent baseline", () => {
  const initial = audit("alpha");
  const changed = { articles: [{ ...initial.articles[0], domUnitSignatures: [{ blockIndex: 0, sentenceIndex: 0, sha256: "changed" }] }] };
  const drift = compareDomAgainstInitialBaseline(changed, initial);
  assert.equal(drift[0].firstDivergence.path, "domUnitSignatures[0].sha256");
});

test("additions, deletions, changed history and unavailable DOM evidence fail closed", () => {
  const before = state(article("alpha"), article("gone"));
  const removed = article("alpha");
  removed.addedAt = "2026-02-01T00:00:00Z";
  const result = compareArticleStates(before, state(removed, article("new")), { domBefore: audit("alpha"), domAfter: audit("alpha") });
  assert.deepEqual(result.blockers.map(item => item.kind), ["history", "removed", "added"]);
  const noDom = compareArticleStates(state(article("alpha")), state(article("alpha")));
  assert.equal(noDom.blockers[0].kind, "dom-chapters");
});

test("an explicitly authorized removal passes pairwise and independent source/DOM inventory checks", () => {
  const before = state(article("alpha"), article("gone"));
  const after = state(article("alpha"));
  const hash = value => createHash("sha256").update(value).digest("hex");
  const baselineArticle = source => ({
    ...source,
    source: `content/articles/${source.slug}.json`,
    sourceBlob: sha("b"),
    editorialSentences: source.editorialSentences.map(sentence => ({
      ...sentence,
      textSha256: hash(sentence.text.normalize("NFC").trim()),
      punctuationSha256: hash((sentence.text.match(/[\p{P}\p{S}]+/gu) ?? []).join("")),
      runs: sentence.runs.map(run => ({ lang: run.lang, textSha256: hash(run.text.normalize("NFC")) }))
    })),
    legacyChunks: source.legacyChunks.map(chunk => ({
      ...chunk,
      textSha256: hash(chunk.text),
      runs: chunk.runs.map(run => ({ lang: run.lang, textSha256: hash(run.text) }))
    }))
  });
  const sourceBaseline = { articles: before.articles.map(baselineArticle) };
  const domBaseline = { articles: [...audit("alpha").articles, ...audit("gone").articles] };
  const domBefore = domBaseline;
  const domAfter = audit("alpha");
  const authorizedRemovals = ["gone"];

  const pairwise = compareArticleStates(before, after, {
    authorizedRemovals,
    domBefore,
    domAfter
  });
  assert.deepEqual(pairwise, { narration: [], framing: [], selection: [], blockers: [] });

  const baselineDrift = {
    before: compareAgainstInitialBaseline(before, sourceBaseline),
    after: compareAgainstInitialBaseline(after, sourceBaseline, { authorizedRemovals })
  };
  const domBaselineDrift = {
    before: compareDomAgainstInitialBaseline(domBefore, domBaseline),
    after: compareDomAgainstInitialBaseline(domAfter, domBaseline, { authorizedRemovals })
  };
  assert.deepEqual(baselineDrift, { before: [], after: [] });
  assert.deepEqual(domBaselineDrift, { before: [], after: [] });
  assert.deepEqual(baselineCoverageBlockers({ baselineDrift, domBaselineDrift }), []);
  assert.equal(compareAgainstInitialBaseline(after, sourceBaseline).some(item => item.kind === "missing-from-current-baseline"), true,
    "a removal remains blocked without the explicit authorization");
});

test("publication order changes are visible even when article content is unchanged", () => {
  const beforeArticle = { ...article("alpha"), order: 1 };
  const afterArticle = { ...article("alpha"), order: 2 };
  const result = compareArticleStates(state(beforeArticle), state(afterArticle), { domBefore: audit("alpha"), domAfter: audit("alpha") });
  assert.ok(result.blockers.some(item => item.reason === "publication order changed"));
  assert.deepEqual(result.narration, []);
});

test("baseline rejects absent, zero, unavailable and duplicate records", () => {
  assert.throws(() => validateIndependentBaseline(null), /baseline\.sha/);
  assert.throws(() => validateIndependentBaseline({ sha: sha("0") }), /non-zero/);
  assert.throws(() => validateIndependentBaseline({ sha: sha("a"), articles: [], sourceCount: 0, capture: { sourceTools: [], captureTools: [] } }), /non-empty/);
  const sourceArticle = { ...article("alpha"), source: "content/articles/alpha.json", sourceBlob: sha("b") };
  assert.throws(() => validateIndependentBaseline({ schemaVersion: 3, sha: sha("a"), articles: [article("alpha")], sourceCount: 1,
    capture: { sourceTools: [{ path: "x", sha256: "x" }], captureTools: [{ path: "y", sha256: "y" }] } }), /source path and Git blob SHA/);
  const valid = { schemaVersion: 3, sha: sha("a"), articles: [sourceArticle, sourceArticle], sourceCount: 2, capture: { sourceTools: [{ path: "x", sha256: "x" }], captureTools: [{ path: "y", sha256: "y" }] } };
  assert.throws(() => validateIndependentBaseline(valid), /duplicate/);
});

test("DOM audit evidence must bind its records to the verified source artifact", () => {
  const report = { schemaVersion: 3, baselineSourceSha: sha("a"), sourceSha: sha("b"), buildId: "c".repeat(64),
    artifactFileCount: 72, distIdentityVerified: true, articleCount: 1, articles: audit("alpha").articles };
  assert.equal(validateDomAuditReport(report, { expectedSourceSha: sha("b"), baselineSha: sha("a") }), report);
  assert.throws(() => validateDomAuditReport({ ...report, sourceSha: sha("d") }, {
    expectedSourceSha: sha("b"), baselineSha: sha("a")
  }), /prove that its HTML artifact matches/);
  assert.throws(() => validateDomAuditReport({ ...report, distIdentityVerified: false }, {
    expectedSourceSha: sha("b"), baselineSha: sha("a")
  }), /prove that its HTML artifact matches/);
  assert.throws(() => validateDomAuditReport({ ...report, baselineSourceSha: sha("e") }, {
    expectedSourceSha: sha("b"), baselineSha: sha("a")
  }), /independent source baseline/);
});

test("initial independent baseline drift is exposed even when both current sides match", () => {
  const originalSentence = { ...sentence("Original."), textSha256: "wrong", punctuationSha256: "wrong", runs: [{ lang: "pt-BR", textSha256: "wrong" }] };
  const baseline = { sha: sha("a"), articles: [{ slug: "alpha", source: "content/articles/alpha.json", sourceBlob: sha("b"), metadata: { title: "Título", dek: "Resumo", language: "pt-BR" }, addedAt: "2026-01-01T00:00:00Z", order: 1,
    structure: { ids: ["inicio"], elements: [{ tag: "p", id: "inicio" }], urls: [] }, assets: [], editorialSentences: [originalSentence],
    legacyChunks: [{ chunkIndex: 0, blockIndex: 0, tag: "p", section: false, plannedPauseAfterSeconds: 0.38, splitReason: "paragraph_end", textSha256: "wrong", runs: [{ lang: "pt-BR", textSha256: "wrong" }] }] }] };
  const currentArticle = { ...article("alpha", "Current."), source: "content/articles/alpha.json", sourceBlob: sha("b"), order: 1 };
  const before = { sha: sha("c"), articles: [currentArticle] };
  const result = compareAgainstInitialBaseline(before, baseline);
  assert.equal(result.length, 1);
  assert.equal(result[0].firstDivergence.path, "editorialSentences[0].punctuationSha256");
  const domBaseline = audit("alpha", "original-dom");
  const domDrift = compareDomAgainstInitialBaseline(audit("alpha", "regressed-dom"), domBaseline);
  const replayBlockers = baselineReplayBlockers({ baseline, before,
    baselineDrift: { before: result }, domBaselineDrift: { before: domDrift } });
  assert.deepEqual(replayBlockers.map(blocker => blocker.kind), ["source-baseline-replay", "dom-baseline-replay"]);
  const after = { sha: sha("d"), articles: [{ ...currentArticle, sourceBlob: sha("b") }] };
  const afterReplayBlockers = baselineReplayBlockers({ baseline, before: { sha: sha("c"), articles: [currentArticle] }, after,
    baselineDrift: { before: [], after: result }, domBaselineDrift: { before: [], after: domDrift } });
  assert.deepEqual(afterReplayBlockers.map(blocker => blocker.side), ["after", "after"]);
  const editedSource = { ...before, sha: sha("d"), articles: [{ ...currentArticle, sourceBlob: sha("e") }] };
  assert.deepEqual(baselineReplayBlockers({ baseline, before: editedSource,
    baselineDrift: { before: result }, domBaselineDrift: { before: domDrift } }), []);
});

test("baseline coverage drift blocks slugs omitted from both commits and unplanned additions", () => {
  const currentArticle = { ...article("alpha"), order: 1 };
  const baseline = { articles: [
    { slug: "alpha", metadata: currentArticle.metadata, addedAt: currentArticle.addedAt, order: 1,
      editorialSentences: [], legacyChunks: [], structure: currentArticle.structure, assets: [] },
    { slug: "omitted-from-both" }
  ] };
  const baselineAudit = { articles: [...audit("alpha").articles, { slug: "omitted-from-both" }] };
  const current = state(currentArticle);
  const currentAudit = audit("alpha");
  const baselineDrift = {
    before: compareAgainstInitialBaseline(current, baseline),
    after: compareAgainstInitialBaseline(current, baseline)
  };
  const domBaselineDrift = {
    before: compareDomAgainstInitialBaseline(currentAudit, baselineAudit),
    after: compareDomAgainstInitialBaseline(currentAudit, baselineAudit)
  };
  assert.deepEqual(baselineDrift.before.filter(({ kind }) => kind === "missing-from-current-baseline"), [
    { slug: "omitted-from-both", kind: "missing-from-current-baseline" }
  ]);
  assert.deepEqual(baselineDrift.after.filter(({ kind }) => kind === "missing-from-current-baseline"), [
    { slug: "omitted-from-both", kind: "missing-from-current-baseline" }
  ]);
  assert.deepEqual(domBaselineDrift.before.filter(({ kind }) => kind === "missing-from-current-dom-baseline"), [
    { slug: "omitted-from-both", kind: "missing-from-current-dom-baseline" }
  ]);
  assert.deepEqual(domBaselineDrift.after.filter(({ kind }) => kind === "missing-from-current-dom-baseline"), [
    { slug: "omitted-from-both", kind: "missing-from-current-dom-baseline" }
  ]);
  const blockers = baselineCoverageBlockers({ baselineDrift, domBaselineDrift });
  assert.deepEqual(blockers.map(({ slug, kind, side }) => ({ slug, kind, side })), [
    { slug: "omitted-from-both", kind: "baseline-coverage", side: "before" },
    { slug: "omitted-from-both", kind: "baseline-coverage", side: "after" },
    { slug: "omitted-from-both", kind: "dom-baseline-coverage", side: "before" },
    { slug: "omitted-from-both", kind: "dom-baseline-coverage", side: "after" }
  ]);

  const withUnplannedSlug = state(currentArticle, article("unplanned"));
  const unplannedDrift = compareAgainstInitialBaseline(withUnplannedSlug, baseline);
  assert.ok(unplannedDrift.some(({ slug, kind }) => slug === "unplanned" && kind === "missing-in-initial-baseline"));
  assert.ok(baselineCoverageBlockers({ baselineDrift: { before: unplannedDrift }, domBaselineDrift: [] })
    .some(({ slug, kind }) => slug === "unplanned" && kind === "baseline-coverage"));
});

test("real temporary Git commits preserve first addition across mixed sources and delete-add", async () => {
  const repo = await mkdtemp(path.join(process.cwd(), ".tmp-migration-compare-git-"));
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  const commit = message => { git("add", "-A"); git("commit", "-m", message); return git("rev-parse", "HEAD"); };
  try {
    git("init", "-q"); git("config", "user.email", "test@example.com"); git("config", "user.name", "Migration Test");
    await mkdir(path.join(repo, "content/articles"), { recursive: true });
    const originalJson = "{}\n\n";
    await writeFile(path.join(repo, "content/articles/alpha.json"), originalJson);
    const firstCommit = commit("add JSON");
    assert.equal(runGitText(repo, "show", firstCommit + ":content/articles/alpha.json"), originalJson);
    const firstDate = git("log", "--reverse", "--diff-filter=A", "--format=%cI", firstCommit, "--", "content/articles/alpha.json", "content/articles/alpha.md");
    assert.equal(firstAdditionDate(firstDate, "alpha"), firstDate);
    await rm(path.join(repo, "content/articles/alpha.json"));
    await writeFile(path.join(repo, "content/articles/alpha.md"), "---\nslug: alpha\n---\n");
    const secondCommit = commit("convert to Markdown");
    const secondInventory = discoverArticleSources(git("ls-tree", "-r", "--name-only", secondCommit).split(/\r?\n/), secondCommit);
    assert.deepEqual(secondInventory, [{ slug: "alpha", file: "content/articles/alpha.md", extension: "md" }]);
    assert.deepEqual(publishedArticleSlugs(git("ls-tree", "-r", "--name-only", secondCommit).split(/\r?\n/), secondCommit), ["alpha"]);
    assert.equal(firstAdditionDate(git("log", "--reverse", "--diff-filter=A", secondCommit, "--format=%cI", "--", "content/articles/alpha.json", "content/articles/alpha.md"), "alpha"), firstDate);
    await rm(path.join(repo, "content/articles/alpha.md"));
    await writeFile(path.join(repo, "content/articles/alpha.json"), "{}\n");
    const thirdCommit = commit("delete and add same slug");
    assert.equal(firstAdditionDate(git("log", "--reverse", "--diff-filter=A", thirdCommit, "--format=%cI", "--", "content/articles/alpha.json", "content/articles/alpha.md"), "alpha"), firstDate);
    assert.throws(() => discoverArticleSources(["content/articles/alpha.json", "content/articles/alpha.md"], thirdCommit), /duplicate sources/);
    await rm(path.join(repo, "content/articles/alpha.json"));
    await writeFile(path.join(repo, "content/articles/beta.json"), "{}\n");
    const renamedCommit = commit("rename article to a different slug");
    const renameBlock = compareArticleStates(state(article("alpha")), state(article("beta")), { domBefore: audit("alpha"), domAfter: audit("beta") });
    assert.ok(renameBlock.blockers.some(item => item.kind === "removed"));
    assert.ok(renameBlock.blockers.some(item => item.kind === "added"));
    assert.deepEqual(discoverArticleSources(git("ls-tree", "-r", "--name-only", renamedCommit).split(/\r?\n/), renamedCommit), [{ slug: "beta", file: "content/articles/beta.json", extension: "json" }]);
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test("real Git commits preserve the full corpus across an equivalent mixed-source state", async testContext => {
  if (!compileMarkdownArticle) return testContext.skip("production compiler dependencies are unavailable in this checkout");
  const root = process.cwd();
  const repo = await mkdtemp(path.join(root, ".tmp-migration-full-corpus-git-"));
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }).trim();
  const commit = message => { git("add", "-A"); git("commit", "-m", message); return git("rev-parse", "HEAD"); };
  const rootGit = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }).toString().trim();
  const python = process.env.TECH_TOPICS_PYTHON || (process.platform === "win32" ? "python" : "python3");
  try {
    git("init", "-q"); git("config", "user.email", "test@example.com"); git("config", "user.name", "Migration Test");
    // The fixture represents the independently captured legacy corpus, even
    // after the current checkout has converted some or all sources to Markdown.
    const baseline = JSON.parse(await readFile(path.join(root, "docs/migrations/baselines/capture-v3/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json"), "utf8"));
    const baselineSha = baseline.sha;
    const committedPaths = rootGit("ls-tree", "-r", "--name-only", baselineSha).split(/\r?\n/).filter(Boolean);
    const sourcePaths = committedPaths.filter(file => /^content\/articles\/[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(file)
      && !["content/articles/index.json", "content/articles/catalog.json"].includes(file));
    assert.equal(sourcePaths.length, baseline.sourceCount, "fixture must start with the complete independently captured corpus");
    const assetPaths = new Set(committedPaths.filter(file => file.startsWith("assets/")));
    const articleDir = path.join(repo, "content/articles");
    await mkdir(articleDir, { recursive: true });
    const markdownSlug = "quoruns-de-leitura-e-escrita";
    for (const file of sourcePaths) {
      const destination = path.join(repo, ...file.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, rootGit("show", `${baselineSha}:${file}`));
    }
    const jsonCommit = commit("add complete legacy corpus");

    for (const file of sourcePaths) {
      const source = JSON.parse(git("show", `${jsonCommit}:${file}`));
      const { bodyHtml, ...metadata } = source;
      const slug = path.basename(file, ".json");
      if (slug !== markdownSlug) continue;
      const opening = bodyHtml.match(/^\s*<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/i);
      assert.ok(opening, `${slug}: legacy article must begin with its opening prose paragraph`);
      const rewriteSourceAsset = value => value.startsWith("assets/") ? `../../${value}` : value;
      const rewriteSrcset = value => value.split(",").map(candidate => candidate.trim()
        .replace(/^(\S+)/, (_, url) => rewriteSourceAsset(url))).join(", ");
      const markdownRemainder = bodyHtml.slice(opening[0].length).trim()
        .replace(/\b(href|src)=(['"])(.*?)\2/gi, (_match, attribute, quote, value) => `${attribute}=${quote}${rewriteSourceAsset(value)}${quote}`)
        .replace(/\bsrcset=(['"])(.*?)\1/gi, (_match, quote, value) => `srcset=${quote}${rewriteSrcset(value)}${quote}`);
      const markdownBody = `${opening[1]}\n\n${markdownRemainder}`;
      // This synthetic non-narrable tag models classification without making an editorial claim.
      const markdown = `---\n${stringifyYaml({ ...metadata, tags: ["sistemas-distribuidos"] }, { schema: "core", lineWidth: 0 })}---\n\n${markdownBody}\n`;
      await rm(path.join(repo, file));
      await writeFile(path.join(repo, `content/articles/${slug}.md`), markdown);
    }
    const markdownCommit = commit("convert one source in the full corpus to Markdown");
    const mixedInventory = discoverArticleSources(git("ls-tree", "-r", "--name-only", markdownCommit).split(/\r?\n/), markdownCommit);
    assert.equal(mixedInventory.length, 18);
    assert.equal(mixedInventory.filter(({ extension }) => extension === "md").length, 1);
    assert.equal(mixedInventory.find(({ slug }) => slug === markdownSlug)?.extension, "md");

    const taxonomy = JSON.parse(await readFile(path.join(root, "generation/taxonomy/tags.json"), "utf8"));
    const knownTags = new Set(Object.keys(taxonomy.tags));
    const lexicon = JSON.parse(await readFile(path.join(root, "content/tts-lexicon.json"), "utf8"));
    const extractor = path.join(root, "scripts/lib/migration-baseline-extract.py");
    async function compileCommit(sha) {
      const entries = git("ls-tree", "-r", "--name-only", sha).split(/\r?\n/).filter(Boolean);
      const inventory = discoverArticleSources(entries, sha);
      assert.equal(inventory.length, 18);
      const tree = new Map(git("ls-tree", "-r", sha).split(/\r?\n/).filter(Boolean).map(line => {
        const match = line.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/);
        return match && [match[2], match[1]];
      }).filter(Boolean));
      const knownSlugs = new Set(inventory.map(({ slug }) => slug));
      const compiled = [];
      for (const source of inventory) {
        const text = git("show", `${sha}:${source.file}`);
        const context = { sourcePath: source.file, rootPath: root, knownTags, knownSlugs,
          assetExists: file => assetPaths.has(file) };
        const result = source.extension === "json"
          ? fromLegacyArticle(JSON.parse(text), context)
          : await compileMarkdownArticle({ source: text, ...context });
        assert.equal(result.metadata.slug, source.slug);
        const history = git("log", "--reverse", "--diff-filter=A", "--format=%cI", sha,
          "--", `content/articles/${source.slug}.json`, `content/articles/${source.slug}.md`);
        compiled.push({ slug: source.slug, source: source.file, sourceBlob: tree.get(source.file), metadata: result.metadata,
          bodyHtml: result.slots.body, addedAt: firstAdditionDate(history, source.slug) });
      }
      const extracted = JSON.parse(execFileSync(python, ["-X", "utf8", extractor], {
        cwd: root, input: JSON.stringify({ articles: compiled.map(articleForNarrationExtraction), lexicon }), encoding: "utf8",
        env: { ...process.env, PYTHONUTF8: "1", TECH_TOPICS_BASELINE_TTS_DIR: path.join(root, "tools/tts") },
        maxBuffer: 50 * 1024 * 1024
      }));
      const articles = compiled.map((article, index) => {
        const extractedArticle = extracted.articles[index];
        const assets = [...extractedArticle.assets.filter(asset => !isArticleNavigationLink(asset)),
          { tag: "article", attribute: "image", value: article.metadata.image }].map(asset => {
          const normalized = asset.value.split(/[?#]/, 1)[0].replace(/^\.\//, "");
          return { ...asset, gitBlob: tree.get(normalized) ?? null };
        });
        return { ...article, ...extractedArticle, assets };
      }).sort((a, b) => b.metadata.publishedAt.localeCompare(a.metadata.publishedAt)
        || (Date.parse(b.addedAt) || 0) - (Date.parse(a.addedAt) || 0) || a.slug.localeCompare(b.slug))
        .map((article, index) => ({ ...article, order: index + 1 }));
      return { sha, articles };
    }
    const [before, after] = await Promise.all([compileCommit(jsonCommit), compileCommit(markdownCommit)]);
    assert.deepEqual(after.articles.map(({ slug }) => slug), before.articles.map(({ slug }) => slug), "publication order and inventory must survive the conversion");
    for (const oldArticle of before.articles) {
      const newArticle = after.articles.find(article => article.slug === oldArticle.slug);
      assert.equal(newArticle.addedAt, oldArticle.addedAt, `${oldArticle.slug}: first addition history survives source extension change`);
    }
    const auditState = current => ({ articles: current.articles.flatMap(item => {
      const sentences = item.editorialSentences;
      const records = audit(item.slug, sentences.map((sentence, index) => `${index}:${sentence.text}`), {
        frames: sentences.map(({ blockIndex, sentenceIndex }) => [blockIndex, sentenceIndex]),
        spokenTexts: sentences.map(({ text }) => text), spokenRuns: sentences.map(({ runs }) => runs),
        chapters: JSON.stringify(sentences.map(({ blockIndex, sentenceIndex }) => [blockIndex, sentenceIndex]))
      }).articles;
      return records;
    }) });
    const result = compareArticleStates(before, after, { domBefore: auditState(before), domAfter: auditState(after) });
    const diffSummary = {
      narration: result.narration.slice(0, 4).map(({ slug, firstDivergence }) => ({ slug, path: firstDivergence.path })),
      framing: result.framing.slice(0, 4).map(({ slug, contract, firstDivergence }) => ({ slug, contract, path: firstDivergence.path })),
      blockers: result.blockers.slice(0, 4).map(({ slug, kind, reason, firstDivergence }) => ({ slug, kind, reason, path: firstDivergence?.path }))
    };
    assert.deepEqual(result, { narration: [], framing: [], selection: [], blockers: [] },
      `all 18 articles must have empty events when source format and non-narrable test tags are the only changes: ${JSON.stringify(diffSummary)}`);
  } finally { await rm(repo, { recursive: true, force: true }); }
});
