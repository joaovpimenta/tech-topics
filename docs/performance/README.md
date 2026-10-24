# Baseline de performance — P01

Referência da issue #107 / plano #88. O harness mede o site construído em `dist/` sob `/tech-topics/`, o prefixo usado pelo Pages, e reproduz estados no loader real. Reexecute a partir da raiz após `node scripts/validate-site.mjs`:

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

## Perfil e leitura das métricas

O script percorre home e artigo em 10 navegações frias e 10 quentes cada: viewport 390×844, throttling CPU 4×, rede 4.000.000 bit/s e RTT 150 ms. Cold desabilita o cache HTTP via CDP; warm mantém o mesmo contexto/browser, habilita cache HTTP e serve recursos com `max-age=3600`. Service workers ficam bloqueados para isolar cache HTTP; depois, um ensaio separado usa o SW real do artefato, visita home/artigo, confirma controle e tenta abrir o artigo offline. Esse é um smoke de uma amostra, não uma comparação estatística fria/quente do SW. Não há `page.route` no perfil, pois ele desabilitaria cache; a API de Release é simulada dentro do `fetch` da página.

O relógio de primeira disponibilidade de texto permanece separado da janela visual: antes de colher LCP/CLS, o harness aguarda as duas primeiras capas da home ou a capa do artigo, `document.fonts.ready` e dois frames de animação. Cada imagem e as fontes têm limite de 4 s; resultados incompletos ficam registrados. A amostra inclui candidato de LCP, bytes de navegação e recursos e requisições externos cujo `transferSize` zero não permite distinguir cache de falta de `Timing-Allow-Origin`.

A interação isolada mede clique até callback `onstart` do mock. Ela não é INP de campo e não mede latência acústica. LCP é capturado antes da interação. CLS é a soma dos layout shifts sem entrada recente no intervalo inicial, não a janela de sessão da métrica Web Vitals de campo. Long tasks e layout shifts vêm de `PerformanceObserver` com buffer. Descoberta de áudio é marcada separadamente de `loadedmetadata`, `canplay` e `playing`; o MP3 não é pré-carregado pela homepage. Marks `tt:*` expõem pontos de instrumentação no DOM de performance.

| Indicador | Meta inicial da issue #88 | Resultado desta rodada |
|---|---:|---|
| Navegação → texto do artigo | registrar p75 | `baseline.json` |
| Corpo → controles/caminho local | p75 ≤ 200 ms | `baseline.json` |
| Clique → callback local | p75 ≤ 500 ms, voz já disponível | `baseline.json`; callback síncrono simulado |
| LCP | p75 ≤ 2,5 s | `baseline.json`, com janela visual estabilizada |
| Soma de layout shifts no ensaio | referência CLS ≤ 0,1 | `baseline.json`; não é CLS de campo/session-window |
| Interação representativa | ≤ 200 ms | Ensaio sintético isolado, nunca INP de campo |

Metas são limites propostos pela issue, e não resultados. Comparações devem usar o mesmo SHA, Chrome, configuração e fixture. O arquivo `baseline.json` é o registro completo desta execução, incluindo amostras de waterfall.

## Gates ainda pendentes

- QA em aparelho Android e Safari/iOS reais.
- Escuta com gravações existentes; esta tarefa não faz síntese nem testa qualidade acústica.
- Verificação de promoção por frase, chapters v2 e comportamento em pausa/seek; fora da implementação P01.
- Repetição em CDN/Pages real. O harness serve `dist` localmente e não prova LCP/INP do campo; a cobertura do SW é somente o smoke descrito acima.
