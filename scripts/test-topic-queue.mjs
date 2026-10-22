import assert from "node:assert/strict";
import { chooseNext, parseQueue, selectionComment, validateQueueAgainstRegistry } from "./lib/topic-queue.mjs";
import { githubQueueAdapter, inspectTopicQueue, queueSummary, runTopicQueue } from "./lib/topic-queue-service.mjs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const makeTopic = slug => ({ slug, title: slug, angle: "Distinct mechanism", task: "explain-concept", frameworks: ["backend"] });
const topics = ["alpha", "beta", "gamma", "delta", "epsilon"].map(makeTopic);
const candidates = [{ id: 1, body: `<!-- tech-topics:candidates:v1 -->\n\`\`\`json\n${JSON.stringify({ topics })}\n\`\`\`` }];
const queue = parseQueue(candidates);
assert.equal(queue.candidates.length, 5);
assert.equal(chooseNext(queue, ["alpha"], () => 0).topic.slug, "beta");
const first = queue.candidates[1];
const withSelection = parseQueue([...candidates, { id: 2, body: selectionComment(first) }]);
assert.equal(chooseNext(withSelection, [], () => 0).status, "pending");
assert.equal(chooseNext(withSelection, ["alpha", "beta"], () => 0).topic.slug, "gamma");
assert.equal(chooseNext(withSelection, topics.map(item => item.slug), () => 0).status, "empty");
assert.throws(() => parseQueue([{ id: 3, body: "<!-- tech-topics:candidates:v1 --> bad" }]), /Malformed/);
assert.throws(() => parseQueue([{ id: 4, body: `<!-- tech-topics:candidates:v1 -->\n\`\`\`json\n${JSON.stringify({ topics: [] })}\n\`\`\`` }]), /exactly five/);
console.log("PASS: topic queue selection");

const owner = "maintainer";
const registry = { tasks: new Map([["explain-concept", {}]]), frameworks: new Map([["backend", {}]]) };
const trustedCandidates = candidates.map(comment => ({ ...comment, user: { login: owner } }));
const inspect = (comments, published = [], customRegistry = registry) => inspectTopicQueue({ comments, owner, registry: customRegistry, published });
assert.equal(inspect(trustedCandidates).status, "ready");
assert.equal(inspect(trustedCandidates, topics.map(item => item.slug)).status, "empty");
assert.equal(inspect([]).status, "empty");
assert.throws(() => validateQueueAgainstRegistry(queue, {}, []), /validated generation registry/);
assert.equal(inspect(trustedCandidates, [], {}).status, "blocked");

const invalidTopics = topics.map((topic, index) => index === 0 ? { ...topic, task: "missing-task", frameworks: ["missing-framework"] } : topic);
const markedCandidates = value => `<!-- tech-topics:candidates:v1 -->\n\`\`\`json\n${JSON.stringify({ topics: value })}\n\`\`\``;
const invalidBatch = { id: 3, body: markedCandidates(invalidTopics), user: { login: owner } };
const invalidState = inspect([invalidBatch]);
assert.equal(invalidState.status, "ready");
assert.equal(invalidState.eligible.length, 4);
assert.equal(invalidState.invalidCandidates[0].problems.length, 2);
const pendingInvalid = { id: 4, body: selectionComment({ ...invalidTopics[0], sourceCommentId: 3 }), user: { login: "github-actions[bot]" } };
const blockedState = inspect([invalidBatch, pendingInvalid]);
assert.equal(blockedState.status, "blocked");
assert.equal(blockedState.selection.slug, "alpha");
assert.equal(blockedState.invalidCandidates.length, 1);
assert.equal(blockedState.eligible.length, 4);
assert.match(blockedState.problems[0], /Pending selection/);
assert.equal(inspect([invalidBatch, pendingInvalid], ["alpha"]).status, "ready");

const outsider = { id: 5, body: markedCandidates(topics), user: { login: "outsider" } };
const forged = { id: 6, body: selectionComment(first), user: { login: "outsider" } };
const botBatch = { ...outsider, id: 7, user: { login: "github-actions[bot]" } };
const mixedBot = { ...botBatch, id: 8, body: botBatch.body + "\n" + selectionComment(first) };
assert.equal(inspect([outsider, forged, botBatch, mixedBot]).status, "empty");
assert.equal(inspect([outsider, forged, botBatch, mixedBot]).ignoredComments, 4);
assert.equal(inspect([{ id: 9, body: "<!-- tech-topics:candidates:v1 --> broken", user: { login: owner } }]).status, "blocked");
for (const [comments, expected] of [[[invalidBatch, pendingInvalid], "blocked"], [[], "empty"]]) {
  const guarded = await runTopicQueue({
    adapter: { listComments: async () => comments, postSelection: async () => { throw new Error("Unexpected write"); } },
    owner, registry, published: [], randomIndex: () => 0
  });
  assert.equal(guarded.status, expected);
}

