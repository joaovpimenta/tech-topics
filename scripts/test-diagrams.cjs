const { readdir, readFile, access } = require("node:fs/promises");
const path = require("node:path");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const articlesDir = path.join(root, "content", "articles");
  const assetsDir = path.join(root, "assets");
  const failures = [];

  for (const file of await walk(assetsDir)) {
    if (file.endsWith(".svg") && path.dirname(file) !== assetsDir) {
      failures.push("technical SVG remains: " + path.relative(root, file));
    }
  }

  const [{ compileMarkdownArticle }] = await Promise.all([import("./lib/markdown-article.mjs")]);
  const taxonomy = JSON.parse(await readFile(path.join(root, "generation", "taxonomy", "tags.json"), "utf8"));
  const articleFiles = (await readdir(articlesDir)).filter(file => file.endsWith(".md"));
  const knownSlugs = new Set(articleFiles.map(file => file.slice(0, -3)));
  let total = 0;
  for (const file of articleFiles) {
    const sourcePath = path.join(articlesDir, file);
    const compiled = await compileMarkdownArticle({
      source: await readFile(sourcePath, "utf8"),
      sourcePath: path.relative(root, sourcePath),
      rootPath: root,
      knownTags: new Set(Object.keys(taxonomy.tags)),
      knownSlugs,
    });
    const bodyHtml = compiled.slots.body;
    const diagrams = (bodyHtml.match(/data-mermaid\s*=\s*["']true["']/gi) || []).length;
    const sources = (bodyHtml.match(/class\s*=\s*["'][^"']*\bmermaid-source\b[^"']*["']/gi) || []).length;
    const fallbacks = (bodyHtml.match(/class\s*=\s*["'][^"']*\bmermaid-fallback\b[^"']*["']/gi) || []).length;
    if (diagrams !== sources || diagrams !== fallbacks) {
      failures.push(file + ": Mermaid diagram/source/fallback count mismatch");
    }
    if (/<svg\b|\.svg(?:["')?#]|$)/i.test(bodyHtml)) {
      failures.push(file + ": SVG visual reference remains");
    }
    total += diagrams;
  }

  await access(path.join(root, "mermaid-theme.js"));
  const articleHtml = await readFile(path.join(root, "article.html"), "utf8");
  if (!articleHtml.includes("mermaid-theme.js")) failures.push("article.html does not load mermaid-theme.js");

  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("PASS: validated " + total + " Mermaid diagram(s), fallbacks, theme loading and technical SVG policy.");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
