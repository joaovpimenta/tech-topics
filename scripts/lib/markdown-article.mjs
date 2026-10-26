import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument, isAlias } from "yaml";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { parseFragment } from "parse5";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_IDS = new Set(["article-root", "article-heading", "article-dek", "article-body", "article-category", "article-meta", "article-actions", "article-image", "article-recording", "article-description", "article-search-input", "article-count", "article-quick-actions", "inline-recording", "github-stars", "favorite-article", "share-article", "share-status", "__proto__", "prototype", "constructor", "window", "document", "location", "name", "forms", "all", "body", "head", "currentScript"].map(id => id.normalize("NFKC").toLocaleLowerCase("en-US")));
// The shell owns complete ID namespaces because future controls can be added
// without a compiler release. Current exact IDs are checked against article.html
// and the fixed selectors in article.js, audio.js and speech.js by the suite.
const RESERVED_ID_PREFIXES = ["article-", "recording-", "speech-", "tts-", "header-", "listen-", "inline-recording-"];
const TAGS = new Set([
  "a", "abbr", "article", "b", "blockquote", "br", "button", "caption", "code", "col", "colgroup", "dd", "del", "details", "div", "dl", "dt", "em", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "input", "kbd", "label", "li", "mark", "nav", "ol", "output", "p", "pre", "s", "section", "small", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "th", "thead", "tr", "ul"
]);
const ATTRS = new Set([
  "alt", "align", "aria-atomic", "aria-label", "aria-labelledby", "aria-describedby", "aria-hidden", "aria-live", "checked", "class", "colspan", "data-footnotes", "data-footnote-ref", "data-footnote-backref", "data-mermaid", "data-mermaid-label", "data-tts-mode", "data-tts-say", "disabled", "download", "for", "height", "href", "id", "lang", "max", "min", "name", "open", "role", "rowspan", "scope", "src", "srcset", "step", "tabindex", "target", "title", "type", "value", "width"
]);
const SAFE_CLASS = /^(?:article-callout|article-back|article-table-scroll|fgs-table-scroll|signal-grid|signal-card|fgs-simulator|fgs-formula|fgs-guide|fgs-references|fgs-review|fgs-sim-results|fgs-small|fgs-toc|code-block|mermaid-figure|mermaid-diagram|mermaid-source|mermaid-fallback|footnotes|sr-only|data-footnote-backref|language-[a-z0-9_-]+|task-list-item|contains-task-list)$/;
const REQUIRED = ["slug", "language", "title", "category", "date", "publishedAt", "read", "image", "alt", "dek", "excerpt", "tags"];
const ALLOWED_METADATA = new Set([...REQUIRED, "speechMarkup", "updatedAt", "level", "series", "seriesOrder", "prerequisites", "addedAt"]);

function fail(where, message) {
  throw new Error(`${where}: ${message}`);
}

function walk(tree, visit, parent = null) {
  if (!tree || typeof tree !== "object") return;
  visit(tree, parent);
  for (const child of tree.children ?? []) walk(child, visit, tree);
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function parseFrontmatter(source, location) {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) fail(location, "YAML frontmatter must start and end with ---");
  if (match[1].length > 128 * 1024) fail(location, "YAML frontmatter exceeds the 128 KiB limit");
  let doc;
  try {
    doc = parseDocument(match[1], {
      version: "1.2", schema: "core", strict: true, uniqueKeys: true,
      merge: false, maxAliasCount: 0, customTags: [], resolveKnownTags: false
    });
  } catch (error) { fail(location, `invalid or unsafe YAML: ${error.message}`); }
  if (doc.errors.length) fail(location, `invalid or unsafe YAML: ${doc.errors.map(error => error.message).join("; ")}`);
  let aliases = false;
  const stack = [{ node: doc.contents, depth: 0 }];
  let nodeCount = 0;
  while (stack.length) {
    const { node, depth } = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (++nodeCount > 10000 || depth > 40) fail(location, "YAML frontmatter exceeds the 10,000-node or 40-level safety limit");
    if (isAlias(node) || node.anchor || (node.tag && !["tag:yaml.org,2002:str", "tag:yaml.org,2002:seq", "tag:yaml.org,2002:map", "tag:yaml.org,2002:int", "tag:yaml.org,2002:bool", "tag:yaml.org,2002:null", "tag:yaml.org,2002:float"].includes(node.tag))) aliases = true;
    for (const item of node.items ?? []) {
      if (item?.key) stack.push({ node: item.key, depth: depth + 1 });
      if (item?.value) stack.push({ node: item.value, depth: depth + 1 });
      else stack.push({ node: item, depth: depth + 1 });
    }
  }
  if (aliases) fail(location, "YAML aliases, anchors and custom tags are not allowed");
  const metadata = doc.toJS({ maxAliasCount: 0 });
  if (!plainObject(metadata)) fail(location, "frontmatter must be a mapping");
  return { metadata, body: match[2] };
}

