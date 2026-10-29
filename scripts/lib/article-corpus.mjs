import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseFragment } from "parse5";
import { discoverArticleSources } from "./generation-system.mjs";
import { compileMarkdownArticle } from "./markdown-article.mjs";
import { validateArticleCatalog } from "./article-contract.mjs";

async function collectAssets(root) {
  const assetRoot = path.join(root, "assets");
  const rootStat = await lstat(assetRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("assets must be a regular directory");
  }

  const files = new Set();
  async function walk(directory, relative) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = `${relative}/${entry.name}`;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not valid article assets: ${relativePath}`);
      if (entry.isDirectory()) await walk(absolutePath, relativePath);
      else if (entry.isFile()) files.add(relativePath);
      else throw new Error(`Unsupported article asset entry: ${relativePath}`);
    }
  }

  await walk(assetRoot, "assets");
  const sourceRoot = path.join(root, "articles");
  try {
    const stats = await lstat(sourceRoot);
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("articles must be a regular directory");
    await walk(sourceRoot, "articles");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  return files;
}

export async function compileArticleCorpus(root) {
  root = path.resolve(root);
  const sources = await discoverArticleSources(root);
  if (!sources.length) throw new Error("No article sources found in content/articles");

  const knownSlugs = new Set(sources.map(source => source.slug));
  const knownTags = new Set(sources.flatMap(source => source.tags ?? []));
  const sourcePaths = new Map(sources.map(source => [source.slug, source.file.startsWith("articles/") ? source.file : `content/articles/${source.file}`]));
  const assets = await collectAssets(root);
  const articles = [];

  for (const source of sources) {
    const file = source.file.startsWith("articles/") ? source.file : `content/articles/${source.file}`;
    const crossLinks = [];
    let content;
    try {
      content = await readFile(path.join(root, file), "utf8");
    } catch (error) {
      throw new Error(`${file}: could not read article source: ${error.message}`, { cause: error });
    }

    const context = {
      rootPath: root,
      sourcePath: file,
      knownTags,
      knownSlugs,
      assetExists: asset => assets.has(asset),
      crossLinks,
      sourcePaths,
    };
    let compiled;
    try {
      compiled = await compileMarkdownArticle({ source: content, ...context });
    } catch (error) {
      throw new Error(`${file}: ${error.message}`, { cause: error });
    }

    if (compiled.metadata.slug !== source.slug) {
      throw new Error(`${file}: metadata slug does not match the source inventory`);
    }
    articles.push({
      file,
      sourceType: source.sourceType,
      metadata: source,
      compiled,
      crossLinks,
      article: { ...compiled.metadata, bodyHtml: compiled.slots.body },
    });
  }

  const idsBySlug = new Map(articles.map(({ article, compiled }) => {
    const ids = new Set(compiled.headingAnchor ? [compiled.headingAnchor] : []);
    const visit = node => {
      for (const attr of node.attrs ?? []) if (attr.name === "id" || attr.name === "name") ids.add(attr.value);
      for (const child of node.childNodes ?? []) visit(child);
    };
    visit(parseFragment(compiled.slots.body));
    return [article.slug, ids];
  }));
  for (const { file, crossLinks } of articles) for (const { slug, fragment } of crossLinks) {
    if (!idsBySlug.has(slug)) throw new Error(`${file}: unknown article target: ${slug}`);
    if (fragment && !idsBySlug.get(slug).has(fragment)) throw new Error(`${file}: unknown fragment #${fragment} in article ${slug}`);
  }
  const failures = validateArticleCatalog(articles.map(({ file, article }) => ({ file, article })));
  if (failures.length) {
    throw new Error(failures.map(({ file, message }) => `${file}: ${message}`).join("\n"));
  }
  return articles;
}
