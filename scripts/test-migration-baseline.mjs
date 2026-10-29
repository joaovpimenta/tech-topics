import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { articleSignatures, compareBaselines, compareCaptureTools, nativeDomUnitHash, validateBaseline } from "./lib/migration-baseline.mjs";

const extracted = { structure: { ids: ["intro"], elements: [{ tag: "p" }], urls: [] },
  editorialSentences: [{ blockIndex: 0, sentenceIndex: 0, tag: "p", section: false, pauseAfterSeconds: 0.38, pauseKind: "paragraph", runs: [{ text: "Olá", lang: "pt-BR" }], text: "Olá" }],
  legacyChunks: [{ chunkIndex: 0, blockIndex: 0, tag: "p", section: false, plannedPauseAfterSeconds: 0.45, splitReason: "paragraph_end", runs: [{ text: "Olá", lang: "pt-BR" }], text: "Olá" }], assets: [] };
const article = { slug: "exemplo", title: "Exemplo", bodyHtml: "<p>Olá.</p>" };
const record = { slug: "exemplo", order: 1, addedAt: "2026-01-01T00:00:00Z", signatures: articleSignatures(article, extracted).signatures };

test("baseline signatures cover metadata, HTML, structure, narration and assets", () => {
  const signatures = articleSignatures(article, extracted).signatures;
  assert.deepEqual(Object.keys(signatures).sort(), ["assets", "editorialSentences", "html", "legacyChunks", "metadata", "structure"]);
  assert.equal(signatures.html.length, 64);
  assert.deepEqual(validateBaseline({ sha: "a".repeat(40), sourceCount: 1, capture: { sourceTools: [], captureTools: [] }, articles: [record] }), []);
});

test("Python contract hashes preserve punctuation, aliases, language runs, indices and pauses", () => {
  const nativePythonSignature = (text, runs) => articleSignatures(article, { ...extracted, editorialSentences: [
    { ...extracted.editorialSentences[0], text, runs }
  ] }).editorialSentences[0];
  const exact = text => nativePythonSignature(text, [{ text, lang: "pt-BR" }]);
  for (const [before, after] of [["1.23", "12.3"], ["a,b", "ab,"], ["HTTP/2", "HTTP2/"], ["alias.", "alias"]]) {
    assert.notEqual(exact(before).textSha256, exact(after).textSha256, `${before} versus ${after}`);
  }
  const englishWord = nativePythonSignature("Bulkhead", [{ text: "Bulk", lang: "en-US" }, { text: "head", lang: "pt-BR" }]);
  const portugueseWord = nativePythonSignature("Bulkhead", [{ text: "Bulk", lang: "pt-BR" }, { text: "head", lang: "pt-BR" }]);
  assert.notDeepEqual(englishWord.runs, portugueseWord.runs);
  assert.notEqual(nativePythonSignature("Next.", [{ text: "Next.", lang: "pt-BR" }]).textSha256,
    nativePythonSignature("Next", [{ text: "Next", lang: "pt-BR" }]).textSha256);
  assert.deepEqual(exact("1.23"), exact("1.23"), "identical Python contract input is reproducible");
});

test("DOM contract hashes preserve raw segment boundaries, punctuation, language, indices and word mapping", () => {
  const unit = { blockIndex: 0, sentenceIndex: 0, segments: [{ text: "1.23", lang: "pt-BR", words: [{ start: 0, end: 4, nodeIds: ["n1"] }] }] };
  const hash = value => nativeDomUnitHash(value);
  assert.equal(hash(unit), hash(structuredClone(unit)), "identical native DOM records are reproducible");
  const withText = text => ({ ...unit, segments: [{ ...unit.segments[0], text, words: [{ start: 0, end: text.length, nodeIds: ["n1"] }] }] });
  for (const [before, after] of [["1.23", "12.3"], ["a,b", "ab,"], ["HTTP/2", "HTTP2/"], ["alias.", "alias"]]) {
    assert.notEqual(hash(withText(before)), hash(withText(after)), `${before} versus ${after}`);
  }
  for (const changed of [
    { ...unit, segments: [{ ...unit.segments[0], lang: "en-US" }] },
    { ...unit, blockIndex: 1 },
    { ...unit, segments: [{ ...unit.segments[0], words: [{ start: 0, end: 4, nodeIds: ["n2"] }] }] },
    { ...unit, segments: [{ text: "1.", lang: "pt-BR", words: [{ start: 0, end: 2, nodeIds: ["n1"] }] }, { text: "23", lang: "pt-BR", words: [{ start: 0, end: 2, nodeIds: ["n1"] }] }] }
  ]) assert.notEqual(hash(unit), hash(changed));
});

