# Baseline de performance — P01 (histórica)

Referência histórica da issue #107 / plano #88, medida no SHA `7abb3284b9ae32d4551f0cddb53efaea73f38787`, antes da integração de P02/P03. O harness mede o site construído em `dist/` sob `/tech-topics/`, o prefixo usado pelo Pages, e reproduz estados no loader real. Reexecute a partir da raiz após `node scripts/validate-site.mjs`:

```powershell
$env:TECH_TOPICS_PLAYWRIGHT = '<caminho do módulo Playwright existente>'
$env:TECH_TOPICS_CHROMIUM = '<executável Chrome ou Chromium existente>'
node scripts/test-loader-regressions.cjs
node scripts/perf-baseline.cjs docs/performance/baseline.json
```

Não instala dependências, não sintetiza Kokoro, não consulta telemetria externa e não altera releases. Os endpoints de voz/Release, Mermaid e reprodução acústica são simulados. O waterfall mostra recursos requisitados pelo build local; bytes não incluem payloads transferidos por cache quando `transferSize` reporta zero.

## Contratos observados

`test-loader-regressions.cjs` abre `dist/article.html` com `article.js`, `speech.js` e `audio.js` reais. O DOM e as respostas externas são controlados para manter uma dependência em voo. O código de saída é zero quando o comportamento atual reproduz as observações documentadas, inclusive os contratos desejados ainda ausentes; isso não significa que as regressões estejam corrigidas.

- Enquanto Mermaid ou léxico ficam pendentes, o corpo já foi inserido, mas `#article-actions` continua oculto e o dock não foi montado. Ao liberar a dependência, as ações aparecem.
- Com consulta de Release ainda pendente, o gesto inicia Web Speech.
- Com asset MP3 descoberto, `readyState` permanece zero e a promise de `play()` fica pendente. O player seleciona narração gravada, sem iniciar Web Speech. Descoberta não prova prontidão.

O teste não valida o tempo acústico percebido, compatibilidade real de capítulos v2 nem uma promoção entre frases. A transição para próxima frase ainda não existe neste SHA e é N/A.

Na execução histórica desta P01, `node scripts/test-speech-browser.cjs` falhou ao esperar o dock gravado visível. A regressão e a validação browser foram ampliadas depois da integração de P02/P03; os resultados e limites atuais estão em [gates de browser P02/P03](p03-browser-gates-2026-10-25.md).

O ensaio separado do SW registrou instalação ativa e controle sob `/tech-topics/`, 11 recursos iniciados por SW na visita online e sucesso ao abrir offline um artigo previamente visitado (26.489 caracteres de corpo renderizados). É uma amostra funcional, sem distribuição de latência e sem MP3/API durante o modo offline.

## Perfil e leitura das métricas

O script percorre home e artigo em 10 navegações frias e 10 quentes cada: viewport 390×844, throttling CPU 4×, rede 4.000.000 bit/s e RTT 150 ms. Cold desabilita o cache HTTP via CDP; warm mantém o mesmo contexto/browser, habilita cache HTTP e serve recursos com `max-age=3600`. Service workers ficam bloqueados para isolar cache HTTP; depois, um ensaio separado usa o SW real do artefato, visita home/artigo, confirma controle e tenta abrir o artigo offline. Esse é um smoke de uma amostra, não uma comparação estatística fria/quente do SW. Não há `page.route` no perfil, pois ele desabilitaria cache; a API de Release é simulada dentro do `fetch` da página.

**Interpretação limitada:** este é um baseline de subsistemas controlados, não do renderer Mermaid completo nem do CDN/Pages real. O renderer externo é substituído por um módulo stub local e o servidor local define `Cache-Control: max-age=3600`; esses resultados não representam os cabeçalhos atuais de Pages ou o custo de baixar/renderizar o Mermaid real. A captura real com renderer pesado e a repetição contra Pages/CDN continuam gates pendentes.

O relógio de primeira disponibilidade de texto permanece separado da janela visual: antes de colher LCP/CLS, o harness aguarda em paralelo as duas primeiras capas da home ou a capa do artigo e `document.fonts.ready`, com limite de 4 s por recurso, e então dois frames de animação. Resultados incompletos ficam registrados. A amostra inclui candidato de LCP, bytes de navegação e recursos e requisições externos cujo `transferSize` zero não permite distinguir cache de falta de `Timing-Allow-Origin`.

A interação isolada mede clique até callback `onstart` do mock. Ela não é INP de campo e não mede latência acústica. LCP é capturado antes da interação. CLS é a soma dos layout shifts sem entrada recente no intervalo inicial, não a janela de sessão da métrica Web Vitals de campo. Long tasks e layout shifts vêm de `PerformanceObserver` com buffer. Descoberta de áudio é marcada separadamente de `loadedmetadata`, `canplay` e `playing`; o MP3 não é pré-carregado pela homepage. Marks `tt:*` expõem pontos de instrumentação no DOM de performance.

| Indicador | Meta inicial da issue #88 | Resultado desta rodada |
|---|---:|---|
| Navegação → texto do artigo | registrar p75 | frio/quente 1231/677 ms |
| Corpo → controles/caminho local | p75 ≤ 200 ms | frio/quente 613/612 ms |
| Clique → callback local | p75 ≤ 500 ms, voz já disponível | frio/quente 10/8,5 ms, callback síncrono simulado |
| LCP | p75 ≤ 2,5 s | home 684/248 ms; artigo 1464/884 ms (frio/quente) |
| Soma de layout shifts no ensaio | referência CLS ≤ 0,1 | home 0,288/0,289; artigo 0,583/0,583 (frio/quente) |
| Interação representativa | ≤ 200 ms | callback local 8,5–10 ms, mock; não é INP de campo |

Metas são limites propostos pela issue, e não resultados. Comparações devem usar o mesmo SHA, Chrome, configuração e fixture. O arquivo `baseline.json` é o registro completo desta execução, incluindo amostras de waterfall.

## Gates ainda pendentes

- QA em aparelho Android e Safari/iOS reais.
- Estabilização do teste de dock gravado em desktop/celular; seu timeout persiste no ambiente e não foi atribuído com evidência suficiente a uma causa específica.
- Escuta com gravações existentes; esta tarefa não faz síntese nem testa qualidade acústica.
- Verificação de promoção por frase, chapters v2 e comportamento em pausa/seek; fora da implementação P01.
- Repetição em CDN/Pages real. O harness serve `dist` localmente e não prova LCP/INP do campo; a cobertura do SW é somente o smoke descrito acima.
