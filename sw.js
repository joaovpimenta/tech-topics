importScripts("./sw-version.js");
const CACHE_PREFIX = "tech-topics-";
const CACHE_NAME = `tech-topics-${PRECACHE_VERSION}`;
const BASE_URL = new URL("./", self.location.href);
const VERSIONED_ASSETS_URL = new URL("__tech-topics-versioned-assets.json", BASE_URL).href;

function versionedAssetsIn(shell) {
  const assets = {};
  const ambiguous = new Set();
  for (const tagMatch of shell.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const tag = tagMatch[0];
    for (const match of tag.matchAll(/(?:^|\s)(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      const reference = match[1] ?? match[2] ?? match[3];
      try {
        const asset = new URL(reference, BASE_URL);
        if (asset.origin !== BASE_URL.origin
          || !asset.pathname.startsWith(BASE_URL.pathname)
          || !/\.(?:js|css)$/.test(asset.pathname)
          || asset.searchParams.size !== 1
          || !asset.searchParams.has("v")) continue;
        const version = asset.searchParams.get("v");
        if (!version) continue;
        if (Object.hasOwn(assets, asset.pathname) && assets[asset.pathname] !== version) {
          delete assets[asset.pathname];
          ambiguous.add(asset.pathname);
        } else if (!ambiguous.has(asset.pathname)) {
          assets[asset.pathname] = version;
        }
      } catch (error) { /* Ignore malformed or external references. */ }
    }
  }
  return assets;
}

async function cacheVersionedAssetIndex(cache) {
  const assets = {};
  const ambiguous = new Set();
  for (const shell of ["index.html", "article.html"]) {
    const response = await cache.match(new URL(shell, BASE_URL).href);
    if (!response) continue;
    for (const [pathname, version] of Object.entries(versionedAssetsIn(await response.text()))) {
      if (Object.hasOwn(assets, pathname) && assets[pathname] !== version) {
        delete assets[pathname];
        ambiguous.add(pathname);
      } else if (!ambiguous.has(pathname)) {
        assets[pathname] = version;
      }
    }
  }
  await cache.put(VERSIONED_ASSETS_URL, new Response(JSON.stringify(assets), {
    headers: { "Content-Type": "application/json" }
  }));
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE_FILES.map(path => new Request(new URL(path, BASE_URL), { cache: "reload" })));
      await cacheVersionedAssetIndex(cache);
    } catch (error) {
      // A partial candidate cache must never replace or damage the active version.
      // The active cache has a different content-derived name and is left intact.
      try { await caches.delete(CACHE_NAME); } catch (cleanupError) { /* Keep the original install failure. */ }
      throw error;
    }
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type !== "TECH_TOPICS_ACTIVATE_UPDATE" || !event.ports?.[0]) return;
  const responsePort = event.ports[0];
  event.waitUntil((async () => {
    try {
      await self.skipWaiting();
      responsePort.postMessage({ ok: true });
    } catch (error) {
      responsePort.postMessage({ ok: false });
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
    // Without an explicit user update, the waiting worker activates after old clients close.
    // The explicit path uses skipWaiting, but updates never claim already-open clients.
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
  const relativePath = url.pathname.slice(BASE_URL.pathname.length);
  const isArticleData = relativePath === "assets/articles-catalog.json"
    || /^content\/articles\/[a-z0-9]+(?:-[a-z0-9]+)*\.html$/.test(relativePath);
  // A reader explicitly asking for the published snapshot must not receive
  // an older cached catalog/envelope just because a worker is still active.
  const refreshArticleData = isArticleData && event.request.cache === "no-store";
  const cleanRoute = event.request.mode === "navigate" && /^[a-z0-9]+(?:-[a-z0-9]+)*\/(?:index\.html)?$/.test(relativePath)
    ? relativePath.replace(/index\.html$/, "") : null;
  const cacheKey = shellPath ? new URL(shellPath, BASE_URL).href
    : cleanRoute ? new URL(cleanRoute, BASE_URL).href : event.request;
  const response = (async () => {
    let cache;
    let saved;
    let requestCacheKey = cacheKey;
    let cacheFreshResponse = true;
    try {
      cache = await caches.open(CACHE_NAME);
      if (url.searchParams.size === 1 && url.searchParams.has("v") && /\.(?:js|css)$/.test(url.pathname)) {
        // Versioned code and styles must come from this shell's complete precache.
        cacheFreshResponse = false;
        try {
          const versionIndex = await cache.match(VERSIONED_ASSETS_URL);
          const versions = versionIndex ? await versionIndex.json() : {};
          if (versions[url.pathname] === url.searchParams.get("v")) {
            requestCacheKey = new URL(url.pathname, BASE_URL).href;
          }
        } catch (error) { /* Do not cache an asset when its shell version is unknown. */ }
      }
      saved = await cache.match(requestCacheKey);
    } catch (error) { cache = null; }
    if (saved && !refreshArticleData) return saved;
    try {
      const fresh = await fetch(event.request);
      if (fresh.ok && cache && cacheFreshResponse) {
        try { await cache.put(requestCacheKey, fresh.clone()); } catch (error) { /* Storage is best-effort. */ }
      }
      return fresh;
    } catch (error) {
      if (saved) return saved;
      // The installed worker precaches the canonical catalog. It can serve an
      // offline revisioned request only when the cached source SHA matches.
      if (relativePath === "assets/articles-catalog.json" && cache) {
        const revision = url.searchParams.get("revision");
        if (revision) {
          try {
            const canonical = await cache.match(new URL("assets/articles-catalog.json", BASE_URL).href);
            if (canonical && (await canonical.clone().json()).sourceSha === revision) return canonical;
          } catch (cacheError) { /* Keep offline fallback safe. */ }
        }
      }
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
