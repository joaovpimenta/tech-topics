# Reprodução da baseline M01

Este diretório preserva a captura v1 imutável, identificada pelo SHA completo em `baselines/<sha>/baseline.json`; ela foi rejeitada como referência autoritativa porque a conversão de texto do subprocesso Python produzia caracteres Unicode corrompidos em Windows. A v2 em `baselines/capture-v2/<sha>/baseline.json` corrigiu a extração UTF-8, mas uma comparação semântica experimental entre Python e DOM era insegura e foi retirada do gate. A v3 em `baselines/capture-v3/<sha>/baseline.json` guarda o contrato Python nativo: texto exato, runs de idioma, índices, pausas, chunks legados e fontes. O relatório DOM versionado guarda assinaturas nativas independentes para `player.blocks`, com texto e idioma por segmento, índices e word mapping do DOM original. Equivalência cruzada não é afirmada; a issue #94 deve verificar mudanças antes/depois dentro de cada contrato antes do corte. As revisões v1 e v2 permanecem imutáveis. A interface e os gates estão em [markdown-html-contracts.md](markdown-html-contracts.md); o estado observado está em [operational-baseline-2026-10-24.md](operational-baseline-2026-10-24.md).

## Captura e comparação

Com Node 22 e Python disponíveis, reproduza a baseline em um destino temporário. O extrator executa Python em modo UTF-8 explícito para manter iguais os bytes de texto em Windows e Linux:

```powershell
node scripts/capture-migration-baseline.mjs --sha fca72c31fcb57ffe9741a2390a04c2035639e14a --previous docs/migrations/baselines/capture-v2/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json --output-root $env:TEMP/migration-baseline
```

O comando lê blobs e histórico pelo Git no SHA indicado, enumera fontes reais `content/articles/*.json` (não confia no índice legado), recupera extrator e léxico daquele mesmo SHA, e grava assinaturas/metadados; não sintetiza áudio nem persiste corpos de artigos. O destino é criado sem sobrescrita. `capture.runtime` registra Node/Python como proveniência. A comparação canônica entre ambientes ignora somente esse objeto; hashes `captureTools` permanecem comparados e arquivos textuais são hashados com novas linhas LF canônicas. O teste exige duas capturas do mesmo ambiente byte a byte iguais, depois compara a captura canônica com a revisão versionada.

A captura registra `editorialSentences` e `legacyChunks` produzidos pelo extrator Python UTF-8, com hashes nativos de texto, runs de idioma, índices, pausas e chunks. `editorialSentences` usa `equilibrado` (1.00; 0,38 s entre parágrafos e 0,70 s após seção); `legacyChunks` usa `atual` (0.95) e não representa índices de frase nem timestamps medidos. O auditor assina o contrato DOM em separado, sem normalizar conteúdo para compará-lo ao Python. A v2 permanece como revisão histórica da conversão UTF-8 e da tentativa semântica anterior. Não altere revisões históricas; use v3 para auditorias e capturas seguintes.

Uma baseline posterior deve apontar explicitamente à anterior:

```powershell
node scripts/capture-migration-baseline.mjs --sha <sha-completo> --previous docs/migrations/baselines/capture-v3/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json --output-root $env:TEMP/migration-baseline
```

O resultado inclui caminho de repositório para a baseline anterior, diff de assinaturas por artigo e mudanças de hashes das ferramentas de captura/fontes. Não substitua nenhuma revisão. Para executar os testes públicos da ferramenta: `node scripts/test-migration-baseline.mjs`.

## Auditoria reproduzível de DOM e capítulos

Construa o site para `dist/` e forneça o snapshot local read-only de capítulos, Playwright e Chromium já instalados:

```powershell
$env:TECH_TOPICS_PLAYWRIGHT = 'C:\caminho\para\node_modules\playwright'
$env:TECH_TOPICS_CHROMIUM = 'C:\caminho\para\chrome.exe'
node scripts/audit-migration-dom.cjs --root . --dist dist --chapters-dir C:\caminho\para\chapters --baseline docs/migrations/baselines/capture-v3/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json --base-path /tech-topics/
```

A ferramenta serve apenas o `dist` local, aborta pedidos externos e bloqueia síntese de voz. Intercepta o `TechTopicsSpeech.mount` original e registra segmentos nativos com texto, idioma, índices e word mapping. Compara esses registros byte a byte com o clone e verifica os índices dos capítulos em separado. Por padrão, o relatório retém hashes por unidade/artigo e contagens; `--detail full` grava unidades e capítulos completos para análise local. Na auditoria v3, mount e clone coincidiram em 18/18, e índices DOM/capítulos em 15/18. `baselineSourceSha` identifica a revisão usada como referência e não autentica o conteúdo de `dist`; a identidade dos inputs e do artefato precisa ser validada antes de usar o relatório como gate. As issues #94/#96 devem estabelecer essa verificação e comparar alterações antes/depois dentro de cada contrato. Assinaturas Python e DOM permanecem separadas; equivalência cruzada não é afirmada. Nada disso prova qualidade acústica. Consulte [o relatório nativo DOM v3 por SHA](audits/dom-v3-fca72c31fcb57ffe9741a2390a04c2035639e14a.json); os relatórios v1/v2 são históricos.
