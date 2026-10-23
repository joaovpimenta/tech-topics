import assert from "node:assert/strict";
import { validateArticleCatalog, validateSpeechDirective } from "./lib/article-contract.mjs";
import { extractOpeningParagraph } from "./lib/catalog-opening.mjs";

const article = {
  slug: "fixture", language: "pt-BR", title: "Fixture", category: "Backend",
  date: "05/10/2026", publishedAt: "2026-10-05", read: "2 min",
  image: "assets/fixture/fixture-cover.jpg", alt: "Capa", dek: "Abertura",
  excerpt: "Resumo", bodyHtml: '<p><a href="https://example.com/cqrs"><span lang="en-US">CQRS</span></a></p>'
};
const validate = value => validateArticleCatalog([{ file: "fixture.json", article: value }]);
assert.deepEqual(validate(article), []);
assert.deepEqual(validate({ ...article, speechMarkup: { title: [{ text: "Fixture", lang: "en-US", speak: "fixture" }] } }), []);
assert.ok(validate({ ...article, speechMarkup: { title: [{ text: "Outro", lang: "pt-BR" }] } }).some(error => /exactly match/.test(error.message)));
assert.ok(validate({ ...article, speechMarkup: { title: [{ text: "Fixture", lang: "pt-BR", mode: "guess" }] } }).some(error => /mode/.test(error.message)));
assert.ok(validateSpeechDirective({ "data-tts-mode": "spell", "data-tts-say": "a pê i" }).some(message => /mutually exclusive/.test(message)));
assert.ok(validateSpeechDirective({ "data-tts-say": " " }).some(message => /non-empty/.test(message)));
assert.match(validate({ ...article, bodyHtml: '<p><a href="assets/<span lang="en-US">cqrs</span>/file.py">Download</a></p>' })[0].message, /URL attributes/);
assert.match(validate({ ...article, bodyHtml: "<p><img src='assets/<span lang=\"en-US\">cqrs</span>/image.jpg'></p>" })[0].message, /URL attributes/);
assert.match(validate({ ...article, publishedAt: "2026-02-30" })[0].message, /valid ISO/);
assert.match(validate({ ...article, image: "assets/other/cover.jpg" })[0].message, /image must point/);
assert.ok(validateArticleCatalog([{ file: "fixture.json", article }, { file: "fixture.json", article }]).some(error => /duplicate article/.test(error.message)));
// The preview must use the first displayed paragraph, not a summary or the
// next block's text. Inline formatting and HTML entities are plain text.
assert.equal(
  extractOpeningParagraph('  <p>Pense num <strong>garçom</strong> que anota um pedido &amp; avisa a <span lang="en-US">cozinha</span>. É a abertura inteira.</p><p>Segundo parágrafo.</p>'),
  "Pense num garçom que anota um pedido & avisa a cozinha. É a abertura inteira."
);
assert.equal(
  extractOpeningParagraph('<p>Não corte o texto: 1 &lt; 2, &#8594; entrega, &#x2014; retomada.<br>Última frase.</p><h2>Seção</h2>'),
  "Não corte o texto: 1 < 2, → entrega, — retomada. Última frase."
);
assert.equal(extractOpeningParagraph('<div><p>Não é abertura válida.</p></div>'), "");
assert.equal(extractOpeningParagraph(null), "");

console.log("PASS: article contract rejects corrupt URL attributes, invalid dates, covers and duplicates");
