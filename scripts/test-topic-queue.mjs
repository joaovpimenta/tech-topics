import assert from "node:assert/strict";
import { chooseNext, parseQueue, selectionComment } from "./lib/topic-queue.mjs";

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
