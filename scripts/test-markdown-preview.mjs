import assert from "node:assert/strict";
import { cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_ROOT_FILES } from "./lib/site-artifact.mjs";
import { buildMarkdownPreview, buildMarkdownSiteArtifact, verifyMarkdownSiteArtifact } from "./lib/markdown-site-artifact.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "tech-topics-markdown-preview-test-"));
const sourceRoot = path.join(temporaryRoot, "source");
const sourceSha = "a".repeat(40);

async function snapshot(result) {
  return Promise.all([...result.files, ".site-artifact.json"].map(async file => [
    file,
    await readFile(path.join(result.destination, file)),
  ]));
}

try {
  await mkdir(path.join(sourceRoot, "content", "articles"), { recursive: true });
  await mkdir(path.join(sourceRoot, "generation", "taxonomy"), { recursive: true });
  for (const file of PUBLIC_ROOT_FILES) {
    await cp(path.join(root, file), path.join(sourceRoot, file), { recursive: true });
  }
  await cp(path.join(root, "assets"), path.join(sourceRoot, "assets"), { recursive: true });
  await cp(path.join(root, "content", "tts-lexicon.json"),
    path.join(sourceRoot, "content", "tts-lexicon.json"));
  await cp(path.join(root, "generation", "taxonomy", "tags.json"),
    path.join(sourceRoot, "generation", "taxonomy", "tags.json"));
  await mkdir(path.join(sourceRoot, "assets", "preview"), { recursive: true });
  await writeFile(path.join(sourceRoot, "assets", "preview", "preview-cover.jpg"), Buffer.from("cover"));
  await writeFile(path.join(sourceRoot, "assets", "preview", "manual.pdf"), Buffer.from("download"));

  const articlePath = path.join(sourceRoot, "content", "articles", "preview.md");
  const markdown = body => `---
slug: preview
language: pt-BR
title: "Preview HTML"
category: Fundamentos
date: "26 de outubro de 2026"
publishedAt: "2026-10-26"
read: "5 min"
image: assets/preview/preview-cover.jpg
alt: Capa de teste
excerpt: Resumo curto do artigo
dek: Uma explicação do pacote preparado.
tags: [seguranca]
---

${body}
`;
  const opening = "O pacote preserva a mesma rota pública enquanto cada fonte passa por compilação validada.";
  const relationalMarkdown = (slug, title, body, extra = []) => [
    "---",
    `slug: ${slug}`,
    "language: pt-BR",
    `title: ${JSON.stringify(title)}`,
    "category: Fundamentos",
    'date: "26 de outubro de 2026"',
    'publishedAt: "2026-10-26"',
    'read: "5 min"',
    `image: assets/${slug}/${slug}-cover.jpg`,
    "alt: Capa de teste",
    "excerpt: Resumo curto do artigo",
    "dek: Uma explicação do pacote preparado.",
    "tags: [seguranca]",
    ...extra,
    "---",
    "",
    body,
    "",
  ].join("\n");
  await writeFile(articlePath, markdown(
    `${opening}\n\n[Baixar manual](../../assets/preview/manual.pdf?versao=1#guia)\n`), "utf8");

  const first = await buildMarkdownPreview({
    root: sourceRoot, sourceSha, destination: path.join(temporaryRoot, "first"),
  });
  const second = await buildMarkdownPreview({
    root: sourceRoot, sourceSha, destination: path.join(temporaryRoot, "second"),
  });
  assert.equal(first.buildId, second.buildId, "repeat builds of the same source should share an identity");
  assert.deepEqual(await snapshot(first), await snapshot(second), "repeat builds should be byte-identical");
  // A mixed corpus publishes v2 assets at their historical public URLs while
  // retaining the flat v1 article and keeping source Markdown private.
  const v2Root = path.join(sourceRoot, "articles", "moderno");
  await mkdir(path.join(v2Root, "figures"), { recursive: true });
  await writeFile(path.join(v2Root, "cover.jpg"), "v2 cover");
  await writeFile(path.join(v2Root, "figures", "diagram.jpg"), "v2 figure");
  await writeFile(path.join(v2Root, "article.md"), `---
formatVersion: 2
publishedAt: '2026-10-28'
category: Fundamentos
tags: [seguranca]
language: pt-BR
date: 28 de outubro de 2026
read: 5 min
excerpt: Resumo do artigo moderno.
---

# Artigo moderno

> Um subtítulo.

![Capa](./cover.jpg)

Abertura do artigo moderno.

## Neste artigo

- [Parte](#parte)

## Parte

[Artigo anterior](../../content/articles/preview.md)

![Figura](./figures/diagram.jpg)
`);
  const mixed = await buildMarkdownPreview({ root: sourceRoot, sourceSha, destination: path.join(temporaryRoot, "mixed") });
  assert.equal(await readFile(path.join(mixed.destination, "assets/moderno/moderno-cover.jpg"), "utf8"), "v2 cover");
  assert.equal(await readFile(path.join(mixed.destination, "assets/moderno/figures/diagram.jpg"), "utf8"), "v2 figure");
  assert(!mixed.files.some(file => file.startsWith("articles/")));
  assert.match(await readFile(path.join(mixed.destination, "moderno/index.html"), "utf8"), /id="artigo-moderno"/);
  assert.match(await readFile(path.join(mixed.destination, "content/articles/moderno.html"), "utf8"), /href="preview\/"/);
  await rm(path.join(sourceRoot, "articles"), { recursive: true });
  const originalSnapshot = await snapshot(first);
  const rebuilt = await buildMarkdownPreview({
    root: sourceRoot, sourceSha, destination: first.destination,
  });
  assert.deepEqual(await snapshot(rebuilt), originalSnapshot,
    "a managed candidate can be rebuilt without accumulating output");
  assert.equal(first.sourceSha, sourceSha);
  assert.equal(first.files.filter(file => /^content\/articles\/[^/]+\.html$/.test(file)).length, 1);
  assert.equal(first.files.some(file => /^content\/articles\/[^/]+\.(?:json|md)$/.test(file)), false);
  assert.equal(first.files.includes("content/articles/preview.html"), true);

  const catalog = JSON.parse(await readFile(path.join(first.destination, "assets/articles-catalog.json"), "utf8"));
  assert.equal(catalog.transport, "html-v1");
  assert.equal(catalog.sourceSha, sourceSha);
  assert.equal(catalog.buildId, first.buildId);
  assert.equal(catalog.articles.length, 1);
  assert.equal(catalog.articles[0].path, "content/articles/preview.html");
  const route = await readFile(path.join(first.destination, "preview/index.html"), "utf8");
  assert.match(route, /<title>.*Tech Topics<\/title>/);
  assert.match(route, /rel="canonical" href="\.\.\/preview\/"/);
  assert.match(route, /src="\.\.\/article\.js/);
  assert.match(route, /data-article-slug="preview"/);
  assert.doesNotMatch(route, /<base\b/i);

  assert.equal(catalog.articles[0].opening, opening);
  assert.deepEqual(catalog.articles[0].tags, ["seguranca"]);
  assert.deepEqual(catalog.articles[0].tagLabels, ["Segurança"]);
  assert.equal("bodyHtml" in catalog.articles[0], false);
  assert.equal("html" in catalog.articles[0], false);
  const compiled = await readFile(path.join(first.destination, "content/articles/preview.html"), "utf8");
  assert.match(compiled, new RegExp(`data-build-id="${first.buildId}"`));
  assert.match(compiled, /href="assets\/preview\/manual\.pdf\?versao=1#guia"/);
  const swVersion = await readFile(path.join(first.destination, "sw-version.js"), "utf8");
  assert.doesNotMatch(swVersion, /content\/articles\/index\.json/);
  assert.equal(JSON.parse(await readFile(path.join(first.destination, ".site-artifact.json"), "utf8")).buildId,
    first.buildId);

  await writeFile(articlePath, markdown(
    `${opening} O texto de abertura ganhou uma frase sem mudar os metadados.\n\n[Baixar manual](../../assets/preview/manual.pdf?versao=1#guia)\n`), "utf8");
  const changed = await buildMarkdownPreview({
    root: sourceRoot, sourceSha, destination: first.destination,
  });
  assert.notEqual(changed.buildId, first.buildId, "a body-only edit must invalidate the HTML artifact identity");

  const legacyRoot = path.join(temporaryRoot, "legacy-root");
  await mkdir(path.join(legacyRoot, "content", "articles"), { recursive: true });
  for (const file of PUBLIC_ROOT_FILES) {
    await cp(path.join(sourceRoot, file), path.join(legacyRoot, file), { recursive: true });
  }
  await cp(path.join(sourceRoot, "assets"), path.join(legacyRoot, "assets"), { recursive: true });
  await cp(path.join(sourceRoot, "content", "tts-lexicon.json"),
    path.join(legacyRoot, "content", "tts-lexicon.json"));
  await writeFile(path.join(legacyRoot, "sw-version.js"),
    'const PRECACHE_VERSION = "legacy";\nconst PRECACHE_FILES = ["index.html", "article.html", "assets/articles-catalog.json", "content/articles/index.json"];\n');
  await writeFile(path.join(legacyRoot, "content", "articles", "legacy.json"), JSON.stringify({
    slug: "legacy", language: "pt-BR", title: "Artigo legado",
    image: "assets/preview/preview-cover.jpg", bodyHtml: "<p>Conteúdo legado.</p>",
  }));
  await writeFile(path.join(legacyRoot, "content", "articles", "index.json"),
    JSON.stringify([{ slug: "legacy", path: "content/articles/legacy.json" }]));
  const legacyFiles = [...PUBLIC_ROOT_FILES, "assets/articles-catalog.json", "assets/preview/preview-cover.jpg",
    "content/articles/index.json", "content/articles/legacy.json"].sort();
  const legacyDist = path.join(legacyRoot, "dist");
  await mkdir(legacyDist, { recursive: true });
  for (const file of legacyFiles) {
    const destination = path.join(legacyDist, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(legacyRoot, file), destination);
  }
  await writeFile(path.join(legacyDist, ".site-artifact.json"),
    `${JSON.stringify({ version: 1, files: legacyFiles }, null, 2)}\n`);
  await cp(legacyDist, path.join(sourceRoot, "dist"), { recursive: true });
  const rebuiltLegacy = await buildMarkdownPreview({
    root: sourceRoot, sourceSha, destination: path.join(legacyRoot, "dist"),
  });
  assert.equal(rebuiltLegacy.files.includes("content/articles/legacy.json"), false,
    "rebuilding a managed legacy package removes obsolete article files");
  assert.equal(rebuiltLegacy.files.includes("content/articles/preview.html"), true);
  await assert.rejects(lstat(path.join(rebuiltLegacy.destination, "content", "articles", "legacy.json")),
    { code: "ENOENT" });

  const legacyCoverPath = path.join(sourceRoot, "assets", "legacy", "legacy-cover.jpg");
  await mkdir(path.dirname(legacyCoverPath), { recursive: true });
  await writeFile(legacyCoverPath, Buffer.from("legacy cover"));
  const legacySourcePath = path.join(sourceRoot, "content", "articles", "legacy.json");
  const legacyMarkdownPath = path.join(sourceRoot, "content", "articles", "legacy.md");
  const legacySource = JSON.stringify({
    slug: "legacy", language: "pt-BR", title: "Artigo legado",
    category: "Fundamentos", date: "25 de outubro de 2026", publishedAt: "2026-10-25",
    read: "5 min", image: "assets/legacy/legacy-cover.jpg", alt: "Capa legada",
    excerpt: "Resumo legado", dek: "Subtítulo legado", bodyHtml: "<p>Conteúdo legado.</p>",
  });
  await writeFile(legacySourcePath, legacySource);
  await writeFile(path.join(sourceRoot, "content", "articles", "index.json"), JSON.stringify([
    { slug: "legacy", path: "content/articles/legacy.json" },
  ]));
  await writeFile(path.join(sourceRoot, "assets", "articles-catalog.json"), JSON.stringify([
    { slug: "legacy", title: "Artigo legado", path: "content/articles/legacy.json" },
  ]));
  await writeFile(path.join(sourceRoot, "sw-version.js"),
    'const PRECACHE_VERSION = "legacy";\nconst PRECACHE_FILES = ["index.html", "article.html", "assets/articles-catalog.json", "content/articles/index.json"];\n');
  const sourceLegacyFiles = [...PUBLIC_ROOT_FILES, "assets/articles-catalog.json", "assets/legacy/legacy-cover.jpg",
    "assets/preview/preview-cover.jpg", "assets/preview/manual.pdf", "content/articles/index.json",
    "content/articles/legacy.json"].sort();
  const sourceLegacyDist = path.join(sourceRoot, "dist");
  await mkdir(sourceLegacyDist, { recursive: true });
  for (const file of sourceLegacyFiles) {
    const destination = path.join(sourceLegacyDist, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(sourceRoot, file), destination);
  }
  await writeFile(path.join(sourceLegacyDist, ".site-artifact.json"),
    `${JSON.stringify({ version: 1, files: sourceLegacyFiles }, null, 2)}\n`);

  execFileSync("git", ["init", "--quiet"], { cwd: sourceRoot, stdio: "ignore" });
  execFileSync("git", ["add", "content/articles/preview.md", "content/articles/legacy.json",
    "generation/taxonomy/tags.json", "content/tts-lexicon.json", "assets/preview", "assets/legacy"],
  { cwd: sourceRoot, stdio: "ignore" });
  execFileSync("git", ["-c", "user.name=Tech Topics Fixture", "-c", "user.email=fixture@example.invalid",
    "commit", "-m", "legacy JSON source snapshot"], { cwd: sourceRoot, stdio: "ignore" });
  const legacyMarkdown = relationalMarkdown("legacy", "Artigo legado", "Conteúdo legado.");
  await writeFile(legacyMarkdownPath, legacyMarkdown, "utf8");
  await rm(legacySourcePath);
  await rm(path.join(sourceRoot, "content", "articles", "index.json"));
  execFileSync("git", ["add", "--all", "content/articles"], { cwd: sourceRoot, stdio: "ignore" });
  execFileSync("git", ["-c", "user.name=Tech Topics Fixture", "-c", "user.email=fixture@example.invalid",
    "commit", "-m", "migrate the legacy fixture to Markdown"], { cwd: sourceRoot, stdio: "ignore" });
  const initialArticleAddition = execFileSync("git", ["log", "--reverse", "--diff-filter=A", "--format=%cI", "HEAD",
    "--", "content/articles/preview.md", "content/articles/legacy.json", "content/articles/legacy.md"],
  { cwd: sourceRoot, encoding: "utf8" }).split(/\r?\n/).find(Boolean);
  const savedLegacyMarkdown = await readFile(legacyMarkdownPath, "utf8");
  const productionSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot, encoding: "utf8" }).trim();
  await writeFile(path.join(sourceRoot, "history-marker.txt"), "keeps the article source commit behind HEAD\n");
  execFileSync("git", ["add", "history-marker.txt"], { cwd: sourceRoot, stdio: "ignore" });
  execFileSync("git", ["-c", "user.name=Tech Topics Fixture", "-c", "user.email=fixture@example.invalid",
    "commit", "-m", "fixture follow-up commit"], { cwd: sourceRoot, stdio: "ignore" });
  const shallowFile = path.join(sourceRoot, ".git", "shallow");
  await writeFile(shallowFile, `${productionSha}\n`);
  assert.equal(execFileSync("git", ["rev-parse", "--is-shallow-repository"],
    { cwd: sourceRoot, encoding: "utf8" }).trim(), "true");
  await assert.rejects(buildMarkdownSiteArtifact({ root: sourceRoot, sourceSha: productionSha }), /complete Git history/);
  await rm(shallowFile);
  const production = await buildMarkdownSiteArtifact({ root: sourceRoot, sourceSha: productionSha });
  assert.equal(production.destination, path.join(sourceRoot, "dist"));
  assert.equal(production.sourceSha, productionSha);
  const verifiedIdentity = await verifyMarkdownSiteArtifact(production.destination, productionSha);
  assert.deepEqual(verifiedIdentity, { sourceSha: productionSha, buildId: production.buildId, fileCount: production.files.length });
  await assert.rejects(verifyMarkdownSiteArtifact(production.destination, "f".repeat(40)), /source SHA does not match/);
  assert.equal(production.files.includes("content/articles/legacy.html"), true);
  assert.equal(production.files.includes("content/articles/preview.html"), true);
  assert.equal(production.files.some(file => /^content\/articles\/[^/]+\.(?:json|md)$/.test(file)), false);
  const productionCatalog = JSON.parse(await readFile(path.join(production.destination, "assets", "articles-catalog.json"), "utf8"));
  assert.deepEqual(productionCatalog.articles.map(article => article.slug).sort(), ["legacy", "preview"]);
  assert.equal(productionCatalog.transport, "html-v1");
  assert.ok(productionCatalog.articles.every(article => article.addedAt === initialArticleAddition),
    "production catalog dates must come from the first article additions, not the latest source commit");
  assert.equal(await readFile(legacyMarkdownPath, "utf8"), savedLegacyMarkdown,
    "publishing the HTML transport preserves the Markdown editorial source");
  await assert.rejects(buildMarkdownSiteArtifact({ root: sourceRoot, destination: path.join(temporaryRoot, "outside-dist"), sourceSha: productionSha }),
    /destination must be <root>\/dist/);

  const productionManifestPath = path.join(production.destination, ".site-artifact.json");
  const productionManifest = await readFile(productionManifestPath, "utf8");
  const verifiedHtmlPath = path.join(production.destination, "content", "articles", "legacy.html");
  const verifiedHtml = await readFile(verifiedHtmlPath);
  await writeFile(verifiedHtmlPath, Buffer.concat([verifiedHtml, Buffer.from(" ")]));
  await assert.rejects(verifyMarkdownSiteArtifact(production.destination, productionSha), /content does not match its build ID/);
  await writeFile(verifiedHtmlPath, verifiedHtml);
  await rm(legacyMarkdownPath);
  await assert.rejects(buildMarkdownSiteArtifact({ root: sourceRoot, sourceSha: productionSha }), /Article source inventory differs from sourceSha/);
  assert.equal(await readFile(productionManifestPath, "utf8"), productionManifest,
    "a removed committed article preserves the last valid HTML package");
  await writeFile(legacyMarkdownPath, savedLegacyMarkdown);

  const legacyCover = await readFile(legacyCoverPath);
  await rm(legacyCoverPath);
  await assert.rejects(buildMarkdownSiteArtifact({ root: sourceRoot, sourceSha: productionSha }), /Article asset inventory differs from sourceSha/);
  assert.equal(await readFile(productionManifestPath, "utf8"), productionManifest,
    "a removed committed article asset preserves the last valid HTML package");
  await writeFile(legacyCoverPath, legacyCover);

  await writeFile(articlePath, markdown(`${opening}\n\nO corpo foi alterado depois do SHA de origem.\n`), "utf8");
  await assert.rejects(buildMarkdownSiteArtifact({ root: sourceRoot, sourceSha: productionSha }), /differs from sourceSha/);
  assert.equal(await readFile(productionManifestPath, "utf8"), productionManifest,
    "a source snapshot mismatch preserves the last valid HTML package");
  await writeFile(articlePath, "---\nslug: duplicate\nslug: invalid\n---\nBroken.\n", "utf8");
  await assert.rejects(buildMarkdownSiteArtifact({ root: sourceRoot, sourceSha: productionSha }));
  assert.equal(await readFile(productionManifestPath, "utf8"), productionManifest,
    "an invalid source rebuild preserves the last valid HTML package");
  await writeFile(articlePath, markdown(`${opening}\n\n[Baixar manual](../../assets/preview/manual.pdf?versao=1#guia)\n`), "utf8");

  const unmanagedPublicFile = path.join(production.destination, "precious.txt");
  await writeFile(unmanagedPublicFile, "keep");
  await assert.rejects(buildMarkdownSiteArtifact({ root: sourceRoot, sourceSha: productionSha }), /unlisted files/);
  assert.equal(await readFile(unmanagedPublicFile, "utf8"), "keep");
  await rm(unmanagedPublicFile);

  const unmanaged = path.join(temporaryRoot, "unmanaged");
  await mkdir(unmanaged);
  await writeFile(path.join(unmanaged, "keep.txt"), "user data");
  await assert.rejects(() => buildMarkdownPreview({
    root: sourceRoot, sourceSha, destination: unmanaged,
  }), /unmanaged/);
  assert.equal(await readFile(path.join(unmanaged, "keep.txt"), "utf8"), "user data");

  const manifestPath = path.join(first.destination, ".site-artifact.json");
  const beforeFailure = await readFile(manifestPath, "utf8");

  await writeFile(articlePath, "---\nslug: preview\nslug: duplicate\n---\n\nBroken.\n", "utf8");
  await assert.rejects(() => buildMarkdownPreview({
    root: sourceRoot, sourceSha, destination: first.destination,
  }));
  assert.equal(await readFile(manifestPath, "utf8"), beforeFailure,
    "a failed rebuild preserves the last valid package");

  const relatedPath = path.join(sourceRoot, "content", "articles", "related.md");
  await writeFile(articlePath, relationalMarkdown("preview", "Preview", "Texto.", [
    "series: guia", "seriesOrder: 1",
  ]));
  const relatedCoverPath = path.join(sourceRoot, "assets", "related", "related-cover.jpg");
  await mkdir(path.dirname(relatedCoverPath), { recursive: true });
  await writeFile(relatedCoverPath, Buffer.from("related cover"));
  await writeFile(relatedPath, relationalMarkdown("related", "Relacionado", "Texto.", [
    "series: guia", "seriesOrder: 1",
  ]));
  const duplicateSeriesDestination = path.join(temporaryRoot, "duplicate-series");
  await assert.rejects(() => buildMarkdownPreview({
    root: sourceRoot, sourceSha, destination: duplicateSeriesDestination,
  }), /unique seriesOrder/);
  await assert.rejects(lstat(duplicateSeriesDestination), { code: "ENOENT" });

  await writeFile(articlePath, relationalMarkdown("preview", "Preview", "Texto.", [
    "prerequisites: [related]",
  ]));
  await writeFile(relatedPath, relationalMarkdown("related", "Relacionado", "Texto.", [
    "prerequisites: [preview]",
  ]));
  const cycleDestination = path.join(temporaryRoot, "prerequisite-cycle");
  await assert.rejects(() => buildMarkdownPreview({
    root: sourceRoot, sourceSha, destination: cycleDestination,
  }), /prerequisite cycle/);
  await assert.rejects(lstat(cycleDestination), { code: "ENOENT" });
  console.log("PASS: deterministic HTML preview, safe managed rebuilds, corpus metadata, and cache identity");
} finally {
  await import("node:fs/promises").then(({ rm }) => rm(temporaryRoot, { recursive: true, force: true }));
}
