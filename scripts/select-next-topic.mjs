import { randomInt } from "node:crypto";
import { appendFile, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadGenerationSystem } from "./lib/generation-system.mjs";
import { githubQueueAdapter, queueSummary, runTopicQueue } from "./lib/topic-queue-service.mjs";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: node scripts/select-next-topic.mjs [--dry-run] [--json] [--fixture path.json]\nRead-only queries need no token. Fixtures require --dry-run and contain comments, published, repository, and optional registry {tasks, frameworks} arrays.");
} else {
  try {
    const allowed = new Set(["--dry-run", "--json", "--fixture"]);
    let fixturePath;
    for (let i = 0; i < args.length; i++) {
      if (!allowed.has(args[i])) throw new Error(`Unknown argument: ${args[i]}`);
      if (args[i] === "--fixture") {
        fixturePath = args[++i];
        if (!fixturePath || fixturePath.startsWith("--")) throw new Error("--fixture requires a JSON path");
      }
    }
    const dryRun = args.includes("--dry-run");
    if (fixturePath && !dryRun) throw new Error("Fixtures require --dry-run; fixture queries cannot publish comments");
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const fixture = fixturePath ? JSON.parse(await readFile(fixturePath, "utf8")) : null;
    const repository = fixture?.repository || process.env.GITHUB_REPOSITORY || "joaovpimenta/tech-topics";
    const issue = Number(process.env.TOPIC_QUEUE_ISSUE_NUMBER || 21);
    const registry = fixture?.registry ? {
      tasks: new Map(fixture.registry.tasks.map(id => [id, {}])),
      frameworks: new Map(fixture.registry.frameworks.map(id => [id, {}]))
    } : await loadGenerationSystem(root);
    const published = fixture?.published || (await readdir(path.join(root, "content", "articles")))
      .filter(file => file.endsWith(".json") && file !== "index.json").map(file => file.slice(0, -5));
    const adapter = fixture ? { listComments: async () => fixture.comments } :
      githubQueueAdapter({ repository, issue, token: process.env.GITHUB_TOKEN });
    if (!dryRun && !process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is required to publish a selection; use --dry-run for queries");
    const result = await runTopicQueue({ adapter, owner: repository.split("/")[0], registry, published, dryRun, randomIndex: randomInt });
    console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : queueSummary(result));
    if (process.env.GITHUB_STEP_SUMMARY && !fixture) await appendFile(process.env.GITHUB_STEP_SUMMARY, queueSummary(result));
    if (result.status === "blocked") process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: "blocked", problems: [error.message] }));
    process.exitCode = 1;
  }
}
