import { randomInt } from "node:crypto";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chooseNext, parseQueue, selectionComment } from "./lib/topic-queue.mjs";

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const issue = Number(process.env.TOPIC_QUEUE_ISSUE_NUMBER);
if (!repository || !token || !Number.isInteger(issue) || issue < 1) {
  throw new Error("GITHUB_REPOSITORY, GITHUB_TOKEN and TOPIC_QUEUE_ISSUE_NUMBER are required");
}

async function github(url, options = {}) {
  const response = await fetch(`https://api.github.com${url}`, {
    ...options,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", ...options.headers }
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  return response.json();
}

const comments = [];
for (let page = 1; ; page++) {
  const batch = await github(`/repos/${repository}/issues/${issue}/comments?per_page=100&page=${page}`);
  comments.push(...batch);
  if (batch.length < 100) break;
}
// Public issue comments are untrusted; only the repository owner curates candidates.
const owner = repository.split("/")[0];
const trusted = comments.filter(comment => comment.user?.login === owner ||
  (comment.user?.login === "github-actions[bot]" && comment.body?.includes("<!-- tech-topics:selected:v1 -->")));
const articles = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../content/articles");
const published = (await readdir(articles)).filter(file => file.endsWith(".json") && file !== "index.json").map(file => file.slice(0, -5));
const result = chooseNext(parseQueue(trusted), published, randomInt);
if (result.status === "selected") {
  await github(`/repos/${repository}/issues/${issue}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: selectionComment(result.topic) })
  });
  console.log(`Selected: ${result.topic.slug}`);
} else {
  console.log(result.status === "pending" ? `Selection pending: ${result.topic.slug}` : "No eligible candidate; weekly curation must replenish the queue.");
}
