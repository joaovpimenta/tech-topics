import { copyFile, cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_ROOT_FILES } from "./lib/site-artifact.mjs";
import { buildMarkdownPreview } from "./lib/markdown-site-artifact.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const destinationIndex = args.indexOf("--destination");
const destination = destinationIndex >= 0 ? args[destinationIndex + 1] : "";
if (!destination || args.length !== 2) throw new Error("Usage: node build-markdown-browser-fixture.mjs --destination <temp-path>");

const sourceRoot = path.join(path.dirname(path.resolve(destination)), "markdown-browser-source");
await mkdir(path.join(sourceRoot, "content", "articles"), { recursive: true });
await mkdir(path.join(sourceRoot, "generation", "taxonomy"), { recursive: true });
for (const file of PUBLIC_ROOT_FILES) {
  await copyFile(path.join(root, file), path.join(sourceRoot, file));
}
await cp(path.join(root, "assets"), path.join(sourceRoot, "assets"), { recursive: true });
await cp(path.join(root, "content", "articles"), path.join(sourceRoot, "content", "articles"), { recursive: true });
await cp(path.join(root, "articles"), path.join(sourceRoot, "articles"), { recursive: true });
await copyFile(path.join(root, "content", "tts-lexicon.json"),
  path.join(sourceRoot, "content", "tts-lexicon.json"));
await copyFile(path.join(root, "generation", "taxonomy", "tags.json"),
  path.join(sourceRoot, "generation", "taxonomy", "tags.json"));

await mkdir(path.join(sourceRoot, "assets", "preview"), { recursive: true });
await mkdir(path.join(sourceRoot, "articles", "preview"), { recursive: true });
await copyFile(path.join(root, "articles", "bulkhead", "cover.jpg"),
  path.join(sourceRoot, "articles", "preview", "cover.jpg"));
await writeFile(path.join(sourceRoot, "assets", "preview", "manual.pdf"), "%PDF-1.4\n% fixture\n");
const opening = "O pacote mantém os metadados no catálogo e carrega o corpo pelo HTML compilado.";
await writeFile(path.join(sourceRoot, "articles", "preview", "article.md"), `---
language: pt-BR
category: Fundamentos
date: "26 de outubro de 2026"
publishedAt: "2026-10-26"
read: "3 min"
excerpt: Fixture para conferir o pacote HTML no navegador.
tags: [seguranca]
formatVersion: 2
---

# Preview de migração

> Catálogo leve e corpo HTML compilado.

![Capa de preview](./cover.jpg)

${opening}

## Neste artigo

- [Contrato](#contrato)
- [Fontes](#fontes)

## Contrato

A URL pública continua relativa ao shell do site.

## Fontes

[Baixar manual](../../assets/preview/manual.pdf?versao=1#guia)
`, "utf8");

const result = await buildMarkdownPreview({
  root: sourceRoot,
  destination: path.resolve(destination),
  sourceSha: "a".repeat(40),
});
console.log(JSON.stringify({ destination: result.destination, buildId: result.buildId }));
