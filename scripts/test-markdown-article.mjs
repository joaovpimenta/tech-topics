import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseFragment } from "parse5";
import { compileMarkdownArticle, fromLegacyArticle, renderArticleEnvelope } from "./lib/markdown-article.mjs";

const rootPath = path.resolve(import.meta.dirname, "..");
const sourcePath = "content/articles/sample.md";
const source = fs.readFileSync(path.join(rootPath, "scripts/fixtures/markdown-article/complex.md"), "utf8");
const context = {
  sourcePath,
  rootPath,
  knownTags: ["markdown", "seguranca"],
  knownSlugs: ["sample", "base", "outro"],
  assetExists: asset => asset.startsWith("assets/")
};
const compiled = await compileMarkdownArticle({ source, ...context });

assert.equal(compiled.metadata.publishedAt, "2026-10-25");
assert.deepEqual(compiled.metadata.tags, ["markdown", "seguranca"]);
assert.match(compiled.slots.heading, /<span lang="pt-BR">Título: <\/span><span lang="en-US" data-tts-say="secure">seguro<\/span>/);
assert.equal(compiled.slots.dek, '<span lang="pt-BR">Uma introdução clara</span>');
assert.match(compiled.slots.body, /^<p>Uma conversa/);
assert.match(compiled.slots.body, /<h2 id="âncora-antiga">Uma seção<\/h2>/);
assert.doesNotMatch(compiled.slots.body, /<a name=/);
assert.match(compiled.slots.body, /class="article-table-scroll" tabindex="0" role="region" aria-label=/);
assert.match(compiled.slots.body, /<div class="article-callout"><p><span lang="en-US" data-tts-say="mark down">Markdown<\/span>/);
assert.match(compiled.slots.body, /src="assets\/sample\/example.png"/);
assert.match(compiled.slots.body, /srcset="assets\/sample\/thumb.png\?variant=small#preview 1x, assets\/sample\/caf%C3%A9.png\?variant=large#preview 2x"/);
assert.match(compiled.slots.body, /srcset="assets\/sample\/width-small.png 320w, assets\/sample\/width-large.png 640w"/);
assert.match(compiled.slots.body, /href="article\.html\?slug=outro(?:&|&#x26;)modo=leitura#intro"/);
assert.match(compiled.slots.body, /<figure class="mermaid-figure"><div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="Fluxo de compilação"><pre class="mermaid-source">/);
assert.match(compiled.slots.body, /<figcaption>O fluxo separa fonte e HTML\.<\/figcaption>/);
assert.match(compiled.slots.body, /<details class="mermaid-fallback"><summary>Ver o código Mermaid<\/summary>/);
const envelope = renderArticleEnvelope(compiled, { buildId: "build-2026-10-25" });
assert.match(envelope, /^<article data-article-format="html-v1" data-article-slug="sample" data-build-id="build-2026-10-25"><h1 data-article-slot="heading">/);
assert.equal((envelope.match(/data-article-slot="heading"/g) ?? []).length, 1);
assert.equal((envelope.match(/data-article-slot="dek"/g) ?? []).length, 1);
assert.equal((envelope.match(/data-article-slot="body"/g) ?? []).length, 1);
const envelopeDom = parseFragment(envelope);
const article = envelopeDom.childNodes.find(node => node.tagName === "article");
assert.equal(article.attrs.find(attr => attr.name === "data-article-format").value, "html-v1");
const headingSlot = article.childNodes.find(node => node.tagName === "h1" && node.attrs.some(attr => attr.value === "heading"));
const dekSlot = article.childNodes.find(node => node.tagName === "p" && node.attrs.some(attr => attr.value === "dek"));
const bodySlot = article.childNodes.find(node => node.tagName === "section" && node.attrs.some(attr => attr.value === "body"));
assert.ok(headingSlot && dekSlot && bodySlot);
const firstBodyElements = bodySlot.childNodes.filter(node => node.tagName);
assert.equal(firstBodyElements[0]?.tagName, "p", "compiled article starts with the single opening prose paragraph");
assert.equal(firstBodyElements[1]?.tagName, "h2", "no additional prose or component is injected before the next heading");
const headings = [];
const links = [];
const visit = node => { if (node.tagName === "h2" && node.attrs.some(attr => attr.name === "id" && attr.value === "âncora-antiga")) headings.push(node); if (node.tagName === "a") links.push(node); for (const child of node.childNodes ?? []) visit(child); };
visit(bodySlot);
assert.equal(headings.length, 1, "explicit Unicode anchor becomes the target heading ID");
assert.ok(links.some(node => decodeURIComponent(node.attrs.find(attr => attr.name === "href").value) === "#âncora-antiga"), "Unicode fragment link resolves to the preserved ID");

