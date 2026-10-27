# Reprodução da baseline M01

Este diretório preserva a captura v1 imutável, identificada pelo SHA completo em `baselines/<sha>/baseline.json`; ela foi rejeitada como referência autoritativa porque a conversão de texto do subprocesso Python produzia caracteres Unicode corrompidos em Windows. A v2 em `baselines/capture-v2/<sha>/baseline.json` corrigiu a extração UTF-8, mas uma comparação semântica experimental entre Python e DOM era insegura e foi retirada do gate. A v3 em `baselines/capture-v3/<sha>/baseline.json` guarda o contrato Python nativo: texto exato, runs de idioma, índices, pausas, chunks legados e fontes. O relatório DOM histórico guarda assinaturas nativas independentes para `player.blocks`, com texto e idioma por segmento, índices e word mapping do DOM original. A issue #94 acrescenta um mapeamento por conteúdo entre frases Python e unidades DOM nos relatórios `schemaVersion: 3`; os relatórios DOM históricos continuam imutáveis e não contêm esse fingerprint. As revisões v1 e v2 permanecem imutáveis. A interface e os gates estão em [markdown-html-contracts.md](markdown-html-contracts.md); o estado observado está em [operational-baseline-2026-10-24.md](operational-baseline-2026-10-24.md).

## Captura e comparação

Com Node 22 e Python disponíveis, reproduza a baseline em um destino temporário. O extrator executa Python em modo UTF-8 explícito para manter iguais os bytes de texto em Windows e Linux:

```powershell
node scripts/capture-migration-baseline.mjs --sha fca72c31fcb57ffe9741a2390a04c2035639e14a --previous docs/migrations/baselines/capture-v2/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json --output-root $env:TEMP/migration-baseline
```

O comando lê blobs e histórico pelo Git no SHA indicado, enumera fontes reais `content/articles/*.json` (não confia no índice legado), recupera extrator e léxico daquele mesmo SHA, e grava assinaturas/metadados; não sintetiza áudio nem persiste corpos de artigos. O destino é criado sem sobrescrita. `capture.runtime` registra Node/Python como proveniência. A comparação canônica entre ambientes ignora somente esse objeto; hashes `captureTools` permanecem comparados e arquivos textuais são hashados com novas linhas LF canônicas. O teste exige duas capturas do mesmo ambiente byte a byte iguais, depois compara a captura canônica com a revisão versionada.

A captura registra `editorialSentences` e `legacyChunks` produzidos pelo extrator Python UTF-8, com hashes nativos de texto, runs de idioma, índices, pausas e chunks. `editorialSentences` usa `equilibrado` (1.00; 0,38 s entre parágrafos e 0,70 s após seção); `legacyChunks` usa `atual` (0.95) e não representa índices de frase nem timestamps medidos. O auditor preserva as assinaturas nativas DOM e adiciona no schema 3 uma assinatura normalizada dos runs de texto/idioma para o mapeamento por conteúdo. A v2 permanece como revisão histórica da conversão UTF-8 e da tentativa semântica anterior. Não altere revisões históricas; use v3 para baselines Python e o auditor schema 3 para comparações DOM/capítulos.

Uma baseline posterior deve apontar explicitamente à anterior:

```powershell
node scripts/capture-migration-baseline.mjs --sha <sha-completo> --previous docs/migrations/baselines/capture-v3/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json --output-root $env:TEMP/migration-baseline
```

O resultado inclui caminho de repositório para a baseline anterior, diff de assinaturas por artigo e mudanças de hashes das ferramentas de captura/fontes. Não substitua nenhuma revisão. Para executar os testes públicos da ferramenta: `node scripts/test-migration-baseline.mjs`.

## Comparação de publicação e histórico (M06)

Use `scripts/compare-migration.mjs` com os SHAs completos dos dois estados, a baseline inicial independente e um relatório DOM/capítulos produzido para cada lado. Não há `HEAD~1`, baseline vazia ou fallback implícito:

```powershell
node scripts/compare-migration.mjs `
  --before <sha-completo> `
  --after <sha-completo> `
  --baseline docs/migrations/baselines/capture-v3/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json `
  --dom-baseline <auditoria-inicial-com-identidade-verificada.json> `
  --dom-before <auditoria-before.json> `
  --dom-after <auditoria-after.json>
```

O inventário lê `content/articles/*.json` e `*.md` em cada commit; duas fontes para o mesmo slug são erro. A extração histórica passa tanto JSON como Markdown pelo compilador e extrator atuais e exige o mesmo léxico e os mesmos fontes de TTS nos commits. A captura registra fingerprints do renderer/extrator e compara as ferramentas de narração com a baseline imutável. `addedAt` vem da primeira adição Git de qualquer extensão daquele slug, sem seguir renames; remoção exige autorização explícita em `--allow-remove <slug>`. Um slug adicionado bloqueia a comparação para planejamento explícito.

