import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const commands = Object.freeze({
  validate: "node scripts/validate-site.mjs",
  build: "node scripts/build-site.mjs",
  catalog: "node scripts/compose-article-brief.mjs --list",
  queue: "node scripts/select-next-topic.mjs --dry-run --json",
  tts: "python tools/tts/precommit.py doctor --json"
});

function runCommand(command, args, root) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 10000, windowsHide: true });
  return { ok: result.status === 0, output: (result.stdout || result.stderr || result.error?.message || "").trim() };
}

export async function diagnoseRepository({ root, nodeVersion = process.versions.node, run = runCommand }) {
  const checks = [];
  let expectedNode;
  try {
    expectedNode = (await readFile(path.join(root, ".node-version"), "utf8")).trim();
    if (!/^\d+$/.test(expectedNode)) throw new Error(".node-version must contain a Node major version");
    const actual = Number(nodeVersion.split(".")[0]);
    const expected = Number(expectedNode);
    checks.push({ name: "node", status: actual < expected ? "error" : actual === expected ? "ok" : "warning", actual: nodeVersion, expected: expectedNode,
      message: actual === expected ? "Node matches CI" : `CI uses Node ${expectedNode}; use that major version for reproducibility` });
  } catch (error) {
    checks.push({ name: "node", status: "error", message: error.message });
  }
  for (const file of ["AGENTS.md", "generation/registry.json", "content/articles/index.json", "scripts/validate-site.mjs"]) {
    try { await access(path.join(root, file)); checks.push({ name: file, status: "ok" }); }
    catch { checks.push({ name: file, status: "error", message: "Required repository file is missing" }); }
  }
  const git = run("git", ["rev-parse", "--is-inside-work-tree"], root);
  checks.push({ name: "git", status: git.ok && git.output === "true" ? "ok" : "warning", message: git.ok ? "Git history available for publication ordering" : "Git unavailable; build uses publication dates without first-addition history" });
  const github = run("gh", ["--version"], root);
  checks.push({ name: "github-cli", status: github.ok ? "ok" : "warning", message: github.ok ? "GitHub CLI available; authentication is checked when accessing the tracker" : "Optional: install gh for tracker and workflow operations; offline validation remains available" });
  const status = checks.some(check => check.status === "error") ? "error" : checks.some(check => check.status === "warning") ? "warning" : "ok";
  return { status, node: { expected: expectedNode, actual: nodeVersion }, checks, commands, navigation: "docs/agents/README.md", tts: { requiredForSite: false, diagnostics: commands.tts } };
}
