import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { diagnoseRepository } from "./lib/repository-health.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "tech-topics-health-"));
try {
  const unavailable = () => ({ ok: false, output: "not installed" });
  const missing = await diagnoseRepository({ root, nodeVersion: "22.1.0", run: unavailable });
  assert.equal(missing.status, "error");
  for (const file of [".node-version", "AGENTS.md", "generation/registry.json", "content/articles/index.json", "scripts/validate-site.mjs"]) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), file === ".node-version" ? "22\n" : "fixture");
  }
  const optionalMissing = await diagnoseRepository({ root, nodeVersion: "22.1.0", run: unavailable });
  assert.equal(optionalMissing.status, "warning");
  assert.equal(optionalMissing.checks.filter(check => check.status === "error").length, 0);
  assert.equal(optionalMissing.tts.requiredForSite, false);
  const healthy = await diagnoseRepository({ root, nodeVersion: "22.1.0", run: command => ({ ok: true, output: command === "git" ? "true" : "gh fixture" }) });
  assert.equal(healthy.status, "ok");
  assert.equal((await diagnoseRepository({ root, nodeVersion: "20.0.0", run: unavailable })).checks[0].status, "error");
  assert.equal((await diagnoseRepository({ root, nodeVersion: "24.0.0", run: unavailable })).checks[0].status, "warning");
  assert.match(healthy.commands.queue, /--dry-run --json/);
} finally { await rm(root, { recursive: true, force: true }); }
console.log("PASS: repository diagnostics distinguish required failures from optional tools");