test("UTF-8 extraction preserves Portuguese, aliases, punctuation and language runs", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const fixture = { articles: [{ slug: "utf8-fixture", title: "Ação e café.", dek: "Não há perda.",
    bodyHtml: '<p>São Paulo: <span lang="en-US">Bulkhead</span>, não <span data-tts-say="cerca avançada.">alias</span></p>' }], lexicon: {} };
  const python = process.env.TECH_TOPICS_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const temp = await mkdtemp(path.join(os.tmpdir(), "migration-utf8-extraction-test-"));
  const inputPath = path.join(temp, "input.json");
  await writeFile(inputPath, JSON.stringify(fixture), "utf8");
  const inputFd = openSync(inputPath, "r");
  try {
    const result = spawnSync(python, ["-X", "utf8", path.join(root, "scripts/lib/migration-baseline-extract.py")], {
      cwd: root, stdio: [inputFd, "pipe", "pipe"], encoding: "utf8", maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, PYTHONUTF8: "1", TECH_TOPICS_BASELINE_TTS_DIR: path.join(root, "tools/tts") }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.includes("\uFFFD"), false);
    const extractedFixture = JSON.parse(result.stdout).articles[0];
    const text = extractedFixture.editorialSentences.map(sentence => sentence.text).join(" ");
    assert.match(text, /Ação e café\./);
    assert.match(text, /Não há perda\./);
    assert.match(text, /São Paulo: Bulkhead, não cerca avançada\./);
    assert.ok(extractedFixture.editorialSentences.some(sentence => sentence.runs.some(run => run.lang === "en-us" && run.text.includes("Bulkhead"))));
  } finally {
    closeSync(inputFd);
    await rm(temp, { recursive: true, force: true });
  }
});

test("baseline comparison reports additions, removals and changed signature dimensions", () => {
  const original = { sha: "a".repeat(40), articles: [record] };
  const updated = { sha: "b".repeat(40), articles: [
    { ...record, order: 2, signatures: { ...record.signatures, editorialSentences: "changed" } },
    { slug: "novo", signatures: {}, addedAt: "2026-01-02T00:00:00Z" }
  ] };
  assert.deepEqual(compareBaselines(original, updated), [
    { slug: "exemplo", kind: "changed", signatures: ["editorialSentences", "order"] },
    { slug: "novo", kind: "added" }
  ]);
  assert.deepEqual(compareBaselines(updated, original).map(change => change.kind), ["changed", "removed"]);
});


