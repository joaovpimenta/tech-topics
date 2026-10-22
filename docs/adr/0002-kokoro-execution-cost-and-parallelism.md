# ADR 0002 — Custos e paralelismo do Kokoro no GitHub Actions

- **Estado:** Aceito
- **Data:** 2026-10-22
- **Escopo:** geração CPU em `.github/workflows/kokoro-audio.yml` e filtros de execução

## Contexto observado

A execução de referência de Bulkhead [#39823281725](https://github.com/joaovpimenta/tech-topics/actions/runs/39823281725), `mode=profile`, completou a síntese sequencial em **628,39 s**, produzindo **1.563,48 s de áudio**, em **225 segmentos** (`RTF=0.402`). O runner tinha quatro CPUs efetivas; a utilização média foi **99,6%** e o percentil 90 **99,8%**, com RSS máximo de **959,7 MiB**. É evidência de saturação de CPU, não de capacidade ociosa para múltiplos processos com quatro threads cada.

## Decisão

- **Manter uma instância** do Kokoro ONNX FP32 por artigo, com `intra_op_num_threads=4`, usando a voz `pf_dora`.
- **Não** iniciar duas ou três instâncias concorrentes no mesmo runner por padrão. Se houver justificativa, comparar em experimento separado `1×4 threads` com `2×2 threads`, mantendo mesmo texto, modelo, qualidade, memória e configuração de CPU.
- Manter `mode=profile` sob disparo **manual** para levantar novas evidências; nenhuma medição completa deve rodar automaticamente em PRs.
- Preservar filtros de execução: alteração de código/CSS do site pode fazer deploy, mas não recria artigo nem sintetiza áudio; alterações em artigos existentes **não** disparam nova geração; selecionar áudio apenas para JSON de artigo **novo**.
- **Release `tts-<slug>` existente:** skip antes de criar job pesado e conferir novamente antes de publicar. Substituição requer `mode=publish` e `replace_existing=true` explicitamente informados no GitHub Actions.
- `mode=compare` usa amostras curtas e reutiliza a mesma sessão ONNX; diferenças entre 96/128/160 kbps devem partir do **mesmo WAV**, evitando inferência redundante.

## Consequências

Menos minutos faturáveis e menor risco de conflito com o áudio publicado. A geração por artigo permanece limitada à CPU existente; multiplicar instâncias sem benchmark não traz ganho garantido. Evitar confundir um job `skipped` com falha: pode representar corretamente ausência de artigo novo.

## Reavaliar quando

- Runner, ONNX Runtime, modelo ou número de CPUs mudar;
- Novo profiling comprovar folga de CPU/memória;
- Um benchmark reproduzível `2×2` apresentar redução significativa de wall-clock sem regressão de qualidade.

Relacionados: [ADR 0001](0001-kokoro-dora-prosody-and-encoding.md), [Kokoro Actions](../KOKORO_ACTIONS.md), PR #54 e execução #39823281725.
