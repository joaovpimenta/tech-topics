import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { parseArticleFrontmatter, parseV2Article, validateArticleMetadata } from "./markdown-article.mjs";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HARD_LIMITS = Object.freeze({
  maxFrameworks: 5,
  maxModuleBytes: 16 * 1024,
  maxBriefBytes: 64 * 1024,
  maxRegistryBytes: 32 * 1024
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertKnownKeys(value, allowed, context) {
  for (const key of Object.keys(value)) {
    assert(allowed.has(key), `${context}: unknown property ${key}`);
  }
}

function assertPositiveInteger(value, context, hardMaximum) {
  assert(Number.isInteger(value) && value > 0, `${context} must be a positive integer`);
  assert(value <= hardMaximum, `${context} exceeds the hard safety limit of ${hardMaximum}`);
}

function validateRelativeModulePath(relativePath, expectedDirectory, context) {
  assert(typeof relativePath === "string" && relativePath.length > 0, `${context}: file must be a non-empty string`);
  assert(!relativePath.includes("\\"), `${context}: backslashes are not allowed in module paths`);
  assert(!path.posix.isAbsolute(relativePath), `${context}: absolute module paths are not allowed`);
  assert(path.posix.normalize(relativePath) === relativePath, `${context}: module path must already be normalized`);
  assert(!relativePath.split("/").includes(".."), `${context}: parent traversal is not allowed`);
  assert(relativePath.startsWith(`${expectedDirectory}/`), `${context}: module must live under ${expectedDirectory}/`);
  assert(relativePath.endsWith(".md"), `${context}: modules must be Markdown files`);
}

async function readTrustedModule(generationRoot, generationRealRoot, relativePath, byteLimit, context) {
  const absolutePath = path.resolve(generationRoot, relativePath);
  assert(
    absolutePath.startsWith(`${generationRoot}${path.sep}`),
    `${context}: resolved module path escapes generation/`
  );

  const stats = await lstat(absolutePath);
  assert(stats.isFile(), `${context}: module is not a regular file`);
  assert(!stats.isSymbolicLink(), `${context}: symbolic links are not allowed`);
  assert(stats.size <= byteLimit, `${context}: module exceeds ${byteLimit} bytes`);

  const moduleRealPath = await realpath(absolutePath);
  assert(
    moduleRealPath.startsWith(`${generationRealRoot}${path.sep}`),
    `${context}: real module path escapes generation/`
  );

  const content = (await readFile(moduleRealPath, "utf8")).replace(/\r\n?/g, "\n");
  assert(content.trim().startsWith("# "), `${context}: module must start with a level-one heading`);
  return { content: content.trim(), bytes: Buffer.byteLength(content), path: relativePath };
}

function validateCatalogShape(catalog, name) {
  assert(isPlainObject(catalog), `${name} must be an object`);
  assert(Object.keys(catalog).length > 0, `${name} must not be empty`);

  for (const [id, entry] of Object.entries(catalog)) {
    assert(ID_PATTERN.test(id), `${name}.${id}: id must be lowercase kebab-case`);
    assert(isPlainObject(entry), `${name}.${id} must be an object`);
    assertKnownKeys(entry, new Set(["label", "file"]), `${name}.${id}`);
    assert(typeof entry.label === "string" && entry.label.trim().length > 0 && entry.label.length <= 80, `${name}.${id}: invalid label`);
    assert(typeof entry.file === "string", `${name}.${id}: invalid file`);
  }
}

export async function validateGenerationRegistry(root, registry) {
  assert(isPlainObject(registry), "generation registry must be an object");
  assertKnownKeys(registry, new Set(["version", "limits", "authoring", "tasks", "frameworks"]), "generation registry");
  assert(registry.version === 1, "generation registry version must be 1");
  assert(isPlainObject(registry.limits), "generation registry limits must be an object");
  assertKnownKeys(registry.limits, new Set(["maxFrameworks", "maxModuleBytes", "maxBriefBytes"]), "generation registry limits");
  assertPositiveInteger(registry.limits.maxFrameworks, "limits.maxFrameworks", HARD_LIMITS.maxFrameworks);
  assertPositiveInteger(registry.limits.maxModuleBytes, "limits.maxModuleBytes", HARD_LIMITS.maxModuleBytes);
  assertPositiveInteger(registry.limits.maxBriefBytes, "limits.maxBriefBytes", HARD_LIMITS.maxBriefBytes);
  assert(registry.limits.maxBriefBytes > registry.limits.maxModuleBytes, "limits.maxBriefBytes must be larger than maxModuleBytes");

  validateRelativeModulePath(registry.authoring, "editorial", "authoring");
  validateCatalogShape(registry.tasks, "tasks");
  validateCatalogShape(registry.frameworks, "frameworks");

  const generationRoot = path.resolve(root, "generation");
  const generationRealRoot = await realpath(generationRoot);
  const usedPaths = new Set([registry.authoring]);

  for (const [id, entry] of Object.entries(registry.tasks)) {
    validateRelativeModulePath(entry.file, "tasks", `tasks.${id}`);
    assert(!usedPaths.has(entry.file), `tasks.${id}: module file is registered more than once`);
    usedPaths.add(entry.file);
  }
  for (const [id, entry] of Object.entries(registry.frameworks)) {
    validateRelativeModulePath(entry.file, "frameworks", `frameworks.${id}`);
    assert(!usedPaths.has(entry.file), `frameworks.${id}: module file is registered more than once`);
    usedPaths.add(entry.file);
  }

  const authoring = await readTrustedModule(
    generationRoot,
    generationRealRoot,
    registry.authoring,
    registry.limits.maxModuleBytes,
    "authoring"
  );
  const tasks = new Map();
  const frameworks = new Map();

  for (const [id, entry] of Object.entries(registry.tasks)) {
    const module = await readTrustedModule(generationRoot, generationRealRoot, entry.file, registry.limits.maxModuleBytes, `tasks.${id}`);
    tasks.set(id, { ...entry, ...module });
  }
  for (const [id, entry] of Object.entries(registry.frameworks)) {
    const module = await readTrustedModule(generationRoot, generationRealRoot, entry.file, registry.limits.maxModuleBytes, `frameworks.${id}`);
    frameworks.set(id, { ...entry, ...module });
  }

  const taxonomy = await readTagTaxonomy(generationRoot, generationRealRoot);
  const templatePath = path.resolve(generationRoot, "templates", "article.md");
  assert(templatePath.startsWith(`${generationRoot}${path.sep}`), "article template must stay inside generation/templates/");
  const templateStats = await lstat(templatePath);
  assert(templateStats.isFile() && !templateStats.isSymbolicLink() && templateStats.size <= 16 * 1024, "article template must be a regular file below 16 KiB");
  const templateRealPath = await realpath(templatePath);
  assert(templateRealPath.startsWith(`${generationRealRoot}${path.sep}`), "article template real path escapes generation/");
  const templateContent = (await readFile(templateRealPath, "utf8")).replace(/\r\n?/g, "\n");
  assert(templateContent.startsWith("---\n") && /PREENCHER|YYYY-MM-DD/.test(templateContent), "article template must be Markdown frontmatter with unresolved placeholders");
  const template = { path: "templates/article.md", content: templateContent.trim(), bytes: Buffer.byteLength(templateContent) };
  return { registry, authoring, tasks, frameworks, taxonomy, template };
}

function validateTagTaxonomy(taxonomy) {
  assert(isPlainObject(taxonomy) && taxonomy.version === 1 && isPlainObject(taxonomy.tags), "tag taxonomy must have version 1 and a tags object");
  assert(Object.keys(taxonomy).every(key => ["version", "tags", "optionalMetadata"].includes(key)), "tag taxonomy contains unknown properties");
  assert(Object.keys(taxonomy.tags).length > 0, "tag taxonomy must not be empty");
  const labels = new Set();
  for (const [id, tag] of Object.entries(taxonomy.tags)) {
    assert(ID_PATTERN.test(id), `taxonomy tag ${id}: id must be lowercase kebab-case`);
    assert(isPlainObject(tag) && Object.keys(tag).every(key => ["label", "description"].includes(key)), `taxonomy tag ${id} must contain only label and description`);
    assert(typeof tag.label === "string" && tag.label.trim() && tag.label.length <= 80, `taxonomy tag ${id}: invalid label`);
    const normalizedLabel = tag.label.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").trim();
    assert(!labels.has(normalizedLabel), `taxonomy tag labels must be unique and must not define synonyms: ${tag.label}`);
    labels.add(normalizedLabel);
    assert(typeof tag.description === "string" && tag.description.trim() && tag.description.length <= 240, `taxonomy tag ${id}: invalid description`);
  }
  const optionals = taxonomy.optionalMetadata ?? {};
  assert(isPlainObject(optionals), "taxonomy optionalMetadata must be an object");
  for (const [field, rule] of Object.entries(optionals)) {
    assert(["updatedAt", "level", "series", "seriesOrder", "prerequisites"].includes(field), `taxonomy optionalMetadata.${field}: unsupported field`);
    assert(typeof rule === "string" && rule.trim(), `taxonomy optionalMetadata.${field} must document when to use the field`);
  }
}

async function readTagTaxonomy(generationRoot, generationRealRoot) {
  const taxonomyPath = path.resolve(generationRoot, "taxonomy", "tags.json");
  assert(taxonomyPath.startsWith(`${generationRoot}${path.sep}`), "tag taxonomy must stay inside generation/");
  const taxonomyStats = await lstat(taxonomyPath);
  assert(taxonomyStats.isFile() && !taxonomyStats.isSymbolicLink() && taxonomyStats.size <= HARD_LIMITS.maxRegistryBytes, "generation/taxonomy/tags.json must be a regular file within the registry size limit");
  const taxonomyRealPath = await realpath(taxonomyPath);
  assert(taxonomyRealPath.startsWith(`${generationRealRoot}${path.sep}`), "tag taxonomy real path escapes generation/");
  let taxonomy;
  try { taxonomy = JSON.parse(await readFile(taxonomyRealPath, "utf8")); }
  catch (error) { throw new Error(`generation/taxonomy/tags.json is invalid JSON: ${error.message}`); }
  validateTagTaxonomy(taxonomy);
  return taxonomy;
}

export async function loadGenerationSystem(root) {
  const registryPath = path.resolve(root, "generation", "registry.json");
  const stats = await lstat(registryPath);
  assert(stats.isFile() && !stats.isSymbolicLink(), "generation/registry.json must be a regular file");
  assert(stats.size <= HARD_LIMITS.maxRegistryBytes, `generation/registry.json exceeds ${HARD_LIMITS.maxRegistryBytes} bytes`);

  let registry;
  try {
    registry = JSON.parse(await readFile(registryPath, "utf8"));
  } catch (error) {
    throw new Error(`generation/registry.json is invalid JSON: ${error.message}`);
  }
  return validateGenerationRegistry(root, registry);
}

export function normalizeTopic(value) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function slugifyTopic(value) {
  const slug = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  assert(ID_PATTERN.test(slug), "topic cannot be converted to a valid slug");
  return slug;
}

function removeMarkdownCodeExamples(markdown) {
  const visibleLines = [];
  let fence = null;
  for (const line of markdown.split("\n")) {
    const opener = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!fence && opener) {
      fence = { marker: opener[1][0], length: opener[1].length };
      visibleLines.push("");
      continue;
    }
    if (fence) {
      const closePattern = new RegExp(`^ {0,3}${fence.marker}{${fence.length},}\\s*$`);
      if (closePattern.test(line)) fence = null;
      visibleLines.push("");
      continue;
    }
    visibleLines.push(line);
  }

  const text = visibleLines.join("\n");
  let output = "";
  for (let index = 0; index < text.length;) {
    if (text[index] !== "`") {
      output += text[index++];
      continue;
    }
    let runEnd = index + 1;
    while (text[runEnd] === "`") runEnd++;
    const delimiter = text.slice(index, runEnd);
    let close = text.indexOf(delimiter, runEnd);
    while (close !== -1 && (text[close - 1] === "`" || text[close + delimiter.length] === "`")) {
      close = text.indexOf(delimiter, close + delimiter.length);
    }
    if (close === -1) {
      output += delimiter;
      index = runEnd;
    } else {
      output += " ";
      index = close + delimiter.length;
    }
  }
  return output;
}

function parseMarkdownMetadata(source, file) {
  const { metadata, body, frontmatter } = parseArticleFrontmatter(source, file);
  const placeholderSource = `${frontmatter}\n${removeMarkdownCodeExamples(body)}`;
  assert(!/\{\{[^}]*\}\}|\b(?:TBD|PLACEHOLDER)\b|\bPREENCHER(?:\s*:|-)|YYYY-MM-DD/.test(placeholderSource), `${file}: unresolved template placeholders are not publishable`);
  return { metadata, body };
}

