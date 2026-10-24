import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { effectsAllowed, requestedFlag } from "./lib/migration-effects.mjs";

const events = ["push", "workflow_call", "workflow_dispatch", "issue_comment"];
for (const event of events) {
  for (const generateAudio of [false, true]) {
    for (const advanceTopic of [false, true]) {
      assert.equal(effectsAllowed(generateAudio), false, `${event}: audio must remain frozen`);
      assert.equal(effectsAllowed(advanceTopic), false, `${event}: queue must remain frozen`);
    }
  }
}
for (const untrusted of [undefined, "false", "true", "1", 1, null]) {
  assert.equal(requestedFlag(untrusted), false);
  assert.equal(effectsAllowed(untrusted), false);
}

const pages = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
const audio = await readFile(new URL("../.github/workflows/kokoro-audio.yml", import.meta.url), "utf8");
const queue = await readFile(new URL("../.github/workflows/select-next-topic.yml", import.meta.url), "utf8");
assert.match(pages, /generate_audio:\s*false/);
assert.match(pages, /advance_topic:\s*false/);
assert.match(pages, /deploy:\s*\n\s+name: Deploy GitHub Pages\n\s+needs: validate/);
assert.match(pages, /inputs\.generate_audio == true && false/);
assert.match(pages, /inputs\.advance_topic == true && false/);
assert.match(audio, /inputs\.generate_audio == true && false/);
assert.match(audio, /needs: select\n\s+if: needs\.select\.outputs\.slugs != '\[\]'/);
assert.match(queue, /\(inputs\.advance_topic == true && false\)\s*&&\s*\(github\.event_name == 'push'/);
assert.match(queue, /issue_comment/);
assert.match(queue, /workflow_dispatch/);
assert.match(queue, /default: false/);
console.log("PASS: migration effect flags stay frozen across all events and input values");
