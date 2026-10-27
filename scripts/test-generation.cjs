const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { mkdtemp, mkdir, writeFile, readFile, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const { pathToFileURL } = require("node:url");

const run = promisify(execFile);
const root = path.resolve(__dirname, "..");
const composer = path.join(root, "scripts", "compose-article-brief.mjs");
const coverComposer = path.join(root, "scripts", "compose-cover-brief.mjs");

async function expectFailure(args, pattern) {
  await assert.rejects(
    run(process.execPath, [composer, ...args], { cwd: root }),
    error => pattern.test(`${error.stderr}\n${error.stdout}`)
  );
}

(async () => {
  const catalog = await run(process.execPath, [composer, "--list"], { cwd: root });
  const generationReadme = await readFile(path.join(root, "generation", "README.md"), "utf8");
  const authoring = await readFile(path.join(root, "generation", "editorial", "AUTHORING.md"), "utf8");
  assert.match(generationReadme, /formato-fonte, template, taxonomia e validação.*contrato autoral/);
  assert.match(authoring, /O build público aceita somente fontes Markdown/);
  assert.doesNotMatch(generationReadme, /O build público compila/);
  assert.doesNotMatch(generationReadme, /build público vigente ainda lê JSON e ignora/);
  assert.match(catalog.stdout, /explain-concept/);
  assert.match(catalog.stdout, /distributed-systems/);
  assert.match(catalog.stdout, /Published topics/);
  assert.match(catalog.stdout, /"slug":"four-golden-signals"/);
  assert.doesNotMatch(catalog.stdout, /"bodyHtml"/);

  const result = await run(process.execPath, [
    composer,
    "--topic", "Circuit Breaker",
    "--task", "explain-concept",
    "--framework", "distributed-systems",
    "--framework", "backend",
    "--depth", "advanced"
  ], { cwd: root });
  assert.match(result.stdout, /content\/articles\/circuit-breaker\.md/);
  assert.match(result.stdout, /Lente de domínio: Sistemas distribuídos/);
  assert.match(result.stdout, /Lente de domínio: Backend/);
  assert.doesNotMatch(result.stdout, /Lente de domínio: Observabilidade/);
  assert.match(result.stdout, /content\/articles\/<slug>\.md/);
  assert.doesNotMatch(result.stdout, /contrato JSON vigente/);
  assert.match(result.stdout, /O build público aceita fontes Markdown/);
  assert.match(result.stdout, /valida os artigos Markdown e constrói o pacote/);
  assert.ok(Buffer.byteLength(result.stdout) < 32768);
  // The active authoring module is included in every generated brief:
  // models must receive TTS aliases for meaningful inline code and arrows.
  assert.match(result.stdout, /data-tts-say="try catch"/);
  assert.match(result.stdout, /<code lang="en-US"/);
  assert.match(result.stdout, /data-tts-say="para o"/);
  assert.match(result.stdout, /data-tts-say="aumenta"/);
  assert.match(result.stdout, /data-tts-say="diminuem"/);
  assert.match(result.stdout, /não traduza símbolos globalmente/);

  const cover = await run(process.execPath, [coverComposer], { cwd: root });
  assert.match(cover.stdout, /Style anchor obrigatório/);
  assert.match(cover.stdout, /four-golden-signals-cover\.jpg/);
  assert.match(cover.stdout, /Critérios de aceitação da capa/);
  assert.doesNotMatch(cover.stdout, /capa determinística/);
  assert.ok(Buffer.byteLength(cover.stdout) < 8192);

  const coverFixture = await mkdtemp(path.join(os.tmpdir(), "tech-topics-cover-"));
  try {
    await mkdir(path.join(coverFixture, "scripts"));
    await mkdir(path.join(coverFixture, "docs"));
    const fixtureComposer = path.join(coverFixture, "scripts", "compose-cover-brief.mjs");
    await writeFile(fixtureComposer, await readFile(coverComposer));
    const visualStyle = (await readFile(path.join(root, "docs", "VISUAL_STYLE.md"), "utf8")).replace(/\r\n?/g, "\n");
    for (const newline of ["\n", "\r\n", "\r"]) {
      await writeFile(path.join(coverFixture, "docs", "VISUAL_STYLE.md"), visualStyle.replace(/\n/g, newline));
      const fixtureCover = await run(process.execPath, [fixtureComposer]);
      assert.equal(fixtureCover.stdout, cover.stdout, "cover brief must be independent of document line endings");
    }
  } finally {
    await rm(coverFixture, { recursive: true, force: true });
  }

  await expectFailure([
    "--topic", "Circuit Breaker",
    "--task", "unknown-task",
    "--framework", "backend"
  ], /unknown task/);
  await expectFailure([
    "--topic", "Four Golden Signals",
    "--task", "explain-concept",
    "--framework", "observability"
  ], /topic already exists/);
  await expectFailure([
    "--topic", "Circuit Breaker",
    "--task", "explain-concept",
    "--framework", "backend",
    "--framework", "cloud",
    "--framework", "security",
    "--framework", "networking"
  ], /at most 3 frameworks/);
  await expectFailure([
    "--topic", "Circuit\nBreaker",
    "--task", "explain-concept",
    "--framework", "backend"
  ], /single printable line/);

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "tech-topics-generation-"));
  await mkdir(path.join(temporaryRoot, "generation", "editorial"), { recursive: true });
  await mkdir(path.join(temporaryRoot, "generation", "frameworks"), { recursive: true });
  await mkdir(path.join(temporaryRoot, "generation", "taxonomy"), { recursive: true });
  await mkdir(path.join(temporaryRoot, "generation", "templates"), { recursive: true });
  await writeFile(path.join(temporaryRoot, "generation", "editorial", "AUTHORING.md"), "# Authoring\n");
  await writeFile(path.join(temporaryRoot, "generation", "frameworks", "safe.md"), "# Safe\n");
  const invalidRegistry = {
    version: 1,
    limits: { maxFrameworks: 1, maxModuleBytes: 1024, maxBriefBytes: 2048 },
    authoring: "editorial/AUTHORING.md",
    tasks: { unsafe: { label: "Unsafe", file: "../outside.md" } },
    frameworks: { safe: { label: "Safe", file: "frameworks/safe.md" } }
  };
  const moduleUrl = pathToFileURL(path.join(root, "scripts", "lib", "generation-system.mjs"));
  const { validateGenerationRegistry, discoverArticleSources } = await import(moduleUrl.href);
  await assert.rejects(validateGenerationRegistry(temporaryRoot, invalidRegistry), /normalized|must live|traversal/);

  // Exercise the actual article CLI with the same selected modules in LF and CRLF.
  await mkdir(path.join(temporaryRoot, "scripts", "lib"), { recursive: true });
  await mkdir(path.join(temporaryRoot, "generation", "tasks"));
  await mkdir(path.join(temporaryRoot, "content", "articles"), { recursive: true });
  const fixtureArticleComposer = path.join(temporaryRoot, "scripts", "compose-article-brief.mjs");
  await writeFile(fixtureArticleComposer, await readFile(composer));
  const generationSystemSource = await readFile(path.join(root, "scripts", "lib", "generation-system.mjs"), "utf8");
  const sharedArticleModule = pathToFileURL(path.join(root, "scripts", "lib", "markdown-article.mjs")).href;
  await writeFile(path.join(temporaryRoot, "scripts", "lib", "generation-system.mjs"), generationSystemSource.replace(
    'from "./markdown-article.mjs"', `from ${JSON.stringify(sharedArticleModule)}`
  ));
  const validRegistry = { ...invalidRegistry, tasks: { fixture: { label: "Fixture", file: "tasks/fixture.md" } } };
  await writeFile(path.join(temporaryRoot, "generation", "registry.json"), JSON.stringify(validRegistry));
  await writeFile(path.join(temporaryRoot, "generation", "taxonomy", "tags.json"), JSON.stringify({ version: 1, tags: { teste: { label: "Teste", description: "Tag de teste." } }, optionalMetadata: {} }));
  await writeFile(path.join(temporaryRoot, "generation", "templates", "article.md"), "---\nslug: PREENCHER-SLUG\n---\nPREENCHER: conteúdo\n");
  const taxonomy = { version: 1, tags: { teste: { label: "Teste", description: "Tag de teste." } }, optionalMetadata: {} };
  const fixtureModules = ["editorial/AUTHORING.md", "tasks/fixture.md", "frameworks/safe.md"];
  let canonicalBrief;
  for (const newline of ["\n", "\r\n", "\r"]) {
    for (const file of fixtureModules) await writeFile(path.join(temporaryRoot, "generation", file), ["# Fixture", "", "Texto do módulo.", "Outra linha.", ""].join(newline));
    const composed = await run(process.execPath, [fixtureArticleComposer, "--topic", "Novo tema", "--task", "fixture", "--framework", "safe"]);
    canonicalBrief ??= composed.stdout;
    assert.equal(composed.stdout, canonicalBrief, "article brief must be independent of selected module line endings");
    assert.equal(composed.stdout.includes("\r"), false);
  }

  const articleMarkdown = (slug, fields = "") => [
    "---", `slug: ${slug}`, "language: pt-BR", `title: ${slug}`, 'category: "Sistemas"', 'date: "1 de janeiro de 2026"',
    'publishedAt: "2026-01-01"', 'read: "5 min"', `image: assets/${slug}/${slug}-cover.jpg`, 'alt: "Descrição de teste"',
    'dek: "Resumo de teste"', 'excerpt: "Resumo curto de teste"', /^tags:/m.test(fields) ? "" : "tags: [teste]", fields, "---", "Texto completo.", ""
  ].filter(Boolean).join("\n");
  const legacyArticle = (slug, fields = {}) => ({
    slug, language: "pt-BR", title: slug, category: "Sistemas", date: "1 de janeiro de 2026", publishedAt: "2026-01-01",
    read: "5 min", image: `assets/${slug}/${slug}-cover.jpg`, alt: "Descrição de teste", dek: "Resumo de teste", excerpt: "Resumo curto de teste", ...fields
  });
  const discoveryOptions = { taxonomy };
  const rawArticleTemplate = await readFile(path.join(root, "generation", "templates", "article.md"), "utf8");
  await writeFile(path.join(temporaryRoot, "content", "articles", "draft.md"), rawArticleTemplate);
  await assert.rejects(() => discoverArticleSources(temporaryRoot, discoveryOptions), /unresolved template placeholders/);
  await rm(path.join(temporaryRoot, "content", "articles", "draft.md"));
  const populatedTemplate = rawArticleTemplate
    .replaceAll("PREENCHER-SLUG", "base")
    .replace("PREENCHER: título do artigo", "Base")
    .replace("PREENCHER: categoria editorial", "Sistemas")
    .replace("PREENCHER: data legível herdada do contrato vigente", "1 de janeiro de 2026")
    .replace('publishedAt: "YYYY-MM-DD"', 'publishedAt: "2026-01-01"')
    .replace("PREENCHER: tempo de leitura", "3 min")
    .replace("PREENCHER: descrição objetiva da capa", "Descrição da capa")
    .replace("PREENCHER: resumo curto do artigo", "Resumo curto")
    .replace("PREENCHER: resumo para descoberta e busca", "Resumo de descoberta")
    .replace("PREENCHER-TAG-CANONICA", "teste")
    .replace(/^# .*$/gm, "")
    .replace(/PREENCHER: [^\r\n]+/g, "Conteúdo de fixture.");
  await writeFile(path.join(temporaryRoot, "content", "articles", "base.md"), populatedTemplate);
  const todoArticlePath = path.join(temporaryRoot, "content", "articles", "todo-pedido.md");
  await writeFile(todoArticlePath, articleMarkdown("todo-pedido").replace("Texto completo.", "Todo pedido recebe um identificador; preencher a variável é uma ação explícita do operador."));
  assert.ok((await discoverArticleSources(temporaryRoot, discoveryOptions)).some(source => source.slug === "todo-pedido"));
  await rm(todoArticlePath);
  const reintroducedJsonPath = path.join(temporaryRoot, "content", "articles", "reintroduced.json");
  await writeFile(reintroducedJsonPath, "{}\n");
  await assert.rejects(() => discoverArticleSources(temporaryRoot, discoveryOptions), /individual article JSON sources are no longer supported/);
  await rm(reintroducedJsonPath);
  const codeExamplePath = path.join(temporaryRoot, "content", "articles", "template-syntax.md");
  await writeFile(codeExamplePath, articleMarkdown("template-syntax").replace(
    "Texto completo.",
    "Use `{{ user.name }}` para interpolação e este bloco:\n\n```handlebars\n{{ account.id }}\n```"
  ));
  assert.ok((await discoverArticleSources(temporaryRoot, discoveryOptions)).some(source => source.slug === "template-syntax"));
  await rm(codeExamplePath);
  const unresolvedBracePath = path.join(temporaryRoot, "content", "articles", "unresolved-braces.md");
  await writeFile(unresolvedBracePath, articleMarkdown("unresolved-braces").replace("Texto completo.", "{{ preencher o corpo }}"));
  await assert.rejects(() => discoverArticleSources(temporaryRoot, discoveryOptions), /unresolved template placeholders/);
  await rm(unresolvedBracePath);
  const validMetadataWithPlaceholder = populatedTemplate
    .replaceAll("base", "draft")
    .replace("Conteúdo de fixture.", "PREENCHER: conteúdo pendente.");
  const draftPath = path.join(temporaryRoot, "content", "articles", "draft.md");
  await writeFile(draftPath, validMetadataWithPlaceholder);
  await assert.rejects(() => discoverArticleSources(temporaryRoot, discoveryOptions), /unresolved template placeholders/);
  await writeFile(draftPath, populatedTemplate.replaceAll("base", "draft").replace('publishedAt: "2026-01-01"', 'publishedAt: "YYYY-MM-DD"'));
  await assert.rejects(() => discoverArticleSources(temporaryRoot, discoveryOptions), /unresolved template placeholders/);
  await rm(draftPath);
  await writeFile(path.join(temporaryRoot, "content", "articles", "next.md"), articleMarkdown("next", "prerequisites: [base]"));
  const markdownSources = await discoverArticleSources(temporaryRoot, discoveryOptions);
  assert.deepEqual(markdownSources.map(source => source.slug), ["base", "next"]);
  assert.equal(markdownSources[0].sourceType, "markdown");
  assert.equal(markdownSources[0].title, "Base");
  assert.deepEqual(markdownSources[0].tags, ["teste"]);
  await writeFile(path.join(temporaryRoot, "content", "articles", "base.json"), JSON.stringify(legacyArticle("base", { title: "Base" })));
  await assert.rejects(() => discoverArticleSources(temporaryRoot, discoveryOptions), /individual article JSON sources are no longer supported/);
  await rm(path.join(temporaryRoot, "content", "articles", "base.json"));
  await writeFile(path.join(temporaryRoot, "content", "articles", "next.md"), articleMarkdown("next", "prerequisites: [missing]"));
  await assert.rejects(() => discoverArticleSources(temporaryRoot, discoveryOptions), /unknown prerequisite slug/);
  await writeFile(path.join(temporaryRoot, "content", "articles", "next.md"), articleMarkdown("next", "prerequisites: [base]"));
  await writeFile(path.join(temporaryRoot, "content", "articles", "base.md"), articleMarkdown("base", "prerequisites: [next]"));
  await assert.rejects(() => discoverArticleSources(temporaryRoot, discoveryOptions), /prerequisite cycle detected/);
  await writeFile(path.join(temporaryRoot, "content", "articles", "base.md"), articleMarkdown("base", "updatedAt: 2026-02-30"));
  await assert.rejects(() => discoverArticleSources(temporaryRoot, discoveryOptions), /updatedAt must be a valid date/);
  await writeFile(path.join(temporaryRoot, "content", "articles", "base.md"), articleMarkdown("base", "level: beginner"));
  await assert.rejects(() => discoverArticleSources(temporaryRoot, discoveryOptions), /level must be introdutorio/);
  await writeFile(path.join(temporaryRoot, "content", "articles", "base.md"), articleMarkdown("base", "series: series-a"));
  await assert.rejects(() => discoverArticleSources(temporaryRoot, discoveryOptions), /series and seriesOrder must be provided together/);
  await writeFile(path.join(temporaryRoot, "content", "articles", "base.md"), articleMarkdown("base", "tags: [unknown]"));
  await assert.rejects(() => discoverArticleSources(temporaryRoot, discoveryOptions), /unknown tag ID/);
  await writeFile(path.join(temporaryRoot, "content", "articles", "base.md"), articleMarkdown("base", "series: series-a\nseriesOrder: 2"));
  await writeFile(path.join(temporaryRoot, "content", "articles", "next.md"), articleMarkdown("next", "series: series-a\nseriesOrder: 5"));
  assert.deepEqual((await discoverArticleSources(temporaryRoot, discoveryOptions)).map(source => source.slug), ["base", "next"]);
  await writeFile(path.join(temporaryRoot, "content", "articles", "next.md"), articleMarkdown("next", "series: series-a\nseriesOrder: 2"));
  await assert.rejects(() => discoverArticleSources(temporaryRoot, discoveryOptions), /unique seriesOrder values/);
  await rm(temporaryRoot, { recursive: true, force: true });

  console.log("PASS: article and cover briefs are selective, compact and reject unsafe or invalid input.");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
