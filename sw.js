importScripts("./sw-version.js");
const CACHE_PREFIX = "tech-topics-";
const CACHE_NAME = `${CACHE_PREFIX}${PRECACHE_VERSION}`;
const BASE_URL = new URL("./", self.location.href);

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_FILES.map(path => new Request(new URL(path, BASE_URL), { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== BASE_URL.origin || !url.pathname.startsWith(BASE_URL.pathname)) return;
  // Always try the network first so scheduled publications are visible immediately.
  const response = (async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const fresh = await fetch(event.request);
      if (fresh.ok) {
        try { await cache.put(event.request, fresh.clone()); } catch (error) { /* Storage is best-effort. */ }
      }
      return fresh;
    } catch (error) {
      const saved = await cache.match(event.request);
      if (saved) return saved;
      if (event.request.mode === "navigate") {
        // The query selects the article JSON, not a different HTML shell.
        const shell = url.pathname.endsWith("/article.html") ? "article.html"
          : (url.pathname === BASE_URL.pathname || url.pathname.endsWith("/index.html")) ? "index.html" : null;
        if (shell) {
          const page = await cache.match(new URL(shell, BASE_URL).href);
          if (page) return page;
        }
      }
      return new Response("Conteúdo indisponível offline. Conecte-se e tente novamente.", {
        status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  })();
  event.respondWith(response);
  event.waitUntil(response.then(() => undefined));
});
