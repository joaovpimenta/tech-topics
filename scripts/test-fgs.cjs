const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const article = JSON.parse(fs.readFileSync("content/articles/four-golden-signals.json", "utf8"));
assert.equal(article.slug, "four-golden-signals");
assert.equal(article.publishedAt, "2026-09-12");
assert(fs.existsSync(article.image));
assert.equal((article.bodyHtml.match(/<figure\b/g) || []).length, 3);
assert.equal((article.bodyHtml.match(/data-mermaid="true"/g) || []).length, 3);
assert.equal((article.bodyHtml.match(/class="mermaid-source"/g) || []).length, 3);
assert(!article.bodyHtml.includes("<svg"));
assert(!article.bodyHtml.includes(".svg"));
assert(!article.bodyHtml.includes("<script"));
const ids = [...article.bodyHtml.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, new Set(ids).size);
for (const [, id] of article.bodyHtml.matchAll(/href="#([^"]+)"/g)) assert(ids.includes(id));
const nodes = new Map();
for (const name of ["arrival", "traffic", "utilization", "duration", "concurrency"]) nodes.set(`#fgs-${name}`, { value: "80", textContent: "", addEventListener(event, fn) { this[event] = fn; } });
const root = { dataset: {}, querySelector(selector) { return nodes.get(selector); } };
const context = { Intl, document: { querySelector() { return root; }, addEventListener() {} } };
vm.runInNewContext(fs.readFileSync("fgs-simulator.js", "utf8"), context);
const input = nodes.get("#fgs-arrival");
for (const [arrival, expected] of [[50, "20 ms"], [90, "100 ms"], [95, "200 ms"], [99, "1.000 ms"]]) {
  input.value = String(arrival); input.input(); assert.equal(nodes.get("#fgs-duration").textContent, expected);
}
vm.runInNewContext(fs.readFileSync("fgs-simulator.js", "utf8"), { Intl, document: { querySelector() { return null; }, addEventListener() {} } });
assert.equal((90 * 100 + 10 * 1500) / 100, 240);
assert.equal(12 + 20 - 5, 27);
console.log("PASS: FGS structure, Mermaid diagrams, anchors, simulator values and no-op on other articles.");
