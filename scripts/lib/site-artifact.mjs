import { readFile } from "node:fs/promises";
import path from "node:path";

// Publication includes runtime resources and downloadable article assets. This
// list is deliberately independent of the smaller service-worker precache.
export const PUBLIC_ROOT_FILES = Object.freeze([
  "index.html", "article.html", "styles.css", "app.js", "article.js", "cards.js", "header.js",
  "speech.js", "audio.js", "content/tts-lexicon.json", "mermaid-theme.js", "fgs-simulator.js", "pwa.js", "manifest.webmanifest",
  "favicon.svg", "favicon.ico", "sw.js", "sw-version.js"
]);
function safePath(file) {
  if (typeof file !== "string" || !file || file.includes("\\") || file.includes("\0") || path.posix.isAbsolute(file) || /^[a-z]:/i.test(file) || file.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe artifact path: ${file}`);
  }
  return file;
}

function referencePath(value, source, base = path.posix.dirname(source)) {
  const decoded = value.replace(/&amp;/g, "&").trim();
  if (!decoded || decoded.startsWith("#") || decoded.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(decoded)) return null;
  const pathname = decodeURIComponent(decoded.split(/[?#]/, 1)[0]);
  if (!pathname) return null;
  if (pathname.startsWith("/") || pathname.includes("\\") || pathname.includes("\0")) throw new Error(`Repository-relative URL required in ${source}: ${value}`);
  const resolved = path.posix.normalize(path.posix.join(base, pathname));
  if (resolved === ".") return "index.html";
  safePath(resolved);
  return resolved.endsWith("/") ? `${resolved}index.html` : resolved;
}

function htmlReferences(text) {
  const references = [];
  for (const tag of text.matchAll(/<[a-z][^>]*>/gi)) {
    for (const attribute of tag[0].matchAll(/\b(?:href|src|poster|data-fallback-src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      references.push(attribute[1] ?? attribute[2] ?? attribute[3]);
    }
    for (const attribute of tag[0].matchAll(/\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      const value = attribute[1] ?? attribute[2];
      if (!value.trim().startsWith("data:")) references.push(...value.split(",").map(candidate => candidate.trim().split(/\s+/)[0]));
    }
  }
  return references;
}

function cssReferences(text) {
  return [...text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)|@import\s+["']([^"']+)["']/gi)].map(match => match[1] ?? match[2]);
}

function jsReferences(text) {
  const calls = [...text.matchAll(/\b(?:fetch|importScripts|import|register)\s*\(\s*["']([^"']+)["']/g)].map(match => match[1]);
  const imports = [...text.matchAll(/\b(?:import|export)\s+(?:[^;\n]*?\s+from\s+)?["']([^"']+)["']/g)].map(match => match[1]).filter(value => value.startsWith(".") || value.startsWith("/"));
  return [...calls, ...imports];
}

export async function validatePublicReferences(root, files, { allowMissing = [] } = {}) {
  const available = new Set(files);
  const allowedMissing = new Set(allowMissing);
  const failures = [];
  function check(value, source, base) {
    try {
      const target = referencePath(value, source, base);
      if (target && !available.has(target) && !allowedMissing.has(target)) failures.push(`${source}: missing public reference ${value} (${target})`);
    } catch (error) { failures.push(error.message); }
  }
  for (const file of files) {
    if (!/\.(?:html|css|js|json|webmanifest)$/.test(file)) continue;
    const text = await readFile(path.join(root, file), "utf8");
    if (file.endsWith(".html")) {
      const base = file.startsWith("content/articles/") ? "." : undefined;
      for (const reference of [...htmlReferences(text), ...cssReferences(text)]) check(reference, file, base);
    } else if (file.endsWith(".css")) {
      for (const reference of cssReferences(text)) check(reference, file);
    } else if (file.endsWith(".js")) {
      for (const reference of jsReferences(text)) check(reference, file);
      if (file === "sw-version.js") {
        const precache = text.match(/\bPRECACHE_FILES\s*=\s*(\[[\s\S]*?\])\s*;/);
        if (!precache) failures.push("sw-version.js: missing PRECACHE_FILES array");
        else for (const reference of JSON.parse(precache[1])) check(reference, file, ".");
      }
    } else if (file === "manifest.webmanifest") {
      const manifest = JSON.parse(text);
      if (manifest.start_url) check(manifest.start_url, file);
      for (const icon of manifest.icons ?? []) check(icon.src, file);
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
}
