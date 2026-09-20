const { readdir, readFile, access } = require("node:fs/promises");
const path = require("node:path");

async function main() {
const root = path.resolve(__dirname, "..");
const articlesDir = path.join(root, "content", "articles");
const assetsDir = path.join(root, "assets");
const failures = [];

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

const assetFiles = await walk(assetsDir);
for (const file of assetFiles) {
  if (file.endsWith(".svg") && path.dirname(file) !== assetsDir) {
    failures.push(`diagram SVG remains: ${path.relative(root, file)}`);
  }
}

const articleFiles = (await readdir(articlesDir)).filter(file => file.endsWith(".json") && file !== "index.json");
let total = 0;
for (const file of articleFiles) {
  const article = JSON.parse(await readFile(path.join(articlesDir, file), "utf8"));
  if (article.bodyHtml.includes("<svg") || article.bodyHtml.includes(".svg")) failures.push(`${file}: SVG visual reference remains`);
  const firstParagraph = article.bodyHtml.match(/<p>[\\s\\S]*?<\\/p>/)?.[0] || "";
  const visibleFirstParagraph = firstParagraph.replace(/<[^>]*>/g, "");
  const diagrams = article.bodyHtml.split('data-mermaid="true"').length - 1;
  const sources = article.bodyHtml.split('class="mermaid-source"').length - 1;
  const tables = article.bodyHtml.match(/<table\\b/g)?.length || 0;
  if (/[“”"]/u.test(visibleFirstParagraph)) failures.push(`${file}: introductory paragraph must not use quotation marks`);
  const tableScrollRegions = article.bodyHtml.match(/class="(?:article-table-scroll|fgs-table-scroll)"/g)?.length || 0;
  if (!diagrams || diagrams !== sources) failures.push(`${file}: Mermaid source/fallback count mismatch`);
  if (tables !== tableScrollRegions) failures.push(`${file}: tables must use a local horizontal-scroll container`);
  total += diagrams;
}

await access(path.join(root, "mermaid-theme.js"));
const articleHtml = await readFile(path.join(root, "article.html"), "utf8");
if (!articleHtml.includes("mermaid-theme.js")) failures.push("article.html does not load mermaid-theme.js");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Validated ${total} Mermaid diagram(s) and removed technical SVG references.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
