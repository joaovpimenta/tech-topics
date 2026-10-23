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
  function element() {
    const listeners = {};
    return {
      hidden: true, value: "", checked: false, children: [], listeners, dataset: {}, classList: { add() {}, toggle() {} },
      setAttribute() {}, append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; },
      addEventListener(type, callback) { listeners[type] = callback; },
      querySelector() { return null; }, appendChild(node) { this.children.push(node); },
      get childElementCount() { return this.children.length; }
    };
  }
  const document = {
    baseURI: "https://example.com/tech-topics/",
    createElement: element,
    createElementNS: element,
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
  vm.runInNewContext(readFileSync("app.js", "utf8"), {
    document, window: { location: { search: "" } }, navigator: {},
    URL, URLSearchParams, Intl, setTimeout, clearTimeout,
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
  const card = nodes.get("#recent-list").children[0];
  card.children[2].children[0].listeners.click();
  assert.deepEqual(JSON.parse(stored.get("tech-topics:favorites:v1")), ["newest"]);
  const filter = nodes.get("#favorites-only");
  filter.checked = true;
  filter.listeners.change();
  assert.deepEqual(urls(), ["article.html?slug=newest"]);
  filter.checked = false;
  filter.listeners.change();
  const search = nodes.get("#search-input");
  search.value = "Antigo";
  search.listeners.input();
  assert.deepEqual(urls(), ["article.html?slug=old"]);
}

(async () => {
  const manifest = JSON.parse(readFileSync("manifest.webmanifest", "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.start_url, "./index.html");
  for (const size of [192, 512]) assert(manifest.icons.some(icon => icon.sizes === `${size}x${size}`));
  for (const icon of manifest.icons) assert(existsSync(icon.src));
  for (const file of ["index.html", "article.html"]) assert(readFileSync(file, "utf8").includes('rel="manifest"'));
  await testWorker(); await testOrdering();
  console.log("PASS: manifest, scoped install/cache cleanup, network refresh, offline article/query/JSON fallback, newest-first ordering.");
})().catch(error => { console.error(error); process.exitCode = 1; });
