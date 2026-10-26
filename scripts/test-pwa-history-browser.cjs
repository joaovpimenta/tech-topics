const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { createServer } = require("node:http");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const currentRef = "c24e8811ff8bb611f6cf211e46bde59321d7f291";
const historicalRefs = [
  { label: "original-fca72c3", ref: "fca72c31fcb57ffe9741a2390a04c2035639e14a", artifact: "rollback-pages-12536011249.zip", sha256: "d9e8de30cb8272ca348fda80da85c2525cb2e019bb268209aa2809152b29a483" },
  { label: "preparatory-parent-d817", ref: "d817b9489035a721bf30c14779cf7a1dfa7ab734" },
  { label: "preparatory-c24", ref: currentRef, artifact: "rollback-c24/github-pages-12603729364.zip", sha256: "cf16b5ea1ffb9c37e5a50924a8abb2f5b506e5841a35e8e97eb368d996d41253" }
];
const slug = "cqrs-projecoes-e-consistencia";
const articleJsonPath = `content/articles/${slug}.json`;
const articleHtmlPath = `content/articles/${slug}.html`;
const buildId = `m03-html-candidate-${currentRef.slice(0, 8)}`;
const candidateCacheName = `tech-topics-m03-${currentRef.slice(0, 8)}`;
const audioFile = process.env.TECH_TOPICS_M03_MP3_PATH
  || path.resolve(__dirname, "../../../../.local/validation-2026-10-24/kokoro", slug, `${slug}.mp3`);
const chaptersFile = process.env.TECH_TOPICS_M03_CHAPTERS_PATH
  || path.resolve(__dirname, "../../../../.local/validation-2026-10-24/kokoro", slug, `${slug}.chapters.json`);

function safeArchivePath(name) {
  const normalized = name.replace(/^\.\//, "").replace(/\/$/, "");
  if (!normalized || normalized === ".") return "";
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)
    || normalized.split("/").some(part => part === ".." || part === "")) {
    throw new Error(`Unsafe archive member path: ${name}`);
  }
  const resolved = path.resolve(root, normalized);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Archive member escapes the worktree: ${name}`);
  }
  return normalized;
}

function readTar(tar) {
  const files = new Map();
  let offset = 0;
  let longName = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const leaf = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/s, "");
    const name = safeArchivePath(longName || (prefix ? `${prefix}/${leaf}` : leaf));
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/s, "").trim(), 8);
    const type = String.fromCharCode(header[156] || 0);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Invalid TAR size at offset ${offset}`);
    if (type === "1" || type === "2") throw new Error(`TAR link entries are not allowed: ${name}`);
    if (type === "L") {
      longName = safeArchivePath(tar.subarray(offset + 512, offset + 512 + size).toString("utf8").replace(/\0.*$/s, ""));
      offset += 512 + Math.ceil(size / 512) * 512;
      continue;
    }
    longName = null;
    if (type === "0" || type === "\0" || type === "7") files.set(name, tar.subarray(offset + 512, offset + 512 + size));
    else if (!["5", "x", "g"].includes(type)) throw new Error(`Unsupported TAR entry type ${JSON.stringify(type)}: ${name}`);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

