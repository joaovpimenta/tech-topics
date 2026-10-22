# Text-to-speech e conteúdo multilíngue

## Objetivo

Os artigos são escritos em português brasileiro, mas frequentemente contêm termos técnicos em inglês. O conteúdo deve carregar informação semântica suficiente para que o mecanismo de text-to-speech possa alternar pronúncia e voz quando necessário, sem depender de heurísticas frágeis no runtime.

## Regra principal

O idioma padrão do artigo é `pt-BR`.

Quando uma palavra ou expressão deve ser pronunciada em inglês, marque-a explicitamente com `lang="en-US"`.

Para siglas, aplique a política de pronúncia abaixo: trocar o idioma, por si só, não determina soletração.

Exemplos:

```html
<span lang="en-US">backoff</span>
<span lang="en-US">full jitter</span>
<span lang="en-US">retry budget</span>
<span lang="en-US">load shedding</span>
<span lang="en-US">leader election</span>
```

Em contexto:

```html
<p>
  Uma política de <span lang="en-US">retry budget</span> limita a quantidade
  de repetições aceitas durante um incidente.
</p>
```

## Quando marcar

Marque `lang="en-US"` quando:

- o termo ou expressão permanecer em inglês no texto;
- a pronúncia inglesa for a forma natural ou predominante no contexto técnico;
- uma pronúncia portuguesa provavelmente degradaria a compreensão.

A marcação deve ser semântica. Não mantenha uma lista fechada de palavras como única regra: novos termos técnicos podem aparecer a qualquer momento.

Os campos `title` e `dek` são texto simples, não HTML. Quando incluírem trechos que devam ser falados em outro idioma, declare segmentos em `speechMarkup` no JSON do artigo:

```json
"speechMarkup": {
  "title": [
    { "text": "Transactional Outbox", "lang": "en-US" },
    { "text": ": do ", "lang": "pt-BR" },
    { "text": "commit", "lang": "en-US" },
    { "text": " local à entrega confiável", "lang": "pt-BR" }
  ]
}
```

Os segmentos devem concatenar exatamente o texto visível do campo correspondente. O player monta os elementos `lang` no DOM sem interpretar o conteúdo como HTML.

## Quando não marcar

Não marque automaticamente:

- palavras já incorporadas de forma natural ao português quando a pronúncia inglesa não trouxer benefício;
- nomes próprios cuja pronúncia não seja resolvida apenas pela troca de idioma;
- URLs;
- blocos de código;
- fórmulas;
- identificadores de programas ou APIs quando uma leitura literal seria pior do que o tratamento específico do léxico.

Evite envolver frases inteiras em `lang="en-US"` quando apenas um termo curto estiver em inglês.

## Siglas, abreviações e pronúncias especiais

Troca de idioma e pronúncia excepcional são problemas diferentes.

Classifique cada expressão técnica como termo estrangeiro, sigla soletrada ou acrônimo pronunciado como palavra. A precedência é:

1. pronúncia explícita naquela ocorrência;
2. entrada correspondente em `content/tts-lexicon.json`;
3. soletração em português brasileiro para siglas sem decisão editorial, inclusive `API`, `SQL`, `mTLS` e `gRPC`;
4. leitura literal no idioma herdado para os demais termos.

Essa regra vale mesmo quando a sigla aparece dentro de um trecho marcado em inglês. O fallback reconhece palavras inteiras com duas ou mais letras maiúsculas, incluindo um prefixo minúsculo e plural em `s`; identificadores como `API_v2` e URLs permanecem literais. Grafias fora desse padrão precisam de marcação explícita ou entrada no léxico. O léxico tem prioridade sobre a soletração automática: uma futura entrada para `SQL` muda a leitura de todos os artigos nas próximas builds sem reescrever o conteúdo. Correspondências são sensíveis a maiúsculas; o plural usa primeiro sua entrada exata e, depois, a entrada da forma singular.