test("versioned original and corrected tool baseline preserve signatures and do not duplicate article bodies", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const file = path.join(root, "docs/migrations/baselines/capture-v2/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json");
  const originalFile = path.join(root, "docs/migrations/baselines/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json");
  const baseline = JSON.parse(await readFile(file, "utf8"));
  const original = JSON.parse(await readFile(originalFile, "utf8"));
  assert.equal(createHash("sha256").update(await readFile(file)).digest("hex"), "04df6fcc596b1fa3d7de3bc0b85297d2035dd995bcdd402650f240b1546445f6",
    "the v2 correction record remains immutable when v3 tooling changes");
  assert.equal(createHash("sha256").update(await readFile(originalFile)).digest("hex"), "e5acb9163da52bc0b7c37316e95b8c6f075b406124378b2bb2b1cdf708ce6278",
    "the historical v1 artifact remains byte-identical without depending on its Git commit being reachable");
  assert.equal(baseline.schemaVersion, 2);
  assert.equal(baseline.sha, "fca72c31fcb57ffe9741a2390a04c2035639e14a");
  assert.equal(baseline.sourceCount, 18);
  assert.equal(baseline.indexSourceCount, 17);
  assert.ok(baseline.articles.some(entry => entry.slug === "hedged-requests"));
  assert.deepEqual(baseline.articles.map(entry => entry.order), Array.from({ length: 18 }, (_, index) => index + 1));
  assert.ok(baseline.articles.every(entry => entry.sourceBlob && entry.html.sha256 && entry.addedAt));
  assert.ok(baseline.articles.every(entry => !Object.hasOwn(entry, "bodyHtml")));
  assert.ok(baseline.capture.sourceTools.some(tool => tool.path.endsWith("kokoro_release.py")));
  assert.ok(baseline.articles.every(entry => entry.editorialSentences.every(sentence => typeof sentence.pauseAfterSeconds === "number" && Number.isInteger(sentence.blockIndex) && Number.isInteger(sentence.sentenceIndex))));
  assert.ok(baseline.articles.every(entry => entry.editorialSentences.every(sentence => Array.isArray(sentence.semanticTokens) &&
    /^[0-9a-f]{64}$/.test(sentence.punctuationSha256) && sentence.semanticTokens.every(token => token.lang && /^[0-9a-f]{64}$/.test(token.textSha256)))));
  assert.ok(baseline.articles.every(entry => entry.legacyChunks.every(chunk => Number.isInteger(chunk.blockIndex) && Number.isInteger(chunk.chunkIndex) && !Object.hasOwn(chunk, "sentenceIndex"))));
  assert.equal(baseline.capture.narration.editorialSentences.settings.speed, 1);
  assert.equal(baseline.capture.narration.editorialSentences.settings.paragraph_pause, 0.38);
  assert.equal(baseline.capture.narration.editorialSentences.settings.section_pause, 0.70);
  assert.equal(baseline.capture.narration.legacyChunks.preset, "atual");
  assert.match(baseline.capture.narration.legacyChunks.meaning, /not editorial sentence indices/);
  assert.ok(baseline.articles.some(entry => entry.structure.elements.some(element => element.ttsSay)));
  assert.equal(baseline.previous.sha, baseline.sha);
  assert.equal(baseline.previous.path, "docs/migrations/baselines/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json");
  assert.equal(baseline.diff.articles.length, 18);
  assert.ok(baseline.diff.articles.every(change => change.signatures.includes("narration") && change.signatures.includes("editorialSentences") && change.signatures.includes("legacyChunks")));
  assert.notDeepEqual(baseline.diff.captureTools, []);
  for (const article of baseline.articles) {
    const previous = original.articles.find(entry => entry.slug === article.slug);
    assert.ok(previous);
    for (const field of ["source", "sourceBlob", "addedAt", "publishedAt", "order", "metadata", "html", "structure", "assets"]) {
      assert.deepEqual(article[field], previous[field], `${article.slug}: stable ${field}`);
    }
    assert.equal(article.signatures.metadata, previous.signatures.metadata);
    assert.equal(article.signatures.html, previous.signatures.html);
    assert.equal(article.signatures.structure, previous.signatures.structure);
    assert.equal(article.signatures.assets, previous.signatures.assets);
    for (const [index, chunk] of article.legacyChunks.entries()) {
      assert.equal(chunk.chunkIndex, index);
      assert.match(chunk.textSha256, /^[0-9a-f]{64}$/);
      assert.ok(Number.isInteger(chunk.blockIndex));
      assert.equal(typeof chunk.plannedPauseAfterSeconds, "number");
      assert.equal(Object.hasOwn(chunk, "sentenceIndex"), false);
    }
  }
  const normalizedHash = text => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
  assert.equal(normalizedHash("capture\nsource"), normalizedHash("capture\r\nsource"));
  const otherRuntime = structuredClone(baseline);
  otherRuntime.capture.runtime = { node: "v22.0.0", python: "3.11.0" };
  assert.deepEqual(compareCaptureTools(baseline, otherRuntime), []);
});

