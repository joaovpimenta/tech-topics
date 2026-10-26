const { readFileSync, existsSync } = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

async function testWorker() {
  const handlers = {};
  const cachesByName = new Map();
  const deleted = [];
  const key = request => typeof request === "string" ? request : request.url;
  let cacheMatchFails = false;
  const makeCache = () => {
    const entries = new Map();
    return {
      entries,
      async addAll(requests) { for (const request of requests) entries.set(key(request), new Response(key(request))); },
      async put(request, response) { entries.set(key(request), response); },
      async match(request) {
        if (cacheMatchFails) throw new Error("cache match unavailable");
        return entries.get(key(request))?.clone();
      }
    };
  };
  const oldCache = makeCache();
  oldCache.entries.set("https://example.com/tech-topics/app.js", new Response("old-version-app"));
  cachesByName.set("tech-topics-old", oldCache);
  let offline = false;
  let cacheAccessFails = false;
  let claimed = false;
  let skipWaitingCalls = 0;
  let matchAllCalls = 0;
  const updateMessages = [];
  const windows = [
    { url: "https://example.com/tech-topics/article.html?slug=bulkhead#limits", postMessage(message) { updateMessages.push(["tab-one", message]); } },
    { url: "https://example.com/tech-topics/", postMessage(message) { updateMessages.push(["tab-two", message]); } },
    { url: "https://example.com/other/index.html", postMessage(message) { updateMessages.push(["other", message]); } }
  ];
  const networkRequests = [];
  const context = vm.createContext({
    URL, Request, Response,
    importScripts() { vm.runInContext(readFileSync(process.env.TECH_TOPICS_SW_VERSION_SOURCE_PATH || "sw-version.js", "utf8"), context); },
    self: {
      location: { href: "https://example.com/tech-topics/sw.js" },
      addEventListener(name, fn) { handlers[name] = fn; },
      async skipWaiting() { skipWaitingCalls++; }, clients: {
        async claim() { claimed = true; },
        async matchAll() { matchAllCalls++; return windows; }
      }
    },
    caches: {
      async open(name) {
        if (cacheAccessFails && name !== "tech-topics-old") throw new Error("cache unavailable");
        if (!cachesByName.has(name)) cachesByName.set(name, makeCache());
        return cachesByName.get(name);
      },
      async keys() { return [...cachesByName.keys(), "another-app"]; },
      async delete(name) { deleted.push(name); return cachesByName.delete(name); }
    },
    async fetch(request) {
      networkRequests.push(request.url);
      if (offline) throw Error("Offline");
      if (request.url === "https://example.com/tech-topics/content/articles/retired.json") {
        return new Response("retired endpoint", { status: 404 });
      }
      if (request.url.startsWith("https://example.com/tech-topics/content/articles/retired.html")) {
        return new Response("<article data-article-format=\"html-v1\"></article>");
      }
      return new Response(`fresh:${request.url}`);
    }
  });
  vm.runInContext(readFileSync(process.env.TECH_TOPICS_SW_SOURCE_PATH || "sw.js", "utf8"), context);
  let pending;
  handlers.install({ waitUntil(promise) { pending = promise; } }); await pending;
  const candidate = [...cachesByName.keys()].find(name => name.startsWith("tech-topics-") && name !== "tech-topics-old");
  const entries = cachesByName.get(candidate).entries;
  assert(entries.has("https://example.com/tech-topics/index.html"));
  assert(entries.has("https://example.com/tech-topics/content/articles/index.json"));
  if (!process.env.TECH_TOPICS_SW_SOURCE_PATH) {
    assert(entries.has("https://example.com/tech-topics/assets/articles-catalog.json"));
  }
  assert(!entries.has("https://example.com/tech-topics/content/articles/bulkhead.json"), "full articles must not be precached");
  assert(!entries.has("https://example.com/tech-topics/assets/bulkhead/bulkhead-cover.jpg"), "covers must not be precached");
  assert.equal(skipWaitingCalls, 0, "an installed update waits for the browser's natural lifecycle");
  const manifestIcons = JSON.parse(readFileSync("manifest.webmanifest", "utf8")).icons;
  for (const icon of manifestIcons) assert(entries.has(new URL(icon.src, "https://example.com/tech-topics/").href), "installable app icon must be available offline: " + icon.src);
  assert(entries.has("https://example.com/tech-topics/favicon.ico"));
  assert(entries.has("https://example.com/tech-topics/speech.js"));
  assert(entries.has("https://example.com/tech-topics/audio.js"));
  assert(entries.has("https://example.com/tech-topics/header.js"), "shared header script must be offline");
  assert(entries.has("https://example.com/tech-topics/content/tts-lexicon.json"));
  handlers.activate({ waitUntil(promise) { pending = promise; } }); await pending;
  assert.deepEqual(deleted, [], "activation must preserve every prior cache until a separate recovery gate");
  assert.equal(cachesByName.has("tech-topics-old"), true, "the previous offline version remains usable");
  assert.equal(await oldCache.match("https://example.com/tech-topics/app.js").then(response => response.text()), "old-version-app",
    "candidate cache writes cannot replace a previous version's app code");
  assert.equal(claimed, false, "activation must not take control of already-open tabs");
  assert.equal(matchAllCalls, 0, "the new worker does not take over or notify existing tabs during activation");
  assert.equal(updateMessages.length, 0, "activation does not claim that old tabs have updated");
  assert.equal(skipWaitingCalls, 0, "updates wait for the browser's natural service-worker lifecycle");
  async function request(path, navigate = false) {
    let response;
    handlers.fetch({ request: { url: `https://example.com${path}`, method: "GET", mode: navigate ? "navigate" : "cors" },
      respondWith(value) { response = value; }, waitUntil() {} });
    return response;
  }
  assert.equal(await request("/other-app/index.html"), undefined);
  const online = await request("/tech-topics/app.js");
  assert.equal(await online.text(), "https://example.com/tech-topics/app.js", "a controlled tab stays on its worker's precached app version");
  const articleShellUrl = "https://example.com/tech-topics/article.html";
  const articleNavigation = await request("/tech-topics/article.html?slug=bulkhead#limits", true);
  assert.equal(await articleNavigation.text(), articleShellUrl, "article query/hash navigation reuses the cached shell");
  assert.equal(entries.has("https://example.com/tech-topics/article.html?slug=bulkhead#limits"), false,
    "navigation parameters are not stored as a second shell version");
  assert.equal(await (await request("/tech-topics/", true)).text(), "https://example.com/tech-topics/index.html");
  assert.equal(await (await request("/tech-topics/index.html?q=search", true)).text(), "https://example.com/tech-topics/index.html");
  assert.equal(networkRequests.some(url => url.includes("article.html?slug=bulkhead") || url.includes("index.html?q=search")), false,
    "known shell navigations are normalized before network access");
  entries.delete(articleShellUrl);
  const queryShellUrl = "https://example.com/tech-topics/article.html?slug=uncached#part";
  assert.match(await (await request("/tech-topics/article.html?slug=uncached#part", true)).text(), /^fresh:/);
  assert.equal(entries.has(articleShellUrl), true, "a shell network miss is saved under its canonical pathname");
  assert.equal(entries.has(queryShellUrl), false, "a shell response never enters a query-specific cache key");
  const uncached = await request("/tech-topics/content/articles/cached-on-first-visit.json");
  assert.match(await uncached.text(), /^fresh:/, "a cache miss uses the network and joins this worker's version cache");
  const retired = await request("/tech-topics/content/articles/retired.json");
  assert.equal(retired.status, 404, "an old JSON endpoint's 404 is passed to the client for its HTML fallback");
  assert.equal(await cachesByName.get(candidate).match("https://example.com/tech-topics/content/articles/retired.json"), undefined,
    "404 responses never become stale cached articles");
  const candidateArticle = await request("/tech-topics/content/articles/retired.html?build=candidate");
  assert.equal(candidateArticle.status, 200, "a candidate HTML transport can be fetched and cached by its version");
  cacheAccessFails = true;
  assert.match(await (await request("/tech-topics/assets/cache-unavailable.js")).text(), /^fresh:/,
    "Cache Storage failures do not block an online response");
  cacheAccessFails = false;
  offline = true;
  assert.equal(await (await request("/tech-topics/app.js")).text(), "https://example.com/tech-topics/app.js");
  assert.match(await (await request("/tech-topics/content/articles/cached-on-first-visit.json")).text(), /^fresh:/);
  assert.match(await (await request("/tech-topics/content/articles/retired.html?build=candidate")).text(), /article data-article-format/,
    "a cached candidate document remains available to a prepared client offline");
  assert.equal((await request("/tech-topics/article.html?slug=four-golden-signals", true)).status, 200);
  assert.equal((await request("/tech-topics/", true)).status, 200);
  assert.equal((await request("/tech-topics/missing.json")).status, 503);
  cacheAccessFails = true;
  assert.equal((await request("/tech-topics/article.html?slug=cache-open-failure", true)).status, 503,
    "an offline Cache.open failure returns the site's unavailable response");
  cacheAccessFails = false;
  cacheMatchFails = true;
  assert.equal((await request("/tech-topics/article.html?slug=cache-match-failure", true)).status, 503,
    "an offline Cache.match failure returns the site's unavailable response");
  cacheMatchFails = false;
}

