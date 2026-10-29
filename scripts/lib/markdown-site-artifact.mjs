import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PUBLIC_ROOT_FILES, validatePublicReferences } from "./site-artifact.mjs";
import { discoverArticleSources as discoverMigrationSources, assertCommitSha } from "./migration-compare.mjs";
import { discoverArticleSources as discoverEditorialSources } from "./generation-system.mjs";
import { compileMarkdownArticle, renderArticleEnvelope } from "./markdown-article.mjs";
import { extractOpeningParagraph } from "./catalog-opening.mjs";

const speechLexiconMarker = "/* TECH_TOPICS_SPEECH_LEXICON */";
const emptyBuildId = "0".repeat(64);
const artifactManifest = ".site-artifact.json";

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function regularDirectory(root, relative) {
  const absolute = path.join(root, relative);
  const stat = await lstat(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Expected a regular directory: ${relative}`);
  return absolute;
}

async function walkRegularFiles(root, relative) {
  const directory = await regularDirectory(root, relative);
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = `${relative}/${entry.name}`;
    const absolute = path.join(root, file);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links cannot enter the HTML preview: ${file}`);
    if (entry.isDirectory()) files.push(...await walkRegularFiles(root, file));
    else if (entry.isFile()) files.push(file);
    else throw new Error(`Unsupported public entry: ${file}`);
  }
  return files;
}

async function sourceInventory(root, taxonomy) {
  const directory = await regularDirectory(root, "content/articles");
  const editorialSources = await discoverEditorialSources(root, { taxonomy });
  if (!editorialSources.length) throw new Error("No article sources found for the HTML preview");
  const entries = editorialSources.map(source => `content/articles/${source.file}`);
  return discoverMigrationSources(entries, "working tree");
}

