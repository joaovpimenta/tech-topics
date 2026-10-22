const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { mkdtemp, mkdir, writeFile, readFile, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const { pathToFileURL } = require("node:url");

const run = promisify(execFile);
const root = path.resolve(__dirname, "..");
const composer = path.join(root, "scripts", "compose-article-brief.mjs");
const coverComposer = path.join(root, "scripts", "compose-cover-brief.mjs");

async function expectFailure(args, pattern) {
  await assert.rejects(
    run(process.execPath, [composer, ...args], { cwd: root }),
    error => pattern.test(`${error.stderr}\n${error.stdout}`)
  );
}

(async () => {
  const catalog = await run(process.execPath, [composer, "--list"], { cwd: root });
  assert.match(catalog.stdout, /explain-concept/);
  assert.match(catalog.stdout, /distributed-systems/);
  assert.match(catalog.stdout, /Published topics/);
  assert.match(catalog.stdout, /"slug":"four-golden-signals"/);
  assert.doesNotMatch(catalog.stdout, /"bodyHtml"/);

  const result = await run(process.execPath, [
    composer,
    "--topic", "Circuit Breaker",
    "--task", "explain-concept",
    "--framework", "distributed-systems",
    "--framework", "backend",
    "--depth", "advanced"
  ], { cwd: root });
  assert.match(result.stdout, /content\/articles\/circuit-breaker\.json/);
  assert.match(result.stdout, /Framework: sistemas distribuídos/);
  assert.match(result.stdout, /Framework: backend/);
  assert.doesNotMatch(result.stdout, /Framework: observabilidade/);
  assert.ok(Buffer.byteLength(result.stdout) < 32768);

  const cover = await run(process.execPath, [coverComposer], { cwd: root });
  assert.match(cover.stdout, /Style anchor obrigatório/);
  assert.match(cover.stdout, /four-golden-signals-cover\.jpg/);
  assert.match(cover.stdout, /Critérios de aceitação da capa/);
  assert.doesNotMatch(cover.stdout, /capa determinística/);
  assert.ok(Buffer.byteLength(cover.stdout) < 8192);

  const coverFixture = await mkdtemp(path.join(os.tmpdir(), "tech-topics-cover-"));
  try {
    await mkdir(path.join(coverFixture, "scripts"));
    await mkdir(path.join(coverFixture, "docs"));
    const fixtureComposer = path.join(coverFixture, "scripts", "compose-cover-brief.mjs");
    await writeFile(fixtureComposer, await readFile(coverComposer));
    const visualStyle = (await readFile(path.join(root, "docs", "VISUAL_STYLE.md"), "utf8")).replace(/\r\n?/g, "\n");
    for (const newline of ["\n", "\r\n", "\r"]) {
      await writeFile(path.join(coverFixture, "docs", "VISUAL_STYLE.md"), visualStyle.replace(/\n/g, newline));
      const fixtureCover = await run(process.execPath, [fixtureComposer]);
      assert.equal(fixtureCover.stdout, cover.stdout, "cover brief must be independent of document line endings");
    }
  } finally {
    await rm(coverFixture, { recursive: true, force: true });
  }

  await expectFailure([
    "--topic", "Circuit Breaker",
    "--task", "unknown-task",
    "--framework", "backend"
  ], /unknown task/);
  await expectFailure([
    "--topic", "Four Golden Signals",
    "--task", "explain-concept",
    "--framework", "observability"
  ], /topic already exists/);
  await expectFailure([
    "--topic", "Circuit Breaker",
    "--task", "explain-concept",
    "--framework", "backend",
    "--framework", "cloud",
    "--framework", "security",
    "--framework", "networking"
  ], /at most 3 frameworks/);
  await expectFailure([
    "--topic", "Circuit\nBreaker",
    "--task", "explain-concept",
    "--framework", "backend"
  ], /single printable line/);

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "tech-topics-generation-"));
  await mkdir(path.join(temporaryRoot, "generation", "editorial"), { recursive: true });
  await mkdir(path.join(temporaryRoot, "generation", "frameworks"), { recursive: true });
  await writeFile(path.join(temporaryRoot, "generation", "editorial", "AUTHORING.md"), "# Authoring\n");
  await writeFile(path.join(temporaryRoot, "generation", "frameworks", "safe.md"), "# Safe\n");
  const invalidRegistry = {
    version: 1,
    limits: { maxFrameworks: 1, maxModuleBytes: 1024, maxBriefBytes: 2048 },
    authoring: "editorial/AUTHORING.md",
    tasks: { unsafe: { label: "Unsafe", file: "../outside.md" } },
    frameworks: { safe: { label: "Safe", file: "frameworks/safe.md" } }
  };
  const moduleUrl = pathToFileURL(path.join(root, "scripts", "lib", "generation-system.mjs"));
  const { validateGenerationRegistry } = await import(moduleUrl.href);
  await assert.rejects(validateGenerationRegistry(temporaryRoot, invalidRegistry), /normalized|must live|traversal/);

  // Exercise the actual article CLI with the same selected modules in LF and CRLF.
  await mkdir(path.join(temporaryRoot, "scripts", "lib"), { recursive: true });
  await mkdir(path.join(temporaryRoot, "generation", "tasks"));
  await mkdir(path.join(temporaryRoot, "content", "articles"), { recursive: true });
  const fixtureArticleComposer = path.join(temporaryRoot, "scripts", "compose-article-brief.mjs");
  await writeFile(fixtureArticleComposer, await readFile(composer));
  await writeFile(path.join(temporaryRoot, "scripts", "lib", "generation-system.mjs"), await readFile(path.join(root, "scripts", "lib", "generation-system.mjs")));
  const validRegistry = { ...invalidRegistry, tasks: { fixture: { label: "Fixture", file: "tasks/fixture.md" } } };
  await writeFile(path.join(temporaryRoot, "generation", "registry.json"), JSON.stringify(validRegistry));
  const fixtureModules = ["editorial/AUTHORING.md", "tasks/fixture.md", "frameworks/safe.md"];
  let canonicalBrief;
  for (const newline of ["\n", "\r\n", "\r"]) {
    for (const file of fixtureModules) await writeFile(path.join(temporaryRoot, "generation", file), ["# Fixture", "", "Texto do módulo.", "Outra linha.", ""].join(newline));
    const composed = await run(process.execPath, [fixtureArticleComposer, "--topic", "Novo tema", "--task", "fixture", "--framework", "safe"]);
    canonicalBrief ??= composed.stdout;
    assert.equal(composed.stdout, canonicalBrief, "article brief must be independent of selected module line endings");
    assert.equal(composed.stdout.includes("\r"), false);
  }
  await rm(temporaryRoot, { recursive: true, force: true });

  console.log("PASS: article and cover briefs are selective, compact and reject unsafe or invalid input.");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
