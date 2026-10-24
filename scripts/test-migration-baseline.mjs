import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { articleSignatures, compareBaselines, compareCaptureTools, validateBaseline } from "./lib/migration-baseline.mjs";

const extracted = { structure: { ids: ["intro"], elements: [{ tag: "p" }], urls: [] },
  narration: [{ segmentIndex: 0, blockIndex: 0, sentenceIndex: 0, tag: "p", section: false, pauseAfterSeconds: 0.45, splitReason: "paragraph_end", runs: [{ text: "Olá", lang: "pt-BR" }], text: "Olá" }], assets: [] };
const article = { slug: "exemplo", title: "Exemplo", bodyHtml: "<p>Olá.</p>" };
const record = { slug: "exemplo", order: 1, addedAt: "2026-01-01T00:00:00Z", signatures: articleSignatures(article, extracted).signatures };

test("baseline signatures cover metadata, HTML, structure, narration and assets", () => {
  const signatures = articleSignatures(article, extracted).signatures;
  assert.deepEqual(Object.keys(signatures).sort(), ["assets", "html", "metadata", "narration", "structure"]);
  assert.equal(signatures.html.length, 64);
  assert.deepEqual(validateBaseline({ sha: "a".repeat(40), sourceCount: 1, capture: { sourceTools: [], captureTools: [] }, articles: [record] }), []);
});

test("baseline comparison reports additions, removals and changed signature dimensions", () => {
  const original = { sha: "a".repeat(40), articles: [record] };
  const updated = { sha: "b".repeat(40), articles: [
    { ...record, order: 2, signatures: { ...record.signatures, narration: "changed" } },
    { slug: "novo", signatures: {}, addedAt: "2026-01-02T00:00:00Z" }
  ] };
  assert.deepEqual(compareBaselines(original, updated), [
    { slug: "exemplo", kind: "changed", signatures: ["narration", "order"] },
    { slug: "novo", kind: "added" }
  ]);
  assert.deepEqual(compareBaselines(updated, original).map(change => change.kind), ["changed", "removed"]);
});


test("versioned reference baseline is complete, immutable by SHA and does not duplicate article bodies", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const file = path.join(root, "docs/migrations/baselines/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json");
  const baseline = JSON.parse(await readFile(file, "utf8"));
  assert.equal(baseline.sha, "fca72c31fcb57ffe9741a2390a04c2035639e14a");
  assert.equal(baseline.sourceCount, 18);
  assert.equal(baseline.indexSourceCount, 17);
  assert.ok(baseline.articles.some(entry => entry.slug === "hedged-requests"));
  assert.deepEqual(baseline.articles.map(entry => entry.order), Array.from({ length: 18 }, (_, index) => index + 1));
  assert.ok(baseline.articles.every(entry => entry.sourceBlob && entry.html.sha256 && entry.addedAt));
  assert.ok(baseline.articles.every(entry => !Object.hasOwn(entry, "bodyHtml")));
  assert.ok(baseline.capture.sourceTools.some(tool => tool.path.endsWith("kokoro_release.py")));
  assert.ok(baseline.articles.every(entry => entry.narration.every(segment => typeof segment.pauseAfterSeconds === "number" && Number.isInteger(segment.blockIndex) && Number.isInteger(segment.sentenceIndex))));
  assert.ok(baseline.articles.some(entry => entry.structure.elements.some(element => element.ttsSay)));
});

test("capture tool changes are explicit", () => {
  assert.deepEqual(compareCaptureTools(
    { capture: { sourceTools: [{ path: "tools/a.py", sha256: "a" }], captureTools: [{ path: "scripts/a.mjs", sha256: "x" }] } },
    { capture: { sourceTools: [{ path: "tools/a.py", sha256: "b" }], captureTools: [{ path: "scripts/a.mjs", sha256: "x" }, { path: "scripts/new.mjs", sha256: "n" }] } }
  ), [{ path: "scripts/new.mjs", kind: "added" }, { path: "tools/a.py", kind: "changed" }]);
});

test("capture CLI reproduces the checked-in baseline and refuses overwrites", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const baseline = path.join(root, "docs/migrations/baselines/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json");
  const sha = "fca72c31fcb57ffe9741a2390a04c2035639e14a";
  const temp = await mkdtemp(path.join(os.tmpdir(), "migration-baseline-test-"));
  const env = { ...process.env, TECH_TOPICS_PYTHON: process.env.TECH_TOPICS_PYTHON || (process.platform === "win32" ? "py" : "python3") };
  const run = (outputRoot, ...extra) => spawnSync(process.execPath, [path.join(root, "scripts/capture-migration-baseline.mjs"), "--sha", sha, "--output-root", outputRoot, ...extra], { cwd: root, env, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  try {
    const outputRoot = path.join(temp, "reproduced");
    const first = run(outputRoot);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const output = path.join(outputRoot, sha, "baseline.json");
    assert.equal(await readFile(output, "utf8"), await readFile(baseline, "utf8"));
    const before = await readFile(output, "utf8");
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
    assert.equal(path.resolve(path.dirname(nextFile), next.previous.path), previousFile);
    assert.deepEqual(next.diff.articles[0].signatures, ["order", "addedAt"]);
    assert.deepEqual(next.diff.captureTools, [{ path: previous.capture.captureTools[0].path, kind: "changed" }]);

    const missing = spawnSync(process.execPath, [path.join(root, "scripts/capture-migration-baseline.mjs"), "--sha", "0000000000000000000000000000000000000000", "--output-root", path.join(temp, "missing")], { cwd: root, env, encoding: "utf8" });
    assert.notEqual(missing.status, 0);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
test("baseline validation rejects incomplete or duplicated records", () => {
  assert.match(validateBaseline({ sha: "bad", articles: [record, record] }).join("\n"), /full Git commit SHA/);
  assert.match(validateBaseline({ sha: "a".repeat(40), sourceCount: 2, capture: { sourceTools: [], captureTools: [] }, articles: [record, record] }).join("\n"), /unique/);
});
