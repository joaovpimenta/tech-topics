const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const fixtureRoot = path.join(__dirname, "fixtures/pwa-browser");
const PRECACHE_FILES = [
  "index.html", "article.html", "app.js", "article.js", "styles.css", "pwa.js",
  "assets/articles-catalog.json", "content/articles/known.json"
];
const deployments = {
  A: { directory: "a", cacheVersion: "a1" },
  B: { directory: "b", cacheVersion: "b1" },
  rollbackA: { directory: "a", cacheVersion: "a1" }
};

async function main() {
  let chromium;
  try { ({ chromium } = require(process.env.TECH_TOPICS_PLAYWRIGHT || "playwright")); }
  catch (error) {
    if (error.code === "MODULE_NOT_FOUND") throw Error("Set TECH_TOPICS_PLAYWRIGHT to an installed Playwright module.");
    throw error;
  }

  let deployment = "A";
  const networkReads = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const pathname = decodeURIComponent(url.pathname);
      networkReads.push({ deployment, pathname, search: url.search });
      let contents;
      if (pathname === "/sw.js" || pathname === "/pwa.js") {
        contents = await readFile(path.join(root, pathname.slice(1)));
      } else if (pathname === "/sw-version.js") {
        const version = deployments[deployment].cacheVersion;
        contents = `const PRECACHE_VERSION = ${JSON.stringify(version)};\nconst PRECACHE_FILES = ${JSON.stringify(PRECACHE_FILES)};\n`;
      } else {
        const fixtureName = pathname === "/assets/articles-catalog.json" ? "assets-articles-catalog.json"
          : pathname === "/content/articles/known.json" ? "known.json"
            : pathname === "/content/articles/unvisited.json" ? "unvisited.json"
              : pathname.slice(1);
        contents = await readFile(path.join(fixtureRoot, deployments[deployment].directory, fixtureName));
      }
      const contentType = pathname.endsWith(".js") ? "text/javascript; charset=utf-8"
        : pathname.endsWith(".css") ? "text/css; charset=utf-8"
          : pathname.endsWith(".json") ? "application/json; charset=utf-8"
            : "text/html; charset=utf-8";
      response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
      response.end(contents);
    } catch {
      response.writeHead(404, { "Cache-Control": "no-store" }).end("not found");
    }
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  let context;
  const watchdog = setTimeout(() => {
    void browser?.close();
    server.closeAllConnections?.();
  }, 90000);
  watchdog.unref();

  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.TECH_TOPICS_CHROMIUM || undefined,
      args: ["--no-sandbox", "--disable-dev-shm-usage"]
    });
    context = await browser.newContext();
    const base = `http://127.0.0.1:${server.address().port}`;
    await context.route("**/*", route => route.request().url().startsWith(base) ? route.continue() : route.abort());

    async function newPage(pathname, expectedVersion) {
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.__controllerChanges = 0;
        navigator.serviceWorker?.addEventListener("controllerchange", () => { window.__controllerChanges++; });
      });
      await page.goto(`${base}${pathname}`, { waitUntil: "domcontentloaded" });
      const versionKey = pathname.startsWith("/article.html") ? "__articleVersion" : "__appVersion";
      await page.waitForFunction(key => window[key] === "A" || window[key] === "B", versionKey, { timeout: 12000 });
      assert.equal(await page.evaluate(key => window[key], versionKey), expectedVersion);
      await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 12000 });
      await page.evaluate(() => {
        window.__controllerAtReady = navigator.serviceWorker.controller;
        window.__controllerChangesAtReady = window.__controllerChanges;
      });
      return page;
    }

    async function waitForWaitingState(page, expectedCache) {
      try {
        const state = await page.evaluate(async expectedCache => {
          const deadline = Date.now() + 15000;
          let lastState;
          while (Date.now() < deadline) {
            const registration = await navigator.serviceWorker.getRegistration();
            const cacheNames = await caches.keys();
            lastState = {
              waiting: registration?.waiting?.state ?? null,
              installing: registration?.installing?.state ?? null,
              active: registration?.active?.state ?? null,
              cacheNames,
              stillControlledByInitialWorker: navigator.serviceWorker.controller === window.__controllerAtReady,
              controllerChanges: window.__controllerChanges - window.__controllerChangesAtReady
            };
            if (!registration?.installing
              && registration?.waiting?.state === "installed"
              && cacheNames.includes(expectedCache)) return lastState;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          throw new Error(`Timed out waiting for an installed worker: ${JSON.stringify(lastState)}`);
        }, expectedCache);
        state.workerRequests = networkReads.filter(item => item.pathname === "/sw.js" || item.pathname === "/sw-version.js");
        return state;
      } catch (error) {
        const diagnostics = await page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return {
            installing: registration?.installing?.state ?? null,
            waiting: registration?.waiting?.state ?? null,
            active: registration?.active?.state ?? null,
            cacheNames: await caches.keys(),
            controllerIsActive: navigator.serviceWorker.controller === registration?.active,
            controllerIsInitial: navigator.serviceWorker.controller === window.__controllerAtReady,
            controllerChanges: window.__controllerChanges - window.__controllerChangesAtReady
          };
        });
        diagnostics.workerRequests = networkReads.filter(item => item.pathname === "/sw.js" || item.pathname === "/sw-version.js");
        error.message += `; update state: ${JSON.stringify(diagnostics)}`;
        throw error;
      }
    }

    async function installNextVersion(page, expectedCache) {
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        await registration.update();
      });
      const state = await waitForWaitingState(page, expectedCache);
      assert.equal(state.waiting, "installed", `the update remains waiting while prior clients are open: ${JSON.stringify(state)}`);
      assert.equal(state.active, "activated");
      assert.ok(state.cacheNames.includes(expectedCache), `the candidate cache ${expectedCache} is complete`);
      return state;
    }

    const pageAArticle = await newPage("/article.html?slug=known", "A");
    await pageAArticle.locator("#start-playback").click();
    assert.equal(await pageAArticle.evaluate(() => window.__playbackActive), true);
    const pageAHome = await newPage("/index.html", "A");

    deployment = "B";
    const cacheBeforeMiss = await pageAArticle.evaluate(async () => {
      const cache = await caches.open("tech-topics-a1");
      return Boolean(await cache.match(new URL("content/articles/unvisited.json", location.href).href));
    });
    assert.equal(cacheBeforeMiss, false, "the article fixture starts as a real precache miss");
    const firstArticleRead = await pageAArticle.evaluate(() => window.loadUnvisitedArticle());
    assert.deepEqual(firstArticleRead, { slug: "unvisited", body: "Artigo buscado em B" });
    const missRequest = networkReads.filter(item => item.pathname === "/content/articles/unvisited.json");
    assert.deepEqual(missRequest, [{ deployment: "B", pathname: "/content/articles/unvisited.json", search: "" }],
      "A's old worker fetches the first cache miss from the currently deployed B");
    const cachedMissBody = await pageAArticle.evaluate(async () => {
      const cache = await caches.open("tech-topics-a1");
      return (await cache.match(new URL("content/articles/unvisited.json", location.href))).json();
    });
    assert.deepEqual(cachedMissBody, { slug: "unvisited", body: "Artigo buscado em B" },
      "the B response is stored under the old A worker's cache");

    const bState = await installNextVersion(pageAArticle, "tech-topics-b1");
    assert.ok(bState.cacheNames.includes("tech-topics-a1"), "the A cache remains available while B waits");
    for (const page of [pageAArticle, pageAHome]) {
      const stayedOnA = await page.evaluate(async () => {
        const scriptPath = document.querySelector("#article-version") ? "article.js?v=a1" : "app.js?v=a1";
        const js = await (await fetch(scriptPath)).text();
        const catalog = await (await fetch("assets/articles-catalog.json")).json();
        const known = await (await fetch("content/articles/known.json")).json();
        const unvisited = await (await fetch("content/articles/unvisited.json")).json();
        return {
          shell: document.body.dataset.shellVersion,
          jsVersion: js.includes('= "A"'),
          catalogTitle: catalog[0].title,
          knownBody: known.body,
          unvisitedBody: unvisited.body,
          sameController: navigator.serviceWorker.controller === window.__controllerAtReady,
          controllerChanges: window.__controllerChanges - window.__controllerChangesAtReady,
          boots: window.__articleBoots ?? window.__appBoots
        };
      });
      assert.equal(stayedOnA.shell, "A");
      assert.equal(stayedOnA.jsVersion, true, "a versioned JS request remains bound to cached A bytes");
      assert.equal(stayedOnA.catalogTitle, "Catálogo A");
      assert.equal(stayedOnA.knownBody, "Artigo conhecido A");
      assert.equal(stayedOnA.unvisitedBody, "Artigo buscado em B",
        "a cache miss after deployment B is retained by the still-active A worker");
      assert.equal(stayedOnA.sameController, true, "the old tab keeps its original controller");
      assert.equal(stayedOnA.controllerChanges, 0, "B waiting does not cause controllerchange in an A tab");
      assert.equal(stayedOnA.boots, 1, "no shell/script reload occurred");
    }
    assert.equal(await pageAArticle.evaluate(() => window.__playbackActive), true,
      "the simulated playback continues while B waits");
    assert.equal(networkReads.filter(item => item.pathname === "/content/articles/unvisited.json").length, 1,
      "the first miss is stored by A and later reads remain within A's cache");

    await pageAArticle.close();
    const stillWaiting = await pageAHome.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.waiting?.state;
    });
    assert.equal(stillWaiting, "installed", "closing one of two A tabs does not activate B");
    await pageAHome.close();

    const pageB = await newPage("/article.html?slug=known", "B");
    const bContent = await pageB.evaluate(async () => ({
      shell: document.body.dataset.shellVersion,
      catalog: (await (await fetch("assets/articles-catalog.json")).json())[0].title,
      article: (await (await fetch("content/articles/known.json")).json()).body,
      retainedAArticle: await (async () => {
        const cache = await caches.open("tech-topics-a1");
        return (await cache.match(new URL("content/articles/unvisited.json", location.href))).json();
      })(),
      cacheNames: await caches.keys(),
      waiting: (await navigator.serviceWorker.getRegistration())?.waiting?.state ?? null
    }));
    assert.deepEqual(bContent, {
      shell: "B", catalog: "Catálogo B", article: "Artigo conhecido B",
      retainedAArticle: { slug: "unvisited", body: "Artigo buscado em B" },
      cacheNames: ["tech-topics-a1", "tech-topics-b1"], waiting: null
    }, "B becomes active naturally after the last A client closes; both caches remain");

    deployment = "rollbackA";
    await installNextVersion(pageB, "tech-topics-a1");
    assert.equal(await pageB.evaluate(() => document.body.dataset.shellVersion), "B",
      "the B client does not change during rollback worker installation");
    await pageB.close();

    const pageRollback = await newPage("/article.html?slug=known", "A");
    const rollbackContent = await pageRollback.evaluate(async () => ({
      shell: document.body.dataset.shellVersion,
      articleJs: window.__articleVersion,
      catalog: (await (await fetch("assets/articles-catalog.json")).json())[0].title,
      article: (await (await fetch("content/articles/known.json")).json()).body,
      retainedAArticle: await (async () => {
        const cache = await caches.open("tech-topics-a1");
        return (await cache.match(new URL("content/articles/unvisited.json", location.href))).json();
      })(),
      cacheNames: await caches.keys(),
      waiting: (await navigator.serviceWorker.getRegistration())?.waiting?.state ?? null
    }));
    assert.deepEqual(rollbackContent, {
      shell: "A", articleJs: "A", catalog: "Catálogo A", article: "Artigo conhecido A",
      retainedAArticle: { slug: "unvisited", body: "Artigo buscado em B" },
      cacheNames: ["tech-topics-a1", "tech-topics-b1"], waiting: null
    }, "rollback is a new natural worker version and retains both earlier caches");

    console.log("PASS: local real-SW A→B→A smoke, two tabs, playback state, cache miss, versioned assets, natural activation and cache retention.");
  } finally {
    clearTimeout(watchdog);
    await context?.close();
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
