# Reprodução da baseline M01

Este diretório contém a baseline inicial imutável, identificada pelo SHA completo em `baselines/<sha>/baseline.json`. A interface e os gates da migração estão em [markdown-html-contracts.md](markdown-html-contracts.md); o estado remoto observado e seus limites estão em [operational-baseline-2026-10-24.md](operational-baseline-2026-10-24.md).

## Captura e comparação

Com Node 22 e Python disponíveis, reproduza a baseline em um destino temporário:

```powershell
node scripts/capture-migration-baseline.mjs --sha fca72c31fcb57ffe9741a2390a04c2035639e14a --output-root $env:TEMP/migration-baseline
```

O comando lê blobs e histórico pelo Git no SHA indicado, enumera fontes reais `content/articles/*.json` (não confia no índice legado), recupera o extrator de segmentação e léxico daquele mesmo SHA, e grava assinaturas/metadados; não sintetiza áudio nem persiste corpos de artigos. O destino é criado sem sobrescrita. `capture.runtime` registra Node/Python usados como evidência. Essa proveniência ambiental não participa das assinaturas editoriais nem do diff entre baselines. Para reprodução byte a byte, use o mesmo SHA, as mesmas ferramentas de captura e o mesmo toolchain; o teste de contrato executa a CLI e compara o arquivo resultante byte a byte com a baseline versionada.

Uma baseline posterior deve apontar explicitamente à anterior:

```powershell
node scripts/capture-migration-baseline.mjs --sha <sha-completo> --previous docs/migrations/baselines/fca72c31fcb57ffe9741a2390a04c2035639e14a/baseline.json --output-root $env:TEMP/migration-baseline
```

O resultado inclui caminho relativo para a baseline anterior, diff de assinaturas por artigo e mudanças de hashes das ferramentas de captura/fontes. Não substitua a baseline original. Para executar os testes públicos da ferramenta: `node scripts/test-migration-baseline.mjs`.

## Auditoria reproduzível de DOM e capítulos

Construa o site para `dist/` e forneça o snapshot local read-only de capítulos, Playwright e Chromium já instalados:

```powershell
$env:TECH_TOPICS_PLAYWRIGHT = 'C:\caminho\para\node_modules\playwright'
$env:TECH_TOPICS_CHROMIUM = 'C:\caminho\para\chrome.exe'
node scripts/audit-migration-dom.cjs --root . --dist dist --chapters-dir C:\caminho\para\chapters --base-path /tech-topics/
```

A ferramenta serve apenas o `dist` local, aborta pedidos externos e bloqueia síntese de voz. Para cada artigo compara capítulos com `readingNodes`/`buildBlocks`, e verifica que o DOM montado produz os mesmos blocos, frases, textos e runs que um clone sem mutação. Retém apenas hashes e índices no relatório. A igualdade clone/montado valida a metodologia da captura; igualdade DOM/capítulos é um gate separado, não prova de identidade do texto narrado nem de qualidade acústica. A divergência histórica inicial está registrada no documento operacional.