const mutate = (needle, replacement) => source.replace(needle, replacement);
const failures = [
  ["duplicate YAML key", mutate("category: Fundamentos", "title: Repetido\ncategory: Fundamentos"), /duplicate key|unique/i],
  ["unsafe YAML alias", mutate("tags: [markdown, seguranca]", "defaults: &defaults [markdown]\ntags: *defaults"), /alias|anchor/i],
  ["unsafe YAML custom tag", mutate("category: Fundamentos", "category: Fundamentos\nextra: !unsafe value"), /YAML|tag/i],
  ["deep YAML nesting", mutate("category: Fundamentos", `category: Fundamentos\nextra: ${"[".repeat(50)}x${"]".repeat(50)}`), /YAML|level|unsafe|nesting/i],
  ["unknown metadata", mutate("category: Fundamentos", "category: Fundamentos\ncustomField: value"), /unknown metadata field/],
  ["unknown tag ID", mutate("tags: [markdown, seguranca]", "tags: [missing-tag]"), /unknown tag ID/],
  ["invalid calendar date", mutate("publishedAt: 2026-10-25", "publishedAt: 2026-02-30"), /real ISO/],
  ["missing tags", mutate("tags: [markdown, seguranca]\n", ""), /tags/],
  ["heading before prose", mutate("Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.", "## Antes da prosa\n\nUma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco."), /first content block/],
  ["body h1 duplicates envelope hierarchy", mutate("## Uma seção", "# Uma seção"), /only h1/],
  ["raw HTML body h1 duplicates envelope hierarchy", mutate("Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.", "Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.\n\n<h1>Título duplicado</h1>"), /only h1/],
  ["nested raw HTML body h1 duplicates envelope hierarchy", mutate("<div class=\"article-callout\">", "<div class=\"article-callout\"><h1>Título duplicado</h1>"), /only h1/],
  ["shell prefix ID recording-play", mutate("âncora-antiga", "recording-play"), /reserved|unsafe/],
  ["raw HTML shell ID recording-play", mutate("<div class=\"article-callout\">", '<p id="recording-play">Control</p>\n\n<div class="article-callout">'), /reserved|unsafe/],
  ["reserved browser ID mixed case", mutate("âncora-antiga", "CurrentScript"), /reserved|unsafe/],
  ["reserved browser ID NFKC fullwidth", mutate("âncora-antiga", "ｃｕｒｒｅｎｔＳｃｒｉｐｔ"), /reserved|unsafe/],
  ["shell prefix ID NFKC fullwidth collision", mutate("âncora-antiga", "ｒｅｃｏｒｄｉｎｇ-play"), /reserved|unsafe/],
  ["image in opening prose", mutate("Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.", "![Capa](../../assets/sample/cover.jpg) Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco."), /first prose paragraph cannot contain an image/],
  ["HTML script", mutate("<div class=\"article-callout\">", "<script>alert(1)</script>\n\n<div class=\"article-callout\">"), /forbidden|not allowed/i],
  ["event attribute", mutate("class=\"article-callout\"", "class=\"article-callout\" onclick=\"alert(1)\""), /event handler/],
  ["obfuscated URL", mutate("../../assets/sample/example.png", "j%61vascript%3Aalert(1)"), /unsafe URL/],
  ["encoded path escape", mutate("../../assets/sample/example.png", "%252e%252e/%252e%252e/private.png"), /escapes repository|beneath assets/],
  ["srcset unsafe URL", mutate("../../assets/sample/thumb.png?variant=small#preview 1x", "j%61vascript%3Aalert(1) 1x"), /unsafe URL/],
  ["srcset invalid descriptor", mutate("640w", "0w"), /invalid srcset descriptor/],
  ["srcset duplicate descriptor", mutate("width-large.png 640w", "width-large.png 320w"), /duplicate srcset descriptor/],
  ["srcset encoded path escape", mutate("../../assets/sample/thumb.png?variant=small#preview 1x", "%252e%252e/%252e%252e/private.png 1x"), /escapes repository|beneath assets/],
  ["missing image alt", mutate("![Diagrama de exemplo](../../assets/sample/example.png)", "![](../../assets/sample/example.png)"), /alt/],
  ["unmarked Mermaid", mutate('<!-- diagram: {"label":"Fluxo de compilação","caption":"O fluxo separa fonte e HTML.","fallback":"flowchart LR\\n A --> B"} -->\n', ""), /requires an adjacent/],
  ["orphan Mermaid metadata", mutate("```mermaid", "texto intermediário\n\n```mermaid"), /immediately precede|adjacent/],
  ["duplicate Mermaid JSON key", mutate('"caption":"O fluxo separa fonte e HTML."', '"caption":"A","caption":"B"'), /diagram metadata/],
  ["diagram metadata injection", mutate('"label":"Fluxo de compilação"', '"label":"<script>"'), /diagram metadata/],
  ["Mermaid init directive", mutate("flowchart LR\n  A[Markdown] --> B[HTML]", '%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\n  A[Markdown] --> B[HTML]'), /init directives/],
  ["Mermaid click interaction", mutate("flowchart LR\n  A[Markdown] --> B[HTML]", 'flowchart LR\nclick A "javascript:alert(1)"\n  A[Markdown] --> B[HTML]'), /click interactions/],
  ["Mermaid trailing click interaction", mutate("flowchart LR\n  A[Markdown] --> B[HTML]", 'flowchart LR\n  A[Markdown] --> B[HTML]\nclick A "https://example.org"'), /click interactions/],
  ["Mermaid click word in node label remains valid", mutate("A[Markdown]", "A[click label]"), null],
  ["ID collision", mutate("[Ir para a âncora preservada](#âncora-antiga)", "## Colisao\n\n## Colisao"), /ID collision/]
];
for (const [name, invalidSource, expected] of failures) {
  if (expected === null) {
    await compileMarkdownArticle({ source: invalidSource, ...context });
    continue;
  }
  await assert.rejects(() => compileMarkdownArticle({ source: invalidSource, ...context }), error => {
    assert.match(error.message, expected, name);
    return true;
  }, name);
}
await assert.rejects(() => compileMarkdownArticle({ source: mutate("âncora-antiga", "article-body"), ...context }), /reserved|unsafe/);
await assert.rejects(() => compileMarkdownArticle({ source: mutate("âncora-antiga", "constructor"), ...context }), /reserved|unsafe/);
await assert.rejects(() => compileMarkdownArticle({ source: mutate("#âncora-antiga", "#nao-existe"), ...context }), /fragment does not match/);
const shellIds = new Set();
const collectIds = node => { for (const attr of node.attrs ?? []) if (attr.name === "id") shellIds.add(attr.value); for (const child of node.childNodes ?? []) collectIds(child); };
collectIds(parseFragment(fs.readFileSync(path.join(rootPath, "article.html"), "utf8")));
for (const filename of ["article.js", "audio.js", "speech.js"]) {
  const code = fs.readFileSync(path.join(rootPath, filename), "utf8");
  for (const match of code.matchAll(/querySelector\(\s*["']#([\w-]+)["']\s*\)/g)) shellIds.add(match[1]);
}
for (const id of shellIds) {
  await assert.rejects(() => compileMarkdownArticle({ source: mutate("âncora-antiga", id), ...context }), /reserved|unsafe/, `shell-owned ID ${id} cannot be claimed by content`);
}
await assert.rejects(() => compileMarkdownArticle({ source, sourcePath, rootPath, knownSlugs: context.knownSlugs, assetExists: context.assetExists }), /knownTags registry/);
await assert.rejects(() => compileMarkdownArticle({ source: mutate("prerequisites: [base]", "prerequisites: [missing]"), ...context }), /unknown prerequisite slug/);
await assert.rejects(() => compileMarkdownArticle({ source: mutate('<a name="âncora-antiga"></a>', '<a name="café"></a>\n\n<a name="café"></a>'), ...context }), /duplicate|reserved|unsafe/);
await assert.rejects(() => compileMarkdownArticle({ source, ...context, assetExists: asset => asset !== "assets/sample/café.png" }), /asset does not exist/);
await assert.rejects(() => compileMarkdownArticle({ source, sourcePath, rootPath, knownTags: context.knownTags, knownSlugs: context.knownSlugs }), /cover asset does not exist/);

const legacy = {
  slug: "legacy", language: "pt-BR", title: "Artigo legado", category: "Fundamentos",
  date: "25 de outubro de 2026", publishedAt: "2026-10-25", read: "3 min",
  image: "assets/legacy/legacy-cover.jpg", alt: "Capa", dek: "Abertura", excerpt: "Resumo",
  bodyHtml: '<p>Primeiro parágrafo.</p><table><tr><th>A</th></tr><tr><td>B</td></tr></table>'
};
const adapted = fromLegacyArticle(legacy, { rootPath, assetExists: () => true });
assert.equal(adapted.metadata.tags, undefined);
assert.match(adapted.slots.body, /^<p>Primeiro parágrafo\.<\/p>/);
assert.throws(() => fromLegacyArticle({ ...legacy, bodyHtml: '<p onclick="alert(1)">X</p>' }, { rootPath, assetExists: () => true }), /event attribute/);
assert.throws(() => fromLegacyArticle({ ...legacy, bodyHtml: "<p>Abertura.</p><h1>Duplicado</h1>" }, { rootPath, assetExists: () => true }), /body must not contain h1/);

const domSignature = node => {
  if (node.nodeName === "#text") return ["text", node.value];
  const attrs = [...(node.attrs ?? [])].map(({ name, value }) => [name, value]).sort(([a], [b]) => a.localeCompare(b));
  return [node.tagName ?? node.nodeName, attrs, ...(node.childNodes ?? []).filter(child => child.nodeName !== "#comment").map(domSignature)];
};
const articleFiles = fs.readdirSync(path.join(rootPath, "content/articles")).filter(name => name.endsWith(".json") && name !== "index.json");
for (const filename of articleFiles) {
  const record = JSON.parse(fs.readFileSync(path.join(rootPath, "content/articles", filename), "utf8"));
  const legacyCompiled = fromLegacyArticle(record, { rootPath });
  const expectedMetadata = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "bodyHtml"));
  assert.deepEqual(legacyCompiled.metadata, expectedMetadata, `${filename}: legacy metadata is preserved without classification`);
  assert.deepEqual(domSignature(parseFragment(legacyCompiled.slots.body)), domSignature(parseFragment(record.bodyHtml)), `${filename}: legacy HTML DOM semantics are preserved`);
}

console.log(`markdown article compiler: ${failures.length} table-driven negative cases + guard checks + complex fixture + ${articleFiles.length} legacy DOM/metadata parity checks passed`);
