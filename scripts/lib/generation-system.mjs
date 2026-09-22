import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

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

  const content = await readFile(moduleRealPath, "utf8");
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

  return { registry, authoring, tasks, frameworks };
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

export async function findExistingTopic(root, topic, slug) {
  const articlesDirectory = path.resolve(root, "content", "articles");
  const expectedTitle = normalizeTopic(topic);
  const files = (await readdir(articlesDirectory)).filter(file => file.endsWith(".json") && file !== "index.json");

  for (const file of files) {
    const article = JSON.parse(await readFile(path.join(articlesDirectory, file), "utf8"));
    if (article.slug === slug || normalizeTopic(article.title || "") === expectedTitle) {
      return { file, slug: article.slug, title: article.title };
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