async function testVersionedAssetsStayWithTheirCachedShell() {
  const handlers = {};
  const baseUrl = "https://example.com/tech-topics/";
  const shellIndex = '<script src="app.js?v=app-v1"></script>';
  const shellArticle = '<link rel="stylesheet" href="styles.css?v=css-v1"><script src="article.js?v=article-v1"></script>';
  const cacheKey = request => typeof request === "string" ? request : request.url;
  const entries = new Map();
  const matches = [];
  const oldCache = { entries: new Map([[`${baseUrl}article.js`, new Response("older-v0")]]) };
  const cache = {
    entries,
    async addAll(requests) {
      for (const request of requests) {
        const url = request.url;
        const body = url === `${baseUrl}index.html` ? shellIndex
          : url === `${baseUrl}article.html` ? shellArticle
            : url === `${baseUrl}app.js` ? "cached-app-v1"
              : url === `${baseUrl}article.js` ? "cached-article-v1"
                : url === `${baseUrl}styles.css` ? "cached-styles-v1"
                  : `precache:${url}`;
        entries.set(url, new Response(body));
      }
    },
    async match(request) { matches.push(cacheKey(request)); return entries.get(cacheKey(request))?.clone(); },
    async put(request, response) { entries.set(cacheKey(request), response); }
  };
  const cachesByName = new Map([["tech-topics-v0", oldCache]]);
  let offline = false;
  let claimed = false;
  let skipWaitingCalls = 0;
  const networkRequests = [];
  const context = vm.createContext({
    URL, Request, Response,
    importScripts() {
      context.PRECACHE_VERSION = "v1";
      context.PRECACHE_FILES = ["index.html", "article.html", "app.js", "article.js", "styles.css"];
    },
    self: {
      location: { href: `${baseUrl}sw.js` },
      addEventListener(name, fn) { handlers[name] = fn; },
      async skipWaiting() { skipWaitingCalls++; },
      clients: { async claim() { claimed = true; } }
    },
    caches: {
      async open(name) {
        if (name === "tech-topics-v0") return oldCache;
        cachesByName.set(name, cache);
        return cache;
      },
      async keys() { return [...cachesByName.keys()]; },
      async delete(name) { return cachesByName.delete(name); }
    },
    async fetch(request) {
      networkRequests.push(request.url);
      if (offline) throw new Error("offline");
      if (request.url.includes("article.js?v=")) return new Response("deployed-article-v2");
      return new Response(`network:${request.url}`);
    }
  });
  vm.runInContext(readFileSync(process.env.TECH_TOPICS_SW_SOURCE_PATH || "sw.js", "utf8"), context);
  let pending;
  handlers.install({ waitUntil(promise) { pending = promise; } });
  await pending;
  handlers.activate({ waitUntil(promise) { pending = promise; } });
  await pending;

  const versionIndex = await cache.match(`${baseUrl}__tech-topics-versioned-assets.json`);
  assert.ok(versionIndex, "installation stores asset version data from its own cached shells");
  assert.deepEqual(JSON.parse(await versionIndex.text()), {
    [new URL("article.js", baseUrl).pathname]: "article-v1",
    [new URL("styles.css", baseUrl).pathname]: "css-v1",
    [new URL("app.js", baseUrl).pathname]: "app-v1"
  }, "the version map comes from the cached v1 shells");
  assert.equal(claimed, false, "an update keeps prior clients on their original worker");
  assert.equal(skipWaitingCalls, 0, "a cached version update never calls skipWaiting");

  async function request(path) {
    let response;
    const req = new Request(new URL(path, baseUrl));
    handlers.fetch({ request: req, respondWith(value) { response = value; }, waitUntil() {} });
    return response;
  }

  offline = false;
  const deployedV2 = await request("article.js?v=article-v2");
  assert.equal(await deployedV2.text(), "deployed-article-v2", "the original v2 HTTP URL is preserved when requested");
  assert.equal(networkRequests.at(-1), `${baseUrl}article.js?v=article-v2`);
  assert.equal(entries.has(`${baseUrl}article.js?v=article-v2`), false, "a different deploy's asset is never added to the v1 cache");
  assert.equal(await entries.get(`${baseUrl}article.js`).clone().text(), "cached-article-v1", "the canonical v1 asset remains unchanged");

  offline = true;
  const callsBeforeV1 = networkRequests.length;
  const articleV1 = await request("article.js?v=article-v1");
  assert.equal(networkRequests.length, callsBeforeV1, `a v1 request served from its canonical precache never reaches the v2 network; matches=${matches.slice(-4).join(",")}`);
  assert.equal(await articleV1.text(), "cached-article-v1", "the v1 shell query resolves to its canonical v1 precache offline");
  const stylesV1 = await request("styles.css?v=css-v1");
  assert.equal(await stylesV1.text(), "cached-styles-v1", "versioned CSS uses the same shell-bound cache rule");
  assert.equal((await request("article.js?v=article-v2")).status, 503, "offline v2 cannot fall back to v1 bytes");

  offline = false;
  const querySpecific = await request("app.js?mode=preview");
  assert.equal(await querySpecific.text(), `network:${baseUrl}app.js?mode=preview`, "non-version query semantics remain intact");
  assert.equal(entries.has(`${baseUrl}app.js`), true);
  assert.equal(entries.has(`${baseUrl}app.js?mode=preview`), true);
  offline = true;
  assert.equal(await (await request("app.js?mode=preview")).text(), `network:${baseUrl}app.js?mode=preview`);
  assert.equal((await request("app.js?mode=other")).status, 503, "a different non-version query is not collapsed into the canonical key");
}