function gitText(root, ...args) {
  return execFileSync("git", args, {
    cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function gitPaths(root, sourceSha, directory) {
  const output = execFileSync("git", ["ls-tree", "-r", "--name-only", sourceSha, "--", directory], {
    cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return output.split(/\r?\n/).filter(Boolean);
}

function assertSamePaths(label, expected, actual, sourceSha) {
  const expectedSorted = [...expected].sort();
  const actualSorted = [...actual].sort();
  if (JSON.stringify(expectedSorted) === JSON.stringify(actualSorted)) return;
  const expectedSet = new Set(expectedSorted);
  const actualSet = new Set(actualSorted);
  const missing = expectedSorted.filter(file => !actualSet.has(file));
  const uncommitted = actualSorted.filter(file => !expectedSet.has(file));
  const details = [
    missing.length && `missing from working tree: ${missing.join(", ")}`,
    uncommitted.length && `not present at sourceSha: ${uncommitted.join(", ")}`,
  ].filter(Boolean).join("; ");
  throw new Error(`${label} differs from sourceSha ${sourceSha}${details ? ` (${details})` : ""}`);
}

async function assertEditorialInputsMatchCommit(root, sourceSha, inventory) {
  const committedPaths = gitPaths(root, sourceSha, "content/articles");
  const committedSources = committedPaths.filter(file => {
    const match = file.match(/^content\/articles\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/);
    return match && !["index", "catalog"].includes(match[1]);
  });
  const currentJsonSources = committedPaths.filter(file => /^content\/articles\/[^/]+\.json$/.test(file));
  if (currentJsonSources.length) throw new Error(`Individual JSON article sources are not allowed in the current checkout: ${currentJsonSources.join(", ")}`);
  assertSamePaths("Article source inventory", committedSources, inventory.map(source => source.file), sourceSha);

  const slugs = new Set(inventory.map(source => source.slug));
  const committedAssets = gitPaths(root, sourceSha, "assets")
    .filter(file => [...slugs].some(slug => file.startsWith(`assets/${slug}/`)));
  const workingAssets = (await Promise.all([...slugs].map(slug => walkRegularFiles(root, `assets/${slug}`)))).flat();
  assertSamePaths("Article asset inventory", committedAssets, workingAssets, sourceSha);

  const inputFiles = new Set([
    "generation/taxonomy/tags.json",
    "content/tts-lexicon.json",
    ...inventory.map(source => source.file),
  ]);
  for (const file of workingAssets) inputFiles.add(file);

  for (const file of [...inputFiles].sort()) {
    let committed;
    try {
      committed = execFileSync("git", ["cat-file", "blob", `${sourceSha}:${file}`], {
        cwd: root, encoding: null, maxBuffer: 50 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch (error) {
      throw new Error(`${file} is not present at sourceSha ${sourceSha}; production HTML requires committed editorial inputs`, { cause: error });
    }
    const working = await readFile(path.join(root, file));
    if (!working.equals(committed)) {
      throw new Error(`${file} differs from sourceSha ${sourceSha}; production HTML requires the committed editorial snapshot`);
    }
  }
}

function publishedDateValue(value) {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : 0;
}

function addedAtFor(root, sourceSha, slug, previousRecords, { requireCompleteHistory = false } = {}) {
  let history = "";
  try {
    history = gitText(root, "log", "--reverse", "--diff-filter=A", "--format=%cI", sourceSha,
      "--", `content/articles/${slug}.json`, `content/articles/${slug}.md`);
  } catch (error) {
    if (requireCompleteHistory) {
      throw new Error(`${slug}: could not resolve first-add Git history for the production catalog`, { cause: error });
    }
  }
  const firstAddition = history.split(/\r?\n/).find(Boolean);
  if (firstAddition) return firstAddition;
  if (requireCompleteHistory) {
    throw new Error(`${slug}: first-add Git history is unavailable for the production catalog`);
  }
  return previousRecords.get(slug)?.addedAt ?? "";
}

function catalogRecord(compiled, addedAt) {
  const metadata = compiled.metadata;
  const tags = metadata.tags ?? [];
  const record = {
    slug: metadata.slug,
    path: `content/articles/${metadata.slug}.html`,
    format: "html-v1",
    publishedAt: metadata.publishedAt,
    addedAt,
    title: metadata.title,
    category: metadata.category,
    date: metadata.date,
    read: metadata.read,
    image: metadata.image,
    alt: metadata.alt,
    excerpt: metadata.excerpt,
    dek: metadata.dek,
    opening: extractOpeningParagraph(compiled.slots.body),
    tags,
    tagLabels: tags.map(tag => metadata.tagLabels?.[tag] ?? tag),
  };
  for (const field of ["updatedAt", "level", "series", "seriesOrder", "prerequisites"]) {
    if (Object.hasOwn(metadata, field)) record[field] = metadata[field];
  }
  return record;
}

export function computeMarkdownBuildId(files) {
  const hash = createHash("sha256");
  for (const [file, content] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    hash.update(file, "utf8");
    hash.update(Buffer.from([0]));
    hash.update(content);
    hash.update(Buffer.from([0]));
  }
  return hash.digest("hex");
}

function candidateServiceWorkerVersion(source, buildId) {
  const match = source.match(/\bPRECACHE_FILES\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!match) throw new Error("sw-version.js has no PRECACHE_FILES array");
  const previous = JSON.parse(match[1]);
  const precache = [...new Set([
    ...previous.filter(file => typeof file === "string" && !file.startsWith("content/articles/")),
    "assets/articles-catalog.json", "cards.js",
  ])].sort();
  return `// Generated by scripts/lib/markdown-site-artifact.mjs. Do not edit manually.\n` +
    `const PRECACHE_VERSION = ${JSON.stringify(buildId.slice(0, 16))};\n` +
    `const PRECACHE_FILES = ${JSON.stringify(precache, null, 2)};\n`;
}

function safeManagedPath(file) {
  return typeof file === "string" && file.length > 0 && !file.includes("\\")
    && !file.includes("\0") && !file.startsWith("/") && !/^[a-z]:/i.test(file)
    && file.split("/").every(part => part && part !== "." && part !== "..");
}

function isManagedArtifactFile(file, version) {
  if (PUBLIC_ROOT_FILES.includes(file) || file.startsWith("assets/")) return true;
  // Version 1 outputs are recognized only so a new build can safely replace
  // them; this does not enable JSON sources in the current checkout.
  if (version === 1) return /^content\/articles\/[^/]+\.json$/.test(file);
  return /^content\/articles\/[^/]+\.html$/.test(file);
}

async function listOutputFiles(root, relative = "") {
  const files = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const file = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Managed package cannot contain symlinks: ${file}`);
    if (entry.isDirectory()) files.push(...await listOutputFiles(root, file));
    else if (entry.isFile()) files.push(file);
    else throw new Error(`Managed package contains an unsupported entry: ${file}`);
  }
  return files;
}

async function inspectManagedOutput(output, { expectedSourceSha } = {}) {
  let stat;
  try { stat = await lstat(output); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Refusing to replace an unmanaged preview destination");
  }
  const manifestPath = path.join(output, artifactManifest);
  let manifestStat;
  try { manifestStat = await lstat(manifestPath); }
  catch { throw new Error("Refusing to replace an unmanaged preview directory"); }
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
    throw new Error("Refusing to replace an unmanaged preview manifest");
  }
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); }
  catch { throw new Error("Refusing to replace an unmanaged preview directory"); }
  const isLegacy = manifest?.version === 1 && Object.keys(manifest).sort().join(",") === "files,version";
  const isHtml = manifest?.version === 2 && manifest?.format === "html-v1"
    && Object.keys(manifest).sort().join(",") === "buildId,files,format,sourceSha,version";
  if ((!isLegacy && !isHtml) || !Array.isArray(manifest.files) || !manifest.files.length
    || manifest.files.some(file => !safeManagedPath(file) || !isManagedArtifactFile(file, isLegacy ? 1 : 2))
    || new Set(manifest.files).size !== manifest.files.length) {
    throw new Error("Refusing to replace a preview directory without a valid managed artifact manifest");
  }
  if (expectedSourceSha && (isLegacy || manifest.sourceSha !== expectedSourceSha)) {
    throw new Error(`HTML artifact source SHA does not match expected ${expectedSourceSha}`);
  }
  const actual = await listOutputFiles(output);
  const expected = new Set([...manifest.files, artifactManifest]);
  if (actual.length !== expected.size || actual.some(file => !expected.has(file))) {
    throw new Error("Refusing to replace a managed package with unlisted files");
  }
  if (isLegacy) return true;

  if (!/^[a-f0-9]{40}$/i.test(manifest.sourceSha || "")
    || !/^[a-f0-9]{64}$/.test(manifest.buildId || "")
    || !manifest.files.includes("assets/articles-catalog.json")
    || !manifest.files.includes("sw-version.js")
    || manifest.files.some(file => /^content\/articles\/[^/]+\.(?:json|md)$/.test(file))) {
    throw new Error("Refusing to replace an invalid HTML artifact manifest");
  }
  const catalogPath = path.join(output, "assets", "articles-catalog.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  if (!catalog || catalog.version !== 1 || catalog.transport !== "html-v1"
    || catalog.sourceSha !== manifest.sourceSha || catalog.buildId !== manifest.buildId
    || !Array.isArray(catalog.articles) || !catalog.articles.length
    || Object.keys(catalog).sort().join(",") !== "articles,buildId,sourceSha,transport,version") {
    throw new Error("Refusing to replace an HTML package with an invalid catalog");
  }
  const slugs = new Set();
  for (const record of catalog.articles) {
    if (!record || typeof record.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.slug)
      || slugs.has(record.slug) || Object.hasOwn(record, "bodyHtml") || Object.hasOwn(record, "html")
      || record.format !== "html-v1" || record.path !== `content/articles/${record.slug}.html`) {
      throw new Error("Refusing to replace an HTML package with invalid article records");
    }
    slugs.add(record.slug);
  }
  const canonicalCatalog = Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`);
  const catalogBytes = await readFile(catalogPath);
  if (!catalogBytes.equals(canonicalCatalog)) throw new Error("Managed HTML catalog is not canonical");
  const baseCatalog = Buffer.from(`${JSON.stringify({
    version: catalog.version, transport: catalog.transport, articles: catalog.articles,
  }, null, 2)}\n`);
  const files = new Map();
  for (const file of manifest.files) {
    if (file === "sw-version.js") continue;
    let content = await readFile(path.join(output, ...file.split("/")));
    if (file === "assets/articles-catalog.json") content = baseCatalog;
    else if (file.startsWith("content/articles/") && file.endsWith(".html")) {
      const html = content.toString("utf8");
      const marker = `data-build-id="${manifest.buildId}"`;
      if (html.split("data-build-id=").length !== 2 || html.split(marker).length !== 2) {
        throw new Error(`Managed HTML envelope has an invalid build identity: ${file}`);
      }
      content = Buffer.from(html.replace(marker, `data-build-id="${"0".repeat(64)}"`));
    }
    files.set(file, content);
  }
  if (computeMarkdownBuildId(files) !== manifest.buildId) {
    throw new Error("Refusing to replace an HTML package whose content does not match its build ID");
  }
  return true;
}

async function installCandidate(staging, output, previousManaged) {
  if (!previousManaged) {
    await rename(staging, output);
    return;
  }
  const backup = path.join(path.dirname(output), `.site-html-backup-${randomUUID()}`);
  await rename(output, backup);
  try {
    await rename(staging, output);
  } catch (error) {
    try { await rename(backup, output); }
    catch (restoreError) {
      throw new AggregateError([error, restoreError], "Could not install the candidate or restore the previous managed package");
    }
    throw error;
  }
  await rm(backup, { recursive: true, force: true });
}

async function loadPreviousCatalog(root) {
  try {
    const payload = JSON.parse(await readFile(path.join(root, "assets", "articles-catalog.json"), "utf8"));
    const records = Array.isArray(payload) ? payload : payload?.articles;
    if (!Array.isArray(records)) throw new Error("articles-catalog.json must contain a list of records");
    return new Map(records.filter(record => record && typeof record.slug === "string")
      .map(record => [record.slug, record]));
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
    throw error;
  }
}

async function buildFiles(root, sourceSha, { production = false } = {}) {
  if (production && gitText(root, "rev-parse", "--is-shallow-repository") === "true") {
    throw new Error("Production HTML requires complete Git history; configure checkout with fetch-depth: 0");
  }
  const taxonomy = JSON.parse(await readFile(path.join(root, "generation", "taxonomy", "tags.json"), "utf8"));
  if (!taxonomy || typeof taxonomy !== "object" || !taxonomy.tags || Array.isArray(taxonomy.tags)) {
    throw new Error("generation/taxonomy/tags.json has an invalid tag registry");
  }
  const inventory = await sourceInventory(root, taxonomy);
  if (production) await assertEditorialInputsMatchCommit(root, sourceSha, inventory);
  const knownSlugs = new Set(inventory.map(({ slug }) => slug));
  const knownTags = new Set(Object.keys(taxonomy.tags));
  const assets = new Set(await walkRegularFiles(root, "assets"));
  const previousRecords = await loadPreviousCatalog(root);
  const files = new Map();
  const compiledArticles = new Map();

  for (const file of PUBLIC_ROOT_FILES) {
    if (file === "sw-version.js") continue;
    const source = path.join(root, file);
    const stat = await lstat(source);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Public root file must be regular: ${file}`);
    let content = await readFile(source);
    if (file === "article.html") {
      const html = content.toString("utf8");
      if (html.split(speechLexiconMarker).length !== 2) {
        throw new Error("article.html must contain the speech lexicon build marker exactly once");
      }
      const lexicon = JSON.parse(await readFile(path.join(root, "content/tts-lexicon.json"), "utf8"));
      if (!lexicon || typeof lexicon !== "object" || Array.isArray(lexicon)) {
        throw new Error("content/tts-lexicon.json must contain an object");
      }
      const embedded = `window.TechTopicsSpeechLexicon=${JSON.stringify(lexicon).replace(/</g, "\\u003c")};`;
      content = Buffer.from(html.replace(speechLexiconMarker, () => embedded));
    }
    files.set(file, content);
  }

  for (const file of await walkRegularFiles(root, "assets")) {
    if (file !== "assets/articles-catalog.json") files.set(file, await readFile(path.join(root, file)));
  }

  const contextBase = {
    rootPath: root,
    knownTags,
    knownSlugs,
    assetExists: file => assets.has(file),
  };
  const records = [];
  for (const source of inventory) {
    const text = await readFile(path.join(root, source.file), "utf8");
    const context = { ...contextBase, sourcePath: source.file };
    const compiled = await compileMarkdownArticle({ source: text, ...context });
    if (compiled.metadata.slug !== source.slug) throw new Error(`${source.file}: metadata slug does not match filename`);
    compiled.metadata.tagLabels = Object.fromEntries((compiled.metadata.tags ?? []).map(tag => [
      tag,
      taxonomy.tags[tag]?.label ?? tag,
    ]));
    compiledArticles.set(source.slug, compiled);
    records.push(catalogRecord(compiled, addedAtFor(root, sourceSha, source.slug, previousRecords, {
      requireCompleteHistory: production,
    })));
  }
  records.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)
    || publishedDateValue(b.addedAt) - publishedDateValue(a.addedAt)
    || a.slug.localeCompare(b.slug));

  const catalogBase = { version: 1, transport: "html-v1", articles: records };
  const catalogBytes = Buffer.from(`${JSON.stringify(catalogBase, null, 2)}\n`);
  files.set("assets/articles-catalog.json", catalogBytes);
  for (const [slug, compiled] of compiledArticles) {
    files.set(`content/articles/${slug}.html`, Buffer.from(renderArticleEnvelope(compiled, { buildId: emptyBuildId })));
  }
  const buildId = computeMarkdownBuildId(files);

  for (const [slug, compiled] of compiledArticles) {
    files.set(`content/articles/${slug}.html`, Buffer.from(renderArticleEnvelope(compiled, { buildId })));
  }
  const catalog = { ...catalogBase, sourceSha, buildId };
  files.set("assets/articles-catalog.json", Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`));
  const serviceWorkerSource = await readFile(path.join(root, "sw-version.js"), "utf8");
  files.set("sw-version.js", Buffer.from(candidateServiceWorkerVersion(serviceWorkerSource, buildId)));
  return { files, inventory, catalog, buildId, sourceSha };
}

async function buildMarkdownPackage({ root, destination, sourceSha, production = false } = {}) {
  root = await realpath(root);
  if (typeof destination !== "string" || !destination) throw new Error("A dedicated preview destination is required");
  const absoluteOutput = path.resolve(destination);
  let parent;
  if (production) {
    if (absoluteOutput !== path.join(root, "dist")) throw new Error("Production HTML artifact destination must be <root>/dist");
    parent = root;
  } else {
    const tempRoot = await realpath(os.tmpdir());
    if (!isWithin(tempRoot, absoluteOutput)) throw new Error("Preview destination must be beneath the system temporary directory");
    parent = await realpath(path.dirname(absoluteOutput));
    if (!isWithin(tempRoot, parent)) throw new Error("Preview parent must remain beneath the system temporary directory");
  }
  const output = path.join(parent, path.basename(absoluteOutput));
  await inspectManagedOutput(output);
  sourceSha = sourceSha ?? gitText(root, "rev-parse", "HEAD");
  assertCommitSha(sourceSha, "sourceSha");

  const staging = await mkdtemp(path.join(parent, production ? ".site-html-build-" : ".site-html-preview-"));
  try {
    const built = await buildFiles(root, sourceSha, { production });
    const publicFiles = [...built.files.keys()].sort();
    if (publicFiles.some(file => /^content\/articles\/[^/]+\.(?:json|md)$/.test(file))) {
      throw new Error("HTML preview cannot contain individual article source files");
    }
    const slugs = built.inventory.map(source => source.slug).sort();
    const catalogSlugs = built.catalog.articles.map(record => record.slug).sort();
    if (JSON.stringify(slugs) !== JSON.stringify(catalogSlugs)) throw new Error("HTML preview catalog and source inventory diverge");
    for (const record of built.catalog.articles) {
      if (record.format !== "html-v1" || record.path !== `content/articles/${record.slug}.html`) {
        throw new Error(`Invalid HTML transport record: ${record.slug}`);
      }
    }
    for (const [file, content] of built.files) {
      const destinationPath = path.join(staging, ...file.split("/"));
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await writeFile(destinationPath, content, { flag: "wx" });
    }
    const manifest = {
      version: 2,
      format: "html-v1",
      sourceSha: built.sourceSha,
      buildId: built.buildId,
      files: publicFiles,
    };
    await writeFile(path.join(staging, artifactManifest), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    await validatePublicReferences(staging, publicFiles);
    if (JSON.stringify(JSON.parse(await readFile(path.join(staging, "assets/articles-catalog.json"), "utf8")))
        !== JSON.stringify(built.catalog)) throw new Error("Staged HTML catalog changed during packaging");
    const previousManaged = await inspectManagedOutput(output);
    await installCandidate(staging, output, previousManaged);
    return { destination: output, sourceSha: built.sourceSha, buildId: built.buildId, files: publicFiles };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export function buildMarkdownPreview(options = {}) {
  return buildMarkdownPackage(options);
}

export async function verifyMarkdownSiteArtifact(directory, sourceSha) {
  assertCommitSha(sourceSha, "sourceSha");
  const output = path.resolve(directory);
  const managed = await inspectManagedOutput(output, { expectedSourceSha: sourceSha });
  if (!managed) throw new Error(`No managed HTML site artifact exists at ${output}`);
  const manifest = JSON.parse(await readFile(path.join(output, artifactManifest), "utf8"));
  if (manifest.version !== 2 || manifest.format !== "html-v1" || manifest.sourceSha !== sourceSha) {
    throw new Error("Expected a content-verified html-v1 artifact for the requested source SHA");
  }
  return { sourceSha: manifest.sourceSha, buildId: manifest.buildId, fileCount: manifest.files.length };
}

export function buildMarkdownSiteArtifact({ root, destination = path.join(root, "dist"), sourceSha } = {}) {
  return buildMarkdownPackage({ root, destination, sourceSha, production: true });
}