test("capture tool changes are explicit", () => {
  assert.deepEqual(compareCaptureTools(
    { capture: { sourceTools: [{ path: "tools/a.py", sha256: "a" }], captureTools: [{ path: "scripts/a.mjs", sha256: "x" }] } },
    { capture: { sourceTools: [{ path: "tools/a.py", sha256: "b" }], captureTools: [{ path: "scripts/a.mjs", sha256: "x" }, { path: "scripts/new.mjs", sha256: "n" }] } }
  ), [{ path: "scripts/new.mjs", kind: "added" }, { path: "tools/a.py", kind: "changed" }]);
});

test("capture CLI reproduces the checked-in baseline and refuses overwrites", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const baseline = path.join(root, "docs/migrations/baselines/capture-v3/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json");
  const previousBaseline = path.join(root, "docs/migrations/baselines/capture-v2/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json");
  const sha = "fca72c31fcb57ffe9741a2390a04c2035639e14a";
  const temp = await mkdtemp(path.join(os.tmpdir(), "migration-baseline-test-"));
  const env = { ...process.env, TECH_TOPICS_PYTHON: process.env.TECH_TOPICS_PYTHON || (process.platform === "win32" ? "py" : "python3") };
  const run = (outputRoot, ...extra) => spawnSync(process.execPath, [path.join(root, "scripts/capture-migration-baseline.mjs"), "--sha", sha, "--output-root", outputRoot, ...extra], { cwd: root, env, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  const canonical = value => {
    const { runtime, ...capture } = value.capture;
    return `${JSON.stringify({ ...value, capture }, null, 2)}\n`;
  };
  try {
    const outputRoot = path.join(temp, "reproduced");
    const first = run(outputRoot, "--previous", previousBaseline);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const output = path.join(outputRoot, sha, "baseline.json");
    const reproduced = JSON.parse(await readFile(output, "utf8"));
    const checkedIn = JSON.parse(await readFile(baseline, "utf8"));
    assert.equal(createHash("sha256").update(await readFile(baseline)).digest("hex"),
      "d67e678549d44fc1d9d1a3e5229f747285052c49778a6b5ad18f1cbd98091c27",
      "the pinned historical capture remains immutable as the tools evolve");
    assert.equal(reproduced.schemaVersion, 3);
    assert.match(reproduced.capture.contracts.comparison, /cross-contract equivalence is inconclusive/);
    assert.ok(reproduced.articles.every(entry => entry.editorialSentences.every(sentence => !Object.hasOwn(sentence, "semanticTokens"))));
    assert.equal(typeof reproduced.capture.runtime.node, "string");
    assert.equal(typeof reproduced.capture.runtime.python, "string");
    assert.equal(typeof checkedIn.capture.runtime.node, "string");
    assert.equal(typeof checkedIn.capture.runtime.python, "string");
    for (const entry of reproduced.articles) {
      const pinned = checkedIn.articles.find(article => article.slug === entry.slug);
      assert.ok(pinned, `${entry.slug}: historical article exists`);
      for (const signature of ["metadata", "html", "structure", "assets"]) {
        assert.equal(entry.signatures[signature], pinned.signatures[signature], `${entry.slug}: stable ${signature} signature`);
      }
    }
    assert.ok(reproduced.diff.captureTools.some(change => change.path === "scripts/capture-migration-baseline.mjs" && change.kind === "changed"),
      "tool evolution is recorded in the successor diff");
    assert.notEqual(canonical(reproduced), canonical(checkedIn), "the replay records current tool provenance without rewriting the pinned artifact");
    const before = await readFile(output, "utf8");
    const secondRoot = path.join(temp, "reproduced-again");
    const secondCapture = run(secondRoot, "--previous", previousBaseline);
    assert.equal(secondCapture.status, 0, secondCapture.stderr || secondCapture.stdout);
    assert.equal(await readFile(path.join(secondRoot, sha, "baseline.json"), "utf8"), before,
      "repeated captures with the same runtime must be byte-identical");
    const second = run(outputRoot);
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /Refusing to overwrite immutable baseline/);
    assert.equal(await readFile(output, "utf8"), before);

    const previous = JSON.parse(before);
    previous.articles[0].order += 1;
    previous.articles[0].addedAt = "2000-01-01T00:00:00Z";
    previous.capture.captureTools[0].sha256 = "changed";
    const previousRoot = path.join(temp, "previous");
    await mkdir(path.join(previousRoot, sha), { recursive: true });
    const previousFile = path.join(previousRoot, sha, "baseline.json");
    await writeFile(previousFile, JSON.stringify(previous));
    const updatedRoot = path.join(temp, "updated");
    const updated = run(updatedRoot, "--previous", previousFile);
    assert.equal(updated.status, 0, updated.stderr || updated.stdout);
    const nextFile = path.join(updatedRoot, sha, "baseline.json");
    const next = JSON.parse(await readFile(nextFile, "utf8"));
    assert.equal(path.resolve(root, next.previous.path), previousFile);
    assert.deepEqual(next.diff.articles[0].signatures, ["order", "addedAt"]);
    assert.deepEqual(next.diff.captureTools, [{ path: previous.capture.captureTools[0].path, kind: "changed" }]);

    const missing = spawnSync(process.execPath, [path.join(root, "scripts/capture-migration-baseline.mjs"), "--sha", "0000000000000000000000000000000000000000", "--output-root", path.join(temp, "missing")], { cwd: root, env, encoding: "utf8" });
    assert.notEqual(missing.status, 0);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("capture CLI compiles Markdown sources in a mixed historical tree", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sha = "12366cefa24be1149cf55d1ea8efe30af06abd3a";
  const previousPath = path.join(root, "docs/migrations/baselines/capture-v3/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json");
  const temp = await mkdtemp(path.join(os.tmpdir(), "migration-mixed-baseline-test-"));
  const env = { ...process.env, TECH_TOPICS_PYTHON: process.env.TECH_TOPICS_PYTHON || (process.platform === "win32" ? "python" : "python3") };
  const run = outputRoot => spawnSync(process.execPath, [path.join(root, "scripts/capture-migration-baseline.mjs"), "--sha", sha, "--output-root", outputRoot,
    "--previous", previousPath], {
    cwd: root, env, encoding: "utf8", maxBuffer: 50 * 1024 * 1024
  });
  try {
    const outputRoot = path.join(temp, "first");
    const first = run(outputRoot);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const output = path.join(outputRoot, sha, "baseline.json");
    const baseline = JSON.parse(await readFile(output, "utf8"));
    assert.equal(baseline.sha, sha);
    assert.equal(baseline.sourceCount, 18);
    assert.equal(baseline.indexSourceCount, 18);
    assert.equal(baseline.articles.length, 18);
    const markdown = baseline.articles.find(entry => entry.slug === "four-golden-signals");
    assert.equal(markdown.source, "content/articles/four-golden-signals.md");
    assert.equal(markdown.sourceBlob, "d3b3868332e119f374e5ad681a6c3c5dd7d7ebe4");
    const original = JSON.parse(await readFile(path.join(root, "docs/migrations/baselines/capture-v3/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json"), "utf8"));
    assert.equal(baseline.previous.sha, original.sha);
    assert.equal(baseline.previous.path, "docs/migrations/baselines/capture-v3/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json");
    assert.ok(baseline.diff.articles.some(change => change.slug === markdown.slug && change.kind === "changed"));
    assert.ok(baseline.diff.captureTools.some(change => change.path === "scripts/lib/markdown-article.mjs" && change.kind === "added"));
    const originalFgs = original.articles.find(entry => entry.slug === markdown.slug);
    assert.equal(markdown.addedAt, originalFgs.addedAt, "converted Markdown source retains its original first-add date");
    assert.equal(markdown.order, originalFgs.order, "the FGS publication order is preserved after conversion");
    assert.equal(markdown.html.sha256, markdown.signatures.html);
    assert.ok(markdown.html.bytes > 0);
    assert.ok(baseline.capture.captureTools.some(tool => tool.path === "scripts/lib/markdown-article.mjs"));
    const secondRoot = path.join(temp, "second");
    const second = run(secondRoot);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.equal(await readFile(path.join(secondRoot, sha, "baseline.json"), "utf8"), await readFile(output, "utf8"),
      "repeated mixed-source captures must be byte-identical");

    const originalPath = path.join(root, "docs/migrations/baselines/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json");
    const corrected = path.join(root, "docs/migrations/baselines/capture-v3/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json");
    assert.equal(createHash("sha256").update(await readFile(originalPath)).digest("hex"), "e5acb9163da52bc0b7c37316e95b8c6f075b406124378b2bb2b1cdf708ce6278");
    assert.equal(createHash("sha256").update(await readFile(corrected)).digest("hex"), "d67e678549d44fc1d9d1a3e5229f747285052c49778a6b5ad18f1cbd98091c27");
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("capture CLI derives the index count from a Markdown-only revision without a legacy index", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sha = "fe86752b9d23a9cb4d9137cc20cb6ffb7883a959";
  const temp = await mkdtemp(path.join(os.tmpdir(), "migration-markdown-baseline-test-"));
  try {
    const result = spawnSync(process.execPath, [path.join(root, "scripts/capture-migration-baseline.mjs"),
      "--sha", sha, "--output-root", temp], { cwd: root, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const baseline = JSON.parse(await readFile(path.join(temp, sha, "baseline.json"), "utf8"));
    assert.equal(baseline.sourceCount, 18);
    assert.equal(baseline.indexSourceCount, 18);
    assert.ok(baseline.articles.every(article => article.source.endsWith(".md")));
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("capture CLI resolves v2 cover and figure public paths to source blobs", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const temp = await mkdtemp(path.join(os.tmpdir(), "migration-v2-assets-test-"));
  const repository = path.join(temp, "repository");
  const runGit = (cwd, ...args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  };
  try {
    runGit(temp, "clone", "--shared", root, repository);
    runGit(repository, "config", "user.email", "test@example.com");
    runGit(repository, "config", "user.name", "Test");
    const articlePath = path.join(repository, "articles/bulkhead/article.md");
    await mkdir(path.join(repository, "articles/bulkhead/figures"), { recursive: true });
    await writeFile(path.join(repository, "articles/bulkhead/figures/example.jpg"), "test figure bytes");
    await writeFile(articlePath, `${await readFile(articlePath, "utf8")}\n![Figura de teste](./figures/example.jpg)\n`);
    runGit(repository, "add", "articles/bulkhead");
    runGit(repository, "commit", "-m", "Fixture v2 figure");
    const sha = runGit(repository, "rev-parse", "HEAD");
    const outputRoot = path.join(temp, "capture");
    const result = spawnSync(process.execPath, [path.join(root, "scripts/capture-migration-baseline.mjs"),
      "--repository", repository, "--sha", sha, "--output-root", outputRoot],
    { cwd: root, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const baseline = JSON.parse(await readFile(path.join(outputRoot, sha, "baseline.json"), "utf8"));
    const assets = baseline.articles.find(article => article.slug === "bulkhead").assets;
    const cover = assets.find(asset => asset.attribute === "image");
    const figure = assets.find(asset => asset.value === "assets/bulkhead/figures/example.jpg");
    assert.equal(cover.gitBlob, runGit(repository, "rev-parse", `${sha}:articles/bulkhead/cover.jpg`));
    assert.ok(figure, "fixture figure must be captured from compiled HTML");
    assert.equal(figure.gitBlob, runGit(repository, "rev-parse", `${sha}:articles/bulkhead/figures/example.jpg`));
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("baseline validation rejects incomplete or duplicated records", () => {
  assert.match(validateBaseline({ sha: "bad", articles: [record, record] }).join("\n"), /full Git commit SHA/);
  assert.match(validateBaseline({ sha: "a".repeat(40), sourceCount: 2, capture: { sourceTools: [], captureTools: [] }, articles: [record, record] }).join("\n"), /unique/);
});
