import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PUBLIC_ROOT_FILES } from "./lib/site-artifact.mjs";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tech-topics-mixed-pipeline-"));
const fixtureRoot = path.join(tempRoot, "fixture");
const buildScript = path.join(root, "scripts", "build-articles.mjs");
const lintScript = path.join(root, "scripts", "lint-articles.mjs");
const coverSource = path.join(root, "assets", "four-golden-signals", "four-golden-signals-cover.jpg");

try {
  await mkdir(path.join(fixtureRoot, "content", "articles"), { recursive: true });
  await mkdir(path.join(fixtureRoot, "generation", "taxonomy"), { recursive: true });
  await mkdir(path.join(fixtureRoot, "assets"), { recursive: true });
  for (const file of PUBLIC_ROOT_FILES) {
    await cp(path.join(root, file), path.join(fixtureRoot, file), { recursive: true });
  }
  for (const entry of await readdir(path.join(root, "assets"), { withFileTypes: true })) {
    if (entry.isFile()) await cp(path.join(root, "assets", entry.name), path.join(fixtureRoot, "assets", entry.name));
  }
  await cp(path.join(root, "generation", "taxonomy", "tags.json"),
    path.join(fixtureRoot, "generation", "taxonomy", "tags.json"));

  const taxonomy = JSON.parse(await readFile(path.join(root, "generation", "taxonomy", "tags.json"), "utf8"));
  const tagId = Object.keys(taxonomy.tags)[0];
  const opening = "Uma cena simples apresenta a diferença entre as duas fontes do corpus.";
  for (const slug of ["legacy-fixture", "markdown-fixture"]) {
    await mkdir(path.join(fixtureRoot, "assets", slug), { recursive: true });
    await cp(coverSource, path.join(fixtureRoot, "assets", slug, `${slug}-cover.jpg`));
  }

  const legacy = {
    slug: "legacy-fixture",
    language: "pt-BR",
    title: "Artigo legado de fixture",
    category: "Fundamentos",
    date: "26 de outubro de 2026",
    publishedAt: "2026-10-26",
    read: "1 min",
    image: "assets/legacy-fixture/legacy-fixture-cover.jpg",
    alt: "Capa do artigo legado",
    excerpt: "Resumo curto do artigo legado.",
    dek: "Um subtítulo legado.",
    bodyHtml: `<p>${opening}</p><h2 id="fontes">Fontes</h2><p><a href="https://example.org/">Referência</a></p>`,
  };
  await writeFile(path.join(fixtureRoot, "content", "articles", "legacy-fixture.json"),
    `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

  const markdown = `---
slug: markdown-fixture
language: pt-BR
title: "Artigo Markdown de fixture"
category: Fundamentos
tags:
  - ${tagId}
date: "26 de outubro de 2026"
publishedAt: "2026-10-26"
read: "1 min"
image: assets/markdown-fixture/markdown-fixture-cover.jpg
alt: "Capa do artigo Markdown"
excerpt: "Resumo curto do artigo Markdown."
dek: "Um subtítulo Markdown."
level: intermediario
---

${opening}

## Fontes

[Referência](https://example.org/)
`;
  await writeFile(path.join(fixtureRoot, "content", "articles", "markdown-fixture.md"), markdown, "utf8");

  await run(process.execPath, [buildScript, "--root", fixtureRoot], { cwd: root });
  await run(process.execPath, [lintScript, "--root", fixtureRoot], { cwd: root });

  const manifest = JSON.parse(await readFile(path.join(fixtureRoot, "content", "articles", "index.json"), "utf8"));
  assert.deepEqual(manifest.map(entry => entry.path).sort(), [
    "content/articles/legacy-fixture.json",
    "content/articles/markdown-fixture.md",
  ]);
  const catalog = JSON.parse(await readFile(path.join(fixtureRoot, "assets", "articles-catalog.json"), "utf8"));
  assert.deepEqual(catalog.map(record => record.slug).sort(), ["legacy-fixture", "markdown-fixture"]);
  const markdownRecord = catalog.find(record => record.slug === "markdown-fixture");
  assert.deepEqual(markdownRecord.tags, [tagId]);
  assert.equal(markdownRecord.level, "intermediario");
  assert.equal(markdownRecord.opening, opening);
  assert.equal(Object.hasOwn(markdownRecord, "bodyHtml"), false);
  console.log("PASS: mixed JSON/Markdown sources build complete metadata and pass article lint.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
