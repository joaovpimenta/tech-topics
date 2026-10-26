const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = process.cwd();
const playwrightPath = process.env.TECH_TOPICS_PLAYWRIGHT || "C:/Users/gabri/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
const chromiumPath = process.env.TECH_TOPICS_CHROMIUM || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const { chromium } = require(playwrightPath);

function startServer() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const target = path.resolve(root, "." + pathname);
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      response.writeHead(404).end("not found");
      return;
    }
    const type = target.endsWith(".html") ? "text/html; charset=utf-8" :
      target.endsWith(".js") ? "text/javascript; charset=utf-8" :
      target.endsWith(".json") ? "application/json; charset=utf-8" :
      target.endsWith(".css") ? "text/css; charset=utf-8" : "application/octet-stream";
    response.writeHead(200, { "content-type": type });
    fs.createReadStream(target).pipe(response);
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true, executablePath: chromiumPath });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const noScript = await browser.newPage({ javaScriptEnabled: false });
    await noScript.goto(`${base}/index.html`, { waitUntil: "domcontentloaded" });
    assert.equal(await noScript.locator(".recent-item").count(), 6, "first batch must be present and navigable without JavaScript");
    assert.match(await noScript.locator(".recent-item h3 a").first().getAttribute("href"), /^article\.html\?slug=/);
    await noScript.close();

    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await page.addInitScript(() => { delete window.IntersectionObserver; });
    await page.route("**/api.github.com/**", route => route.abort());
    page.on("pageerror", error => console.error("browser page error:", error.message));
    let catalogRequests = 0;
    const articleRequests = [];
    const coverRequests = new Map();
    page.on("request", request => {
      const url = new URL(request.url());
      if (/\/content\/articles\/(?!index\.json)[^/]+\.json$/.test(url.pathname)) articleRequests.push(url.pathname);
      if (/\/assets\/[^/]+-cover\.jpg$/.test(url.pathname)) coverRequests.set(url.pathname, (coverRequests.get(url.pathname) || 0) + 1);
    });
    await page.route("**/assets/articles-catalog.json", async route => {
      catalogRequests++;
      await new Promise(resolve => setTimeout(resolve, 500));
      await route.continue();
    });
    await page.goto(`${base}/index.html`, { waitUntil: "domcontentloaded" });
    assert.equal(await page.locator(".recent-item").count(), 6, "static batch must paint before catalog response");
    const firstTitle = await page.locator(".recent-item h3 a").first().textContent();
    await page.locator("#article-count").waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector("#article-count").textContent.includes("artigo"), { timeout: 5000 }).catch(async error => {
      console.error("archive status:", await page.locator("#article-count").textContent(), await page.locator("#archive-status").textContent());
      throw error;
    });
    assert.equal(await page.locator(".recent-item").count(), 6, "hydration must reuse initial cards without duplicates");
    assert.equal(catalogRequests, 1, "catalog should be fetched once");
    assert.deepEqual(articleRequests, [], "home must not fetch full article JSON");
    await page.screenshot({ path: path.join(process.env.TEMP || root, "tech-topics-p06-home.png") });

    const favorite = page.locator(".recent-item .favorite-button").first();
    await favorite.tap();
    assert.equal(await favorite.getAttribute("aria-pressed"), "true");
    const favoriteSlugs = await page.evaluate(() => JSON.parse(localStorage.getItem("tech-topics:favorites:v1")));
    assert.equal(favoriteSlugs.length, 1, "one press must produce one favorite toggle");

    const search = page.locator("#search-input");
    await search.fill(firstTitle);
    assert.equal(await page.locator(".recent-item").count(), 1, "search filters the hydrated catalog");
    await search.fill("");
    assert.equal(await page.locator(".recent-item").count(), 6, "clearing search restores the initial batch");

    const more = page.locator("#load-more");
    assert.equal(await more.isVisible(), true, "pagination must remain available after static hydration");
    await more.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await more.click();
    assert.equal(await page.locator(".recent-item").count(), 12, "load more appends the next batch");
    const svgNamespaces = await page.locator(".recent-item svg").evaluateAll(icons => icons.map(icon => icon.namespaceURI));
    assert.equal(svgNamespaces.length, 24, "the first and second batches each keep two action icons");
    assert(svgNamespaces.every(namespace => namespace === "http://www.w3.org/2000/svg"), "static and dynamic icons must use the SVG namespace");
    assert.equal(catalogRequests, 1, "pagination/search must reuse the one catalog response");
    assert.deepEqual(articleRequests, [], "pagination must not fetch article bodies");
    assert([...coverRequests.values()].every(count => count === 1), "each requested cover must be fetched at most once");

    const injection = await page.evaluate(() => {
      const sample = {
        slug: "safe-slug", title: `Title <script>"'`, category: `Cat & <tag>`,
        image: "assets/transactional-outbox/transactional-outbox-cover.jpg",
        alt: `Alt "><svg onload=alert(1)>`, excerpt: `Text & <b>`, publishedAt: "2026-01-02"
      };
      const card = window.TechTopicsHomeCards.create(document, sample, 0);
      return {
        title: card.querySelector("h3 a").textContent,
        excerpt: card.querySelector(".excerpt").textContent,
        alt: card.querySelector("img").getAttribute("alt"),
        tags: [...card.querySelectorAll("*")].map(node => node.tagName.toLowerCase()),
        attributes: [...card.querySelectorAll("*")].flatMap(node => [...node.attributes].map(attribute => attribute.name)),
        icons: card.querySelectorAll("svg").length,
        iconNamespaces: [...card.querySelectorAll("svg")].map(icon => icon.namespaceURI)
      };
    });
    assert.equal(injection.title, `Title <script>"'`, "editorial title must stay text");
    assert.equal(injection.excerpt, "Text & <b>", "editorial excerpt must stay text");
    assert.equal(injection.alt, `Alt "><svg onload=alert(1)>`, "alt text must preserve its value without creating attributes");
    assert(!injection.tags.some(tag => ["script", "b"].includes(tag)), "editorial content must not create DOM elements");
    assert(!injection.attributes.includes("onload"), "editorial content must not create event attributes");
    assert.equal(injection.icons, 2, "the template keeps exactly its two accessible action icons");
    assert(injection.iconNamespaces.every(namespace => namespace === "http://www.w3.org/2000/svg"), "renderer-created icons must stay SVG nodes");

    const card = page.locator(".recent-item").first();
    await card.scrollIntoViewIfNeeded();
    const rect = await card.locator(".recent-image").boundingBox();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: Math.round(rect.x + 20), y: Math.round(rect.y + 20) }] });
    await page.waitForTimeout(560);
    assert.equal(await page.locator("#article-quick-actions").isVisible(), true, "touch hold must hydrate quick actions");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    console.log("PASS: no-JS static links, early first batch, single hydration/catalog, search, favorites, pagination, SVG, requests, and touch preview");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
