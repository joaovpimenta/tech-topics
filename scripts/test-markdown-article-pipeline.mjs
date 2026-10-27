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
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tech-topics-markdown-pipeline-"));
const fixtureRoot = path.join(tempRoot, "fixture");
const buildScript = path.join(root, "scripts", "build-articles.mjs");
const lintScript = path.join(root, "scripts", "lint-articles.mjs");
const coverSource = path.join(root, "assets", "four-golden-signals", "four-golden-signals-cover.jpg");

try {
  await mkdir(path.join(fixtureRoot, "content", "articles"), { recursive: true });
  await mkdir(path.join(fixtureRoot, "generation", "taxonomy"), { recursive: true });
  await mkdir(path.join(fixtureRoot, "assets", "markdown-fixture"), { recursive: true });
  for (const file of PUBLIC_ROOT_FILES) {
    await cp(path.join(root, file), path.join(fixtureRoot, file), { recursive: true });
  }
  for (const entry of await readdir(path.join(root, "assets"), { withFileTypes: true })) {
    if (entry.isFile()) await cp(path.join(root, "assets", entry.name), path.join(fixtureRoot, "assets", entry.name));
  }
  await cp(coverSource, path.join(fixtureRoot, "assets", "markdown-fixture", "markdown-fixture-cover.jpg"));
  await cp(path.join(root, "generation", "taxonomy", "tags.json"),
    path.join(fixtureRoot, "generation", "taxonomy", "tags.json"));

  const taxonomy = JSON.parse(await readFile(path.join(root, "generation", "taxonomy", "tags.json"), "utf8"));
  const tagId = Object.keys(taxonomy.tags)[0];
  const opening = "Uma cena simples apresenta o contrato editorial em Markdown.";
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
  const articlePath = path.join(fixtureRoot, "content", "articles", "markdown-fixture.md");
  await writeFile(articlePath, markdown, "utf8");

  await run(process.execPath, [buildScript, "--root", fixtureRoot], { cwd: root });
  await run(process.execPath, [lintScript, "--root", fixtureRoot], { cwd: root });

  await assert.rejects(readFile(path.join(fixtureRoot, "content", "articles", "index.json")), { code: "ENOENT" });
  const catalog = JSON.parse(await readFile(path.join(fixtureRoot, "assets", "articles-catalog.json"), "utf8"));
  assert.deepEqual(catalog.map(record => record.slug), ["markdown-fixture"]);
  const record = catalog[0];
  assert.deepEqual(record.tags, [tagId]);
  assert.equal(record.level, "intermediario");
  assert.equal(record.opening, opening);
  assert.equal(Object.hasOwn(record, "bodyHtml"), false);

  await writeFile(path.join(fixtureRoot, "content", "articles", "json-reintroduced.json"), "{}\n", "utf8");
  await assert.rejects(run(process.execPath, [buildScript, "--root", fixtureRoot], { cwd: root }),
    /individual article JSON sources are no longer supported/);
  console.log("PASS: Markdown-only source build, lightweight catalog, and JSON reintroduction guard.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
