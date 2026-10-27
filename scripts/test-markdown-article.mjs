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

const articleTemplate = fs.readFileSync(path.join(rootPath, "generation/templates/article.md"), "utf8");
const taxonomy = JSON.parse(fs.readFileSync(path.join(rootPath, "generation/taxonomy/tags.json"), "utf8"));
const fixtureTagIds = Object.keys(taxonomy.tags).slice(0, 2);
assert.match(articleTemplate, /^---\n[\s\S]*PREENCHER/);
await assert.rejects(() => compileMarkdownArticle({ source: articleTemplate, ...context }));
const instantiatedTemplate = articleTemplate
  .replaceAll("PREENCHER-SLUG", "sample")
  .replace("PREENCHER: título do artigo", "Artigo de fixture")
  .replace("PREENCHER: categoria editorial", "Teste")
  .replace("PREENCHER: data legível herdada do contrato vigente", "26 de outubro de 2026")
  .replace('publishedAt: "YYYY-MM-DD"', 'publishedAt: "2026-10-26"')
  .replace("PREENCHER: tempo de leitura", "1 min de leitura")
  .replace("PREENCHER: descrição objetiva da capa", "Descrição de capa de fixture")
  .replace("PREENCHER: resumo curto do artigo", "Resumo do artigo de fixture")
  .replace("PREENCHER: resumo para descoberta e busca", "Resumo para descoberta")
  .replace("PREENCHER-TAG-CANONICA", fixtureTagIds[0])
  .replace(/^# .*$/gm, "")
  .replace("PREENCHER: primeiro parágrafo em diálogo-metáfora natural, como um único parágrafo introdutório.", "Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.")
  .replace("PREENCHER: seção que explica o problema", "O problema que a ideia resolve")
  .replace("PREENCHER: desenvolva a explicação com fontes confiáveis, exemplos e limites.", "A explicação técnica detalha exemplos e limites.")
  .replace("PREENCHER: seção de aplicação", "Como aplicar a ideia")
  .replace("PREENCHER: explique decisões, trade-offs e relações com conceitos próximos.", "A aplicação discute decisões e relações com conceitos próximos.")
  .replace("PREENCHER: sintetize as ideias centrais.", "As ideias centrais ficam resumidas aqui.")
  .replace("PREENCHER: inclua perguntas que verifiquem a compreensão.", "Quais decisões ajudam a compreender o exemplo?")
  .replace("PREENCHER: proponha dois ou três exercícios executáveis ou mentais.", "Compare duas alternativas em um exercício curto.")
  .replace("PREENCHER: liste fontes com links próximos às afirmações sustentadas.", "[Fonte de fixture](https://example.com).");
const templateCompiled = await compileMarkdownArticle({ source: instantiatedTemplate, ...context, knownTags: [fixtureTagIds[0]] });
assert.equal(templateCompiled.metadata.slug, "sample");
assert.deepEqual(templateCompiled.metadata.tags, [fixtureTagIds[0]]);
assert.match(templateCompiled.slots.body, /^<p>Uma conversa/);

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
const alignedTable = await compileMarkdownArticle({
  source: `${source}\n| A | B |\n| :--- | ---: |\n| 1 | 2 |\n`,
  ...context
});
assert.match(alignedTable.slots.body, /class="article-table-scroll" tabindex="0" role="region" aria-label="[^"]+"><table><thead><tr><th align="left">A<\/th><th align="right">B<\/th>/);
const footnote = await compileMarkdownArticle({ source: `${source}\nUma nota[^x].\n\n[^x]: Texto da nota.\n`, ...context });
assert.match(footnote.slots.body, /<sup><a href="#user-content-fn-x" id="user-content-fnref-x" data-footnote-ref="" aria-describedby="footnote-label">1<\/a><\/sup>/);
assert.match(footnote.slots.body, /<section data-footnotes="" class="footnotes"><h2 class="sr-only" id="footnote-label">Footnotes<\/h2>/);
assert.match(footnote.slots.body, /class="data-footnote-backref"/);
const externalLink = await compileMarkdownArticle({ source: `${source}\n[Site](https://example.com/pic.jpg)\n`, ...context });
assert.match(externalLink.slots.body, /href="https:\/\/example\.com\/pic\.jpg"/);
const shellNavigation = await compileMarkdownArticle({
  source: `${source}\n\n<a href="index.html#recent-posts">Voltar à lista</a>\n[Outro artigo](article.html?slug=outro#intro)\n`,
  ...context
});
assert.match(shellNavigation.slots.body, /href="index\.html#recent-posts"/);
assert.match(shellNavigation.slots.body, /href="article\.html\?slug=outro#intro"/);
const inlineHtmlOpening = await compileMarkdownArticle({
  source: source.replace("Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.", "Uma conversa começa com <span lang=\"pt-BR\">uma observação</span> cotidiana e apresenta o conceito sem depender de outro bloco."),
  ...context
});
assert.match(inlineHtmlOpening.slots.body, /^<p>Uma conversa começa com <span lang="pt-BR">uma observação<\/span> cotidiana/);
const inlineHtmlButtonOpening = await compileMarkdownArticle({
  source: source.replace("Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.", "Uma conversa começa com <button type=\"button\">Play</button> uma observação cotidiana e apresenta o conceito sem depender de outro bloco."),
  ...context
});
assert.match(inlineHtmlButtonOpening.slots.body, /^<p>Uma conversa começa com <button type="button">Play<\/button> uma observação/);
const inlineLinkOpening = await compileMarkdownArticle({
  source: source.replace("Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.", "Uma conversa começa com uma [observação](./outro.md) cotidiana e apresenta o conceito sem depender de outro bloco."),
  ...context
});
assert.match(inlineLinkOpening.slots.body, /Uma conversa começa com uma <a href="article\.html\?slug=outro">observação<\/a> cotidiana/);
const multilingualUnicodeOpening = await compileMarkdownArticle({
  source: source.replace("Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.", '<span lang="en-US">A conversation</span> começa aqui com ação e 🙂.'),
  ...context
});
assert.match(multilingualUnicodeOpening.slots.body, /<span lang="en-US">A conversation<\/span> começa aqui com ação e 🙂\./);
const componentAfterOpening = await compileMarkdownArticle({ source: `${source}\n<button type="button">Play</button>\n`, ...context });
assert.match(componentAfterOpening.slots.body, /<button type="button">Play<\/button>/);
const labelAssociation = await compileMarkdownArticle({ source: `${source}\n<label for="simulator-input">Valor</label>\n`, ...context });
assert.match(labelAssociation.slots.body, /<label for="simulator-input">Valor<\/label>/);
const activeRange = await compileMarkdownArticle({
  source: `${source}\n<input id="range-test" type="range" min="0" max="10" value="5">\n`,
  ...context
});
assert.match(activeRange.slots.body, /<input[^>]*id="range-test"[^>]*type="range"[^>]*>/);
assert.doesNotMatch(activeRange.slots.body, /<input[^>]*id="range-test"[^>]*disabled/);
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
  ["standalone button paragraph before opening prose", mutate("Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.", '<button type="button">Play</button>\n\nUma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.'), /HTML component/],
  ["nested standalone button paragraph before opening prose", mutate("Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.", '<strong><button type="button">Play</button></strong>\n\nUma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.'), /HTML component/],
  ["standalone button with quoted greater-than attribute before opening prose", mutate("Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.", '<button type="button" title="1 > 0">Play</button>\n\nUma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.'), /HTML component/],
  ["standalone void input component before opening prose", mutate("Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.", '<input type="text" aria-label="Busca">\n\nUma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.'), /component cannot precede|standalone HTML component/],
  ["standalone line break before opening prose", mutate("Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.", '<br>\n\nUma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.'), /component cannot precede|standalone HTML component/],
  ["standalone label paragraph before opening prose", mutate("Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.", '<label for="search">Buscar</label>\n\nUma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.'), /HTML component/],
  ["standalone span paragraph before opening prose", mutate("Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.", '<span class="article-back">Voltar</span>\n\nUma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.'), /HTML component/],
  ["navigation anchor before opening prose", mutate("Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.", '<a class="article-back" href="./outro.md">Voltar aos artigos</a>\n\nUma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.'), /HTML component/],
  ["role button anchor before opening prose", mutate("Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.", '<a role="button" href="./outro.md">Começar</a>\n\nUma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.'), /HTML component/],
  ["wrapped navigation anchor before opening prose", mutate("Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.", '<strong><a class="article-back" href="./outro.md">Voltar aos artigos</a></strong>\n\nUma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.'), /HTML component/],
  ["leading button before prose in same paragraph", mutate("Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.", '<button type="button">Play</button> Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.'), /HTML component/],
  ["zero-width text cannot make a leading button prose", mutate("Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.", '\u200b<button type="button">Play</button>\n\nUma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.'), /HTML component/],
  ["raw HTML image before opening prose", mutate("Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.", '<p><img src="../../assets/sample/example.png" alt="Antes da abertura"></p>\n\nUma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.'), /image or component cannot precede/],
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
  ["malformed raw HTML table alignment", `${source}\n<table><tr><th align="justify">A</th></tr></table>\n`, /table alignment must be left, center or right/],
  ["remote image remains rejected beside valid external link", `${source}\n[Site](https://example.com/pic.jpg)\n\n<img src="https://example.com/pic.jpg" alt="Remote">\n`, /remote image URLs are not permitted/],
  ["remote raw image is rejected without a link", `${source}\n<img src="https://example.com/pic.jpg" alt="Remote">\n`, /remote image URLs are not permitted/],
  ["raw image fragment URL is rejected while link fragments remain valid", `${source}\n<img src="#âncora-antiga" alt="Fragment">\n`, /images cannot use fragment-only URLs/],
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
failures.push(...[
  ["strong role button before opening prose", '<strong role="button">Play</strong>', /HTML component/],
  ["wrapped formula class before opening prose", '<strong><span class="fgs-formula">x + y</span></strong>', /HTML component/],
  ...[["U+200B", "\u200B"], ["U+200C", "\u200C"], ["U+200D", "\u200D"], ["U+2060", "\u2060"], ["U+202A", "\u202A"]].map(([codePoint, invisible]) => [
    `invisible-only opening paragraph ${codePoint} before a button is rejected`,
    `<p>${invisible}</p>\n\n<button type="button">Play</button>`,
    /prose paragraph|HTML component/
  ])
].map(([name, prefix, expected]) => [
  name,
  mutate("Uma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.", `${prefix}\n\nUma conversa começa com uma observação cotidiana e apresenta o conceito sem depender de outro bloco.`),
  expected
]));
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
