import { readdir, readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const articlesDir = path.join(root, "content", "articles");
const assetsDir = path.join(root, "assets");
const failures = [];
const requiredFields = {
  slug: "string",
  language: "string",
  title: "string",
  category: "string",
  date: "string",
  publishedAt: "string",
  read: "string",
  image: "string",
  alt: "string",
  dek: "string",
  excerpt: "string",
  bodyHtml: "string"
};
const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

function fail(file, message) {
  failures.push(file + ": " + message);
}

function parseAttributes(tag) {
  const source = tag
    .replace(/^<\s*\/?\s*[A-Za-z][A-Za-z0-9:-]*/, "")
    .replace(/\/?>\s*$/, "");
  const attributes = {};
  const pattern = /([A-Za-z_:][A-Za-z0-9:._-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+)))?/g;
  let match;
  while ((match = pattern.exec(source))) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function textOnly(html) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;|&#34;|&#x22;/gi, '"')
    .replace(/&ldquo;|&#8220;|&#x201c;/gi, "“")
    .replace(/&rdquo;|&#8221;|&#x201d;/gi, "”")
    .replace(/\s+/g, " ")
    .trim();
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(fullPath));
    else result.push(fullPath);
  }
  return result;
}

function scanBody(file, bodyHtml) {
  if (/<(?:script|iframe|object|embed)\b/i.test(bodyHtml)) fail(file, "bodyHtml contains an executable or embedded element");
  if (/\bon[a-z]+\s*=/i.test(bodyHtml)) fail(file, "bodyHtml contains an inline event handler");
  if (/javascript:|data:text\/html|blob:|file:|sandbox:|X-Amz-|Expires=/i.test(bodyHtml)) fail(file, "bodyHtml contains a forbidden or expiring URL");
  if (/<svg\b|\.svg(?:["')?#]|$)/i.test(bodyHtml)) fail(file, "technical visuals must not use SVG");
  if (!/^\s*<p\b[^>]*>/i.test(bodyHtml)) fail(file, "bodyHtml must begin with one introductory <p>");
  const intro = bodyHtml.match(/^\s*<p\b[^>]*>[\s\S]*?<\/p>/i)?.[0] || "";
  if (!intro) fail(file, "introductory paragraph is missing or not closed");
  if (/[“”"]/u.test(textOnly(intro))) fail(file, "introductory paragraph must not use quotation marks");

  const stack = [];
  const ids = new Set();
  const fragmentRefs = [];
  const localRefs = new Set();
  const scrollRegions = [];
  const outsideTables = [];
  let tables = 0;
  let diagrams = 0;
  let diagramSources = 0;
  let diagramFallbacks = 0;
  let mermaidFigures = 0;
  let externalLinks = 0;
  const tokenPattern = /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>/g;
  let match;

  while ((match = tokenPattern.exec(bodyHtml))) {
    const raw = match[0];
    if (raw.startsWith("<!--")) continue;
    const closing = raw.match(/^<\s*\/\s*([A-Za-z][A-Za-z0-9:-]*)/i);
    if (closing) {
      for (let index = stack.length - 1; index >= 0; index--) {
        if (stack[index].name === closing[1].toLowerCase()) {
          stack.splice(index);
          break;
        }
      }
      continue;
    }

    const opening = raw.match(/^<\s*([A-Za-z][A-Za-z0-9:-]*)\b/i);
    if (!opening) continue;
    const name = opening[1].toLowerCase();
    const attrs = parseAttributes(raw);
    const classes = (attrs.class || "").split(/\s+/).filter(Boolean);

    for (const attributeName of Object.keys(attrs)) {
      if (attributeName.startsWith("on")) fail(file, "<" + name + "> uses inline attribute " + attributeName);
    }

    if (attrs.id) {
      if (ids.has(attrs.id)) fail(file, "duplicate id: " + attrs.id);
      ids.add(attrs.id);
    }

    if (classes.includes("article-table-scroll") || classes.includes("fgs-table-scroll")) {
      scrollRegions.push({ attrs, name });
      if (attrs.tabindex !== "0" || attrs.role !== "region" || !attrs["aria-label"]) {
        fail(file, "table scroll region must have tabindex=0, role=region and aria-label");
      }
    }

    if (name === "table") {
      tables++;
      let insideScrollRegion = false;
      for (let index = stack.length - 1; index >= 0; index--) {
        const parentClasses = (stack[index].attrs.class || "").split(/\s+/);
        if (parentClasses.includes("article-table-scroll") || parentClasses.includes("fgs-table-scroll")) {
          insideScrollRegion = true;
          break;
        }
      }
      if (!insideScrollRegion) outsideTables.push(tables);
    }

    if (name === "figure" && classes.includes("mermaid-figure")) mermaidFigures++;

    if (attrs["data-mermaid"] === "true") {
      diagrams++;
      if (!attrs["data-mermaid-label"]) fail(file, "Mermaid diagram is missing data-mermaid-label");
      let insideFigure = false;
      for (let index = stack.length - 1; index >= 0; index--) {
        if (stack[index].name === "figure") {
          insideFigure = true;
          break;
        }
      }
      if (!insideFigure) fail(file, "Mermaid diagram must be inside a figure");
    }

    if (name === "pre" && classes.includes("mermaid-source")) diagramSources++;
    if (name === "details" && classes.includes("mermaid-fallback")) diagramFallbacks++;

    if (name === "img" && !attrs.alt) fail(file, "body image is missing alt text");

    for (const resource of [attrs.src, attrs.href]) {
      if (!resource) continue;
      if (resource.startsWith("#")) {
        fragmentRefs.push(resource.slice(1));
      } else if (/^https?:\/\//i.test(resource)) {
        if (/^http:\/\//i.test(resource)) fail(file, "external URLs must use HTTPS: " + resource);
        else externalLinks++;
      } else if (resource.startsWith("assets/")) {
        localRefs.add(resource.split(/[?#]/)[0]);
      } else if (/^[A-Za-z][A-Za-z0-9+.-]*:/i.test(resource)) {
        fail(file, "unsupported resource URL: " + resource);
      }
    }

    if (!voidTags.has(name) && !raw.endsWith("/>")) stack.push({ name, attrs, raw });
  }

  for (const reference of fragmentRefs) {
    if (!ids.has(reference)) fail(file, "fragment link points to missing id: " + reference);
  }
  if (diagrams !== diagramSources || diagrams !== diagramFallbacks || diagrams !== mermaidFigures) {
    fail(file, "Mermaid diagrams, sources, fallbacks and figures must have matching counts");
  }
  if (outsideTables.length) fail(file, "tables must be inside local horizontal-scroll regions: " + outsideTables.join(", "));
  if (!/\b(fontes|referências)\b/i.test(textOnly(bodyHtml))) fail(file, "article must contain a sources/references section");
  if (!externalLinks) fail(file, "article must contain at least one HTTPS source link");
  return localRefs;
}

const articleFiles = (await readdir(articlesDir))
  .filter(file => file.endsWith(".json") && file !== "index.json")
  .sort();

if (!articleFiles.length) {
  console.error("No article JSON files found.");
  process.exit(1);
}

const slugs = new Set();
const titles = new Set();
const coverPaths = new Set();
const localRefsByFile = new Map();
for (const file of articleFiles) {
  const filePath = path.join(articlesDir, file);
  let article;
  try {
    article = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    fail(file, "invalid JSON: " + error.message);
    continue;
  }

  for (const [field, type] of Object.entries(requiredFields)) {
    if (!(field in article) || typeof article[field] !== type || !article[field].trim()) {
      fail(file, "missing or invalid field: " + field);
    }
  }
  if (!article.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug)) fail(file, "slug must be lowercase kebab-case");
  if (article.slug !== file.slice(0, -5)) fail(file, "slug must match the JSON filename");
  if (article.language !== "pt-BR") fail(file, "language must be pt-BR");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(article.publishedAt) || Number.isNaN(Date.parse(article.publishedAt))) {
    fail(file, "publishedAt must be a valid ISO YYYY-MM-DD date");
  }
  if (slugs.has(article.slug)) fail(file, "duplicate article slug: " + article.slug);
  if (titles.has(article.title.trim().toLocaleLowerCase("pt-BR"))) fail(file, "duplicate article title");
  slugs.add(article.slug);
  titles.add(article.title.trim().toLocaleLowerCase("pt-BR"));

  const expectedImage = "assets/" + article.slug + "/" + article.slug + "-cover.jpg";
  if (article.image !== expectedImage) fail(file, "image must point to " + expectedImage);
  if (coverPaths.has(article.image)) fail(file, "cover image is reused by another article");
  coverPaths.add(article.image);
  try {
    await access(path.join(root, article.image));
  } catch {
    fail(file, "cover image does not exist: " + article.image);
  }

  localRefsByFile.set(file, scanBody(file, article.bodyHtml));
  for (const reference of localRefsByFile.get(file)) {
    try {
      await access(path.join(root, reference));
    } catch {
      fail(file, "local asset does not exist: " + reference);
    }
    if (!reference.startsWith("assets/" + article.slug + "/")) {
      fail(file, "article-local asset must live under assets/" + article.slug + "/: " + reference);
    }
  }
}

const assetFiles = await walk(assetsDir);
for (const file of assetFiles) {
  const relative = path.relative(assetsDir, file).split(path.sep);
  if (relative.length > 1 && !slugs.has(relative[0])) fail(path.relative(root, file), "asset directory does not match an article slug");
  if (relative.length > 1 && path.extname(file).toLowerCase() === ".svg") fail(path.relative(root, file), "technical SVG assets are not allowed inside article directories");
}

try {
  const index = JSON.parse(await readFile(path.join(articlesDir, "index.json"), "utf8"));
  const expected = new Set(articleFiles.map(file => "content/articles/" + file));
  const actual = new Set(index.map(entry => entry.path));
  if (index.length !== articleFiles.length || expected.size !== actual.size || [...expected].some(file => !actual.has(file))) {
    fail("content/articles/index.json", "manifest does not match the article files");
  }
} catch (error) {
  fail("content/articles/index.json", "invalid or unreadable manifest: " + error.message);
}

try {
  const css = await readFile(path.join(root, "styles.css"), "utf8");
  for (const selector of [".article-table-scroll", ".code-block", ".mermaid-diagram"]) {
    if (!css.includes(selector)) fail("styles.css", "missing responsive component selector: " + selector);
  }
  if (!/overflow-x:\s*auto/.test(css)) fail("styles.css", "missing local horizontal overflow handling");
} catch (error) {
  fail("styles.css", "unreadable stylesheet: " + error.message);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("PASS: validated " + articleFiles.length + " article(s), contract fields, editorial structure, HTML safety, assets, Mermaid fallbacks, tables and responsive component rules.");
