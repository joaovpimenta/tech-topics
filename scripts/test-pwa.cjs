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
  hovered = favorite;
  let scrollPrevented = false;
  docListeners.touchmove({
    changedTouches: [touch(2, 160, 215)],
    preventDefault() { scrollPrevented = true; }
  });
  assert(scrollPrevented, "active long-press must not scroll the page");
  assert(favorite.classList.contains("is-targeted"), "target icon must highlight under the finger");
  assert.deepEqual(vibrations, [12], "first selection must deliver one short haptic tick");
  assert.equal(popup.dataset.activeAction, "favorite");
  assert.equal(popup.children[2].children.at(-1).textContent, "Solte para alternar favorito.");
  docListeners.touchmove({ changedTouches: [touch(2, 160, 215)], preventDefault() {} });
  assert.deepEqual(vibrations, [12], "remaining over the same action must not repeatedly vibrate");
  favorite.getBoundingClientRect = () => ({ left: 130, right: 177, top: 194, bottom: 240 });
  hovered = null;
  docListeners.touchmove({ changedTouches: [touch(2, 158, 218)], preventDefault() {} });
  assert(favorite.classList.contains("is-targeted"), "coordinate fallback must target a button even if elementFromPoint misses its SVG");
  const shareTarget = popup.children[3].children[2];
  hovered = shareTarget;
  docListeners.touchmove({
    changedTouches: [touch(2, 170, 215)],
    preventDefault() {}
  });
  assert(!favorite.classList.contains("is-targeted"), "previously highlighted action must reset");
  assert(shareTarget.classList.contains("is-targeted"), "drag highlights the newly selected action");
  assert.deepEqual(vibrations, [12, 12], "moving to another action produces exactly one new haptic tick");
  assert.equal(popup.children[2].children.at(-1).textContent, "Solte para compartilhar.");
  hovered = favorite;
  docListeners.touchmove({
    changedTouches: [touch(2, 160, 215)],
    preventDefault() {}
  });
  assert(favorite.classList.contains("is-targeted"), "dragging back restores the favorite highlight");
  assert.deepEqual(vibrations, [12, 12, 12], "returning to an action produces one haptic tick");
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
  docListeners.touchmove({ changedTouches: [touch(7, 100, 255)], preventDefault() {} });
  assert(visualOnly.classList.contains("is-targeted"));
  assert.equal(vibrations.length, 3, "visual feedback works without haptic support");
  endTouch(touch(7, 120, 310), null);

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
  await testWorker(); await testOrdering();
  console.log("PASS: manifest, scoped install/cache cleanup, network refresh, offline article/query/JSON fallback, favorites, press-drag-release, keyboard access and newest-first ordering.");
})().catch(error => { console.error(error); process.exitCode = 1; });
