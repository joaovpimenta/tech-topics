# TTS: arquitetura e execução

## Motor ativo

**Somente Kokoro ONNX FP32 / pf_dora** produz arquivos de áudio neste repositório.
Não há Chatterbox, clonagem de voz, hook TTS de pre-commit nem obrigação de
sintetizar áudio ao criar/editar artigos. A voz Web Speech API do navegador
é independente e permanece disponível ao visitante.

## Camadas

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Contrato editorial | `narration_text.py` | Extrair blocos HTML, idioma, léxico, soletração e texto narrável |
| Planejamento acústico | `segmentation.py` | Separar frases, orçar chunks, tratar vírgulas e palavras, preservar `block_index` e `sentence_index`, definir pausas |
| Driver | `kokoro_release.py` | Preparar G2P PT-BR/EN-US, injetar a função de orçamento (tokens/fonemas) no planejador e invocar ONNX |
| Montagem | `kokoro_release.py` (WAV/chapters) e `ffmpeg` no workflow | Concatenar PCM e pausas, obter timestamps por amostras, normalizar, publicar MP3 e capítulos v2 |

`segmentation.plan_segments(segments, measure_runs, ...)` aceita callback que
recebe runs de idioma e retorna `(token_count, phoneme_length)`. O planejador
**não importa** modelos/ONNX/fonemizadores. Em futura substituição de modelo,
implementar outro adapter sem reescrever marcação de frases e geração de
capítulos. O driver Kokoro fornece `kokoro.tokenizer.tokenize(phonemes,
limit=None)` com fonemização, mantendo o teto de 350 tokens e a guarda de
500 caracteres fonéticos. Frase curta = inferência única; frase longa =
vários chunks, mas o mesmo marcador lógico. Pausa de 25ms dentro da frase.

## Uso

O workflow [Kokoro audio](../../.github/workflows/kokoro-audio.yml) fornece
`preview` (curto), `review` (artigo integral sem Release), `compare` e
`publish`; consulte [KOKORO_ACTIONS.md](../../docs/KOKORO_ACTIONS.md).
**Não dispare nenhum modo que sintetize áudio enquanto a pausa de
gerações estiver vigente.** Atualizações em `tools/tts/` e documentação
não disparam áudio automaticamente.

Teste rápido, sem ONNX/modelo:

```sh
python -m unittest discover -s tools/tts -p 'test_*.py'
node scripts/validate-site.mjs
```

A documentação de decisão está no [ADR 0004](../../docs/adr/0004-tts-segmentation-backend-boundary.md).
Caso seu clone ainda tenha `core.hooksPath=.githooks` configurado pelo
fluxo antigo, ele pode ser desativado com `git config --local --unset
core.hooksPath`; respeite outros hooks locais antes de alterar.