async function testFailedInstallPreservesActiveCache() {
  const handlers = {};
  const removed = [];
  let candidateCacheName;
  const oldEntries = new Map([["https://example.com/tech-topics/index.html", new Response("old-shell")]]);
  const cachesByName = new Map([["tech-topics-old", { entries: oldEntries }]]);
  const context = vm.createContext({
    URL, Request, Response,
    importScripts() { vm.runInContext(readFileSync(process.env.TECH_TOPICS_SW_VERSION_SOURCE_PATH || "sw-version.js", "utf8"), context); },
    self: {
      location: { href: "https://example.com/tech-topics/sw.js" },
      addEventListener(name, fn) { handlers[name] = fn; },
      async skipWaiting() {}, clients: { async claim() {}, async matchAll() { return []; } }
    },
    caches: {
      async open(name) {
        candidateCacheName = name;
        const cache = { entries: new Map(), async addAll(requests) {
          this.entries.set(requests[0].url, new Response("partial candidate"));
          throw new Error("quota exceeded");
        } };
        cachesByName.set(name, cache);
        return cache;
      },
      async delete(name) { removed.push(name); return cachesByName.delete(name); }
    },
    async fetch() { return new Response("fresh"); }
  });
  vm.runInContext(readFileSync(process.env.TECH_TOPICS_SW_SOURCE_PATH || "sw.js", "utf8"), context);
  let pending;
  handlers.install({ waitUntil(promise) { pending = promise; } });
  await assert.rejects(pending, /quota exceeded/);
  assert.deepEqual(removed, [candidateCacheName], "only the incomplete candidate cache is discarded");
  assert.equal(cachesByName.has("tech-topics-old"), true);
  assert.equal(await oldEntries.get("https://example.com/tech-topics/index.html").text(), "old-shell");
  assert.equal(cachesByName.has(candidateCacheName), false, "partial quota-failed resources are not retained as a candidate");
}

