import assert from 'node:assert/strict';
import { compileMarkdownArticle } from './lib/markdown-article.mjs';
const source = `---
formatVersion: 2
publishedAt: '2026-10-28'
category: Resiliência
tags: [resiliencia]
language: pt-BR
date: 28 de outubro de 2026
read: 5 min
excerpt: Resumo.
---

# Título

> Dek do artigo.

![Capa ilustrada](./cover.jpg)

Abertura do artigo.

## Neste artigo

- [Seção](#alias)

<a name="alias"></a>

## Seção

Texto.
`;
const result = await compileMarkdownArticle({source, sourcePath:'articles/teste/article.md', knownTags:new Set(['resiliencia']), knownSlugs:new Set(['teste']), assetExists: () => true});
assert.equal(result.metadata.slug, 'teste');
assert.equal(result.metadata.title, 'Título');
assert.equal(result.headingAnchor, 'título');
assert.equal(result.metadata.image, 'assets/teste/teste-cover.jpg');
assert.match(result.slots.body, /^<p>Abertura/);
assert.match(result.slots.body, /<nav aria-label="Neste artigo"/);
assert.match(result.slots.body, /id="seção"/);
assert.match(result.slots.body, /name="alias"/);
await assert.rejects(() => compileMarkdownArticle({ source: source.replace('formatVersion: 2', 'formatVersion: 2\ntitle: duplicated'), sourcePath:'articles/teste/article.md', knownTags:new Set(['resiliencia']), assetExists: () => true }), /derived/);
await assert.rejects(() => compileMarkdownArticle({ source: source.replace('[Seção](#alias)', '[Seção](#missing)'), sourcePath:'articles/teste/article.md', knownTags:new Set(['resiliencia']), assetExists: () => true }), /contents target/);
const duplicates = source.replace('Texto.', 'Texto.\n\n## Seção\n\nMais texto.');
const duplicateResult = await compileMarkdownArticle({source:duplicates, sourcePath:'articles/teste/article.md', knownTags:new Set(['resiliencia']), assetExists: () => true});
assert.match(duplicateResult.slots.body, /id="seção-1"/);
const unicode = source.replace('[Seção](#alias)', '[Seção](#café--ação-中文)').replace('<a name="alias"></a>\n\n## Seção', '## Café & ação: 中文!').replace('Texto.', 'Texto.\n\n## Café & ação: 中文!\n\nMais texto.');
const unicodeResult = await compileMarkdownArticle({source:unicode, sourcePath:'articles/teste/article.md', knownTags:new Set(['resiliencia']), assetExists: () => true});
assert.match(unicodeResult.slots.body, /id="café--ação-中文"/);
assert.match(unicodeResult.slots.body, /id="café--ação-中文-1"/);
await assert.rejects(() => compileMarkdownArticle({source:source.replace('Texto.', '![Inválida](../../../../etc/passwd)'), sourcePath:'articles/teste/article.md', knownTags:new Set(['resiliencia']), assetExists: () => true}), /escapes repository root/);
await assert.rejects(() => compileMarkdownArticle({source, sourcePath:'articles/teste/article.md', knownTags:new Set(['resiliencia']), assetExists: () => false}), /cover asset does not exist/);
const diagram = source.replace('Texto.', 'Contexto acessível do diagrama.\n\n```mermaid\ngraph TD\n  A --> B\n```');
const diagramResult = await compileMarkdownArticle({source:diagram, sourcePath:'articles/teste/article.md', knownTags:new Set(['resiliencia']), assetExists: () => true});
assert.match(diagramResult.slots.body, /class="mermaid-figure"/);
const { mkdtemp, mkdir, writeFile, cp, rm, symlink } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const path = await import('node:path');
const { compileArticleCorpus } = await import('./lib/article-corpus.mjs');
const { discoverArticleSources } = await import('./lib/generation-system.mjs');
const root = await mkdtemp(path.join(tmpdir(), 'article-v2-'));
try {
  await mkdir(path.join(root, 'content/articles'), {recursive:true});
  await mkdir(path.join(root, 'assets'), {recursive:true});
  await mkdir(path.join(root, 'generation/taxonomy'), {recursive:true});
  await cp('generation/taxonomy/tags.json', path.join(root, 'generation/taxonomy/tags.json'));
  for (const slug of ['teste', 'outro']) {
    await mkdir(path.join(root, 'articles', slug), {recursive:true});
    await writeFile(path.join(root, 'articles', slug, 'cover.jpg'), 'fixture');
  }
  await mkdir(path.join(root, 'assets/plano'), {recursive:true});
  await writeFile(path.join(root, 'assets/plano/plano-cover.jpg'), 'fixture');
  const flat = source.replace('formatVersion: 2', 'slug: plano\ntitle: Plano\ndek: Dek plano.\nimage: assets/plano/plano-cover.jpg\nalt: Capa plana').replace(/# Título\n\n> Dek do artigo\.\n\n!\[Capa ilustrada\]\(\.\/cover\.jpg\)\n\n/, '');
  await writeFile(path.join(root, 'content/articles/plano.md'), flat);
  await writeFile(path.join(root, 'articles/teste/article.md'), source);
  await writeFile(path.join(root, 'articles/outro/article.md'), source.replace('# Título', '# Outro título'));
  for (const slug of ['assets', 'content', 'docs', 'articles', 'scripts', 'generation', 'tools', 'index', 'article', 'dist']) {
    const flatPath = path.join(root, 'content/articles', `${slug}.md`);
    await writeFile(flatPath, flat.replaceAll('plano', slug));
    await assert.rejects(() => discoverArticleSources(root), /reserved.*slug|slug.*reserved/i);
    await rm(flatPath);
    const nestedDir = path.join(root, 'articles', slug);
    await mkdir(nestedDir, {recursive:true});
    await writeFile(path.join(nestedDir, 'article.md'), source);
    await assert.rejects(() => discoverArticleSources(root), /reserved.*slug|slug.*reserved/i);
    await rm(nestedDir, {recursive:true, force:true});
  }
  await writeFile(path.join(root, 'articles/teste/article.md'), source.replace('Texto.', 'Veja [Outro](../outro/article.md#alias) e [Plano](../../content/articles/plano.md#alias).'));
  await writeFile(path.join(root, 'articles/outro/article.md'), source.replace('# Título', '# Outro título'));
  const corpus = await compileArticleCorpus(root);
  assert.equal(corpus.length, 3);
  assert.match(corpus.find(item => item.article.slug === 'teste').compiled.slots.body, /href="outro\/#alias"/);
  await writeFile(path.join(root, 'articles/teste/article.md'), source.replace('Texto.', 'Veja [Outro](../outro/article.md#ausente).'));
  await assert.rejects(() => compileArticleCorpus(root), /unknown fragment/);
  await writeFile(path.join(root, 'articles/teste/article.md'), source.replace('Texto.', 'Veja <a href="../outro/article.md#alias">Outro</a>.'));
  const htmlCorpus = await compileArticleCorpus(root);
  assert.match(htmlCorpus.find(item => item.article.slug === 'teste').compiled.slots.body, /href="outro\/#alias"/);
  await writeFile(path.join(root, 'articles/teste/article.md'), source.replace('Texto.', 'Veja <a href="../outro/article.md#ausente">Outro</a>.'));
  await assert.rejects(() => compileArticleCorpus(root), /unknown fragment/);
  await writeFile(path.join(root, 'articles/teste/article.md'), source);
  await symlink('cover.jpg', path.join(root, 'articles/teste/link.jpg'));
  await assert.rejects(() => compileArticleCorpus(root), /Symbolic links/);
} finally { await rm(root, {recursive:true, force:true}); }

console.log('PASS: v2 compiler and mixed corpus');
