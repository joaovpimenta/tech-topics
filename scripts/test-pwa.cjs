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
  const element = () => ({ hidden: true, value: "", children: [], setAttribute() {}, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; }, addEventListener() {} });
  const document = { createElement: element, querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); } };
  const records = [
    { slug: "old", publishedAt: "2026-09-10", title: "Antigo" },
    { slug: "new", publishedAt: "2026-09-12", title: "Novo", addedAt: "2026-09-12T09:00:00Z" },
    { slug: "newest", publishedAt: "2026-09-12", title: "Mais novo no mesmo dia", addedAt: "2026-09-12T12:00:00Z" },
    { slug: "middle", publishedAt: "2026-09-11", title: "Intermediário" }
  ];
  vm.runInNewContext(readFileSync("app.js", "utf8"), { document, Intl,
    fetch: async path => ({ ok: true, json: async () => path.includes("index.json") ? records.map(article => ({ slug: article.slug, path: article.slug, addedAt: article.addedAt })) : records.find(article => article.slug === path) })
  });
  await new Promise(setImmediate);
  const urls = nodes.get("#recent-list").children.map(card => card.children[0].href);
  assert.deepEqual(urls, ["article.html?slug=newest", "article.html?slug=new", "article.html?slug=middle", "article.html?slug=old"]);
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
