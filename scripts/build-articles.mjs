import { readdir, readFile, access, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const articlesDir = path.join(root, "content", "articles");
const files = (await readdir(articlesDir)).filter(file => file.endsWith(".json") && file !== "index.json").sort();

if (!files.length) throw new Error("No article JSON files found in content/articles");

const manifest = [];
const slugs = new Set();
for (const file of files) {
  const filePath = path.join(articlesDir, file);
  const article = JSON.parse(await readFile(filePath, "utf8"));
  const required = ["slug", "title", "category", "date", "read", "image", "excerpt", "bodyHtml"];
  const missing = required.filter(field => !article[field]);
  if (missing.length) throw new Error(`${file}: missing ${missing.join(", ")}`);
  if (slugs.has(article.slug)) throw new Error(`Duplicate article slug: ${article.slug}`);
  slugs.add(article.slug);
  const imagePath = path.join(root, article.image);
  await access(imagePath);
  manifest.push({ slug: article.slug, path: `content/articles/${file}` });
}

await writeFile(path.join(articlesDir, "index.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built article manifest with ${manifest.length} article(s).`);