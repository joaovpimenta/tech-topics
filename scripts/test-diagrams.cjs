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

  const articleFiles = (await readdir(articlesDir))
    .filter(file => file.endsWith(".json") && file !== "index.json");
  let total = 0;
  for (const file of articleFiles) {
    const article = JSON.parse(await readFile(path.join(articlesDir, file), "utf8"));
    const diagrams = (article.bodyHtml.match(/data-mermaid\s*=\s*["']true["']/gi) || []).length;
    const sources = (article.bodyHtml.match(/class\s*=\s*["'][^"']*\bmermaid-source\b[^"']*["']/gi) || []).length;
    const fallbacks = (article.bodyHtml.match(/class\s*=\s*["'][^"']*\bmermaid-fallback\b[^"']*["']/gi) || []).length;
    if (!diagrams || diagrams !== sources || diagrams !== fallbacks) {
      failures.push(file + ": Mermaid diagram/source/fallback count mismatch");
    }
    if (/<svg\b|\.svg(?:["')?#]|$)/i.test(article.bodyHtml)) {
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
