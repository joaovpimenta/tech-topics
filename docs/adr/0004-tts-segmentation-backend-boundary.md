# ADR 0004 — Segmentar áudio independentemente do motor TTS

- **Data:** 2026-10-23
- **Estado:** Aceito
- **Contexto:** [PR #66](https://github.com/joaovpimenta/tech-topics/pull/66) adotou frases como unidades de navegação e destaque; a geração antiga Chatterbox via pre-commit ainda coexistia com Kokoro. O módulo de publicação dependia de helpers do hook Chatterbox, acoplando a extração editorial a um motor aposentado.

## Decisão

1. **Somente Kokoro é implementado como backend de geração de áudio.** Excluir `test_chatterbox.py`, `precommit.py`, testes específicos de Chatterbox e o hook TTS que exigia síntese local. Não solicitar voz de referência, PyTorch ou torchaudio.
2. **Extrair a preparação editorial** para `tools/tts/narration_text.py`: HTML narrável, precedência de léxico e tags multilíngues, soletração e texto sem modelo.
3. **Extrair o planejamento** para `tools/tts/segmentation.py` com funções puras e callback de capacidade `measure_runs(runs) -> (token_count, phoneme_length)`. Não importar ONNX, Kokoro, eSpeak ou voz nesse módulo.
4. **Criar adapter Kokoro** em `tools/tts/kokoro_release.py`: aplicar G2P, contar tokens reais com `tokenize(..., limit=None)` e informar as medidas ao planejador. O backend recebe segmentos prontos e sintetiza cada chunk na ordem.
5. **Manter assembly e sincronização independentes dos cortes técnicos**: timestamps vêm da concatenação WAV e das pausas reais. Frase inteira é identificada por `(block_index,sentence_index)`, mesmo quando requer vários chunks; vírgulas não geram navegação. Saída `chapters.json version=2`.
6. **Preparar a troca futura de modelo** sem implantar outro hoje: novo backend deve adaptar somente medição/capacidade, phonemização, invocação e características de saída. Não duplicar gramática de sentenças e semântica editorial.
7. **Web Speech API fica preservada** como voz do dispositivo, não é backend de geração/publicação de MP3.
8. **Pausar novas sínteses:** esta refatoração e seus testes não geram áudio. As runs já iniciadas devem ser avaliadas isoladamente; não disparar novos jobs ou backfills até nova instrução.

## Contrato e testes

- Entradas de planejamento: blocos editoriais com `runs=[{text, lang}]`, `block_index` e pausa de fim de bloco.
- Saídas: sequência estável de runs e texto, `sentence_index`/ `sentence_start`, limites de capacidade, `pause_after_seconds`, `split_reason`. Não descartar conteúdo nem cortar palavras.
- O sintetizador **não decide** onde a frase termina; apenas declara seu orçamento e produz PCM.
- Testar extração, léxico e segmentação com `unittest` usando fakes, **sem executar inferência**. O teste de integração áudio é opcional e manual.
- O par `(block_index,sentence_index)` deve permanecer estável entre partes da mesma frase; relógio é medido pelas amostras geradas, não por estimativas de caracteres.

## Consequências

- Menos dependências locais e nenhum pré-commit que sintetize áudio.
- O custo/complexidade de testar a segmentação fica separado do driver real.
- Mudança futura de motor exige um adapter compatível com o contrato, não mudanças no HTML/editorial ou player.
- A migração não altera Releases nem regenera arquivos automaticamente; arquivos já publicados mantêm sua versão até publicação autorizada.

## Referências

[ADR 0001](0001-kokoro-dora-prosody-and-encoding.md), [ADR 0003](0003-unified-article-audio-and-chapter-synchronization.md) e [issue #64](https://github.com/joaovpimenta/tech-topics/issues/64).

## Operação temporária: congelamento de novos jobs (23/10/2026)

A implementação foi integrada com geração **pausada** para novos disparos.
A Action usa `jobs.select.if: false` até instrução explícita de retomada.
Isso não altera jobs já iniciados sob commits anteriores nem modifica
Releases. Não confundir bloqueio de novos jobs com cancelamento da matriz
antiga [#39883809928](https://github.com/joaovpimenta/tech-topics/actions/runs/39883809928).