async function testFirstInstallClaimsWithoutReload() {
  const handlers = {};
  let cacheName;
  let claimed = false;
  const context = vm.createContext({
    URL, Request, Response,
    importScripts() { vm.runInContext(readFileSync(process.env.TECH_TOPICS_SW_VERSION_SOURCE_PATH || "sw-version.js", "utf8"), context); },
    self: {
      location: { href: "https://example.com/tech-topics/sw.js" },
      addEventListener(name, fn) { handlers[name] = fn; },
      async skipWaiting() {}, clients: { async claim() { claimed = true; }, async matchAll() { return []; } }
    },
    caches: {
      async open(name) { cacheName = name; return { async addAll() {}, async match() { return undefined; }, async put() {} }; },
      async keys() { return [cacheName]; }, async delete() { return false; }
    },
    async fetch() { return new Response("fresh"); }
  });
  vm.runInContext(readFileSync(process.env.TECH_TOPICS_SW_SOURCE_PATH || "sw.js", "utf8"), context);
  let pending;
  handlers.install({ waitUntil(promise) { pending = promise; } }); await pending;
  handlers.activate({ waitUntil(promise) { pending = promise; } }); await pending;
  assert.equal(claimed, true, "a first install controls its page so the precache works offline immediately");
}

async function testCacheKeysFailureKeepsExistingClients() {
  const handlers = {};
  let claimed = false;
  const context = vm.createContext({
    URL, Request, Response,
    importScripts() { vm.runInContext(readFileSync(process.env.TECH_TOPICS_SW_VERSION_SOURCE_PATH || "sw-version.js", "utf8"), context); },
    self: {
      location: { href: "https://example.com/tech-topics/sw.js" },
      addEventListener(name, fn) { handlers[name] = fn; },
      clients: { async claim() { claimed = true; }, async matchAll() { return []; } }
    },
    caches: { async keys() { throw new Error("storage unavailable"); } }
  });
  vm.runInContext(readFileSync(process.env.TECH_TOPICS_SW_SOURCE_PATH || "sw.js", "utf8"), context);
  let pending;
  handlers.activate({ waitUntil(promise) { pending = promise; } });
  await pending;
  assert.equal(claimed, false, "unknown cache state never claims clients from an older version");
}