export async function discoverArticleSources(root, { taxonomy } = {}) {
  const articlesDirectory = path.resolve(root, "content", "articles");
  const entries = await readdir(articlesDirectory);
  const jsonSources = entries.filter(file => file.endsWith(".json"));
  assert(jsonSources.length === 0, `individual article JSON sources are no longer supported: ${jsonSources.join(", ")}`);
  const files = entries.filter(file => /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(file)).sort();
  const v2Files = [];
  const v2Root = path.resolve(root, "articles");
  try {
    const rootStats = await lstat(v2Root);
    assert(rootStats.isDirectory() && !rootStats.isSymbolicLink(), "articles must be a regular directory");
    for (const entry of await readdir(v2Root, { withFileTypes: true })) {
      assert(entry.isDirectory() && !entry.isSymbolicLink() && ID_PATTERN.test(entry.name), `invalid article directory: ${entry.name}`);
      v2Files.push(`articles/${entry.name}/article.md`);
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  files.push(...v2Files.sort());
  let activeTaxonomy = taxonomy;
  if (!activeTaxonomy) {
    const generationRoot = path.resolve(root, "generation");
    activeTaxonomy = await readTagTaxonomy(generationRoot, await realpath(generationRoot));
  }
  validateTagTaxonomy(activeTaxonomy);
  const tagIds = new Set(Object.keys(activeTaxonomy.tags));
  const sources = [];
  const metadataBySlug = new Map();
  for (const file of files) {
    const v2 = file.startsWith("articles/");
    const sourcePath = v2 ? path.join(root, file) : path.join(articlesDirectory, file);
    const stats = await lstat(sourcePath);
    assert(stats.isFile() && !stats.isSymbolicLink(), `${file}: article source must be a regular file`);
    const sourceType = "markdown";
    const raw = await readFile(sourcePath, "utf8");
    const checked = parseMarkdownMetadata(raw, file);
    const parsed = v2 ? parseV2Article(raw, file) : checked;
    const article = { ...parsed.metadata };
    delete article.bodyHtml;
    metadataBySlug.set(article.slug, article);
    sources.push({ slug: article.slug, title: article.title, dek: article.dek, excerpt: article.excerpt || "", tags: article.tags ?? [], sourceType, file });
  }
  const bySlug = new Map();
  for (const source of sources) {
    assert(!bySlug.has(source.slug), `two article sources for slug ${source.slug}: ${bySlug.get(source.slug)} and ${source.file}`);
    bySlug.set(source.slug, source.file);
  }
  const knownSlugs = new Set(bySlug.keys());
  for (const source of sources) {
    validateArticleMetadata(metadataBySlug.get(source.slug), {
      sourcePath: source.file.startsWith("articles/") ? source.file : `content/articles/${source.file}`,
      rootPath: root,
      knownTags: tagIds,
      knownSlugs,
    }, { checkAssets: false });
  }
  const bySeries = new Map();
  for (const source of sources) {
    const metadata = metadataBySlug.get(source.slug);
    if (metadata.series !== undefined) {
      const group = bySeries.get(metadata.series) ?? [];
      group.push({ slug: source.slug, order: metadata.seriesOrder, file: source.file });
      bySeries.set(metadata.series, group);
    }
  }
  for (const [series, members] of bySeries) {
    const orders = new Set();
    for (const member of members) {
      assert(!orders.has(member.order), `series ${series} must have unique seriesOrder values`);
      orders.add(member.order);
    }
  }
  const prereqs = new Map();
  for (const source of sources) {
    const metadata = metadataBySlug.get(source.slug);
    prereqs.set(source.slug, metadata.prerequisites ?? []);
  }
  const visiting = new Set(); const visited = new Set();
  const visit = slug => { assert(!visiting.has(slug), `prerequisite cycle detected at ${slug}`); if (visited.has(slug)) return; visiting.add(slug); for (const next of prereqs.get(slug) ?? []) visit(next); visiting.delete(slug); visited.add(slug); };
  for (const slug of prereqs.keys()) visit(slug);
  return sources.map(({ slug, title, dek, excerpt, tags, sourceType, file }) => ({ slug, title: String(title || "").replace(/\s+/g, " ").trim(), dek: String(dek || "").replace(/\s+/g, " ").trim(), excerpt: String(excerpt || "").replace(/\s+/g, " ").trim(), tags, sourceType, file }));
}

export async function listExistingTopics(root, options = {}) {
  return discoverArticleSources(root, options);
}

export async function findExistingTopic(root, topic, slug, options = {}) {
  const expectedTitle = normalizeTopic(topic);
  for (const article of await listExistingTopics(root, options)) {
    if (article.slug === slug || normalizeTopic(article.title || "") === expectedTitle) {
      return { file: article.file, slug: article.slug, title: article.title };
    }
  }
  return null;
}

export function validateTopicInput(value) {
  assert(typeof value === "string", "topic is required");
  const topic = value.trim();
  assert(topic.length >= 2 && topic.length <= 120, "topic must contain between 2 and 120 characters");
  assert(!/[\u0000-\u001f\u007f]/u.test(topic), "topic must be a single printable line");
  assert(!/[<>`]/u.test(topic), "topic contains unsupported delimiter characters");
  return topic;
}

export { HARD_LIMITS };
