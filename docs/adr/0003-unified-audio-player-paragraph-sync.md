# ADR 0003 — Player único para MP3 e síntese local, sincronizado por blocos

- **Estado:** Proposto — implementação na [PR #53](https://github.com/joaovpimenta/tech-topics/pull/53), ainda não incorporada à `main` em 22/10/2026
- **Data:** 2026-10-22
- **Referências:** [handoff #56](https://github.com/joaovpimenta/tech-topics/issues/56), [PR #52](https://github.com/joaovpimenta/tech-topics/pull/52)

## Contexto

O player MP3 gravado e o Web Speech API do dispositivo apresentavam
interfaces diferentes, embora ambos narrem o mesmo artigo. O usuário
escolheu preservar um único miniplayer inferior branco/verde com capa
do artigo. Ao mesmo tempo, a separação de síntese por sentença não deve
destruir a navegação por parágrafo.

## Decisão proposta

- **Um único dock** no rodapé para as fontes **MP3 gravado** e
  **`speechSynthesis` local**. A troca da fonte pelos três pontos interrompe
  a anterior; os controles play/pause, fechar e velocidade permanecem.
- **Anterior/próximo parágrafo**, clique/Enter no bloco para iniciar
  a partir dele, **destaque verde** do trecho ativo e scroll automático
  com opt-out. Preservar links, seleção de texto e blocos de código.
- **Dois relógios legítimos:** o MP3 dispõe de tempo em segundos e capítulos
  amostrados; a Web Speech API não fornece timestamps/duração confiáveis,
  então seu progresso é em blocos (`N/total`), sem inventar segundos.
- **Marcadores por bloco editorial**: `block_index` de título, subtítulo,
  seções e parágrafos é mantido na síntese. Chunking por frases/tokens
  altera apenas unidades de inferência, não as unidades de navegação.
- Se capítulo e DOM divergirem, desabilitar sincronização visual do MP3,
  preservando reprodução. Releases legadas sem `chapters.json` continuam
  válidas, porém sem saltos exatos.
- Não substituir MP3 legado automaticamente só para ativar capítulos:
  regeneração requer permissão explícita.

## Consequências e aceitação

Validar desktop/mobile, Media Session no MP3, Web Speech em navegador
compatível, alternância entre fontes, texto clicável e ausência de scroll
indesejado. Não marcar como implementado em produção até integrar
a PR #53, passar CI e conferir o deploy. A voz gravada é sempre Dora;
a voz local depende do dispositivo e não é o mesmo mecanismo.