async function testPwaUpdateRequiresUserAction() {
  const windowHandlers = {};
  const workerHandlers = {};
  let reloads = 0;
  let updateRequests = 0;
  let audioPlaying = false;
  const children = [];
  const element = tagName => ({
    tagName,
    style: {}, hidden: false, disabled: false, children: [], attrs: {}, listeners: {},
    setAttribute(name, value) { this.attrs[name] = value; },
    append(...items) { this.children.push(...items); },
    addEventListener(type, handler) { this.listeners[type] = handler; },
    querySelector(selector) {
      if (selector === "button") return this.children.find(child => child.tagName === "button") || null;
      if (selector === "[data-update-status]") return this.children.find(child => child.attrs["data-update-status"] !== undefined) || null;
      return null;
    }
  });
  const body = { append(child) { children.push(child); } };
  const responsePort = { onmessage: null, close() {} };
  class MessageChannelMock { constructor() { this.port1 = responsePort; this.port2 = { peer: responsePort }; } }
  const waiting = {
    state: "installed",
    addEventListener(type, handler) { workerHandlers[type] = handler; },
    postMessage(message, ports) {
      assert.equal(message.type, "TECH_TOPICS_ACTIVATE_UPDATE");
      updateRequests++;
      this.responsePort = ports[0].peer;
    }
  };
  const registration = {
    waiting, installing: null,
    addEventListener() {}
  };
  const navigator = {
    serviceWorker: {
      controller: {},
      addEventListener(type, handler) { workerHandlers[`serviceWorker:${type}`] = handler; },
      register: async () => registration
    }
  };
  const window = {
    location: { href: "https://example.com/tech-topics/article.html?slug=bulkhead#limits", reload() { reloads++; } },
    speechSynthesis: { speaking: false, pending: false }, MessageChannel: MessageChannelMock,
    addEventListener(type, handler) { windowHandlers[type] = handler; }
  };
  const document = {
    body,
    querySelector() { return null; },
    querySelectorAll(selector) { return selector === "audio, video" && audioPlaying ? [{ paused: false, ended: false }] : []; },
    getElementById(id) { return children.find(child => child.id === id) || null; },
    createElement: element
  };
  vm.runInNewContext(readFileSync("pwa.js", "utf8"), { document, window, navigator, console, setTimeout, clearTimeout });
  windowHandlers.load();
  await new Promise(setImmediate);
  workerHandlers.statechange();
  const notice = children[0];
  const message = notice.children[0];
  const button = notice.children[1];
  assert.equal(notice.attrs.role, "status");
  assert.equal(notice.attrs["aria-live"], "polite");
  assert.equal(notice.children.length, 3, "the waiting notice offers a button and a live status");
  assert.equal(button.tagName, "button");
  assert.equal(button.type, "button");
  assert.equal(button.textContent, "Atualizar agora");
  assert.equal(button.attrs["aria-label"], "Atualizar agora o Tech Topics nesta aba");
  assert.match(message.textContent, /outras abas continuarão abertas/);
  assert.equal(updateRequests, 0, "waiting for installation has no activation side effects before the click");
  assert.equal(reloads, 0);

  window.speechSynthesis.speaking = true;
  button.listeners.click();
  assert.equal(updateRequests, 0, "device speech blocks the initiating tab's update action");
  assert.match(notice.children[2].textContent, /Aguarde o fim da leitura/);
  window.speechSynthesis.speaking = false;
  audioPlaying = true;
  button.listeners.click();
  assert.equal(updateRequests, 0, "recorded playback blocks the initiating tab's update action");
  audioPlaying = false;
  button.listeners.click();
  button.listeners.click();
  assert.equal(updateRequests, 1, "duplicate clicks send only one activation request");
  assert.equal(button.disabled, true);
  assert.equal(reloads, 0, "the tab does not reload before activation is confirmed");
  waiting.responsePort.onmessage({ data: { ok: true } });
  assert.equal(reloads, 0, "the worker acknowledgement alone does not reload before activation");
  waiting.state = "activated";
  workerHandlers.statechange();
  assert.equal(reloads, 1, "the requesting tab reloads only after the worker is active");
  assert.equal(window.location.href, "https://example.com/tech-topics/article.html?slug=bulkhead#limits",
    "the initiating tab reload preserves the current URL, including slug and hash");
  assert.equal(children.length, 1, "one update notice is created in this tab");
}

