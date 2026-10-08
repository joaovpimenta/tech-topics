import assert from "node:assert/strict";
import { validateArticleCatalog } from "./lib/article-contract.mjs";

const article = {
  slug: "fixture", language: "pt-BR", title: "Fixture", category: "Backend",
  date: "05/10/2026", publishedAt: "2026-10-05", read: "2 min",
  image: "assets/fixture/fixture-cover.jpg", alt: "Capa", dek: "Abertura",
  excerpt: "Resumo", bodyHtml: '<p><a href="https://example.com/cqrs"><span lang="en-US">CQRS</span></a></p>'
};
const validate = value => validateArticleCatalog([{ file: "fixture.json", article: value }]);
assert.deepEqual(validate(article), []);
assert.match(validate({ ...article, bodyHtml: '<p><a href="assets/<span lang="en-US">cqrs</span>/file.py">Download</a></p>' })[0].message, /URL attributes/);
assert.match(validate({ ...article, bodyHtml: "<p><img src='assets/<span lang=\"en-US\">cqrs</span>/image.jpg'></p>" })[0].message, /URL attributes/);
assert.match(validate({ ...article, publishedAt: "2026-02-30" })[0].message, /valid ISO/);
assert.match(validate({ ...article, image: "assets/other/cover.jpg" })[0].message, /image must point/);
assert.ok(validateArticleCatalog([{ file: "fixture.json", article }, { file: "fixture.json", article }]).some(error => /duplicate article/.test(error.message)));
console.log("PASS: article contract rejects corrupt URL attributes, invalid dates, covers and duplicates");
