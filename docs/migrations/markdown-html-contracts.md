# Contratos de integração da migração Markdown → HTML

> Referência de planejamento histórica. A issue #103 conclui este corte: o checkout corrente aceita somente Markdown; regras de transição e compatibilidade ativa descritas abaixo foram substituídas. JSON individual só deve ser lido em comparações de refs antigas e inspeção de rollback.

Decisões de interface para revisão em M01 (#89), subordinadas à especificação [#87](https://github.com/joaovpimenta/tech-topics/issues/87). Referência inicial: `fca72c31fcb57ffe9741a2390a04c2035639e14a`. Este documento define a interface para as entregas seguintes; não afirma que compilador, preparação PWA, corte HTML ou conversão estejam implementados. O ADR definitivo pertence a #106.

## Fonte, API e saída

Uma fonte por slug: `content/articles/<slug>.md` no estado final. O adaptador JSON é permitido apenas durante a transição; leitura histórica permanece restrita à comparação/rollback. O inventário enumera fontes, nunca depende do índice versionado incompleto. Duas fontes do mesmo slug são erro, não preferência de extensão.

O compilador Node terá uma única implementação compartilhada de YAML/GFM e HTML. Contrato público planejado em `scripts/lib/markdown-article.mjs`:

```js
// Entrada editorial, sem escrita e sem rede; resolução/validação usa contexto explícito.
compileArticle({ source, sourcePath, format, context })
// => { metadata, titleHtml, dekHtml, bodyHtml, dependencies, diagnostics }

// Entrada histórica apenas durante transição/comparação.
adaptLegacyArticle({ source, sourcePath, context })
// => o mesmo contrato em memória

// Inventário e publicação recebem contexto de Git/paths por injeção.
discoverArticleSources({ repository, ref, allowLegacy })
// => fontes por slug; rejeita duplicatas antes de renderizar
```

`metadata` não contém corpo. Os nomes `bodyHtml`/AST acima descrevem valores em memória, nunca arquivo JSON de artigo. `context` identifica raiz, inventário, léxico, regras de URL e versões dos extratores. Nenhum parser Markdown/YAML vai ao navegador ou ao Python. O bridge Python consome o HTML validado do mesmo compilador/SHA. Build e comparação não consultam API mutável para renderizar.

Separar compilação de montagem evita dependência circular do hash: calcular identidade sobre bytes canônicos de shell, catálogo sem identidade, HTML sem identidade, léxico e recursos relevantes; só depois inserir a identidade igual nos envelopes/catálogo. Sem relógio de build. Mudar somente o meio do corpo deve mudar a identidade.

O artefato contém `content/articles/<slug>.html` e `assets/articles-catalog.json`, sem MD, JSON individual ou `content/articles/index.json`. HTML gerado não é versionado. Staging gerenciado reúne todas as saídas e valida antes da substituição atômica de `dist/`; falha conserva a última saída válida e rejeita arquivos alheios.

## Envelope e slots

Envelope de transporte v1 proposto, não um documento executável:

```html
<article data-article-format="html-v1" data-article-slug="exemplo" data-build-id="HASH">
  <header data-article-header>
    <h1 data-article-slot="heading">Título com marcação de fala compilada</h1>
    <p data-article-slot="dek">Subtítulo com marcação compilada</p>
  </header>
  <section data-article-slot="body"><p>Abertura integral.</p></section>
</article>
```

Exatamente um envelope, um heading, um dek e um body. Só o conteúdo interno de cada slot é instalado em `#article-heading`, `#article-dek` e `#article-body`, respectivamente; o envelope não permanece como ancestral duplicado no DOM. Os IDs desses slots pertencem ao shell. Título/dek são narrados exatamente uma vez. Elementos editoriais do corpo conservam IDs originais. Envelope/identidade não acrescentam texto narrável. Validação de slug, identidade e estrutura vem antes da montagem; resposta HTTP de fallback/404 nunca é aceita como artigo.

Catálogo agregado mantém os campos atuais, abertura integral, tags e opcionais presentes, mais contrato de transporte/identidade consistente. `speechMarkup` continua na fonte e é compilado nos slots; o catálogo textual não o substitui. Loader preparatório aceita catálogo atual sem campo de transporte como `legacy-json-v1`; catálogo futuro deve declarar HTML e identidade. Ausência de informação não autoriza adivinhar uma versão HTML.

Durante a transição, `content/articles/index.json` continua sendo a descoberta do artigo e o JSON continua sendo tentado primeiro. Só um HTTP 404 nesse endpoint permite consultar o catálogo. Falha de rede, 5xx, JSON inválido ou qualquer outra resposta não significa ausência e termina no estado de erro existente. O catálogo sem `transport` continua sendo legado e não autoriza tentativa de `.html`. A rota HTML só é buscada quando `format` é `html-v1`, `path` é exatamente `content/articles/<slug>.html` e `buildId` é uma string não vazia. Antes da montagem, o único envelope `<article>` precisa repetir formato, slug e build ID, e conter exatamente um slot `h1[heading]`, `p[dek]` e `section[body]`, todos com conteúdo e sem aninhamento entre slots. Incompatibilidade/404/resposta inválida mantém o erro existente sem inserir qualquer parte da resposta no DOM. Os slots montados ocupam os IDs do shell; JSON segue pela montagem legada, preservando ações, fala e controles atuais. O ensaio local usa uma fixture HTML sintética e não cria JSON intermediário de artigo.

## Autoria, URLs e acessibilidade

YAML seguro com chaves duplicadas/construções inseguras rejeitadas. Datas ISO permanecem strings. Campos/tipos e opcionalidade seguem #87; `addedAt` vem do histórico Git completo nos caminhos JSON/MD do mesmo slug, nunca da data da migração. Tags são IDs canônicos de registro único em `generation/taxonomy/tags.json`, a ser implementado/revisado em #93. Template fica em `generation/templates/article.md`, fora do inventário e do pacote. Nenhum `related` manual; opcionais podem ser omitidos, sem `updatedAt` fictício.

Exemplo de âncora: `<a name="limite-de-retries"></a>` imediatamente antes de `## Limite de retries`. O compilador associa `name` ao heading e emite `id="limite-de-retries"`, sem criar dois destinos. IDs explícitos têm precedência; colisões, âncoras órfãs e IDs duplicados falham. Headings sem âncora usam slugificação determinística documentada/testada em M04, incluindo Unicode. Hash direto é resolvido depois da montagem assíncrona.

No corpo, `../../assets/<slug>/arquivo.py` é relativo à fonte; `outro-slug.md#secao` é artigo irmão. Compilador converte para `assets/<slug>/arquivo.py` e `article.html?slug=outro-slug#secao` relativos ao shell público. `image` de frontmatter já é relativo à raiz. Fragmentos são validados nessa base do shell sob `/tech-topics/`, não sob `content/articles/`. Normalização/decodificação não pode autorizar escape codificado, barras invertidas, URL perigosa ou arquivo fora da allowlist. Preservar fragmentos e parâmetros permitidos; validar links internos contra inventário/IDs.

Mermaid usa fence nativa `mermaid`. Metadados declarativos adjacentes em comentário `tech-topics:mermaid` identificam label/descrição/legenda/fallback; exemplo de instância em `scripts/fixtures/migration-contract.md`. O compilador consome esse grupo e emite a estrutura existente `figure.mermaid-figure`, fonte, legenda, descrição e `details.mermaid-fallback`, sem duplicar legenda narrável. Falta de metadados/fallback é erro. Preview GitHub deve mostrar fence, legenda e fallback; inspeção real será gate separado, não substituído por GFM local.

Tabela GFM simples exige label adjacente `tech-topics:table`; saída usa o wrapper acessível atual com região, `tabindex="0"` e label. Tabela complexa pode conservar HTML explícito e wrapper acessível. HTML controlado também preserva callouts, fórmulas, `signal-grid`, spans `lang`, `data-tts-*` e simulador legado. Preview do simulador oferece descrição/fallback; não executa JS. Segurança valida a árvore final e URLs; nunca remove silenciosamente idioma/alias ou bloco narrável para passar.

## Narração e baseline

Procedimento CLI, reprodução byte a byte, auditoria DOM/capítulos e interpretação das assinaturas: [README de reprodução da baseline M01](README.md). Registro imutável inicial e evidência operacional: [baseline operacional](operational-baseline-2026-10-24.md).

Baseline inicial é imutável e identificada pelo SHA; alterações legítimas geram revisão vinculada com diff, sem regravar a inicial. HTML original é recuperável por blob Git + SHA e hash; assinaturas/metadados não criam cópia JSON completa de artigo. A captura precisa distinguir árvore editorial, palavras/runs, idiomas/aliases, pausas, blocos e frases. Mesmas palavras com parágrafos diferentes não provam equivalência. Versão de ferramenta/léxico é evidência, não permissão para recalcular a baseline original e ocultar regressão.

Comparação usa mesmos renderer/léxico/extrator entre os estados e compara também com a baseline independente. Publicação por conjuntos de slugs e alteração de fala são eventos separados. `before` ausente/zerado/inacessível falha; não usar `HEAD~1` implícito. Deleção/rename precisa autorização/semântica explícita. Índices, pausas e mapa DOM/chapters são gates próprios; hashes de HTML ou contagens isoladas não bastam.

Gravações/chapters são lidos, nunca regenerados para corrigir formato. Incompatibilidade preexistente permanece registrada e impede afirmar paridade daquele áudio até diagnóstico. A captura leve não recalcula G2P, duração acústica nem prova escuta. Sem MP3 novo, sem edição de Release, sem consumo de pauta de teste.

## Preparação PWA, controles e rollback

Antes do corte público: #90 precisa bloquear efeitos em push/call/dispatch/comentário; #91 precisa entregar preparação compatível com transporte atual. `generate_audio=false` e `advance_topic=false` não dispensam comparação real. Política versionada false não pode ser contornada por input true/string. Travas históricas de novo/manual/backfill continuam. Inspecionar jobs antigos antes de cada corte; não rerodar workflow antigo para recuperar deploy.

Cliente preparatório mantém cache utilizável anterior até recuperação confirmada. Nova versão precisa estar completa antes da troca; não recarregar durante reprodução. Atualização coordenada entre abas não mistura catálogo/corpo/léxico/JS. Recuperação visível limitada, com slug/hash/favoritos preservados e sem loop. Cliente original deve ser ensaiado saltando direto para HTML, inclusive 404 de JSON aposentado; não presumir visita intermediária. Offline permanente pode exigir reconexão e recarga explícita, sem promessa de upgrade invisível.

Matriz obrigatória da preparação/corte: original→HTML; preparatório→HTML; HTML→anterior; aba aberta/reprodução ativa/múltiplas abas; corpo não cacheado; 404; instalação interrompida; quota; offline e reconexão. Nenhum ensaio foi executado por este contrato. A implementação e evidência real pertencem a #91/#97/#104 e precisam preservar o trabalho de #88.

Rollback inicial: SHA e artefato descritos no registro operacional adjacente. Após corte preferir último HTML válido; atravessar fronteira legada restaura em conjunto shell, fontes, transporte e SW, mantendo controles false. Artefato anterior deve ser recuperável/verificado antes do corte; retenção expirada é bloqueio real. Não basta reverter só extensão/loader. Nenhuma restauração em produção é autorizada por um ensaio local.

Janela operacional de cada corte começa apenas após auditoria de jobs ativos e reconciliação da main/último deploy/fila. Nenhuma publicação editorial simultânea deve entrar sem nova revisão de baseline e repetição dos gates. Esta sessão ainda não abriu janela de corte: main continua original, efeitos históricos continuam conforme workflows originais, e merge/deploy dependem de autorização humana.
