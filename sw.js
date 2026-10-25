importScripts("./sw-version.js");
const CACHE_PREFIX = "tech-topics-";
const CACHE_NAME = `tech-topics-${PRECACHE_VERSION}`;
const BASE_URL = new URL("./", self.location.href);

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE_FILES.map(path => new Request(new URL(path, BASE_URL), { cache: "reload" })));
    } catch (error) {
      // A partial candidate cache must never replace or damage the active version.
      // The active cache has a different content-derived name and is left intact.
      try { await caches.delete(CACHE_NAME); } catch (cleanupError) { /* Keep the original install failure. */ }
      throw error;
    }
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    // Fail closed: if cache state cannot be read, do not claim old tabs.
    let previousVersionExists = true;
    try {
      const keys = await caches.keys();
      previousVersionExists = keys.some(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME);
    } catch (error) { /* Keep old clients on their current controller if cache state is unknown. */ }
    if (!previousVersionExists) {
      // The first install has no old controller to protect and should work offline
      // without requiring an extra navigation.
      await self.clients.claim();
    }
    // Updates activate naturally after all clients of the previous worker close.
    // Never take control of or reload those clients from a waiting worker.
  })());
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== BASE_URL.origin || !url.pathname.startsWith(BASE_URL.pathname)) return;
  const homePath = new URL("index.html", BASE_URL).pathname;
  const articlePath = new URL("article.html", BASE_URL).pathname;
  const shellPath = event.request.mode !== "navigate" ? null
    : url.pathname === BASE_URL.pathname || url.pathname === homePath ? "index.html"
      : url.pathname === articlePath ? "article.html" : null;
  const cacheKey = shellPath ? new URL(shellPath, BASE_URL).href : event.request;
  const response = (async () => {
    let cache;
    let saved;
    try {
      cache = await caches.open(CACHE_NAME);
      saved = await cache.match(cacheKey);
    } catch (error) { cache = null; }
    if (saved) return saved;
    try {
      const fresh = await fetch(event.request);
      if (fresh.ok && cache) {
        try { await cache.put(cacheKey, fresh.clone()); } catch (error) { /* Storage is best-effort. */ }
      }
      return fresh;
    } catch (error) {
      if (shellPath && cache) {
        try {
          const page = await cache.match(cacheKey);
          if (page) return page;
        } catch (cacheError) { /* An unavailable cache falls through to the offline response. */ }
      }
      return new Response("Conteúdo indisponível offline. Conecte-se e tente novamente.", {
        status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  })();
  event.respondWith(response);
  event.waitUntil(response.then(() => undefined));
});