Cada entrada contém `speak` (texto falado) e `lang` (idioma da fala). Preserve a grafia visível; não escreva a expansão fonética na prosa. `HTTP`, `SRE` e `p99` já possuem entradas. Acrescente decisões editoriais ao léxico; termos estrangeiros comuns podem continuar usando apenas `lang`.

Para uma exceção local no `bodyHtml`, use uma destas formas:

```html
<span lang="en-US" data-tts-mode="spell">API</span>
<span lang="en-US" data-tts-mode="word">REST</span>
<span lang="en-US" data-tts-say="sequel">SQL</span>
```

`spell` usa os nomes das letras no idioma indicado; `word` mantém a leitura literal; `data-tts-say` fornece a fala exata. Use apenas um entre `data-tts-mode` e `data-tts-say`. Em `speechMarkup` de título e subtítulo, os equivalentes opcionais são `mode` e `speak`, mantendo `text` exatamente igual ao texto visível. Uma exceção local prevalece sobre o léxico; use-a quando o contexto realmente divergir da regra global.

## Código e conteúdo não narrativo

Por padrão, o TTS não deve narrar:

- `<pre>` e `<code>` como prosa contínua;
- índices de navegação;
- controles interativos;
- simuladores;
- conteúdo puramente decorativo.

Quando um trecho de código precisar ser explicado, faça essa explicação em prosa no artigo em vez de depender da leitura literal do código.

## Responsabilidade do autor do artigo

Quem gera ou edita o artigo deve inserir a marcação `lang` correta no próprio `bodyHtml` e declarar em `speechMarkup` os idiomas mistos de `title` ou `dek`. Não dependa de detecção automática de idioma no navegador para corrigir o conteúdo depois.

Antes de publicar, revise expressões técnicas inglesas e siglas em título, subtítulo e corpo. Consulte o léxico, aplique a soletração padrão às siglas sem decisão editorial e registre as exceções necessárias. Maiúsculas são um auxílio de detecção, não uma decisão editorial automática sobre acrônimos ou marcas.

## Runtime

O player de TTS deve, quando suportado:

1. herdar `pt-BR` como idioma padrão;
2. respeitar elementos descendentes com atributo `lang`;
3. criar segmentos de fala preservando fronteiras de idioma;
4. selecionar preferencialmente uma voz compatível com o idioma de cada segmento;
5. usar fallback apropriado quando não houver uma voz exata instalada;
6. preservar controles de pausar, continuar e parar, avançar e voltar por trecho;
7. evitar perder marcação semântica convertendo todo o artigo antecipadamente para um único `textContent`.

Esta seção define o comportamento esperado do runtime, mas alterações no player compartilhado devem ser feitas como tarefa técnica específica, não incidentalmente durante a criação de um artigo.

O player oferece barra fixa durante a sessão, seleção de trecho e destaque do bloco atual. Durante a leitura, clicar em um bloco muda a posição; links e seleção de texto preservam seu comportamento. Fora da sessão, selecione o trecho e use “Ouvir daqui”, ou dê foco por teclado e pressione Enter. Mudar de trecho durante a pausa preserva a pausa; anterior e próximo levam ao início do bloco correspondente. Título, subtítulo, listas, células e legendas também são blocos de leitura.

O destaque de palavra depende de eventos `boundary` da voz instalada. Expansões como “a pê i” apontam para a ocorrência visível de `API`; sem esses eventos, o destaque permanece no bloco. “Acompanhar leitura” controla a rolagem automática. Não prometa reprodução em segundo plano ou continuidade com a tela bloqueada: isso depende do navegador.

O léxico e `speech.js` fazem parte do pacote público e do precache; mudanças neles renovam a versão da PWA. Os artigos existentes recebem a política central de pronúncia, sem substituir seu texto visível por grafias fonéticas.

## Revisão com narração local

