const { readFileSync, existsSync } = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

async function testWorker() {
  const handlers = {};
  const entries = new Map();
  const deleted = [];
  const key = request => typeof request === "string" ? request : request.url;
  const cache = {
    async addAll(requests) { for (const request of requests) entries.set(key(request), new Response(key(request))); },
    async put(request, response) { entries.set(key(request), response); },
    async match(request) { return entries.get(key(request))?.clone(); }
  };
  let offline = false;
  let claimed = false;
  const context = vm.createContext({
    URL, Request, Response,
    importScripts() { vm.runInContext(readFileSync("sw-version.js", "utf8"), context); },
    self: {
      location: { href: "https://example.com/tech-topics/sw.js" },
      addEventListener(name, fn) { handlers[name] = fn; },
      async skipWaiting() {}, clients: { async claim() { claimed = true; } }
    },
    caches: { async open() { return cache; }, async keys() { return ["tech-topics-old", "another-app"]; }, async delete(name) { deleted.push(name); } },
    async fetch(request) { if (offline) throw Error("Offline"); return new Response(`fresh:${request.url}`); }
  });
  vm.runInContext(readFileSync("sw.js", "utf8"), context);
  let pending;
  handlers.install({ waitUntil(promise) { pending = promise; } }); await pending;
  assert(entries.has("https://example.com/tech-topics/index.html"));
  assert(entries.has("https://example.com/tech-topics/content/articles/index.json"));
  assert(entries.has("https://example.com/tech-topics/assets/articles-catalog.json"));
  assert(!entries.has("https://example.com/tech-topics/content/articles/bulkhead.json"), "full articles must not be precached");
  assert(!entries.has("https://example.com/tech-topics/assets/bulkhead/bulkhead-cover.jpg"), "covers must not be precached");
  const manifestIcons = JSON.parse(readFileSync("manifest.webmanifest", "utf8")).icons;
  for (const icon of manifestIcons) assert(entries.has(new URL(icon.src, "https://example.com/tech-topics/").href), "installable app icon must be available offline: " + icon.src);
  assert(entries.has("https://example.com/tech-topics/favicon.ico"));
  assert(entries.has("https://example.com/tech-topics/speech.js"));
  assert(entries.has("https://example.com/tech-topics/audio.js"));
  assert(entries.has("https://example.com/tech-topics/header.js"), "shared header script must be offline");
  assert(entries.has("https://example.com/tech-topics/content/tts-lexicon.json"));
  handlers.activate({ waitUntil(promise) { pending = promise; } }); await pending;
  assert.deepEqual(deleted, ["tech-topics-old"]); assert(claimed);
  async function request(path, navigate = false) {
    let response;
    handlers.fetch({ request: { url: `https://example.com${path}`, method: "GET", mode: navigate ? "navigate" : "cors" },
      respondWith(value) { response = value; }, waitUntil() {} });
    return response;
  }
  assert.equal(await request("/other-app/index.html"), undefined);
  const online = await request("/tech-topics/app.js"); assert.match(await online.text(), /^fresh:/);
  offline = true;
  assert.match(await (await request("/tech-topics/app.js")).text(), /^fresh:/);
  assert.equal((await request("/tech-topics/article.html?slug=four-golden-signals", true)).status, 200);
  assert.equal((await request("/tech-topics/", true)).status, 200);
  assert.equal((await request("/tech-topics/missing.json")).status, 503);
}

async function testOrdering() {
  const nodes = new Map();
  const docListeners = {};
  const timers = new Map();
  let timerId = 0;
  let hovered = null;
  const navigated = [];
  const shared = [];
  const setTimer = fn => { const id = ++timerId; timers.set(id, fn); return id; };
  const runTimers = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  function element() {
    const listeners = {};
    const classes = new Set();
    return {
      hidden: true, value: "", checked: false, children: [], listeners, dataset: {}, style: {},
      classList: {
        add(value) { classes.add(value); },
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
      getBoundingClientRect() { return { left: 5, top: 10, bottom: 350, width: 300, height: 150 }; },
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
    { slug: "newest", publishedAt: "2026-09-12", title: "Mais novo no mesmo dia", image: "assets/newest.jpg", excerpt: "Conceito", category: "Arquitetura", addedAt: "2026-09-12T12:00:00Z" },
    { slug: "middle", publishedAt: "2026-09-11", title: "Intermediário", image: "assets/middle.jpg", excerpt: "Detalhes", category: "Arquitetura" }
  ];
  const stored = new Map();
  const calls = [];
  const window = {
    innerWidth: 375, innerHeight: 750, location: { search: "", assign(path) { navigated.push(path); } }
  };
  vm.runInNewContext(readFileSync("app.js", "utf8"), {
    document, window, navigator: { share: async data => { shared.push(data); } },
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
  const startTouch = (id = 1) => {
    const point = touch(id, 120, 310);
    card.listeners.touchstart({
      touches: [point], changedTouches: [point], target: { closest() { return null; } }
    });
    runTimers();
    assert.equal(popup.hidden, false, "hold must show quick actions");
    assert.equal(popup.children[0].src, "assets/newest.jpg", "quick menu shows the original article cover");
    assert.equal(popup.children[3].children[0].textContent, "Ler artigo");
    assert.equal(popup.children[0].draggable, false);
    assert.equal(popup.children[2].children[0].textContent, "Arquitetura");
    assert.match(popup.children[2].children.at(-1).textContent, /Solte fora para fechar/);
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

  // Sliding onto the heart before release toggles a local favorite exactly once.
  startTouch(2);
  let favorite = popup.children[3].children[1];
  hovered = favorite;
  let scrollPrevented = false;
  docListeners.touchmove({
    changedTouches: [touch(2, 160, 215)],
    preventDefault() { scrollPrevented = true; }
  });
  assert(scrollPrevented, "active long-press must not scroll the page");
  assert(favorite.classList.contains("is-targeted"), "target icon must highlight under the finger");
  endTouch(touch(2, 160, 215), favorite);
  assert.deepEqual(JSON.parse(stored.get("tech-topics:favorites:v1")), []);

  // Sliding onto Read navigates only when released on the button.
  startTouch(3);
  endTouch(touch(3, 120, 215), popup.children[3].children[0]);
  assert.deepEqual(navigated, ["article.html?slug=newest"]);

  // Share uses the exact article URL and returns to the closed state.
  startTouch(4);
  endTouch(touch(4, 190, 215), popup.children[3].children[2]);
  await new Promise(setImmediate);
  assert.equal(shared.length, 1);
  assert.equal(shared[0].url, "https://example.com/tech-topics/article.html?slug=newest");

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
  assert(styles.includes("object-fit: contain"), "covers must use contain instead of crop");
  assert(styles.includes(".quick-cover"), "quick menu cover must preserve full artwork");
  const manifest = JSON.parse(readFileSync("manifest.webmanifest", "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.start_url, "./index.html");
  for (const size of [192, 512]) assert(manifest.icons.some(icon => icon.sizes === `${size}x${size}`));
  for (const icon of manifest.icons) assert(existsSync(icon.src));
  for (const file of ["index.html", "article.html"]) assert(readFileSync(file, "utf8").includes('rel="manifest"'));
  await testWorker(); await testOrdering();
  console.log("PASS: manifest, scoped install/cache cleanup, network refresh, offline article/query/JSON fallback, favorites, press-drag-release, keyboard access and newest-first ordering.");
})().catch(error => { console.error(error); process.exitCode = 1; });
