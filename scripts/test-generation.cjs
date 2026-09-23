const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { mkdtemp, mkdir, writeFile } = require("node:fs/promises");
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

  console.log("PASS: article and cover briefs are selective, compact and reject unsafe or invalid input.");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