async function testOrdering() {
  const nodes = new Map();
  const docListeners = {};
  const timers = new Map();
  let timerId = 0;
  let hovered = null;
  const navigated = [];
  const shared = [];
  const vibrations = [];
  const mockNavigator = { share: async data => { shared.push(data); }, vibrate: ms => { vibrations.push(ms); return true; } };
  const setTimer = fn => { const id = ++timerId; timers.set(id, fn); return id; };
  const runTimers = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  function element() {
    const listeners = {};
    const classes = new Set();
    return {
      hidden: true, value: "", checked: false, children: [], listeners, dataset: {}, style: {},
      classList: {
        add(value) { classes.add(value); },
        remove(value) { classes.delete(value); },
        toggle(value, enabled) { if (enabled) classes.add(value); else classes.delete(value); },
        contains(value) { return classes.has(value); }
      },
      setAttribute() {}, append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; },
      addEventListener(type, callback) { listeners[type] = callback; },
      appendChild(node) { this.children.push(node); },
      querySelectorAll(selector) {
        if (selector !== "[data-quick-action]") return [];
        return this.children.flatMap(node => node.children || []).filter(node => node.dataset?.quickAction);
      },
      contains(item) { return this === item || this.children.some(child => child === item || child.contains?.(item)); },
      closest(selector) { return selector === "[data-quick-action]" && this.dataset.quickAction ? this : null; },
      getBoundingClientRect() {
        const slots = {
          read: { left: 66, right: 136, top: 190, bottom: 245 },
          favorite: { left: 145, right: 190, top: 190, bottom: 245 },
          share: { left: 200, right: 245, top: 190, bottom: 245 }
        };
        const rect = slots[this.dataset.quickAction] || { left: 5, right: 305, top: 10, bottom: 350 };
        return { ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top };
      },
      focus() { this.focused = true; },
      get childElementCount() { return this.children.length; }
    };
  }
  const document = {
    baseURI: "https://example.com/tech-topics/",
    documentElement: { clientWidth: 375, clientHeight: 750 },
    body: { classList: { toggle() {}, remove() {} } },
    createElement: element,
    createElementNS: element,
    elementFromPoint() { return hovered; },
    addEventListener(type, listener) { docListeners[type] = listener; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); }
  };
  const records = [
    { slug: "old", publishedAt: "2026-09-10", title: "Antigo", image: "assets/old.jpg", excerpt: "Introdução", category: "Arquitetura" },
    { slug: "new", publishedAt: "2026-09-12", title: "Novo", image: "assets/new.jpg", excerpt: "Evolução", category: "Arquitetura", addedAt: "2026-09-12T09:00:00Z" },
    { slug: "newest", publishedAt: "2026-09-12", title: "Mais novo no mesmo dia", image: "assets/newest.jpg", excerpt: "Conceito", dek: "Descrição curta", opening: "Imagine um sistema distribuído em que dois serviços precisam concordar. A analogia inicial deve aparecer por inteiro na prévia.", category: "Arquitetura", addedAt: "2026-09-12T12:00:00Z" },
    { slug: "middle", publishedAt: "2026-09-11", title: "Intermediário", image: "assets/middle.jpg", excerpt: "Detalhes", category: "Arquitetura" }
  ];
  const stored = new Map();
  const calls = [];
  const window = {
    innerWidth: 375, innerHeight: 750, location: { search: "", assign(path) { navigated.push(path); } }
  };
  vm.runInNewContext(readFileSync("app.js", "utf8"), {
    document, window, navigator: mockNavigator,
    URL, URLSearchParams, Intl, Date, Math, setTimeout: setTimer, clearTimeout: id => timers.delete(id),
    localStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) },
    fetch: async path => {
      calls.push(path);
      if (path === "assets/articles-catalog.json") return { ok: true, json: async () => records };
      return { ok: false, json: async () => ({}) };
    }
  });
  await new Promise(setImmediate);
  const urls = () => nodes.get("#recent-list").children.map(card => card.children[0].href);
  assert.deepEqual(urls(), [
    "article.html?slug=newest", "article.html?slug=new",
    "article.html?slug=middle", "article.html?slug=old"
  ]);
  assert(!calls.some(path => /content\/articles\/(?!catalog\.json)/.test(path)), "home must not fetch full articles");

  const originalCard = nodes.get("#recent-list").children[0];
  assert.equal(originalCard.children[0].draggable, false, "card links must not enter native drag mode");
  assert.equal(originalCard.children[0].children[0].draggable, false, "card cover must not be draggable");
  let nativeDragPrevented = false;
  originalCard.listeners.dragstart({ preventDefault() { nativeDragPrevented = true; } });
  assert(nativeDragPrevented, "native image/link dragging must be canceled");
  originalCard.children[2].children[0].listeners.click();
  assert.deepEqual(JSON.parse(stored.get("tech-topics:favorites:v1")), ["newest"]);
  assert(!nodes.has("#favorites-only"), "home must not offer an unrequested favorites filter");
  const search = nodes.get("#search-input");
  search.value = "Antigo";
  search.listeners.input();
  assert.deepEqual(urls(), ["article.html?slug=old"]);
  search.value = "";
  search.listeners.input();

  // A press-and-hold alone shows the menu, but releasing away does nothing.
  const card = nodes.get("#recent-list").children[0];
  const popup = nodes.get("#article-quick-actions");
  const touch = (identifier, x, y) => ({ identifier, clientX: x, clientY: y });
  const startTouch = (id = 1, x = 120, y = 310) => {
    const point = touch(id, x, y);
    card.listeners.touchstart({
      touches: [point], changedTouches: [point], target: { closest() { return null; } }
    });
    runTimers();
    assert.equal(popup.hidden, false, "hold must show quick actions");
    assert.equal(popup.dataset.gestureActive, "", "held gestures disable native CSS hover styles");
    assert.equal(popup.children[0].src, "assets/newest.jpg", "quick menu shows the original article cover");
    assert.equal(popup.children[3].children[0].textContent, "Ler artigo");
    assert.equal(popup.children[0].draggable, false);
    assert.equal(popup.children[2].children[0].textContent, "Arquitetura");
    assert.equal(popup.children[2].children[1].textContent,
      "Imagine um sistema distribuído em que dois serviços precisam concordar. A analogia inicial deve aparecer por inteiro na prévia.",
      "the preview must display the full opening allegory, not the card excerpt or dek");
    assert.match(popup.children[2].children.at(-1).textContent, /Solte fora para fechar/);
    if (y >= 260) {
      assert.equal(popup.classList.contains("quick-actions-below"), false,
        "gesture previews in mid-page must keep actions above the finger");
      assert.equal(popup.classList.contains("quick-actions-compact"), true,
        "preview must shrink its cover when available space above the finger is limited");
      assert(Math.abs(Number.parseFloat(popup.style.top) + Number.parseFloat(popup.style.height) - y) <= 24,
        "action row must stay near the original touch point instead of below a 500px preview");
    }
    return point;
  };
  const endTouch = (point, actionTarget = null) => {
    hovered = actionTarget;
    let prevented = false;
    docListeners.touchend({
      changedTouches: [point],
      preventDefault() { prevented = true; }
    });
    assert.equal(prevented, true, "long-press release prevents an accidental article click");
    assert.equal(popup.hidden, true, "menu must close on release");
    hovered = null;
  };
  const storedBefore = stored.get("tech-topics:favorites:v1");
  endTouch(startTouch(), null);
  assert.equal(stored.get("tech-topics:favorites:v1"), storedBefore);
  assert.deepEqual(navigated, []);

  // Older cached catalogs still show a meaningful fallback, without fetching
  // the full article. Its card has an excerpt but no opening field.
  const olderCard = nodes.get("#recent-list").children[1];
  const fallbackTouch = touch(8, 120, 310);
  olderCard.listeners.touchstart({
    touches: [fallbackTouch], changedTouches: [fallbackTouch],
    target: { closest() { return null; } }
  });
  runTimers();
  assert.equal(popup.children[2].children[1].textContent, "Evolução");
  endTouch(fallbackTouch, null);

  // Sliding onto the heart before release toggles a local favorite exactly once.
  startTouch(2);
  let favorite = popup.children[3].children[1];
  // The former highlighted Read button may enlarge into Favorite's area.
  // Geometry must choose the closest *new* action, not DOM order.
  const readTarget = popup.children[3].children[0];
  readTarget.getBoundingClientRect = () => ({ left: 65, right: 174, top: 190, bottom: 245, width: 109, height: 55 });
  hovered = favorite;
  let scrollPrevented = false;
  docListeners.touchmove({
    changedTouches: [touch(2, 160, 215)],
    preventDefault() { scrollPrevented = true; }
  });
  assert(scrollPrevented, "active long-press must not scroll the page");
  assert(favorite.classList.contains("is-targeted"), "target icon must highlight under the finger");
  assert(!readTarget.classList.contains("is-targeted"), "overlapping scaled Read rectangle cannot pin selection on Read");
  assert.deepEqual(vibrations, [12], "first selection must deliver one short haptic tick");
  assert.equal(popup.dataset.activeAction, "favorite");
  assert.equal(popup.children[2].children.at(-1).textContent, "Solte para alternar favorito.");
  docListeners.touchmove({ changedTouches: [touch(2, 160, 215)], preventDefault() {} });
  assert.deepEqual(vibrations, [12], "remaining over the same action must not repeatedly vibrate");
  favorite.getBoundingClientRect = () => ({ left: 130, right: 177, top: 194, bottom: 240, width: 47, height: 46 });
  hovered = null;
  docListeners.touchmove({ changedTouches: [touch(2, 158, 218)], preventDefault() {} });
  assert(favorite.classList.contains("is-targeted"), "coordinate fallback must target a button even if elementFromPoint misses its SVG");
  const shareTarget = popup.children[3].children[2];
  hovered = shareTarget;
  docListeners.touchmove({
    changedTouches: [touch(2, 215, 215)],
    preventDefault() {}
  });
  assert(!favorite.classList.contains("is-targeted"), "previously highlighted action must reset");
  assert(shareTarget.classList.contains("is-targeted"), "drag highlights the newly selected action");
  assert(!readTarget.classList.contains("is-targeted"), "moving away clears the previous Read action");
  assert.deepEqual(vibrations, [12, 12], "moving to another action produces exactly one new haptic tick");
  assert.equal(popup.children[2].children.at(-1).textContent, "Solte para compartilhar.");
  hovered = favorite;
  docListeners.touchmove({
    changedTouches: [touch(2, 160, 215)],
    preventDefault() {}
  });
  assert(favorite.classList.contains("is-targeted"), "dragging back restores the favorite highlight");
  assert(!shareTarget.classList.contains("is-targeted"), "Share loses highlight after dragging back to Favorite");
  assert.deepEqual(vibrations, [12, 12, 12], "returning to an action produces one haptic tick");
  endTouch(touch(2, 160, 215), favorite);
  assert.deepEqual(JSON.parse(stored.get("tech-topics:favorites:v1")), []);

  // Sliding onto Read navigates only when released on the button.
  startTouch(3);
  endTouch(touch(3, 120, 215), popup.children[3].children[0]);
  assert.deepEqual(navigated, ["article.html?slug=newest"]);

  // Share uses the exact article URL and returns to the closed state.
  startTouch(4);
  endTouch(touch(4, 215, 215), popup.children[3].children[2]);
  await new Promise(setImmediate);
  assert.equal(shared.length, 1);
  assert.equal(shared[0].url, "https://example.com/tech-topics/article.html?slug=newest");

  // Near the top of the viewport, actions move to the first row and the
  // instruction asks users to drag down instead of reaching offscreen.
  const nearTop = startTouch(6, 120, 130);
  assert(popup.classList.contains("quick-actions-below"));
  assert(Number.parseFloat(popup.style.top) > 130);
  assert.match(popup.children[2].children.at(-1).textContent, /Arraste para baixo/);
  endTouch(nearTop, null);
  assert(!popup.classList.contains("quick-actions-below"), "closing clears the placement state");

  // No browser vibration API: action selection must still show visual feedback.
  delete mockNavigator.vibrate;
  startTouch(7);
  const visualOnly = popup.children[3].children[0];
  hovered = visualOnly;
  docListeners.touchmove({ changedTouches: [touch(7, 100, 215)], preventDefault() {} });
  assert(visualOnly.classList.contains("is-targeted"));
  assert.equal(vibrations.length, 3, "visual feedback works without haptic support");
  endTouch(touch(7, 120, 310), null);

  // If the mobile browser cancels the drag after long-press, preserve a
  // tappable preview instead of silently dropping all action feedback.
  startTouch(9);
  docListeners.touchcancel({ changedTouches: [touch(9, 120, 310)] });
  assert.equal(popup.hidden, false, "native touchcancel retains tappable actions");
  assert.equal(popup.children[2].children.at(-1).textContent,
    "Toque em uma ação para continuar ou pressione Escape para fechar.");
  assert.equal(popup.dataset.gestureActive, undefined, "native gesture cancellation re-enables keyboard/tap mode");
  popup.children[3].children[1].listeners.click();
  assert.equal(popup.hidden, true);
  assert.deepEqual(JSON.parse(stored.get("tech-topics:favorites:v1")), ["newest"]);

  // Starting a normal scroll before the hold threshold cancels the menu.
  const scrollCard = nodes.get("#recent-list").children[1];
  scrollCard.listeners.touchstart({
    touches: [touch(5, 120, 310)], changedTouches: [touch(5, 120, 310)],
    target: { closest() { return null; } }
  });
  docListeners.touchmove({ changedTouches: [touch(5, 120, 270)], preventDefault() {} });
  runTimers();
  assert.equal(popup.hidden, true, "scroll must not activate the quick menu");

  // Keyboard users can open, activate and close the same menu.
  let prevented = false;
  card.listeners.keydown({ key: "Enter", target: card, preventDefault() { prevented = true; } });
  assert(prevented);
  assert.equal(popup.hidden, false);
  popup.children[3].children[0].listeners.click();
  assert.equal(popup.hidden, true);
  assert.equal(navigated.length, 2);
  card.listeners.keydown({ key: "Enter", target: card, preventDefault() {} });
  docListeners.keydown({ key: "Escape" });
  assert.equal(popup.hidden, true);
}

