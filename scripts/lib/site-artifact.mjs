import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Publication includes runtime resources and downloadable article assets. This
// list is deliberately independent of the smaller service-worker precache.
export const PUBLIC_ROOT_FILES = Object.freeze([
  "index.html", "article.html", "styles.css", "app.js", "article.js",
  "mermaid-theme.js", "fgs-simulator.js", "pwa.js", "manifest.webmanifest",
  "favicon.svg", "favicon.ico", "sw.js", "sw-version.js"
]);
const artifactManifest = ".site-artifact.json";

function safePath(file) {
  if (typeof file !== "string" || !file || file.includes("\\") || file.includes("\0") || path.posix.isAbsolute(file) || /^[a-z]:/i.test(file) || file.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe artifact path: ${file}`);
  }
  return file;
}

function isPublic(file) {
  return PUBLIC_ROOT_FILES.includes(file) || file.startsWith("assets/") || /^content\/articles\/[^/]+\.json$/.test(file);
}

async function requireRegular(root, file) {
  safePath(file);
  const parts = file.split("/");
  for (let index = 1; index <= parts.length; index++) {
    const current = path.join(root, ...parts.slice(0, index));
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || (index < parts.length ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error(`Artifact paths must be regular files and directories: ${file}`);
    }
  }
}

async function walk(root, relative) {
  const directory = path.join(root, relative);
  const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe artifact directory: ${relative}`);
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = relative ? `${relative}/${entry.name}` : entry.name;
    safePath(file);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links cannot be published: ${file}`);
    if (entry.isDirectory()) files.push(...await walk(root, file));
    else if (entry.isFile()) files.push(file);
    else throw new Error(`Unsupported artifact entry: ${file}`);
  }
  return files;
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

export async function collectPublicFiles(root) {
  const assets = await walk(root, "assets");
  const articles = (await walk(root, "content/articles")).filter(file => /^content\/articles\/[^/]+\.json$/.test(file));
  const files = [...PUBLIC_ROOT_FILES, ...assets, ...articles].sort();
  for (const file of files) await requireRegular(root, file);
  return files;
}

export async function validatePublicReferences(root, files) {
  const available = new Set(files);
  const failures = [];
  function check(value, source, base) {
    try {
      const target = referencePath(value, source, base);
      if (target && !available.has(target)) failures.push(`${source}: missing public reference ${value} (${target})`);
    } catch (error) { failures.push(error.message); }
  }
  for (const file of files) {
    if (!/\.(?:html|css|js|json|webmanifest)$/.test(file)) continue;
    const text = await readFile(path.join(root, file), "utf8");
    if (file.endsWith(".html")) {
      for (const reference of [...htmlReferences(text), ...cssReferences(text)]) check(reference, file);
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
    } else if (file.startsWith("content/articles/")) {
      const article = JSON.parse(text);
      if (file === "content/articles/index.json") {
        for (const entry of article) check(entry.path, file, ".");
      } else {
        if (article.image) check(article.image, file, ".");
        // Article HTML is inserted into article.html, so URLs resolve at the root.
        for (const reference of [...htmlReferences(article.bodyHtml ?? ""), ...cssReferences(article.bodyHtml ?? "")]) check(reference, file, ".");
      }
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
}

async function inspectDestination(root, destination) {
  let stat;
  try { stat = await lstat(destination); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("dist must be a regular directory");
  const existing = await walk(root, "dist");
  if (!existing.length) return;
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(destination, artifactManifest), "utf8")); }
  catch { throw new Error("Refusing to replace unmanaged dist directory"); }
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error("Invalid dist artifact manifest");
  const expected = new Set([artifactManifest, ...manifest.files.map(file => {
    safePath(file);
    if (!isPublic(file)) throw new Error(`Non-public path in artifact manifest: ${file}`);
    return file;
  })]);
  if (existing.some(file => !expected.has(file.slice("dist/".length)))) throw new Error("Refusing to replace dist containing unmanaged files");
}

export async function buildSiteArtifact({ root, destination = "dist" }) {
  root = await realpath(root);
  const output = path.resolve(root, destination);
  // Never accept an arbitrary output tree for recursive replacement.
  if (output !== path.join(root, "dist")) throw new Error("Site artifact destination must be <root>/dist");
  const files = await collectPublicFiles(root);
  await validatePublicReferences(root, files);
  await inspectDestination(root, output);
  const staging = await mkdtemp(path.join(root, ".site-build-"));
  try {
    for (const file of files) {
      await requireRegular(root, file);
      await mkdir(path.dirname(path.join(staging, file)), { recursive: true });
      await copyFile(path.join(root, file), path.join(staging, file));
    }
    await writeFile(path.join(staging, artifactManifest), `${JSON.stringify({ version: 1, files }, null, 2)}\n`);
    await validatePublicReferences(staging, files);
    await inspectDestination(root, output);
    // This is the fixed, ownership-checked dist tree, never an arbitrary path.
    await rm(output, { recursive: true, force: true });
    await rename(staging, output);
  } finally { await rm(staging, { recursive: true, force: true }); }
  return { destination: output, files };
}
