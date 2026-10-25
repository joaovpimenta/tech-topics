const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../dist");
const fixturePath = path.resolve(__dirname, "fixtures/article-html-v1.html");
const fixtureSlug = "m03-loader-fixture";
const fixturePathJson = `content/articles/${fixtureSlug}.json`;
const fixturePathHtml = `content/articles/${fixtureSlug}.html`;
const fixtureBuildId = "build-future-001";

function fixtureCatalog(transport = { format: "html-v1", path: fixturePathHtml, buildId: fixtureBuildId }) {
  const article = {
    slug: fixtureSlug,
    publishedAt: "2026-10-25",
    title: "Fixture futura HTML",
    category: "Migração",
    date: "25 de outubro de 2026",
    read: "2 min de leitura",
    image: "assets/bulkhead/bulkhead-cover.jpg",
    alt: "Capa sintética do teste",
    excerpt: "Resumo sintético para testar o transporte HTML futuro.",
    dek: "Subtítulo compilado para o contrato futuro."
  };
  if (transport) article.transport = transport;
  return [article];
}

async function main() {
  let chromium;
  try { ({ chromium } = require(process.env.TECH_TOPICS_PLAYWRIGHT || "playwright")); }
  catch (error) { if (error.code === "MODULE_NOT_FOUND") throw Error("Set TECH_TOPICS_PLAYWRIGHT to an existing Playwright module."); throw error; }

  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const file = path.resolve(root, `.${pathname}`);
      if (!file.startsWith(`${root}${path.sep}`)) throw Error("bad path");
      const body = await readFile(file);
      const type = file.endsWith(".js") ? "text/javascript"
        : file.endsWith(".json") ? "application/json"
          : file.endsWith(".css") ? "text/css"
            : file.endsWith(".svg") ? "image/svg+xml"
              : file.endsWith(".png") ? "image/png"
                : "text/html; charset=utf-8";
      res.setHeader("Content-Type", type);
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.TECH_TOPICS_CHROMIUM || undefined,
      args: ["--no-sandbox", "--disable-dev-shm-usage"]
    });
    const base = `http://127.0.0.1:${server.address().port}`;

    async function newPage() {
      const context = await browser.newContext({ serviceWorkers: "block" });
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.__sharedUrl = null;
        Object.defineProperty(navigator, "share", { configurable: true, value: async data => { window.__sharedUrl = data.url; } });
        Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [{ lang: "pt-BR", name: "Mock" }], speak() {}, cancel() {}, pause() {}, resume() {} } });
        window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
      });
      await page.route("**/*", async route => {
        const url = route.request().url();
        if (!url.startsWith(base)) return route.abort();
        if (process.env.TECH_TOPICS_ARTICLE_JS_SOURCE_PATH && new URL(url).pathname.endsWith("/article.js")) {
          return route.fulfill({ status: 200, contentType: "text/javascript", body: fs.readFileSync(process.env.TECH_TOPICS_ARTICLE_JS_SOURCE_PATH, "utf8") });
        }
        return route.continue();
      });
      return { page, context };
    }

    async function waitForUnavailable(page) {
      await page.waitForFunction(() => document.querySelector("#article-heading")?.textContent === "Artigo indisponível", null, { timeout: 2500 });
      assert.equal(await page.locator("#article-body").getAttribute("data-fixture-body"), null);
      assert.doesNotMatch(await page.locator("#article-body").innerText(), /fixture|conteúdo inválido/i);
      assert.equal(await page.locator("#article-category").textContent(), "Arquivo");
      assert.equal(await page.locator(".article-hero").isHidden(), true);
      assert.equal(await page.locator("#article-actions").isHidden(), true);
      assert.equal(await page.locator(".article-back").count(), 1, "the existing recovery link remains visible");
    }

    async function htmlCase({ transport = { format: "html-v1", path: fixturePathHtml, buildId: fixtureBuildId }, htmlStatus = 200, htmlBody, jsonStatus = 404, catalogStatus = 200, catalogMutator } = {}) {
      const { page, context } = await newPage();
      const requests = { catalog: 0, html: 0 };
      await page.route("**/content/articles/index.json", route => route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify([{ slug: fixtureSlug, path: fixturePathJson }])
      }));
      await page.route(`**/${fixturePathJson}`, route => route.fulfill({ status: jsonStatus, body: "not a JSON article" }));
      await page.route("**/assets/articles-catalog.json", route => {
        requests.catalog++;
        if (catalogStatus !== 200) return route.fulfill({ status: catalogStatus, body: "unavailable" });
        const catalog = fixtureCatalog(transport);
        catalogMutator?.(catalog[0]);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalog) });
      });
      await page.route(`**/${fixturePathHtml}`, route => {
        requests.html++;
        return route.fulfill({ status: htmlStatus, contentType: "text/html", body: htmlBody ?? fs.readFileSync(fixturePath, "utf8") });
      });
      await page.goto(`${base}/article.html?slug=${fixtureSlug}#fixture-section`, { waitUntil: "domcontentloaded" });
      return { page, context, requests };
    }

    // Existing JSON/index remains the active transport and keeps its controls.
    {
      const { page, context } = await newPage();
      await page.goto(`${base}/article.html?slug=consenso-raft#consenso-raft`, { waitUntil: "domcontentloaded" });
      await page.locator("#article-actions").waitFor({ state: "visible", timeout: 2500 });
      assert.match(await page.locator("#article-heading").innerText(), /Raft/);
      assert.ok((await page.locator("#article-body").innerText()).length > 1000);
      assert.equal(await page.locator("#favorite-article").getAttribute("aria-pressed"), "false");
      await page.locator("#favorite-article").click();
      assert.equal(await page.locator("#favorite-article").getAttribute("aria-pressed"), "true");
      await page.locator("#share-article").click();
      assert.equal(await page.evaluate(() => window.__sharedUrl), page.url(), "share keeps the slug and fragment");
      assert.equal(new URL(page.url()).hash, "#consenso-raft");
      await context.close();
    }

    // A future HTML response is accepted only when the catalog and envelope agree.
    {
      const { page, context, requests } = await htmlCase();
      await page.locator("#article-actions").waitFor({ state: "visible", timeout: 2500 });
      assert.equal(await page.locator("#article-heading").innerText(), "Fixture futura HTML");
      assert.equal(await page.locator("#article-heading span[lang='en']").getAttribute("data-tts-say"), "HTML");
      assert.equal(await page.locator("#article-dek").innerText(), "Subtítulo compilado para o contrato futuro.");
      assert.equal(await page.locator("#article-body #fixture-section").innerText(), "Este corpo veio do fixture HTML e mantém seu fragmento.");
      assert.equal(await page.locator("#favorite-article").getAttribute("aria-pressed"), "false");
      await page.locator("#favorite-article").click();
      assert.equal(await page.locator("#favorite-article").getAttribute("aria-pressed"), "true");
      await page.locator("#share-article").click();
      assert.equal(await page.evaluate(() => window.__sharedUrl), page.url(), "HTML transport preserves share URL and hash");
      assert.equal(new URL(page.url()).hash, "#fixture-section");
      assert.deepEqual(requests, { catalog: 1, html: 1 });
      await context.close();
    }

    // The current catalog has no transport. A 404 stays unavailable and never guesses an HTML URL.
    {
      const { page, context, requests } = await htmlCase({ transport: null });
      await waitForUnavailable(page);
      assert.deepEqual(requests, { catalog: 1, html: 0 });
      await context.close();
    }

    // Transient JSON failures do not trigger a catalog/HTML fallback.
    {
      const { page, context, requests } = await htmlCase({ jsonStatus: 500 });
      await waitForUnavailable(page);
      assert.deepEqual(requests, { catalog: 0, html: 0 });
      await context.close();
    }

    // Invalid catalog metadata and a transient catalog failure do not request or mount HTML.
    for (const testCase of [
      { name: "invalid catalog metadata", catalogMutator: article => { article.title = ""; } },
      { name: "catalog transient failure", catalogStatus: 503 }
    ]) {
      const { page, context, requests } = await htmlCase(testCase);
      await waitForUnavailable(page);
      assert.deepEqual(requests, { catalog: 1, html: 0 }, testCase.name);
      await context.close();
    }

    // Invalid envelope identity and non-404 HTML errors never mount article content.
    for (const testCase of [
      {
        name: "build id mismatch",
        htmlBody: fs.readFileSync(fixturePath, "utf8").replace(fixtureBuildId, "other-build")
      },
      {
        name: "heading and dek nested inside body",
        htmlBody: `<article data-article-format="html-v1" data-article-slug="${fixtureSlug}" data-build-id="${fixtureBuildId}"><section data-article-slot="body"><h1 data-article-slot="heading">Conteúdo inválido</h1><p data-article-slot="dek">Subtítulo inválido</p><p>Corpo inválido.</p></section></article>`
      },
      { name: "HTML transport path mismatch", transport: { format: "html-v1", path: "content/articles/other.html", buildId: fixtureBuildId }, expectedRequests: { catalog: 1, html: 0 } },
      { name: "HTML transient failure", htmlStatus: 503, htmlBody: "temporarily unavailable" }
    ]) {
      const { page, context, requests } = await htmlCase(testCase);
      await waitForUnavailable(page);
      assert.deepEqual(requests, testCase.expectedRequests ?? { catalog: 1, html: 1 }, testCase.name);
      await context.close();
    }

    console.log("PASS: legacy JSON, declared html-v1 fixture, strict envelope identity/slots, transient failures, favorites/share/hash.");
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