function readArchive(ref) {
  const archive = execFileSync("git", ["archive", ref], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  return readTar(archive);
}

function readPagesArtifact(zipPath, expectedSha, expectedRef) {
  const zip = fsSync.readFileSync(zipPath);
  const sha = crypto.createHash("sha256").update(zip).digest("hex");
  assert.equal(sha, expectedSha, `Pages ZIP SHA-256 for ${expectedRef}`);
  const eocdSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocd = zip.lastIndexOf(eocdSignature);
  assert.notEqual(eocd, -1, `Pages ZIP end record: ${zipPath}`);
  const entryCount = zip.readUInt16LE(eocd + 10);
  const centralOffset = zip.readUInt32LE(eocd + 16);
  let cursor = centralOffset;
  let tar = null;
  for (let i = 0; i < entryCount; i += 1) {
    assert.equal(zip.readUInt32LE(cursor), 0x02014b50, `ZIP central entry ${i}`);
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    if (name === "artifact.tar") {
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = zip.subarray(dataStart, dataStart + compressedSize);
      tar = method === 0 ? compressed : method === 8 ? require("node:zlib").inflateRawSync(compressed) : null;
      assert.ok(tar, `supported ZIP compression for artifact.tar (method ${method})`);
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  assert.ok(tar, `Pages ZIP has artifact.tar: ${zipPath}`);
  return readTar(tar);
}

function htmlForArticle(article) {
  const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<!doctype html><article data-article-format="html-v1" data-article-slug="${slug}" data-build-id="${buildId}">
    <header data-article-header><h1 data-article-slot="heading">${escape(article.title)}</h1>
      <p data-article-slot="dek">${article.dek}</p></header>
    <section data-article-slot="body"><span id="m03-recovery" aria-hidden="true"></span>${article.bodyHtml}</section>
  </article>`;
}

async function collectArtifactFiles(directory, base = directory, files = new Map()) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Site artifact contains an unexpected symlink: ${absolute}`);
    if (entry.isDirectory()) await collectArtifactFiles(absolute, base, files);
    else if (entry.isFile()) files.set(path.relative(base, absolute).split(path.sep).join("/"), await fs.readFile(absolute));
  }
  return files;
}

async function main() {
  let chromium;
  try { ({ chromium } = require(process.env.TECH_TOPICS_PLAYWRIGHT || "playwright")); }
  catch (error) {
    if (error.code === "MODULE_NOT_FOUND") throw Error("Set TECH_TOPICS_PLAYWRIGHT to an installed Playwright module.");
    throw error;
  }

  const repositoryRoot = path.resolve(root, "../../..");
  const integrationEvidence = process.env.TECH_TOPICS_M03_EVIDENCE_ROOT
    || path.join(repositoryRoot, ".local/integration-87-88");
  const deployedArtifacts = new Map();
  const artifactSources = new Map();
  for (const client of historicalRefs) {
    if (!client.artifact) continue;
    const zipPath = path.join(integrationEvidence, client.artifact);
    if (!fsSync.existsSync(zipPath)) continue;
    const provenancePath = path.join(path.dirname(zipPath), "provenance.json");
    const archiveFiles = readPagesArtifact(zipPath, client.sha256, client.ref);
    if (fsSync.existsSync(provenancePath)) {
      const provenance = JSON.parse(fsSync.readFileSync(provenancePath, "utf8"));
      assert.equal(provenance.sourceSha, client.ref, `artifact provenance source for ${client.label}`);
      assert.equal(provenance.sha256, client.sha256, `artifact provenance digest for ${client.label}`);
      assert.equal(provenance.digestMatches, true, `artifact declared digest for ${client.label}`);
      assert.equal(provenance.zipCrcValid, true, `artifact CRC for ${client.label}`);
    }
    deployedArtifacts.set(client.ref, archiveFiles);
    artifactSources.set(client.ref, `Pages ZIP SHA-256 ${client.sha256}`);
  }

  const dist = path.join(root, "dist");
  const candidateFiles = await collectArtifactFiles(dist);
  for (const required of ["article.html", "article.js", "sw.js", "sw-version.js", "assets/articles-catalog.json", articleJsonPath]) {
    assert.ok(candidateFiles.has(required), `build dist before running this test: ${required}`);
  }

  const sourceArticle = JSON.parse(candidateFiles.get(articleJsonPath));
  const candidateCatalog = JSON.parse(candidateFiles.get("assets/articles-catalog.json"));
  const catalogArticle = candidateCatalog.find(item => item.slug === slug);
  assert.ok(catalogArticle, `the real catalog contains ${slug}`);
  catalogArticle.transport = { format: "html-v1", path: articleHtmlPath, buildId };
  const htmlBytes = Buffer.from(htmlForArticle(sourceArticle));
  const candidateVersionText = candidateFiles.get("sw-version.js").toString("utf8")
    .replace(/const PRECACHE_VERSION = "[^"]+";/, `const PRECACHE_VERSION = ${JSON.stringify(`m03-${currentRef.slice(0, 8)}`)};`)
    .replace(/\s*"content\/articles\/index\.json",?/, "")
    .replace(/\n\];\s*$/, `,\n  ${JSON.stringify(articleHtmlPath)}\n];\n`);
  assert.match(candidateVersionText, new RegExp(articleHtmlPath.replaceAll("/", "\\/")), "the declared candidate HTML is in the candidate precache");
  const candidateVersionBytes = Buffer.from(candidateVersionText);

  const archiveCache = new Map();
  const staticCandidate = (profile, pathname) => {
    if (profile.type === "history") {
      if (deployedArtifacts.has(profile.ref)) return deployedArtifacts.get(profile.ref).get(pathname) || null;
      if (!archiveCache.has(profile.ref)) archiveCache.set(profile.ref, readArchive(profile.ref));
      return archiveCache.get(profile.ref).get(pathname) || null;
    }
    return candidateFiles.get(pathname) || null;
  };
  const contentType = pathname => pathname.endsWith(".js") ? "text/javascript; charset=utf-8"
    : pathname.endsWith(".css") ? "text/css; charset=utf-8"
      : pathname.endsWith(".json") || pathname.endsWith(".webmanifest") ? "application/json; charset=utf-8"
        : pathname.endsWith(".jpg") || pathname.endsWith(".jpeg") ? "image/jpeg"
          : pathname.endsWith(".png") ? "image/png"
            : pathname.endsWith(".svg") ? "image/svg+xml"
              : pathname.endsWith(".ico") ? "image/x-icon" : "text/html; charset=utf-8";

  for (const client of historicalRefs) {
    let deployment = { type: "history", ref: client.ref };
    let candidateFault = null;
    const server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url, "http://localhost");
        const pathname = decodeURIComponent(url.pathname).replace(/^\//, "");
        if (deployment.type === "candidate") {
          if (candidateFault === "network" && pathname === "styles.css") {
            response.writeHead(503, { "Cache-Control": "no-store" });
            return response.end("Injected precache network failure");
          }
          if (pathname === "sw.js") {
            const sw = candidateFiles.get("sw.js").toString("utf8");
            response.writeHead(200, { "Content-Type": contentType(pathname), "Cache-Control": "no-store" });
            return response.end(candidateFault === "quota"
              ? `Cache.prototype.addAll = async function () { throw new DOMException("Injected quota failure", "QuotaExceededError"); };\n${sw}`
              : sw);
          }
          if (pathname === "sw-version.js") {
            response.writeHead(200, { "Content-Type": contentType(pathname), "Cache-Control": "no-store" });
            return response.end(candidateVersionBytes);
          }
          if (pathname === "assets/articles-catalog.json") {
            response.writeHead(200, { "Content-Type": contentType(pathname), "Cache-Control": "no-store" });
            return response.end(JSON.stringify(candidateCatalog));
          }
          if (pathname === "content/articles/index.json" || pathname === articleJsonPath) {
            response.writeHead(404, { "Cache-Control": "no-store" });
            return response.end("retired JSON endpoint");
          }
          if (pathname === articleHtmlPath) {
            response.writeHead(200, { "Content-Type": contentType(pathname), "Cache-Control": "no-store" });
            return response.end(htmlBytes);
          }
        }
        const bytes = staticCandidate(deployment, pathname);
        if (!bytes) {
          response.writeHead(404, { "Cache-Control": "no-store" }).end("not found");
          return;
        }
        response.writeHead(200, { "Content-Type": contentType(pathname), "Cache-Control": "no-store" });
        response.end(bytes);
      } catch (error) {
        response.writeHead(500, { "Cache-Control": "no-store" }).end(error.message);
      }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    let browser;
    let context;
    try {
      browser = await chromium.launch({ headless: true, executablePath: process.env.TECH_TOPICS_CHROMIUM || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
      context = await browser.newContext();
      const base = `http://127.0.0.1:${server.address().port}`;
      await context.route("**/*", route => route.request().url().startsWith(base) ? route.continue() : route.abort());

      const mp3Exists = await fs.access(audioFile).then(() => true, () => false);
      const chaptersExists = await fs.access(chaptersFile).then(() => true, () => false);
      if (mp3Exists && chaptersExists) {
        const mp3 = await fs.readFile(audioFile);
        const chapters = await fs.readFile(chaptersFile);
        const fileName = `${slug}.mp3`;
        const chaptersName = `${slug}.chapters.json`;
        const assetBase = `https://github.com/joaovpimenta/tech-topics/releases/download/tts-${slug}/`;
        await context.route(`https://api.github.com/repos/joaovpimenta/tech-topics/releases/tags/tts-${slug}`, route => route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({ body: "", assets: [{ name: fileName, state: "uploaded" }, { name: chaptersName, state: "uploaded" }] })
        }));
        await context.route(`${assetBase}${fileName}`, route => {
          const range = route.request().headers().range;
          if (!range) return route.fulfill({ status: 200, contentType: "audio/mpeg", headers: { "Accept-Ranges": "bytes" }, body: mp3 });
          const [, startText, endText] = /^bytes=(\d+)-(\d*)$/.exec(range) || [];
          const start = Number(startText || 0);
          const end = Math.min(Number(endText || Math.min(start + 1024 * 1024 - 1, mp3.length - 1)), mp3.length - 1);
          return route.fulfill({ status: 206, contentType: "audio/mpeg", headers: {
            "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${mp3.length}`, "Content-Length": String(end - start + 1)
          }, body: mp3.subarray(start, end + 1) });
        });
        await context.route(`${assetBase}${chaptersName}`, route => route.fulfill({ status: 200, contentType: "application/json", body: chapters }));
      }

      const hash = "m03-recovery";
      const initialUrl = `${base}/article.html?slug=${slug}#${encodeURIComponent(hash)}`;
      async function openArticle() {
        const page = await context.newPage();
        await page.addInitScript(() => {
          const key = "__m03_document_load_count";
          const count = Number(sessionStorage.getItem(key) || "0") + 1;
          sessionStorage.setItem(key, String(count));
          window.__m03DocumentLoads = count;
          window.__m03TimeOrigin = performance.timeOrigin;
          window.__m03Controller = navigator.serviceWorker?.controller;
          window.__m03ControllerChanges = 0;
          navigator.serviceWorker?.addEventListener("controllerchange", () => { window.__m03ControllerChanges++; });
        });
        await page.goto(initialUrl, { waitUntil: "domcontentloaded" });
        await page.locator("#article-actions").waitFor({ state: "visible", timeout: 15000 });
        await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 30000 });
        await page.evaluate(() => {
          window.__m03Controller = navigator.serviceWorker.controller;
          window.__m03ControllerChanges = 0;
        });
        return page;
      }

      const pageA = await openArticle();
      const pageB = await openArticle();
      const pageSnapshots = new Map();
      for (const page of [pageA, pageB]) {
        pageSnapshots.set(page, await page.evaluate(() => ({ timeOrigin: window.__m03TimeOrigin, loads: window.__m03DocumentLoads })));
      }
      await pageA.locator("#favorite-article").click();
      assert.equal(await pageA.locator("#favorite-article").getAttribute("aria-pressed"), "true");
      const beforeUpdate = await pageA.evaluate(() => ({
        timeOrigin: window.__m03TimeOrigin,
        loads: window.__m03DocumentLoads,
        controller: navigator.serviceWorker.controller,
        cacheNames: null
      }));
      beforeUpdate.cacheNames = await pageA.evaluate(() => caches.keys());
      const previousCacheName = beforeUpdate.cacheNames.find(name => name.startsWith("tech-topics-"));
      assert.ok(previousCacheName, `the ${client.label} client has a real precache before the update`);

      let actualAudio = false;
      let audioTimeBeforeUpdate = null;
      let audioTimeAfterInstall = null;
      if (mp3Exists && chaptersExists) {
        await pageA.locator("#listen-recording").click();
        await pageA.waitForFunction(() => {
          const audio = document.querySelector("#article-recording");
          return audio && !audio.paused && audio.currentTime > 0;
        }, null, { timeout: 20000 });
        actualAudio = true;
      }

      deployment = { type: "candidate" };
      if (actualAudio) {
        audioTimeBeforeUpdate = await pageA.evaluate(() => document.querySelector("#article-recording").currentTime);
      }
      await pageA.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
      await pageA.waitForFunction(async expectedCache => (await caches.keys()).includes(expectedCache), candidateCacheName, { timeout: 30000 });
      if (actualAudio) {
        await pageA.waitForFunction(before => {
          const audio = document.querySelector("#article-recording");
          return audio && !audio.paused && audio.currentTime > before + 0.2;
        }, audioTimeBeforeUpdate, { timeout: 6000 });
        audioTimeAfterInstall = await pageA.evaluate(() => document.querySelector("#article-recording").currentTime);
        assert.ok(audioTimeAfterInstall > audioTimeBeforeUpdate + 0.2,
          "the real MP3 clock advances after the candidate cache is installed");
      }
      const waitingState = await pageA.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return {
          active: registration?.active?.state,
          waiting: registration?.waiting?.state ?? null,
          currentControllerSame: navigator.serviceWorker.controller === window.__m03Controller,
          controllerChanges: window.__m03ControllerChanges,
          documentLoads: window.__m03DocumentLoads,
          caches: await caches.keys()
        };
      });
      assert.equal(waitingState.active, "activated");
      assert.ok(beforeUpdate.cacheNames.some(name => waitingState.caches.includes(name)), "the prior cache remains while the candidate waits");
      for (const page of [pageA, pageB]) {
        const unchanged = await page.evaluate(() => ({ loads: window.__m03DocumentLoads, timeOrigin: window.__m03TimeOrigin, slug: new URL(location.href).searchParams.get("slug"), hash: location.hash }));
        assert.equal(unchanged.loads, pageSnapshots.get(page).loads, "an open old document was not reloaded by the update");
        assert.equal(unchanged.timeOrigin, pageSnapshots.get(page).timeOrigin, "the old document keeps its original runtime");
        assert.equal(unchanged.slug, slug);
        assert.equal(unchanged.hash, `#${hash}`);
        assert.equal(await page.evaluate(() => navigator.serviceWorker.controller === window.__m03Controller), true,
          "the active old document keeps its original service worker controller");
      }
      if (actualAudio) assert.equal(await pageA.evaluate(() => !document.querySelector("#article-recording").paused), true,
        "the real local Kokoro MP3 remains in playing state after installation");
      await pageA.close();
      assert.equal(await pageB.evaluate(async cacheName => (await caches.keys()).includes(cacheName), previousCacheName), true,
        "closing one of two old tabs does not remove the earlier cache");
      await pageB.close();

      const settlePage = await context.newPage();
      await settlePage.goto(`${base}/index.html`, { waitUntil: "domcontentloaded" });
      await settlePage.waitForFunction(async expectedCache => {
        const registration = await navigator.serviceWorker.getRegistration();
        return (await caches.keys()).includes(expectedCache) && !registration?.waiting && !registration?.installing;
      }, candidateCacheName, { timeout: 30000 });
      await settlePage.close();

      const candidatePage = await context.newPage();
      await candidatePage.goto(initialUrl, { waitUntil: "domcontentloaded" });
      await candidatePage.locator("#article-actions").waitFor({ state: "visible", timeout: 15000 });
      assert.equal(await candidatePage.locator("#article-heading").innerText(), sourceArticle.title);
      assert.equal(await candidatePage.locator("#favorite-article").getAttribute("aria-pressed"), "true",
        "the favorite survives closing old tabs and reopening the HTML candidate");
      assert.equal(new URL(candidatePage.url()).searchParams.get("slug"), slug);
      assert.equal(new URL(candidatePage.url()).hash, `#${hash}`);
      const cachedLegacyManifest = await candidatePage.evaluate(async cacheName => {
        const cache = await caches.open(cacheName);
        return Boolean(await cache.match(new URL("content/articles/index.json", location.href).href));
      }, candidateCacheName);
      assert.equal(cachedLegacyManifest, false, "the retired manifest is not precached by the HTML candidate cache");
      const earlierManifestRetained = await candidatePage.evaluate(async (cacheName) => {
        const cache = await caches.open(cacheName);
        return Boolean(await cache.match(new URL("content/articles/index.json", location.href).href));
      }, previousCacheName);
      assert.equal(earlierManifestRetained, true, "an older usable cache remains until the client recovers");
      const uncachedStatus = await candidatePage.evaluate(async () => (await fetch("assets/m03-unvisited-resource.txt")).status);
      assert.equal(uncachedStatus, 404, "an unvisited/missing asset remains a network miss");
      const cachedMissingAsset = await candidatePage.evaluate(async ({ cacheName, path: assetPath }) => {
        const cache = await caches.open(cacheName);
        return Boolean(await cache.match(new URL(assetPath, location.href).href));
      }, { cacheName: candidateCacheName, path: "assets/m03-unvisited-resource.txt" });
      assert.equal(cachedMissingAsset, false, "a missing network response is not retained as cached content");

      // Return to the exact earlier Git artifact as a local browser recovery exercise.
      deployment = { type: "history", ref: client.ref };
      await candidatePage.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
      await candidatePage.waitForFunction(async expectedCache => {
        const registration = await navigator.serviceWorker.getRegistration();
        return (await caches.keys()).includes(expectedCache) && !registration.installing && !registration.waiting;
      }, previousCacheName, { timeout: 30000 });
      await candidatePage.close();
      let returnedPage;
      let returnedTransport = null;
      const returnDeadline = Date.now() + 15000;
      while (Date.now() < returnDeadline) {
        const page = await context.newPage();
        await page.goto(initialUrl, { waitUntil: "domcontentloaded" });
        await page.locator("#article-actions").waitFor({ state: "visible", timeout: 15000 });
        returnedTransport = await page.evaluate(async articleSlug => {
          const catalog = await (await fetch("assets/articles-catalog.json")).json();
          return catalog.find(item => item.slug === articleSlug)?.transport;
        }, slug);
        if (returnedTransport === undefined) {
          returnedPage = page;
          break;
        }
        await page.close();
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(returnedPage, "all candidate clients close and the earlier worker/catalog become active again");
      assert.equal(await returnedPage.locator("#article-heading").innerText(), sourceArticle.title,
        "the local return to the earlier artifact serves the original JSON article");
      assert.equal(returnedTransport, undefined, "the local return serves the earlier catalog contract without HTML transport metadata");
      const sourceLabel = artifactSources.get(client.ref) || `Git object ${client.ref}`;
      const audioEvidence = actualAudio
        ? `, real Kokoro time ${audioTimeBeforeUpdate.toFixed(3)}→${audioTimeAfterInstall.toFixed(3)}s`
        : ", no local audio source (playback remains unproved)";
      console.log(`PASS: ${client.label} (${sourceLabel}) → declared HTML candidate → local return; two tabs, no reload, retired endpoints, cache recovery${audioEvidence}.`);
      await context.close();

      if (client.label === "preparatory-c24") {
        for (const fault of ["quota", "network"]) {
          context = await browser.newContext();
          await context.route("**/*", route => route.request().url().startsWith(base) ? route.continue() : route.abort());
          deployment = { type: "history", ref: currentRef };
          candidateFault = null;
          const failurePage = await openArticle();
          const activeCache = await failurePage.evaluate(async () => (await caches.keys()).find(name => name.startsWith("tech-topics-")));
          assert.ok(activeCache, `the prepared worker has a usable cache before injected ${fault} failure`);
          const originalTimeOrigin = await failurePage.evaluate(() => window.__m03TimeOrigin);
          deployment = { type: "candidate" };
          candidateFault = fault;
          await failurePage.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
          await failurePage.waitForFunction(async ({ candidateName, activeName }) => {
            const registration = await navigator.serviceWorker.getRegistration();
            const names = await caches.keys();
            return !registration?.installing && !registration?.waiting
              && names.includes(activeName) && !names.includes(candidateName);
          }, { candidateName: candidateCacheName, activeName: activeCache }, { timeout: 30000 });
          assert.equal(await failurePage.locator("#article-heading").innerText(), sourceArticle.title,
            `the active client remains usable after the candidate's injected ${fault} failure`);
          assert.equal(await failurePage.evaluate(() => window.__m03TimeOrigin), originalTimeOrigin,
            `an injected ${fault} failure does not reload the active page`);
          assert.equal(await failurePage.evaluate(() => navigator.serviceWorker.controller === window.__m03Controller), true,
            `an injected ${fault} failure does not displace the current controller`);
          console.log(`PASS: injected ${fault === "quota" ? "QuotaExceededError" : "precache HTTP 503"} removes only the partial candidate cache and keeps the prepared client usable.`);
          await context.close();
        }
      }
    } finally {
      await context?.close();
      await browser?.close();
      await new Promise(resolve => server.close(resolve));
    }
  }

  console.log("PASS: historical and preparatory browser compatibility matrix used local Git artifacts plus a declared future HTML fixture; no Pages access.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
