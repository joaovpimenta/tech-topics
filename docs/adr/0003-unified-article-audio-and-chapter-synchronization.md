# ADR 0003 — Player único, capítulos e sincronismo de leitura

- **Estado:** Aceito e implementado na `main` (PR #53); QA visual entre navegadores ainda é independente
- **Data:** 2026-10-22
- **Escopo:** player do artigo, Web Speech API, áudio gravado e marcadores de bloco

## Contexto

A interface de áudio deve ser consistente ao alternar entre MP3 previamente sintetizado e síntese local do dispositivo. A narração Kokoro agora gera uma inferência por frase completa, exceto frases grandes repartidas em mais de uma inferência com o mesmo marcador. Navegação e destaque seguem a frase lógica, nunca cortes técnicos por vírgulas.

## Decisão aceita

- Reutilizar **um único miniplayer** branco e verde na base da página para ambas as fontes (MP3 do Kokoro e voz local do navegador). O menu de três pontos troca de motor e interrompe o motor anterior.
- Exibir **frase anterior/próxima**, play/pause e velocidade nas duas fontes. Para MP3, a posição usa segundos reais; Web Speech API não expõe duração confiável, portanto mostrar **bloco atual/total** em vez de fabricar um cronômetro.
- **Destacar** a frase narrada; opção **Acompanhar frase** habilita/desabilita scroll suave. Clicar ou pressionar Enter sobre uma frase desloca a reprodução até seu início, mantendo a fonte escolhida; preservar seleção de texto, links, código e elementos interativos.
- Na geração, gravar o timestamp do começo de **cada frase** e seu par `(block_index, sentence_index)` a partir das amostras WAV, com metadados `version=2`. Frases longas fragmentadas mantêm um único marcador; vírgulas não viram frases. Releases `version=1` ainda navegam por parágrafo.
- Não forçar correspondência se os capítulos divergem do DOM/editorial; nesse caso desabilitar destaque incorreto, mantendo o MP3 utilizável.
- Manter Media Session e `HTMLAudioElement` no MP3 para controles do sistema/background quando suportados. O TTS local segue limitações do navegador.
- Áudios antigos sem marcadores continuam tocando; **não regenerar** ou sobrescrever Release sem autorização separada.

## Dependências e riscos

PR **[#53](https://github.com/joaovpimenta/tech-topics/pull/53)** foi integrada à `main`. A verificação funcional no navegador e o deploy são critérios de QA distintos do merge. PR **[#58](https://github.com/joaovpimenta/tech-topics/pull/58)** adiciona `block_index` nos capítulos de futuras narrações e muda o tamanho das unidades de síntese, mas não muda a regra editorial de navegação. O merge do player ocorreu após validação automatizada; não confundir CI verde com validação visual ou sincronização em Releases antigas.

## Aceite

- O mesmo dock permanece montado após mudança MP3 ↔ TTS local.
- Próximo/anterior e clique em parágrafo funcionam em ambos os modos.
- Destaque e scroll acompanham o bloco correto, sem perturbar seleção e links.
- Marcadores de frases correspondem às palavras visíveis dentro dos blocos HTML e aos timestamps reais do WAV publicado; quando houver divergência, desabilitar destaque incorreto.
- Release existente não sofre substituição implícita.

Relacionados: [ADR 0001](0001-kokoro-dora-prosody-and-encoding.md), [ADR 0002](0002-kokoro-execution-cost-and-parallelism.md) e [TTS](../TTS.md).