(async () => {
  const catalog = JSON.parse(readFileSync("assets/articles-catalog.json", "utf8"));
  assert(catalog.length > 0 && catalog.every(article => typeof article.opening === "string" && article.opening.length > 0),
    "build must publish the opening paragraph of every article in the lightweight catalog");
  assert(catalog.every(article => !/<\/?(?:p|span|strong|a|code)\b/i.test(article.opening)),
    "opening paragraphs must be plain display text without article HTML tags");
  const home = readFileSync("index.html", "utf8");
  const styles = readFileSync("styles.css", "utf8");
  assert(!home.includes('id="favorites-only"'), "home has no favorites filter");
  assert(home.includes('id="article-quick-actions"'), "home has a quick-actions menu");
  assert(home.includes('role="dialog"'), "expanded quick preview is a dialog");
  const article = readFileSync("article.html", "utf8");
  for (const markup of ['class="header-inner home-header-inner"', 'class="top-search"', 'id="github-stars"', 'name="q"']) {
    assert(article.includes(markup), "article header mirrors the home: " + markup);
  }
  for (const page of [home, article]) assert(page.includes('src="header.js'), "shared star widget script is loaded");
  assert(styles.includes("user-drag: none"), "native image/link drag is disabled");
  assert(styles.includes(".article-quick-actions .quick-icon"), "preview action targets are styled");
  assert(styles.includes(".article-quick-actions .quick-icon.is-targeted"), "dragging must fill and enlarge the selected icon");
  assert(styles.includes(".article-quick-actions .quick-read.is-targeted"), "read button has target feedback");
  assert(styles.includes(".article-quick-actions.quick-actions-below .quick-controls"),
    "action row must be first when the gesture begins near the top of the screen");
  assert(styles.includes(".article-quick-actions.quick-actions-compact .quick-cover"),
    "previews must compress rather than move the actions away from the touch origin");
  assert(styles.includes(".article-quick-actions[data-active-action]"),
    "the gesture hint must also react to drag targets");
  assert(styles.includes("0 0 0 5px"), "selected icons must have a visible halo beyond the fingertip");
  assert(styles.includes("@media (prefers-reduced-motion: reduce)"), "gesture effects respect reduced motion");
  assert(styles.includes("@media (hover: hover) and (pointer: fine)"),
    "CSS :hover is only active for mouse or trackpad, not touch");
  assert(styles.includes(":not([data-gesture-active]) .quick-read:hover"),
    "CSS :hover cannot pin a button while press-and-drag is active");
  assert(styles.includes("object-fit: contain"), "covers must use contain instead of crop");
  assert(styles.includes(".quick-cover"), "quick menu cover must preserve full artwork");
  assert(styles.includes(".article-quick-actions .quick-opening"), "opening prose has an explicit reading style");
  assert(styles.includes(".article-quick-actions .quick-description"), "text can use remaining preview space");
  assert(styles.includes(".article-quick-actions.quick-actions-below .quick-controls"),
    "opening text must not displace the gesture actions when the preview opens below the finger");
  const manifest = JSON.parse(readFileSync("manifest.webmanifest", "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.start_url, "./index.html");
  for (const size of [192, 512]) assert(manifest.icons.some(icon => icon.sizes === `${size}x${size}`));
  for (const icon of manifest.icons) assert(existsSync(icon.src));
  for (const file of ["index.html", "article.html"]) assert(readFileSync(file, "utf8").includes('rel="manifest"'));
  await testWorker();
  await testVersionedAssetsStayWithTheirCachedShell();
  await testFailedInstallPreservesActiveCache();
  await testFirstInstallClaimsWithoutReload();
  await testCacheKeysFailureKeepsExistingClients();
  await testPwaUpdateRequiresUserAction();
  await testOrdering();
  console.log("PASS: versioned cache retention, shell-bound asset query normalization, quota-safe install, natural updates, offline fallback, favorites and ordering.");
})().catch(error => { console.error(error); process.exitCode = 1; });