function validateMetadata(metadata, location, context, legacy = false) {
  const errors = [];
  for (const key of Object.keys(metadata)) if (!ALLOWED_METADATA.has(key)) errors.push(`unknown metadata field: ${key}`);
  for (const key of REQUIRED) {
    if (key === "tags" && legacy && metadata.tags === undefined) continue;
    if (metadata[key] === undefined || metadata[key] === null || (typeof metadata[key] === "string" && !metadata[key].trim())) errors.push(`missing required metadata field: ${key}`);
  }
  for (const key of ["slug", "language", "title", "category", "date", "publishedAt", "read", "image", "alt", "dek", "excerpt"]) {
    if (metadata[key] !== undefined && typeof metadata[key] !== "string") errors.push(`${key} must be a string`);
    if (typeof metadata[key] === "string" && /(?:<[^>]*>|\b(?:TODO|TBD|PLACEHOLDER)\b)/i.test(metadata[key])) errors.push(`${key} must not contain HTML or unresolved placeholders`);
  }
  if (metadata.slug !== undefined && !SLUG.test(metadata.slug)) errors.push("slug must be lowercase kebab-case");
  if (metadata.language !== undefined && metadata.language !== "pt-BR") errors.push("language must be pt-BR");
  if (metadata.publishedAt !== undefined && !isIsoDate(metadata.publishedAt)) errors.push("publishedAt must be a real ISO YYYY-MM-DD string");
  if (metadata.slug && metadata.image !== undefined && metadata.image !== `assets/${metadata.slug}/${metadata.slug}-cover.jpg`) errors.push(`image must be assets/${metadata.slug}/${metadata.slug}-cover.jpg`);
  if (metadata.updatedAt !== undefined && (!isIsoDate(metadata.updatedAt) || (isIsoDate(metadata.publishedAt) && metadata.updatedAt < metadata.publishedAt))) errors.push("updatedAt must be a valid date on or after publishedAt");
  if (metadata.tags !== undefined && (!Array.isArray(metadata.tags) || metadata.tags.length === 0 || metadata.tags.some(tag => typeof tag !== "string" || !SLUG.test(tag)) || new Set(metadata.tags).size !== metadata.tags.length)) errors.push("tags must be a non-empty list of unique lowercase kebab-case IDs");
  if (metadata.level !== undefined && !["introdutorio", "intermediario", "avancado"].includes(metadata.level)) errors.push("level must be introdutorio, intermediario or avancado");
  if ((metadata.series === undefined) !== (metadata.seriesOrder === undefined)) errors.push("series and seriesOrder must be provided together");
  if (metadata.series !== undefined && (typeof metadata.series !== "string" || !SLUG.test(metadata.series))) errors.push("series must be a lowercase kebab-case ID");
  if (metadata.seriesOrder !== undefined && (!Number.isInteger(metadata.seriesOrder) || metadata.seriesOrder < 1)) errors.push("seriesOrder must be a positive integer");
  if (metadata.prerequisites !== undefined && (!Array.isArray(metadata.prerequisites) || metadata.prerequisites.some(item => typeof item !== "string" || !SLUG.test(item)) || new Set(metadata.prerequisites).size !== metadata.prerequisites.length || metadata.prerequisites.includes(metadata.slug))) errors.push("prerequisites must contain unique, valid, non-self article slugs");
  if (!legacy && metadata.tags !== undefined && !context.knownTags) errors.push("knownTags registry is required to compile Markdown articles");
  if (!legacy && metadata.prerequisites?.length && !context.knownSlugs) errors.push("knownSlugs registry is required when prerequisites are declared");
  if (metadata.prerequisites && context.knownSlugs) for (const slug of metadata.prerequisites) if (!context.knownSlugs.has(slug)) errors.push(`unknown prerequisite slug: ${slug}`);
  if (context.knownTags && metadata.tags) for (const tag of metadata.tags) if (!context.knownTags.has(tag)) errors.push(`unknown tag ID: ${tag}`);
  if (metadata.image && !assetExistsSafely(metadata.image, context, location)) errors.push(`cover asset does not exist: ${metadata.image}`);
  if (errors.length) fail(location, errors.join("; "));
}

function decoded(value, where) {
  let current = value;
  for (let i = 0; i < 10; i++) {
    try { const next = decodeURIComponent(current); if (next === current) break; current = next; }
    catch { fail(where, "malformed percent-encoding in URL"); }
  }
  return current;
}

function safeProtocol(value, where) {
  const probe = decoded(value, where).replace(/[\u0000-\u0020\u007f\u00a0\u2000-\u200f\u2028\u2029\ufeff]/g, "").toLowerCase();
  if (/^(?:javascript|vbscript|data|file|blob):/.test(probe)) fail(where, "unsafe URL scheme");
}

