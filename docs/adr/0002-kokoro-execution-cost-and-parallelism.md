# ADR 0002 — Custos e paralelismo do Kokoro no GitHub Actions

- **Estado:** Aceito
- **Data:** 2026-10-22
- **Escopo:** geração de áudio em `.github/workflows/kokoro-audio.yml`, concorrência e filtros de execução

## Contexto observado

A medição histórica de Bulkhead [#39823281725](https://github.com/joaovpimenta/tech-topics/actions/runs/39823281725) mostrou a CPU do runner próxima da saturação. Esse resultado justificou manter uma instância por runner; o modo `profile` e a instrumentação CPU/RSS foram **removidos**, sem afetar a geração normal de áudio.

## Decisão

- **Manter uma instância** do Kokoro ONNX FP32 por artigo, com `intra_op_num_threads=4`, usando a voz `pf_dora`.
- **Não** iniciar duas ou três instâncias concorrentes no mesmo runner por padrão. Se houver justificativa, comparar em experimento separado `1×4 threads` com `2×2 threads`, mantendo mesmo texto, modelo, qualidade, memória e configuração de CPU.
- Não oferecer `mode=profile`, coleta periódica de CPU/RSS nem jobs de profiling. Preservar métricas simples de duração e tempo total da síntese.
- Preservar filtros de execução: código/CSS podem fazer deploy sem TTS. A síntese automática genérica (incluindo artigos novos) está congelada. Exceção autorizada: atualizar somente MP3 de artigos **existentes** cujo conteúdo de fala/idiomas/aliases mudou, após deploy Pages, com job por slug, backup e `replace_existing=true`.
- **Release `tts-<slug>` existente:** skip antes de criar job pesado e conferir novamente antes de publicar. Substituição requer `mode=publish` e `replace_existing=true` explicitamente informados no GitHub Actions.
- `mode=compare` usa amostras curtas e reutiliza a mesma sessão ONNX; diferenças entre 96/128/160 kbps devem partir do **mesmo WAV**, evitando inferência redundante.

## Consequências

Menos minutos faturáveis e menor risco de conflito com o áudio publicado. A geração por artigo permanece limitada à CPU existente; multiplicar instâncias sem benchmark não traz ganho garantido. Evitar confundir um job `skipped` com falha: pode representar corretamente ausência de artigo novo.

## Reavaliar quando

- Runner, ONNX Runtime, modelo ou número de CPUs mudar;
- Mudanças relevantes de infraestrutura exigirem revisão da configuração de execução;
- Um benchmark reproduzível `2×2` apresentar redução significativa de wall-clock sem regressão de qualidade.

Relacionados: [ADR 0001](0001-kokoro-dora-prosody-and-encoding.md), [Kokoro Actions](../KOKORO_ACTIONS.md), PR #54 e execução #39823281725.
