# Tech Topics

Vocabulário do fluxo editorial de Tech Topics.

## Linguagem

**Artigo**: publicação editorial em português brasileiro que explica um tema técnico por um recorte definido.

**Pauta**: proposta de tema e recorte editorial, acompanhada de intenção de escrita e lentes de domínio.

**Fila editorial**: histórico de pautas candidatas e seleções para publicação agendada.

**Curadoria**: escolha editorial de pautas relevantes e inéditas para compor a fila.

**Seleção vigente**: última pauta designada para a publicação agendada; permanece pendente até virar artigo ou exigir decisão editorial.

**Brief de artigo**: contrato de escrita composto para uma pauta, com uma task e as lentes de domínio selecionadas.

**Pré-visualização de narração:** Artifact opcional gerado pelo Kokoro em `preview` ou `review`, sem publicação. Não há sintetizador local Chatterbox nem exigência de áudio em hooks de commit.

## Vocabulário de narração pública

**Áudio publicado:** MP3 do Kokoro disponibilizado como asset de uma Release `tts-<slug>`. Não confundir com a voz de síntese Web Speech do navegador.

**Voz do dispositivo:** síntese pela Web Speech API, executada localmente no browser e sujeita às vozes/limitações do sistema. O player deve manter a mesma interface visual do MP3, sem inventar duração.

**Dora:** voz PT-BR única `pf_dora` do Kokoro ONNX FP32; também lê spans EN-US após fonemização bilíngue. Não trocar de narrador ao encontrar inglês.

**Preset aprovado:** `equilibrado`, velocidade `1.00`, pausas de parágrafo/section 380/700 ms. O `atual` de 0.95 permanece como baseline histórico; incorporar o preset depende de PR técnica, não de decisão textual isolada.

**Parágrafo editorial (bloco):** contêiner estável do HTML, identificado por `block_index`. A navegação e o destaque ocorrem agora em **frases**, identificadas por `sentence_index` dentro de cada bloco e timestamp real do WAV; o schema novo é `version=2`.

**Chunk de síntese:** divisão independente em `segmentation.py`; uma frase completa por inferência quando couber nos limites fonéticos. Caso contrário, divide em chunks que preservam `(block_index, sentence_index)` e pausa interna de 25 ms. O adapter `kokoro_release.py` mede capacidade usando G2P/tokenizador Kokoro, mas não decide as regras editoriais. Vírgulas não são controles navegáveis.

**Tokens fonéticos:** IDs obtidos de `kokoro.tokenizer.tokenize(phonemes, limit=None)`, depois da fonemização PT-BR/EN-US, **antes** da síntese. Teto de 350 por inferência e alvo de 300; não são caracteres editoriais. Há outra restrição independente de ~510 caracteres na *string fonética* tratada internamente pelo `kokoro-onnx`, protegida por guarda de 500.

**Compare:** geração manual e curta para escuta A/B com a Dora, sem alterar Releases; compara prosódia, velocidade e compressão a partir de um WAV comum quando o único fator é o codec.

**Handoff:** issue de histórico e próximos passos com links para PRs, ADRs, evidências, decisões aprovadas e pendências; não substitui os arquivos versionados que definem o comportamento.
