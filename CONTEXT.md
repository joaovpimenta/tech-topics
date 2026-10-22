# Tech Topics

Vocabulário do fluxo editorial de Tech Topics.

## Linguagem

**Artigo**: publicação editorial em português brasileiro que explica um tema técnico por um recorte definido.

**Pauta**: proposta de tema e recorte editorial, acompanhada de intenção de escrita e lentes de domínio.

**Fila editorial**: histórico de pautas candidatas e seleções para publicação agendada.

**Curadoria**: escolha editorial de pautas relevantes e inéditas para compor a fila.

**Seleção vigente**: última pauta designada para a publicação agendada; permanece pendente até virar artigo ou exigir decisão editorial.

**Brief de artigo**: contrato de escrita composto para uma pauta, com uma task e as lentes de domínio selecionadas.

**Narração local**: áudio privado para revisão do artigo; distinto da leitura em voz alta oferecida no site.

## Narração e áudio

**Narração gravada:** MP3 produzido no GitHub Actions com Kokoro ONNX
e a voz `pf_dora`, publicado por artigo em Release `tts-<slug>`;
distinto do TTS do navegador e da narração local privada.

**Síntese local do navegador:** recurso Web Speech API; não possui
duração nem alinhamento em segundos comparáveis ao MP3.

**Bloco editorial:** título, subtítulo, seção ou parágrafo; é a unidade
de índice/`block_index`, chapter timestamp, destaque e navegação de áudio.

**Chunk de síntese:** sequência fonética enviada numa inferência Kokoro.
Pode ser uma frase, uma combinação de frases curtas ou uma oração
de uma frase longa. **Não é um parágrafo** e não deve alterar a
correspondência dos blocos editoriais.

**Token fonético:** unidade produzida pelo tokenizer do Kokoro **após**
eSpeak PT-BR/EN-US. Não é caractere do artigo nem necessariamente
caractere da string de fonemas; o workflow deve medir ambas as restrições
antes da inferência.

**Preset de prosódia:** conjunto de velocidade, pausas e segmentação,
independente do codec final. `equilibrado-100` é a preferência de
escuta, não um default de publicação aprovado.

**Artefato comparativo:** saída temporária de `compare`/`profile`
para revisão auditiva/performance; não equivale a Release publicada.

**Autorização de publicação:** alteração deliberada do default de
produção ou substituição de Release existente, independente de uma
PR ter validação verde. Handoff: [issue #56](https://github.com/joaovpimenta/tech-topics/issues/56).
