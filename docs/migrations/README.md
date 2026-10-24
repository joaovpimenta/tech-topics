# Reprodução da baseline M01

Este diretório preserva a captura v1 imutável, identificada pelo SHA completo em `baselines/<sha>/baseline.json`; ela foi rejeitada como referência autoritativa porque a conversão de texto do subprocesso Python produzia caracteres Unicode corrompidos em Windows. A revisão entregue em `054cd21` permanece nesse caminho somente como evidência histórica e não deve ser usada como baseline confiável. A baseline corrigida fica em `baselines/capture-v2/<sha>/baseline.json`, vinculada à v1 com diff explícito, extração UTF-8 estrita, hashes semânticos de tokens e dimensões brutas separadas. Testes conferem fontes, metadados, HTML, estrutura, assets, ordem e datas em 18/18 artigos; hashes narrativos e a segmentação por chunks mudam onde a v1 registrou bytes corrompidos. A interface e os gates estão em [markdown-html-contracts.md](markdown-html-contracts.md); o estado remoto observado está em [operational-baseline-2026-10-24.md](operational-baseline-2026-10-24.md).

## Captura e comparação

Com Node 22 e Python disponíveis, reproduza a baseline em um destino temporário. O extrator executa Python em modo UTF-8 explícito para manter iguais os bytes de texto em Windows e Linux:

```powershell
node scripts/capture-migration-baseline.mjs --sha fca72c31fcb57ffe9741a2390a04c2035639e14a --previous docs/migrations/baselines/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json --output-root $env:TEMP/migration-baseline
```

O comando lê blobs e histórico pelo Git no SHA indicado, enumera fontes reais `content/articles/*.json` (não confia no índice legado), recupera extrator e léxico daquele mesmo SHA, e grava assinaturas/metadados; não sintetiza áudio nem persiste corpos de artigos. O destino é criado sem sobrescrita. `capture.runtime` registra Node/Python como proveniência. A comparação canônica entre ambientes ignora somente esse objeto; hashes `captureTools` permanecem comparados e arquivos textuais são hashados com novas linhas LF canônicas. O teste exige duas capturas do mesmo ambiente byte a byte iguais, depois compara a captura canônica com a revisão versionada.

A captura registra `editorialSentences` agrupadas por limites de pontuação do planejador neutro e com as pausas declaradas pelo preset de referência `equilibrado` (1.00; 0,38 s entre parágrafos e 0,70 s após seção). Cada frase inclui hashes de palavras e idiomas; pontuação e símbolos têm um hash separado e também precisam coincidir na auditoria. Essa comparação não depende dos cortes de segmentos de fala. `legacyChunks` registra separadamente os cortes do preset histórico `atual` (0.95). Esses cortes são um plano de inferência, não índices de frases nem timestamps medidos de MP3/capítulos. A revisão v2 corrige a conversão UTF-8 e a representação da narração. Diferenças em estrutura e hashes narrativos são mantidas no diff contra a v1 rejeitada; não altere a captura histórica e use v2 para auditorias e capturas seguintes.

Uma baseline posterior deve apontar explicitamente à anterior:

```powershell
node scripts/capture-migration-baseline.mjs --sha <sha-completo> --previous docs/migrations/baselines/capture-v2/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json --output-root $env:TEMP/migration-baseline
```

O resultado inclui caminho de repositório para a baseline anterior, diff de assinaturas por artigo e mudanças de hashes das ferramentas de captura/fontes. Não substitua nenhuma revisão. Para executar os testes públicos da ferramenta: `node scripts/test-migration-baseline.mjs`.

## Auditoria reproduzível de DOM e capítulos

Construa o site para `dist/` e forneça o snapshot local read-only de capítulos, Playwright e Chromium já instalados:

```powershell
$env:TECH_TOPICS_PLAYWRIGHT = 'C:\caminho\para\node_modules\playwright'
$env:TECH_TOPICS_CHROMIUM = 'C:\caminho\para\chrome.exe'
node scripts/audit-migration-dom.cjs --root . --dist dist --chapters-dir C:\caminho\para\chapters --baseline docs/migrations/baselines/capture-v2/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json --base-path /tech-topics/
```

A ferramenta serve apenas o `dist` local, aborta pedidos externos e bloqueia síntese de voz. Para cada artigo, intercepta o `TechTopicsSpeech.mount` original e compara `player.blocks` com uma extração feita em clone, além de comparar frases com a baseline e índices dos capítulos. A assinatura semântica compara tokens em ordem, línguas e pontuação; os índices de frase e de bloco são avaliados separadamente. Ela recupera as fronteiras originais de palavras dos nós do DOM em vez de colar segmentos, cujos cortes removem espaços nas bordas. O hash do texto concatenado evidencia essa diferença de representação, mas não é um gate semântico. Por padrão, o arquivo versionado retém hashes agregados por artigo, contagens e contexto somente nas primeiras divergências; `--detail full` grava também cada unidade e capítulo para análise local. Igualdade semântica, índices e capítulos são gates separados; nenhum prova qualidade acústica. Divergências históricas ficam registradas no documento operacional e no [relatório final por SHA](audits/dom-v2-fca72c31fcb57ffe9741a2390a04c2035639e14a.json).