Para preparar o Chatterbox, diagnosticar voz e dependências ou validar narração antes de um commit, consulte [o fluxo TTS local](../tools/tts/README.md). Esse fluxo usa o conteúdo staged e mantém voz e áudio privados; sua saída serve à revisão humana e não altera o player público.

O roteiro local aplica a mesma precedência de pronúncia. No pre-commit, tanto o artigo quanto o léxico vêm do índice Git. Uma mudança na fala resultante invalida o cache daquele artigo na próxima verificação; alterar apenas uma entrada não utilizada preserva o áudio. O sintetizador local mantém sua voz/configuração em português e não reproduz a troca de vozes do navegador.

## Geração de MP3 pelo Kokoro no GitHub Actions

A narração de áudio publicado usa **Kokoro Dora** e respeita as mesmas
marcações `lang="en-US"` do corpo e `speechMarkup` de título/subtítulo.
Texto sem marcação usa fonemização `pt-br`; segmentos ingleses recebem
fonemização `en-us`; a voz permanece `pf_dora` em uma única sequência de
fonemas por bloco. Decisões explícitas de `data-tts-say`, `data-tts-mode`
e léxico continuam tendo precedência.

Para gerar MP3 sem alterar uma Release, usar **preview** no workflow Kokoro.
A seleção manual aceita slug, título ou campo vazio para o artigo publicado
mais recentemente. O fluxo automático cria áudio apenas para novos arquivos
JSON após o deploy da página. Ver [guia do Kokoro](KOKORO_ACTIONS.md).

A revisão de pronúncia por escuta é necessária, sobretudo para nomes próprios
e termos ingleses não marcados. A geração de roteiros dedicados ou em diálogo
não faz parte deste fluxo.

## Reprodução dos MP3s no site

Cada artigo pode oferecer duas formas independentes de escuta:

- **Ouvir artigo** (único botão de fones no cabeçalho): abre o MP3 completo
  se a Release pública `tts-<slug>` contiver `<slug>.mp3`; caso contrário
  usa a leitura nativa do navegador.
- **Voz do dispositivo** permanece disponível mesmo quando há MP3,
  pelo menu de opções (`···`) dentro do miniplayer.
- A barra **inferior**, no tema branco e verde do site, mostra a imagem de
  capa do artigo, título, tempo transcorrido e total, progresso, play/pause
  animado, velocidade, fechamento e, quando houver marcadores, avanço ao
  **próximo parágrafo** em vez de salto arbitrário por segundos.
  O botão "Ouvir daqui" não faz mais parte do cabeçalho.

O navegador consulta
`https://api.github.com/repos/joaovpimenta/tech-topics/releases/tags/tts-<slug>`
e só revela o botão caso a Release pública contenha o asset correto.
Falha de rede, limite da API ou Release ausente não impede a leitura pelo
dispositivo; uma nova visita/recarregamento verifica novamente se o
MP3 já foi publicado. O site não baixa o MP3 ao instalar a PWA nem
inclui o arquivo no precache; streaming é feito pelo navegador a partir
da Release.

Ao iniciar um tipo de narração, o outro é interrompido para evitar
sobreposição. A reprodução do MP3 usa a **Media Session API** com metadados
do artigo e ações de play/pause/seek, permitindo integração com
controles do sistema, notificações e tela bloqueada em navegadores
compatíveis. A aba pode ficar em segundo plano, mas não se pode
garantir reprodução se o navegador for encerrado, a aba descartada ou o
sistema suspender aplicativos em segundo plano. O service worker da PWA
não é e não pode ser usado como reprodutor em segundo plano.

As Releases antigas podem conter áudios gerados com Piper: a interface
mostra "Tech Topics · Narração", e não presume que a voz seja sempre Dora.

Os testes rápidos `scripts/test-audio.cjs` verificam consulta à Release,
playback, tempo, busca, velocidade e Media Session sem precisar de
hardware de áudio. `scripts/test-speech.cjs` continua cobrindo o TTS
nativo. O teste visual em navegador é opcional.