function resolveLocal(raw, { sourcePath, rootPath, context, where, isImage = false }) {
  safeProtocol(raw, where);
  if (/^(?:https?:|mailto:|tel:)/i.test(raw)) {
    if (isImage) fail(where, "remote image URLs are not permitted");
    return raw;
  }
  if (raw.startsWith("#")) {
    if (isImage) fail(where, "images cannot use fragment-only URLs");
    return raw;
  }
  if (raw.startsWith("//")) fail(where, "protocol-relative URLs are not permitted");
  const decodedPath = decoded(raw.split(/[?#]/, 1)[0], where).replace(/\\/g, "/");
  if (/^[a-z][a-z0-9+.-]*:/i.test(decodedPath) || decodedPath.startsWith("/")) fail(where, "absolute or encoded URL paths are not permitted");
  const sourceDir = path.posix.dirname(sourcePath.replace(/\\/g, "/"));
  const normalized = path.posix.normalize(path.posix.join(sourceDir, decodedPath));
  const absoluteRoot = path.resolve(rootPath);
  const absolute = path.resolve(absoluteRoot, ...normalized.split("/"));
  const relative = path.relative(absoluteRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail(where, "path escapes repository root");
  const repoRelative = relative.replace(/\\/g, "/");
  if (repoRelative.startsWith("content/articles/") && repoRelative.endsWith(".md")) {
    const slug = path.posix.basename(repoRelative, ".md");
    if (isImage) fail(where, "article source files cannot be used as images");
    if (context.knownSlugs && !context.knownSlugs.has(slug)) fail(where, `unknown article target: ${slug}`);
    const suffix = raw.match(/[?#].*$/)?.[0] ?? "";
    if (suffix.includes("?") && !/^[?](?:[a-zA-Z0-9_~-]+=[^#&]*&?)*#?.*$/.test(suffix)) fail(where, "invalid query string on article link");
    const hashIndex = raw.indexOf("#");
    const queryIndex = raw.indexOf("?");
    const query = queryIndex >= 0 ? raw.slice(queryIndex, hashIndex >= 0 ? hashIndex : undefined) : "";
    const hash = hashIndex >= 0 ? raw.slice(hashIndex) : "";
    return `article.html?slug=${encodeURIComponent(slug)}${query ? `&${query.slice(1)}` : ""}${hash}`;
  }
  if (!repoRelative.startsWith("assets/")) fail(where, "local links and images must resolve beneath assets/ or content/articles/");
  const exists = assetExistsSafely(repoRelative, { ...context, rootPath }, where);
  if (!exists) fail(where, `asset does not exist: ${repoRelative}`);
  const suffix = raw.match(/[?#].*$/)?.[0] ?? "";
  const encodedPath = repoRelative.split("/").map(segment => encodeURIComponent(segment)).join("/");
  return `${encodedPath}${suffix}`;
}

function parseSrcset(value, { sourcePath, rootPath, context, where, alreadyResolved = false }) {
  const candidates = value.split(",").map(item => item.trim());
  if (!value.trim() || candidates.some(item => !item)) fail(where, "srcset contains an empty candidate");
  const descriptors = new Set();
  let descriptorKind = null;
  const result = candidates.map(candidate => {
    const parts = candidate.split(/\s+/);
    if (parts.length > 2 || !parts[0]) fail(where, "srcset candidates must use URL [positive-width-w|positive-density-x]");
    const descriptor = parts[1] ?? "";
    if (descriptor && !/^(?:[1-9]\d*w|(?:\d+(?:\.\d+)?|\.\d+)x)$/.test(descriptor)) fail(where, `invalid srcset descriptor: ${descriptor}`);
    const canonicalDescriptor = descriptor.endsWith("x") ? `${Number(descriptor.slice(0, -1))}x` : descriptor;
    if (descriptor.endsWith("x") && (!Number.isFinite(Number(descriptor.slice(0, -1))) || Number(descriptor.slice(0, -1)) <= 0)) fail(where, `density descriptor must be positive: ${descriptor}`);
    if (descriptor && descriptors.has(canonicalDescriptor)) fail(where, `duplicate srcset descriptor: ${descriptor}`);
    if (descriptor) {
      descriptors.add(canonicalDescriptor);
      const kind = descriptor.endsWith("w") ? "w" : "x";
      if (descriptorKind && descriptorKind !== kind) fail(where, "srcset cannot mix width and density descriptors");
      descriptorKind = kind;
    }
    let url;
    if (alreadyResolved) {
      url = parts[0];
      safeProtocol(url, where);
      const asset = decoded(url.split(/[?#]/, 1)[0], where).replace(/\\/g, "/");
      if (!asset.startsWith("assets/") || asset.split("/").includes("..")) fail(where, `srcset URL is outside assets/: ${url}`);
      const exists = assetExistsSafely(asset, { ...context, rootPath }, where);
      if (!exists) fail(where, `srcset asset does not exist: ${asset}`);
    } else url = resolveLocal(parts[0], { sourcePath, rootPath, context, where, isImage: true });
    return `${url}${descriptor ? ` ${descriptor}` : ""}`;
  });
  if (result.length > 1 && result.some(item => item.split(/\s+/).length === 1)) fail(where, "multiple srcset candidates require explicit unique descriptors");
  return result.join(", ");
}

function sanitizeSchema() {
  const schema = structuredClone(defaultSchema);
  schema.tagNames = [...TAGS];
  schema.attributes = {
    "*": ["ariaAtomic", "ariaLabel", "ariaLabelledBy", "ariaDescribedBy", "ariaHidden", "ariaLive", "className", "id", "lang", "role", "tabIndex", "title"],
    a: ["href", "name", "download", "target", "rel", "dataFootnoteRef", "dataFootnoteBackref"],
    img: ["src", "alt", "width", "height", "srcSet"],
    input: ["id", "name", "type", "min", "max", "step", "value", "checked", "disabled", "ariaLabel"],
    button: ["type", "disabled"],
    th: ["colSpan", "rowSpan", "scope", "align"], td: ["colSpan", "rowSpan", "align"],
    section: ["dataFootnotes"],
    div: ["dataMermaid", "dataMermaidLabel", "dataTtsSay", "dataTtsMode"],
    span: ["dataTtsSay", "dataTtsMode"], code: ["dataTtsSay", "dataTtsMode"],
    pre: ["dataTtsSay", "dataTtsMode"]
  };
  schema.clobber = ["name"];
  schema.clobberPrefix = "";
  schema.protocols = { href: ["http", "https", "mailto", "tel"], src: ["http", "https"] };
  schema.strip = ["script", "style", "iframe", "object", "embed", "form", "svg", "math"];
  return schema;
}

function preflight(tree, context, location) {
  const ids = new Set();
  const fragments = [];
  const explicitIds = new Set();
  walk(tree, (node, parent) => {
    if (node.type !== "element") return;
    const tag = node.tagName.toLowerCase();
    if (!TAGS.has(tag)) fail(location, `HTML element <${tag}> is not allowed`);
    const attrs = node.properties ?? {};
    const ttsMode = attrs.dataTtsMode ?? attrs["data-tts-mode"];
    const ttsSay = attrs.dataTtsSay ?? attrs["data-tts-say"];
    if (ttsMode !== undefined && !["spell", "word"].includes(ttsMode)) fail(location, "data-tts-mode must be spell or word");
    if (ttsSay !== undefined && (typeof ttsSay !== "string" || !ttsSay.trim())) fail(location, "data-tts-say must be non-empty text");
    if (ttsMode !== undefined && ttsSay !== undefined) fail(location, "data-tts-say and data-tts-mode are mutually exclusive");
    const language = attrs.lang;
    if (language !== undefined && !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) fail(location, "lang must be a valid language tag");
    for (const [key, value] of Object.entries(attrs)) {
      const attr = key === "className" ? "class" : key === "tabIndex" ? "tabindex" : key === "srcSet" ? "srcset" : key === "ariaDescribedBy" ? "aria-describedby" : key === "ariaLabelledBy" ? "aria-labelledby" : key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`).toLowerCase();
      if (/^on/i.test(attr)) fail(location, `event handler attribute ${key} is forbidden`);
      if (!ATTRS.has(attr) && !(attr === "rel" || attr === "aria-labelledby" || attr === "aria-describedby")) fail(location, `HTML attribute ${key} is not allowed`);
      if (attr === "align" && (tag !== "th" && tag !== "td" || !/^(?:left|center|right)$/.test(String(value)))) fail(location, "table alignment must be left, center or right");
      if (attr === "class") {
        const classes = Array.isArray(value) ? value : String(value).split(/\s+/);
        for (const name of classes) if (!SAFE_CLASS.test(name) && !/^language-/.test(name)) fail(location, `HTML class is not allowed: ${name}`);
      }
      if (attr === "id" || attr === "name") {
        const key = idKey(String(value));
        if (isReservedId(key) || ids.has(key)) fail(location, `duplicate, reserved or unsafe HTML id or anchor: ${value}`);
        ids.add(key);
      }
      if (attr === "href" || attr === "src") {
        const raw = String(value);
        if (attr === "href" && raw.startsWith("#")) fragments.push(decoded(raw.slice(1), location));
        safeProtocol(raw, location);
        attrs[attr] = context.resolvedUrls?.has(`${attr}:${raw}`) ? raw : resolveLocal(raw, { sourcePath: context.sourcePath, rootPath: context.rootPath, context, where: location, isImage: attr === "src" });
      }
    }
    if (attrs.srcSet !== undefined) {
      if (tag !== "img") fail(location, "srcset is allowed only on images");
      attrs.srcSet = parseSrcset(String(attrs.srcSet), { sourcePath: context.sourcePath, rootPath: context.rootPath, context, where: location, alreadyResolved: false });
    }
    if (tag === "img" && (!attrs.alt || typeof attrs.alt !== "string")) fail(location, "every image must have a non-empty alt attribute");
    if ((tag === "a" || tag === "img") && (attrs.href || attrs.src) && /<|>/.test(String(attrs.href ?? attrs.src))) fail(location, "HTML markup is not allowed inside URL attributes");
    if (tag === "a" && attrs.name && (attrs.href || attrs.target)) fail(location, "legacy named anchor must contain only name");
    if (tag === "a" && attrs.target && attrs.target !== "_blank") fail(location, "unsupported link target");
    if (attrs.target === "_blank") attrs.rel = ["noopener", "noreferrer"];
  });
  for (const fragment of fragments) if (!ids.has(idKey(fragment))) fail(location, `link fragment does not match a compiled ID: #${fragment}`);
}

function treeSnapshot(tree) {
  if (!tree || typeof tree !== "object") return null;
  if (tree.type === "text") return { text: tree.value };
  if (tree.type !== "element" && tree.type !== "root") return null;
  const properties = {};
  for (const [key, value] of Object.entries(tree.properties ?? {}).sort(([a], [b]) => a.localeCompare(b))) properties[key] = value;
  return { tag: tree.tagName ?? "#root", properties, children: (tree.children ?? []).map(treeSnapshot).filter(Boolean) };
}

function textContent(node) {
  if (node.type === "text") return node.value;
  return (node.children ?? []).map(textContent).join("");
}

function slugify(text) {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{Letter}\p{Number}\s-]/gu, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-");
}

function idKey(value) { return value.normalize("NFKC").toLocaleLowerCase("en-US"); }
function isReservedId(value) {
  const key = idKey(value);
  return RESERVED_IDS.has(key) || RESERVED_ID_PREFIXES.some(prefix => key.startsWith(prefix));
}

function assetExistsSafely(asset, context, location) {
  if (context.assetExists) return context.assetExists(asset);
  const root = path.resolve(context.rootPath ?? ROOT);
  const candidate = path.resolve(root, ...asset.split("/"));
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
  try {
    const realRoot = fs.realpathSync(root);
    const realCandidate = fs.realpathSync(candidate);
    const realRelative = path.relative(realRoot, realCandidate);
    return Boolean(realRelative && !realRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(realRelative) && fs.statSync(realCandidate).isFile());
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    fail(location, `could not safely verify asset ${asset}: ${error.message}`);
  }
}

function decodePercentForInspection(value) {
  let result = value;
  for (let i = 0; i < 10; i++) {
    const next = result.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
    if (next === result) break;
    result = next;
  }
  return result;
}

function transformMdast(tree, metadata, context, location) {
  let pendingDiagram = null;
  const ids = new Set();
  const explicitIds = new Set();
  let pendingAnchor = null;
  for (const child of tree.children) {
    const anchorHtml = child.type === "html" ? child.value : child.type === "paragraph" && child.children?.length === 2 && child.children.every(node => node.type === "html") ? child.children.map(node => node.value).join("") : null;
    if (anchorHtml && /^\s*<a\s+name\s*=/.test(anchorHtml)) {
      const match = anchorHtml.match(/^\s*<a\s+name\s*=\s*(["'])([^"']+)\1\s*><\/a>\s*$/i);
      if (!match) fail(location, "explicit anchors must use only <a name=\"id\"></a>");
      const id = match[2];
      if (!/^[\p{Letter}\p{Mark}\p{Number}_-]+$/u.test(id)) fail(location, `invalid explicit anchor id: ${id}`);
      const key = idKey(id);
      if (isReservedId(key) || ids.has(key)) fail(location, `duplicate, reserved or unsafe anchor ID: ${id}`);
      ids.add(key); explicitIds.add(key);
      pendingAnchor = id;
      child.type = "text";
      child.value = "";
      child.data = undefined;
      continue;
    }
    if (child.type === "text" && child.value === "") continue;
    if (pendingAnchor && child.type !== "heading") fail(location, `explicit anchor ${pendingAnchor} must immediately precede a heading`);
    if (child.type === "heading" && pendingAnchor) {
      child.data = { ...(child.data ?? {}), hProperties: { ...(child.data?.hProperties ?? {}), id: pendingAnchor } };
      pendingAnchor = null;
    }
  }
  if (pendingAnchor) fail(location, `explicit anchor ${pendingAnchor} has no following heading`);
  for (let i = 0; i < tree.children.length; i++) {
    const node = tree.children[i];
    if (node.type === "html" && /^\s*<!--\s*diagram:/i.test(node.value)) {
      if (pendingDiagram) fail(location, "duplicate or orphan diagram metadata comment");
      const match = node.value.match(/^\s*<!--\s*diagram:\s*([\s\S]*?)\s*-->\s*$/i);
      if (!match) fail(location, "invalid diagram metadata comment");
      let data;
      const diagramDoc = parseDocument(match[1], { version: "1.2", schema: "json", strict: true, uniqueKeys: true, merge: false, maxAliasCount: 0, customTags: [], resolveKnownTags: false });
      if (diagramDoc.errors.length) fail(location, `invalid diagram metadata JSON: ${diagramDoc.errors.map(error => error.message).join("; ")}`);
      data = diagramDoc.toJS({ maxAliasCount: 0 });
      const keys = Object.keys(data ?? {}).sort();
      if (JSON.stringify(keys) !== JSON.stringify(["caption", "fallback", "label"]) || keys.some(key => typeof data[key] !== "string" || !data[key].trim())) fail(location, "diagram metadata requires exactly non-empty label, caption and fallback strings");
      if (Object.values(data).some(value => /<\s*\/?\s*(?:script|[a-z][\w-]*)(?:\s|>|\/)/i.test(value))) fail(location, "HTML-like injection is not allowed in diagram metadata");
      if (tree.children[i + 1]?.type !== "code" || tree.children[i + 1]?.lang?.toLowerCase() !== "mermaid") fail(location, "diagram metadata comment must immediately precede one Mermaid fence");
      pendingDiagram = data;
      node.type = "text";
      node.value = "";
      node.data = undefined;
      continue;
    }
    if (node.type === "code" && node.lang?.toLowerCase() === "mermaid") {
      if (!pendingDiagram) fail(location, "Mermaid fence requires an adjacent diagram metadata comment");
      const decodedDiagram = decodePercentForInspection(node.value);
      if (/%%\s*\{|(?:^|[;\n])\s*click\s+[^\s;]+(?:\s|$)|<\s*\/?\s*(?:script|iframe|foreignObject)\b|javascript\s*:/im.test(decodedDiagram)) fail(location, "Mermaid init directives, click interactions and executable HTML/URLs are forbidden");
      const { label, caption, fallback } = pendingDiagram;
      node.data = { ...(node.data ?? {}), mermaidData: { label, caption, fallback } };
      (context.mermaidDiagrams ??= []).push({ label, caption, fallback });
      pendingDiagram = null;
      continue;
    }
    if (pendingDiagram && node.type !== "html" && node.type !== "text" && node.type !== "code") fail(location, "diagram metadata must immediately precede a Mermaid fence");
    if (node.type === "heading") {
      if (node.depth === 1) fail(location, "article body headings start at level 2; the envelope owns the only h1");
      const id = node.data?.hProperties?.id ?? slugify(textContent(node));
      const key = idKey(id);
      if (!id || (ids.has(key) && !explicitIds.has(key)) || isReservedId(key)) fail(location, `heading ID collision or reserved ID: ${id}`);
      explicitIds.delete(key);
      ids.add(key);
      node.data = { ...(node.data ?? {}), hProperties: { ...(node.data?.hProperties ?? {}), id } };
    }
  }
  if (pendingDiagram) fail(location, "orphan diagram metadata comment at end of document");
  walk(tree, (node, parent) => {
    if (node.type === "image" || node.type === "link") {
      const resolved = resolveLocal(node.url, { sourcePath: context.sourcePath, rootPath: context.rootPath, context, where: location, isImage: node.type === "image" });
      (context.resolvedUrls ??= new Set()).add(`${node.type === "image" ? "src" : "href"}:${resolved}`);
      node.url = resolved;
      if (node.type === "image" && (!node.alt || !node.alt.trim())) fail(location, "every image must have non-empty alt text");
    }
  });
}

function renderMermaidFences(options = {}) {
  return tree => {
    let diagramIndex = 0;
    const visitChildren = parent => {
      if (!Array.isArray(parent.children)) return;
      for (let index = 0; index < parent.children.length; index++) {
        const pre = parent.children[index];
        const code = pre.type === "element" && pre.tagName === "pre" ? pre.children?.find(child => child.type === "element" && child.tagName === "code" && (child.properties?.className ?? []).includes("language-mermaid")) : null;
        if (code) {
          const source = code.children?.map(child => child.value ?? "").join("") ?? "";
          const data = options.mermaidDiagrams?.[diagramIndex++];
          if (!data) throw new Error("Mermaid fence lost its declarative metadata during conversion");
          parent.children[index] = { type: "element", tagName: "figure", properties: { className: ["mermaid-figure"] }, children: [
            { type: "element", tagName: "div", properties: { className: ["mermaid-diagram"], dataMermaid: "true", dataMermaidLabel: data.label }, children: [{ type: "element", tagName: "pre", properties: { className: ["mermaid-source"] }, children: [{ type: "text", value: source }] }] },
            { type: "element", tagName: "figcaption", properties: {}, children: [{ type: "text", value: data.caption }] },
            { type: "element", tagName: "details", properties: { className: ["mermaid-fallback"] }, children: [{ type: "element", tagName: "summary", properties: {}, children: [{ type: "text", value: "Ver o código Mermaid" }] }, { type: "element", tagName: "pre", properties: { className: ["code-block"] }, children: [{ type: "text", value: data.fallback }] }] }
          ] };
        } else visitChildren(pre);
      }
    };
    visitChildren(tree);
  };
}

function wrapGfmTables() {
  return tree => {
    const visitChildren = parent => {
      if (!Array.isArray(parent.children)) return;
      for (let index = 0; index < parent.children.length; index++) {
        const child = parent.children[index];
        if (child.type === "element" && child.tagName === "table") {
          const alreadyWrapped = parent.tagName === "div" && (parent.properties?.className ?? []).some(name => ["article-table-scroll", "fgs-table-scroll"].includes(name));
          if (!alreadyWrapped) parent.children[index] = { type: "element", tagName: "div", properties: { className: ["article-table-scroll"], tabIndex: 0, role: "region", ariaLabel: "Tabela; use a rolagem horizontal para consultar todas as colunas" }, children: [child] };
        } else visitChildren(child);
      }
    };
    visitChildren(tree);
  };
}

function compactTableWhitespace() {
  return tree => {
    const compact = node => {
      if (!Array.isArray(node.children)) return;
      const insideTableRegion = node.tagName === "table" || node.tagName === "div" && (node.properties?.className ?? []).some(name => ["article-table-scroll", "fgs-table-scroll"].includes(name));
      for (const child of node.children) compact(child);
      if (insideTableRegion) node.children = node.children.filter(child => child.type !== "text" || child.value.trim());
    };
    compact(tree);
  };
}

function validateSpeechMarkup(metadata, location) {
  const value = metadata.speechMarkup;
  if (value === undefined) return;
  if (!plainObject(value)) fail(location, "speechMarkup must be an object");
  for (const field of ["title", "dek"]) {
    if (value[field] === undefined) continue;
    if (!Array.isArray(value[field])) fail(location, `speechMarkup.${field} must be an array`);
    let text = "";
    for (const [index, segment] of value[field].entries()) {
      if (!plainObject(segment) || typeof segment.text !== "string" || !segment.text || typeof segment.lang !== "string" || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(segment.lang)) fail(location, `speechMarkup.${field}[${index}] needs non-empty text and valid lang`);
      if (segment.speak !== undefined && (typeof segment.speak !== "string" || !segment.speak.trim())) fail(location, `speechMarkup.${field}[${index}].speak must be non-empty text`);
      if (segment.mode !== undefined && !["spell", "word"].includes(segment.mode)) fail(location, `speechMarkup.${field}[${index}].mode must be spell or word`);
      if (segment.speak !== undefined && segment.mode !== undefined) fail(location, `speechMarkup.${field}[${index}] cannot combine speak and mode`);
      text += segment.text;
    }
    if (text !== metadata[field]) fail(location, `speechMarkup.${field} text must concatenate exactly to ${field}`);
  }
  for (const key of Object.keys(value)) if (!["title", "dek"].includes(key)) fail(location, `unknown speechMarkup field: ${key}`);
}

function validateRenderedHtml(html, location, context = {}) {
  const tree = parseFragment(html, { sourceCodeLocationInfo: true });
  const ids = new Set();
  function visit(node) {
    if (node.tagName) {
      const tag = node.tagName.toLowerCase();
      if (!TAGS.has(tag)) fail(location, `rendered HTML contains forbidden <${tag}>`);
      for (const attr of node.attrs ?? []) {
        if (/^on/i.test(attr.name)) fail(location, `rendered HTML contains event attribute ${attr.name}`);
        if (!ATTRS.has(attr.name) && attr.name !== "rel" && attr.name !== "aria-labelledby" && attr.name !== "aria-describedby") fail(location, `rendered HTML contains unsupported attribute ${attr.name}`);
        if (attr.name === "align" && (tag !== "th" && tag !== "td" || !/^(?:left|center|right)$/.test(attr.value))) fail(location, "rendered table alignment must be left, center or right");
        if (attr.name === "class") for (const name of attr.value.split(/\s+/)) if (!SAFE_CLASS.test(name)) fail(location, `rendered HTML contains unsupported class ${name}`);
        if ((attr.name === "id" || attr.name === "name") && ids.has(idKey(attr.value))) fail(location, `rendered HTML contains duplicate ID/anchor ${attr.value}`);
        if (attr.name === "id" || attr.name === "name") {
          const key = idKey(attr.value);
          if (isReservedId(key)) fail(location, `rendered HTML contains reserved ID/anchor ${attr.value}`);
          ids.add(key);
        }
        if (["href", "src"].includes(attr.name)) {
          safeProtocol(attr.value, location);
          if (/^(?:https?:|mailto:|tel:|#)/i.test(attr.value)) continue;
          const target = decoded(attr.value.split(/[?#]/, 1)[0], location).replace(/\\/g, "/");
          if (attr.name === "href" && ["article.html", "index.html"].includes(target)) continue;
          if (!target.startsWith("assets/") || target.split("/").includes("..")) fail(location, `rendered local URL is outside assets/: ${attr.value}`);
          const exists = assetExistsSafely(target, context, location);
          if (!exists) fail(location, `rendered asset does not exist: ${target}`);
        }
        if (attr.name === "srcset") parseSrcset(attr.value, { sourcePath: context.sourcePath, rootPath: context.rootPath, context, where: location, alreadyResolved: true });
      }
      if (tag === "img" && !node.attrs.some(attr => attr.name === "alt" && attr.value.trim())) fail(location, "rendered image has no alt text");
    }
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(tree);
  if (context.rejectBodyH1 && containsTag(tree, "h1")) fail(location, "rendered article body must not contain h1; the envelope owns the only h1");
}

function containsTag(node, expectedTag) {
  return Boolean(node?.tagName === expectedTag || (node?.childNodes ?? []).some(child => containsTag(child, expectedTag)));
}

const OPENING_COMPONENT_TAGS = new Set(["br", "button", "input", "label", "output"]);
const OPENING_COMPONENT_CLASSES = new Set(["article-back", "fgs-formula"]);
const OPENING_COMPONENT_ROLES = new Set(["button", "checkbox", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "radio", "switch", "tab", "treeitem"]);

function hasVisibleProseText(value) {
  return value.replace(/[\s\p{Default_Ignorable_Code_Point}]/gu, "").length > 0;
}

function openingCheckHtml(node) {
  if (node.type === "html") return node.value;
  if (node.type === "text") return escapeHtml(node.value);
  if (node.type === "inlineCode") return `<code>${escapeHtml(node.value)}</code>`;
  if (node.type === "break") return "<br>";
  const tags = { emphasis: "em", strong: "strong", delete: "del", link: "a" };
  const tag = tags[node.type];
  const children = node.children?.map(openingCheckHtml).join("");
  if (tag) return `<${tag}>${children ?? ""}</${tag}>`;
  if (children !== undefined) return children;
  return escapeHtml(textContent(node));
}

function openingUiComponent(node) {
  if (OPENING_COMPONENT_TAGS.has(node.tagName)) return true;
  const role = node.attrs?.find(attr => attr.name === "role")?.value.toLowerCase().split(/\s+/) ?? [];
  const classes = node.attrs?.find(attr => attr.name === "class")?.value.split(/\s+/) ?? [];
  if (role.some(name => OPENING_COMPONENT_ROLES.has(name))) return true;
  if (classes.some(name => OPENING_COMPONENT_CLASSES.has(name))) return true;
  return node.tagName === "a" && node.attrs?.some(attr => attr.name === "download");
}

function analyzeOpeningParagraph(paragraph) {
  const fragment = parseFragment((paragraph.children ?? []).map(openingCheckHtml).join(""));
  let proseStarted = false;
  let hasProse = false;
  let componentBeforeProse = false;
  const inspect = node => {
    if (node.nodeName === "#text") {
      if (hasVisibleProseText(node.value)) {
        proseStarted = true;
        hasProse = true;
      }
      return;
    }
    if (openingUiComponent(node)) {
      if (!proseStarted) componentBeforeProse = true;
      return;
    }
    for (const child of node.childNodes ?? []) inspect(child);
  };
  for (const child of fragment.childNodes) inspect(child);
  return { componentBeforeProse, hasProse };
}

function firstProseNode(tree, location) {
  let first = null;
  let firstParagraphIndex = -1;
  for (let index = 0; index < tree.children.length; index++) {
    const node = tree.children[index];
    if (node.type === "yaml" || node.type === "html") continue;
    if (node.type !== "paragraph") fail(location, "first content block after frontmatter must be a prose paragraph");
    const opening = analyzeOpeningParagraph(node);
    if (opening.componentBeforeProse) fail(location, "opening content cannot begin with an HTML component");
    if (!opening.hasProse) {
      let hasMarkdownImage = false;
      walk(node, child => { if (child.type === "image") hasMarkdownImage = true; });
      if (hasMarkdownImage || node.children?.some(child => child.type === "html" && containsTag(parseFragment(child.value), "img"))) {
        fail(location, "first prose paragraph cannot contain an image");
      }
      fail(location, "first content block after frontmatter must be a prose paragraph");
    }
    first = node;
    firstParagraphIndex = index;
    break;
  }
  if (!first) fail(location, "first content block after frontmatter must be a prose paragraph");
  let imageBeforeText = false;
  walk(first, node => { if (node.type === "image") imageBeforeText = true; });
  if (imageBeforeText) fail(location, "first prose paragraph cannot contain an image");
  for (const node of tree.children.slice(0, firstParagraphIndex)) {
    if (node.type !== "html") continue;
    const fragment = parseFragment(node.value);
    const isOnlyLegacyAnchor = fragment.childNodes.every(child => !child.tagName || (
      child.tagName === "a" && child.attrs.some(attr => attr.name === "name") &&
      child.childNodes.every(grandchild => grandchild.nodeName === "#text" && !grandchild.value.trim())
    ));
    if (!isOnlyLegacyAnchor) fail(location, "an image or component cannot precede the opening prose paragraph");
  }
  walk(first, node => {
    if (node.type !== "html") return;
    if (containsTag(parseFragment(node.value), "img")) fail(location, "first prose paragraph cannot contain an image");
  });
}

export async function compileMarkdownArticle({ source, sourcePath, rootPath = ROOT, knownTags, knownSlugs, assetExists, ...context } = {}) {
  if (typeof source !== "string") throw new TypeError("source must be a string");
  const location = sourcePath ?? "<markdown>";
  const parsed = parseFrontmatter(source, location);
  const metadata = parsed.metadata;
  if (!Array.isArray(knownTags) && !(knownTags instanceof Set)) fail(location, "knownTags registry must be injected for Markdown compilation");
  if (knownSlugs !== undefined && !Array.isArray(knownSlugs) && !(knownSlugs instanceof Set)) fail(location, "knownSlugs registry must be an array or Set");
  const compilerContext = { ...context, sourcePath: location, rootPath, knownTags: knownTags && new Set(knownTags), knownSlugs: knownSlugs && new Set(knownSlugs), assetExists };
  if (!/^content\/articles\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(location.replace(/\\/g, "/"))) fail(location, "sourcePath must be content/articles/<slug>.md");
  validateMetadata(metadata, location, compilerContext);
  validateSpeechMarkup(metadata, location);
  const filenameSlug = path.posix.basename(location.replace(/\\/g, "/"), ".md");
  if (metadata.slug !== filenameSlug) fail(location, "metadata slug must match Markdown filename");
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]);
  const tree = processor.parse(parsed.body);
  firstProseNode(tree, location);
  transformMdast(tree, metadata, compilerContext, location);
  const hast = await unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]).use(remarkRehype, { allowDangerousHtml: true }).use(renderMermaidFences, compilerContext).use(wrapGfmTables).use(rehypeRaw).use(compactTableWhitespace).run(tree);
  preflight(hast, compilerContext, location);
  const expectedTree = JSON.stringify(treeSnapshot(hast));
  const sanitized = await unified().use(rehypeSanitize, sanitizeSchema()).run(hast);
  if (JSON.stringify(treeSnapshot(sanitized)) !== expectedTree) fail(location, "sanitizer would alter validated content; adjust the allowlist instead of silently dropping it");
  const html = String(await unified().use(rehypeStringify).stringify(sanitized));
  validateRenderedHtml(html, location, { ...compilerContext, rejectBodyH1: true });
  const fragment = parseFragment(html);
  const first = fragment.childNodes.find(node => node.tagName || node.nodeName === "#text");
  if (!first || first.tagName !== "p") fail(location, "compiled body must begin with exactly one paragraph");
  if (containsTag(first, "img")) fail(location, "compiled opening prose paragraph cannot contain an image");
  const title = metadata.title;
  const dek = metadata.dek;
  const titleHtml = renderTextSlot(title, metadata.speechMarkup?.title, location);
  const dekHtml = renderTextSlot(dek, metadata.speechMarkup?.dek, location);
  return { metadata: structuredClone(metadata), slots: { heading: titleHtml, dek: dekHtml, body: html } };
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function renderTextSlot(value, segments, location) {
  if (!segments) return escapeHtml(value);
  return segments.map(segment => `<span lang="${escapeHtml(segment.lang)}"${segment.speak ? ` data-tts-say="${escapeHtml(segment.speak)}"` : ""}${segment.mode ? ` data-tts-mode="${escapeHtml(segment.mode)}"` : ""}>${escapeHtml(segment.text)}</span>`).join("");
}

export function fromLegacyArticle(record, context = {}) {
  if (!plainObject(record)) throw new TypeError("legacy article must be an object");
  const metadata = structuredClone(record);
  delete metadata.bodyHtml;
  validateMetadata(metadata, context.sourcePath ?? `${record.slug}.json`, context, true);
  validateSpeechMarkup(metadata, context.sourcePath ?? `${record.slug}.json`);
  const body = record.bodyHtml;
  if (typeof body !== "string" || !body.trim()) fail(context.sourcePath ?? record.slug, "legacy bodyHtml must be non-empty HTML");
  const fragment = parseFragment(body);
  const html = fragment.childNodes.map(node => serializeNode(node)).join("");
  validateRenderedHtml(html, context.sourcePath ?? record.slug, { ...context, rejectBodyH1: true });
  const first = parseFragment(html).childNodes.find(node => node.tagName);
  if (!first || first.tagName !== "p") fail(record.slug, "legacy bodyHtml must begin with a paragraph");
  return { metadata, slots: { heading: renderTextSlot(record.title, record.speechMarkup?.title, record.slug), dek: renderTextSlot(record.dek, record.speechMarkup?.dek, record.slug), body: html } };
}

function serializeNode(node) {
  if (node.nodeName === "#text") return escapeHtml(node.value);
  if (!node.tagName) return (node.childNodes ?? []).map(serializeNode).join("");
  const attrs = (node.attrs ?? []).map(attr => ` ${attr.name}="${escapeHtml(attr.value)}"`).join("");
  const content = (node.childNodes ?? []).map(serializeNode).join("");
  return ["br", "hr", "img", "input"].includes(node.tagName) ? `<${node.tagName}${attrs}>` : `<${node.tagName}${attrs}>${content}</${node.tagName}>`;
}

export function renderArticleEnvelope(compiled, { buildId } = {}) {
  if (!compiled?.metadata || !compiled?.slots || typeof buildId !== "string" || !buildId.trim()) throw new TypeError("compiled article and non-empty buildId are required");
  const slug = compiled.metadata.slug;
  if (!SLUG.test(slug)) throw new TypeError("compiled article slug is invalid");
  return `<article data-article-format="html-v1" data-article-slug="${escapeHtml(slug)}" data-build-id="${escapeHtml(buildId)}"><h1 data-article-slot="heading">${compiled.slots.heading}</h1><p data-article-slot="dek">${compiled.slots.dek}</p><section data-article-slot="body">${compiled.slots.body}</section></article>`;
}