// More than one API page, with a genuine pending selection on the last page.
const pagedComments = [...trustedCandidates,
  ...Array.from({ length: 104 }, (_, index) => ({ id: index + 10, body: "discussion", user: { login: "outsider" } })),
  { id: 200, body: selectionComment(first), user: { login: "github-actions[bot]" } }];
const calls = [];
const adapter = githubQueueAdapter({ repository: "maintainer/test", issue: 21, fetchImpl: async (url, options) => {
  calls.push({ url, options });
  const page = Number(new URL(url).searchParams.get("page"));
  return { ok: true, json: async () => pagedComments.slice((page - 1) * 100, page * 100) };
} });
const queried = await runTopicQueue({ adapter, owner, registry, published: [], dryRun: true });
assert.equal(queried.status, "pending");
assert.equal(queried.selection.commentId, 200);
assert.equal(calls.length, 2);
assert.equal(calls[1].url.includes("page=2"), true);
assert.ok(calls.every(call => !call.options.method && !call.options.headers.Authorization));
assert.equal("queue" in queried, false);

// Repeated execution publishes only once and preserves the pending selection.
const stored = [...trustedCandidates];
let posts = 0;
const writingAdapter = {
  listComments: async () => [...stored],
  postSelection: async topic => {
    posts++;
    const posted = { id: 299 + posts, body: selectionComment(topic), user: { login: "github-actions[bot]" } };
    stored.push(posted);
    return posted;
  }
};
const execute = dryRun => runTopicQueue({ adapter: writingAdapter, owner, registry, published: [], dryRun, randomIndex: () => 0 });
assert.equal((await execute(true)).status, "ready");
assert.equal(posts, 0);
const newSelection = await execute(false);
assert.equal(newSelection.status, "selected");
assert.equal(newSelection.eligible.length, 4);
assert.equal((await execute(false)).status, "pending");
assert.equal(posts, 1);
let reads = 0;
const intervening = {
  listComments: async () => ++reads === 1 ? trustedCandidates : stored,
  postSelection: async () => { throw new Error("Must not overwrite intervening selection"); }
};
assert.equal((await runTopicQueue({ adapter: intervening, owner, registry, published: [], randomIndex: () => 0 })).status, "pending");

const failedAdapter = githubQueueAdapter({ repository: "maintainer/test", issue: 21, token: "test-secret", fetchImpl: async () => ({ ok: false, status: 403, text: async () => "test-secret" }) });
await assert.rejects(() => failedAdapter.listComments(), error => error.message === "GitHub queue request failed (HTTP 403)");
const noToken = githubQueueAdapter({ repository: "maintainer/test", issue: 21, fetchImpl: async () => { throw new Error("Must not request"); } });
await assert.rejects(() => noToken.postSelection(first), /GITHUB_TOKEN/);
assert.match(queueSummary(queried), /pending/);
assert.match(queueSummary(blockedState), /Impedimento/);

// Exercise the real CLI offline with no token and verify fixture writes fail.
const fixtureDirectory = await mkdtemp(path.join(tmpdir(), "tech-topics-queue-"));
try {
  const fixturePath = path.join(fixtureDirectory, "queue.json");
  await writeFile(fixturePath, JSON.stringify({ repository: "maintainer/test", comments: trustedCandidates, published: [], registry: { tasks: ["explain-concept"], frameworks: ["backend"] } }));
  const cli = (...extra) => spawnSync(process.execPath, [path.join(import.meta.dirname, "select-next-topic.mjs"), "--fixture", fixturePath, "--json", ...extra], {
    encoding: "utf8", env: { ...process.env, GITHUB_TOKEN: "", GITHUB_STEP_SUMMARY: "" }
  });
  const query = cli("--dry-run");
  assert.equal(query.status, 0, query.error?.message || query.stderr);
  assert.equal(JSON.parse(query.stdout).status, "ready");
  assert.equal(JSON.parse(query.stdout).eligible.length, 5);
  const attemptedWrite = cli();
  assert.equal(attemptedWrite.status, 1);
  assert.match(attemptedWrite.stderr, /Fixtures require --dry-run/);
} finally {
  await rm(fixtureDirectory, { recursive: true, force: true });
}
console.log("PASS: paginated read-only topic queue, registry guards, provenance and idempotent selection");
