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
      return;
    }
    // Keep every prior cache through the migration. Existing tabs remain under
    // their original controller; a new navigation uses this activated worker.
    try {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === BASE_URL.origin && clientUrl.pathname.startsWith(BASE_URL.pathname)) {
          try { client.postMessage({ type: "TECH_TOPICS_UPDATE_ACTIVATED", version: PRECACHE_VERSION }); }
          catch (error) { /* A closing tab cannot prevent other clients from updating. */ }
        }
      }
    } catch (error) { /* A notification failure cannot invalidate the installed cache. */ }
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type !== "TECH_TOPICS_ACTIVATE_UPDATE") return;
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== BASE_URL.origin || !url.pathname.startsWith(BASE_URL.pathname)) return;
  const response = (async () => {
    let cache;
    let saved;
    try {
      cache = await caches.open(CACHE_NAME);
      saved = await cache.match(event.request);
    } catch (error) { cache = null; }
    if (saved) return saved;
    try {
      const fresh = await fetch(event.request);
      if (fresh.ok && cache) {
        try { await cache.put(event.request, fresh.clone()); } catch (error) { /* Storage is best-effort. */ }
      }
      return fresh;
    } catch (error) {
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