O JSON de saída separa `narration`, `framing`, `selection`, `blockers` e o desvio de cada commit em relação às assinaturas Python e DOM/capítulos das baselines independentes. Cada diferença aponta sua primeira divergência. Texto/idioma/alias seleciona apenas o slug afetado quando os limites continuam iguais. Blocos, frases, índices, pausas editoriais, estrutura/recursos, addedAt e mapa DOM/capítulos são gates de framing. A correspondência entre Python e DOM é feita em ordem e validada pela assinatura dos runs normalizados de texto e idioma; os índices numéricos de cada contrato podem diferir. Alterações nativas são toleradas apenas nas unidades correspondentes a frases narráveis alteradas ou aos campos de título/resumo que mudaram. Unidades inalteradas precisam manter a assinatura; em cada lado, o player montado ainda precisa coincidir integralmente com o clone auditado, e os índices dos capítulos precisam mapear para as frases DOM. Se o blob da fonte em qualquer lado for igual ao da baseline, divergências na reprodução Python ou DOM bloqueiam como regressão do comparador. Pausas editoriais são metadados do planejador; não representam duração acústica. Nenhuma inferência, síntese, MP3, Release ou capítulo é gerado ou modificado.

Os relatórios DOM/capítulos devem ser capturados do `dist` produzido para cada commit por `scripts/audit-migration-dom.cjs` e fornecidos como JSON `{ "commitSha": "<sha auditado>", "report": { ...relatório... } }`. Passe `--source-sha` ao auditor. Ele exige um manifesto HTML gerenciado, verifica os bytes contra `buildId` e registra o SHA e a identidade conferidos. O comparador valida essa identidade contra o SHA solicitado e rejeita os relatórios históricos com `distIdentityVerified: false`. O SHA do wrapper também precisa coincidir com o lado solicitado, e todos os relatórios devem apontar para a mesma baseline inicial. Use `schemaVersion: 3`, que inclui a assinatura dos runs narrados por unidade. Artigos duplicados, contagens inconsistentes, uma frase que não possa ser mapeada a uma unidade DOM por texto/idioma ou um mapa de índice de capítulo inválido bloqueiam o resultado, mesmo se a divergência já existia. Rode também `node scripts/test-migration-compare.mjs` para os fixtures negativos, as divergências de player e commits temporários reais; a reprodução do corpus inicial continua coberta por `node scripts/test-migration-baseline.mjs`.

## Auditoria reproduzível de DOM e capítulos

A instrumentação de auditoria preserva o espaço entre segmentos técnicos que o player divide no limite de 240 caracteres e remove ao montar as falas; ela não altera o player em produção.

Construa o site para `dist/` e forneça o snapshot local read-only de capítulos, Playwright e Chromium já instalados:

```powershell
$env:TECH_TOPICS_PLAYWRIGHT = 'C:\caminho\para\node_modules\playwright'
$env:TECH_TOPICS_CHROMIUM = 'C:\caminho\para\chrome.exe'
node scripts/audit-migration-dom.cjs --root . --dist dist --source-sha <sha-do-dist> --chapters-dir C:\caminho\para\chapters --baseline docs/migrations/baselines/capture-v3/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json --base-path /tech-topics/
```

A ferramenta serve apenas o `dist` local, aborta pedidos externos e bloqueia síntese de voz. Antes do browser, verifica que `.site-artifact.json` declara o `--source-sha` informado e que `buildId` corresponde ao conteúdo do pacote. Intercepta o `TechTopicsSpeech.mount` original e registra segmentos nativos com texto, idioma, índices e word mapping. Compara esses registros byte a byte com o clone e verifica os índices dos capítulos em separado. Também emite uma assinatura por sequência normalizada de runs falados para permitir a correspondência cruzada com as frases Python sem confiar nos índices numéricos. Por padrão, o relatório retém hashes por unidade/artigo e contagens; `--detail full` grava unidades e capítulos completos para análise local. A auditoria histórica v3, anterior à verificação da identidade do artefato, teve mount e clone coincidentes em 18/18 e índices DOM/capítulos em 15/18; ela não satisfaz o novo gate. Nada disso prova qualidade acústica. Consulte [o relatório histórico DOM v3 por SHA](audits/dom-v3-fca72c31fcb57ffe9741a2390a04c2035639e14a.json); os relatórios v1/v2 são históricos.
