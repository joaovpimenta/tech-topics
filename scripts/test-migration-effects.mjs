import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = relative => readFile(new URL(relative, import.meta.url), "utf8");
const pages = await read("../.github/workflows/pages.yml");
const audio = await read("../.github/workflows/kokoro-audio.yml");
const queue = await read("../.github/workflows/select-next-topic.yml");
const validate = await read("../.github/workflows/validate.yml");

function jobCondition(yaml, name) {
  const lines = yaml.split(/\r?\n/);
  const jobLine = lines.findIndex(line => new RegExp(`^  ${name}:\\s*$`).test(line));
  assert.notEqual(jobLine, -1, `missing job ${name}`);
  const end = lines.findIndex((line, index) => index > jobLine && /^  [\w-]+:\s*$/.test(line));
  const block = lines.slice(jobLine + 1, end < 0 ? lines.length : end);
  const ifLine = block.findIndex(line => /^    if:\s*/.test(line));
  assert.notEqual(ifLine, -1, `missing if for ${name}`);
  const first = block[ifLine].replace(/^    if:\s*/, "");
  let continuation = [];
  if (first === ">-" || first === ">") {
    for (const line of block.slice(ifLine + 1)) {
      if (line.trim() && !/^      /.test(line)) break;
      if (line.trim()) continuation.push(line.trim());
    }
  }
  const expression = first === ">-" || first === ">" ? continuation.join(" ") : first;
  return expression.replace(/^\$\{\{\s*/, "").replace(/\s*\}\}$/, "").trim();
}

function evaluate(expression, context) {
  const js = expression.replace(/\b(inputs|github|needs)(\.[A-Za-z_][\w.]*)/g, (_, root, tail) => `context.${root}${tail.slice(1).split(".").map(key => `?.${key}`).join("")}`);
  return Function("context", "contains", `return (${js});`)(context, (value, part) => String(value ?? "").includes(part));
}

function actionContext(eventName, { generateAudio, advanceTopic, comment = "" } = {}) {
  return {
    inputs: { generate_audio: generateAudio, advance_topic: advanceTopic, refresh_existing: false, before_sha: "", after_sha: "", replace_existing: false },
    needs: { validate: { outputs: { new_article_slugs: `["new"]`, changed_speech_slugs: `["changed"]` } } },
    github: {
      event_name: eventName,
      ref: "refs/heads/main",
      repository_owner: "owner",
      event: { issue: { number: 21 }, comment: { user: { login: "owner" }, body: comment } },
    },
  };
}

// Read and evaluate each real Actions job condition. The spies model the first
// external boundary downstream of each enabled job; no network/GitHub adapter is used.
const flags = [false, true];
const callerEvents = ["push", "workflow_dispatch", "workflow_call", "issue_comment"];
for (const callerEvent of callerEvents) {
  for (const generateAudio of flags) {
    for (const advanceTopic of flags) {
      // A reusable workflow inherits its caller's event context. A workflow_call
      // push invocation therefore exercises the same event_name='push' expression.
      const eventName = callerEvent === "workflow_call" ? "push" : callerEvent;
      const context = actionContext(eventName, { generateAudio, advanceTopic, comment: "<!-- tech-topics:candidates:v1 -->" });
      const effects = { audioMatrix: 0, model: 0, synthesis: 0, backup: 0, upload: 0, queueSelection: 0, selectionComment: 0 };

      for (const job of ["publish-audio", "republish-edited-audio"]) {
        if (evaluate(jobCondition(pages, job), context)) effects.audioMatrix++;
      }
      if (evaluate(jobCondition(audio, "select"), context) && evaluate(jobCondition(audio, "audio"), context)) {
        effects.audioMatrix++;
        effects.model++;
        effects.synthesis++;
        effects.backup++;
        effects.upload++;
      }
      if (evaluate(jobCondition(queue, "select"), context)) {
        effects.queueSelection++;
        effects.selectionComment++;
      }
      assert.deepEqual(effects, { audioMatrix: 0, model: 0, synthesis: 0, backup: 0, upload: 0, queueSelection: 0, selectionComment: 0 }, `${callerEvent} flags=${generateAudio}/${advanceTopic}`);
    }
  }
}

for (const missingOrString of [undefined, "false", "true", "1", null]) {
  const context = actionContext("workflow_dispatch", { generateAudio: missingOrString, advanceTopic: missingOrString });
  assert.equal(evaluate(jobCondition(audio, "select"), context), false);
  assert.equal(evaluate(jobCondition(queue, "select"), context), false);
}

for (const comment of ["<!-- tech-topics:candidates:v1 -->", "not a queue command"]) {
  const context = actionContext("issue_comment", { generateAudio: true, advanceTopic: true, comment });
  assert.equal(evaluate(jobCondition(queue, "select"), context), false);
}

assert.match(pages, /generate_audio:[\s\S]*?default: false/);
assert.match(pages, /advance_topic:[\s\S]*?default: false/);
assert.match(audio, /generate_audio:[\s\S]*?default: false/);
assert.match(audio, /needs: select\n\s+if: needs\.select\.outputs\.slugs != '\[\]'/);
assert.match(queue, /advance_topic:[\s\S]*?default: false/);
assert.match(pages, /deploy:\s*\n\s+name: Deploy GitHub Pages\n\s+needs: validate/);
assert.match(pages, /needs: \[validate, deploy\]/);
assert.doesNotMatch(pages, /deploy:[\s\S]{0,160}always\(\)/);
assert.doesNotMatch(pages.match(/  deploy:[\s\S]*?(?=\n  publish-audio:)/)?.[0] ?? "", /\n    if:/);
assert.match(validate, /name: Content and application lint/);
const ignoredPaths = pages.match(/paths-ignore:\s*([\s\S]*?)\n  workflow_dispatch:/)?.[1] ?? "";
assert.doesNotMatch(ignoredPaths, /select-next-topic|kokoro-audio/);
console.log("PASS: actual workflow conditions block every migration side effect across flag combinations and events");
