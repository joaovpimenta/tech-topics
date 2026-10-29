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

Os campos `title` e `dek` são texto simples, não HTML. Em artigos novos ou migrados, quando incluírem trechos que devam ser falados em outro idioma, declare segmentos em `speechMarkup` no frontmatter Markdown:

```yaml
speechMarkup:
  title:
    - text: "Transactional Outbox"
      lang: en-US
    - text: ": do "
      lang: pt-BR
    - text: "commit"
      lang: en-US
    - text: " local à entrega confiável"
      lang: pt-BR
```

Os segmentos devem concatenar exatamente o texto visível do campo correspondente. O compilador leva os metadados ao catálogo e o player monta os elementos `lang` no DOM sem interpretar o conteúdo como HTML. Fontes JSON não são aceitas no checkout corrente; o adaptador de leitura permanece apenas para revisões históricas comparadas ou restauradas.

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

Para uma exceção local no corpo narrável, use uma destas formas de HTML inline no Markdown. `bodyHtml` é a saída compilada, não um campo de autoria:

```html
<span lang="en-US" data-tts-mode="spell">API</span>
<span lang="en-US" data-tts-mode="word">REST</span>
<span lang="en-US" data-tts-say="sequel">SQL</span>
```

`spell` usa os nomes das letras no idioma indicado; `word` mantém a leitura literal; `data-tts-say` fornece a fala exata. Use apenas um entre `data-tts-mode` e `data-tts-say`. Em `speechMarkup` de título e subtítulo, os equivalentes opcionais são `mode` e `speak`, mantendo `text` exatamente igual ao texto visível. Uma exceção local prevalece sobre o léxico; use-a quando o contexto realmente divergir da regra global.

## Código e conteúdo não narrativo

Por padrão, o TTS não deve narrar blocos de código `<pre>`, nem código
inline `<code>` sem anotação. Quando uma expressão inline for parte essencial
da frase, mantenha a grafia original e forneça uma leitura **explícita e
contextual**. Por exemplo:

```html
Um bloco <code lang="en-US" data-tts-say="try catch">try/catch</code>
não fecha essa janela.
```

A leitura será “Um bloco try catch não fecha essa janela”, sem soletrar a
barra. Esse `data-tts-say` funciona como um **alias de fala** equivalente
em intenção ao `<sub alias="...">` do SSML. É uma convenção do Tech Topics,
não uma promessa de suporte SSML nativo. **Use-o quando a expressão inline
for indispensável para compreender a frase**, por exemplo `try/catch`,
`SELECT` ou uma operação citada e explicada em prosa; não é necessário
tornar narráveis todos os identificadores, caminhos ou fragmentos de código.
O atributo `lang` identifica o idioma da **fala** quando ela diferir do
português. `<pre>` continua sempre ignorado, mesmo que contenha um
`<code data-tts-say>`. Para código extenso, prefira explicá-lo em prosa,
nunca ler caracteres isolados.

A mesma regra vale para **setas e símbolos com significado na narrativa**:
não substitua globalmente `→`, `←`, `↑`, `↓` nem operadores,
porque a mesma grafia pode significar **fluxo, ordem, mudança de estado,
implicação, direção física ou variação de uma métrica**. O autor deve
determinar primeiro o significado da relação e depois escolher uma fala
natural e gramatical para aquele contexto. Envolva **apenas o símbolo**
em `<span data-tts-say="...">…</span>`.

| Texto visível | Marcação de exemplo | Leitura pretendida |
| --- | --- | --- |
| Banco → broker | `Banco <span data-tts-say="para o">→</span> <span lang="en-US">broker</span>` | Banco para o broker |
| Broker → banco | `<span lang="en-US">Broker</span> <span data-tts-say="para o">→</span> banco` | Broker para o banco |
| Latência ↑ | `Latência <span data-tts-say="aumenta">↑</span>` | Latência aumenta |
| Erros ↓ | `Erros <span data-tts-say="diminuem">↓</span>` | Erros diminuem |
| Serviço ← resposta | `Serviço <span data-tts-say="recebe a">←</span> resposta` | Serviço recebe a resposta |

Para setas de movimento físico, “para cima”, “para baixo” ou “para a
esquerda” podem ser adequados; para encadeamentos técnicos, prefira
“passa para”, “retorna para”, “resulta em” ou “implica”, conforme o
significado. Não use “seta para a direita” como fala padrão para fluxo.

**Não marque setas puramente decorativas ou de navegação** nem símbolos
dentro de código, fórmulas, diagramas ou outros trechos que o TTS já
ignora. Se uma fórmula ou um diagrama comunicar informação essencial,
explique-a também em texto narrável. O `data-tts-say` é uma decisão
editorial **local**, não uma substituição automática aplicada ao site.

**Revisão antes de publicar:** leia mentalmente o parágrafo e cada
título, legenda e cartão como se fossem falados; se remover um `<code>`
ou ler o nome de uma seta quebrar a explicação, acrescente o alias
adequado sem modificar a grafia visual. O lint valida atributos e HTML,
mas não consegue decidir sozinho o significado de um símbolo.

Também não devem ser narrados índices de navegação, controles interativos,
simuladores ou conteúdo puramente decorativo. A forma **visível** permanece
intacta, inclusive para seleção, cópia e leitura visual.

## Responsabilidade do autor do artigo

Quem gera ou edita um artigo Markdown deve inserir a marcação `lang` correta no corpo usando HTML inline quando necessário, e declarar em `speechMarkup` os idiomas mistos de `title` ou `dek` no frontmatter. Não dependa de detecção automática de idioma no navegador para corrigir o conteúdo depois.

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

## Revisão de áudio sem publicação

Para ouvir uma narração sem publicar, execute o workflow Kokoro com
`mode=preview` (trecho curto) ou `mode=review` (artigo completo), e consulte
os Artifacts de GitHub Actions. Apenas a engine **Kokoro** produz novos
arquivos de áudio. A regra de extração do texto e o planejamento de frases
são módulos neutros; consulte [ADR 0004](adr/0004-tts-segmentation-backend-boundary.md)
e [tools/tts/README.md](../tools/tts/README.md).

A antiga síntese Chatterbox anterior ao commit, sua exigência de voz privada
e seu hook foram descontinuados. `node scripts/validate-site.mjs` continua
validando conteúdo e testes TTS sem sintetizar áudio.

## Geração de MP3 pelo Kokoro no GitHub Actions

A narração de áudio publicado usa **Kokoro Dora** e respeita as mesmas
marcações `lang="en-US"` do corpo e `speechMarkup` de título/subtítulo.
Texto sem marcação usa fonemização `pt-br`; segmentos ingleses recebem
fonemização `en-us`; a voz permanece `pf_dora` em uma única sequência de
fonemas por bloco. Decisões explícitas de `data-tts-say`, `data-tts-mode`
e léxico continuam tendo precedência.

Para gerar MP3 sem alterar uma Release, usar **preview** no workflow Kokoro.
A seleção manual aceita slug, título ou campo vazio para o artigo publicado
mais recentemente. Depois do deploy, os cálculos de alteração narrável
reconhecem fontes `.md`. Os jobs de efeito continuam bloqueados; a exceção
seletiva para alteração narrável só pode operar quando liberada pela política
aprovada. Ver
[guia do Kokoro](KOKORO_ACTIONS.md).

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
  animado, velocidade, fechamento e, quando houver marcadores, avanço à
  **próxima frase** em vez de salto arbitrário por segundos.
  O botão "Ouvir daqui" não faz mais parte do cabeçalho.
- Quando os marcadores da Release identificam exatamente os blocos do HTML,
  o site destaca a frase em reprodução, acompanha sua posição por rolagem
  suave e permite iniciar a escuta clicando no próprio parágrafo. O menu
  do player inclui **Acompanhar parágrafo** (ativado por padrão) para
  permitir desabilitar a rolagem. O clique ignora links, código e
  texto selecionado, preservando navegação e cópia. O player oferece
  **frase anterior** e **próxima frase**, inclusive nos controles
  Media Session quando suportados pelo navegador.
- O JSON de capítulos contém `block_index` gerado no mesmo percurso
  editorial que a narração, sem alterar a síntese. Caso o número ou
  a ordem dos blocos do artigo não correspondam aos marcadores,
  a sincronização visual é desabilitada para evitar destacar o
  texto errado; áudio e seek continuam funcionando. Áudios antigos
  sem capítulos não habilitam os comandos de parágrafo.

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

### Player único para áudio gravado e voz do dispositivo

A interface publicada mantém **um único miniplayer inferior branco e verde**,
com capa do banner do artigo, título, play/pause, velocidade, fechar,
frase anterior/próxima e opção **Acompanhar frase**. Os três pontos
trocam entre **áudio gravado** (MP3 Kokoro, quando disponível) e
**voz do dispositivo** (Web Speech API), sem abrir outra barra. Alternar
o motor interrompe a reprodução anterior. O botão **Ouvir artigo**
prefere MP3 quando encontrado; caso não haja MP3, usa voz nativa.

Na reprodução de MP3, o progresso mostra **tempo decorrido e duração real**,
com busca por tempo e controles Media Session quando compatíveis. No TTS
nativo, a Web Speech API não fornece duração nem timestamps do áudio:
o progresso corresponde ao **trecho atual / total de trechos**, e a barra
permite selecionar o bloco para leitura. Não exibimos tempo estimado
como se fosse a duração real.

As duas fontes destacam a frase falada no corpo do artigo, fazem rolagem
automática opcional, aceitam clique ou Enter em um parágrafo e usam os
mesmos botões anterior/próximo. Interações em links, seleções de texto
e blocos de código não devem iniciar narração. A leitura nativa preserva
a pronúncia PT-BR/EN-US, léxico e destaques de palavras quando a voz
disponibiliza eventos `boundary`.

O player nativo depende dos recursos de cada navegador e não possui
garantia de execução em segundo plano; os MP3s continuam usando o elemento
HTML `audio` e a Media Session API para integração com o sistema.

O áudio revisado de Bulkhead confirmou a qualidade perceptiva da
segmentação atual; os marcadores editoriais não alteram o áudio acústico.
As Releases antigas continuam preservadas até que uma regeneração
seja solicitada explicitamente.

## Piloto de fontes autocontidas

A mudança de diretório da #143 preserva a semântica narrável e a identidade dos capítulos; confira a evidência do [piloto](specs/article-v2-pilot.md) e o [ADR 0007](adr/0007-self-contained-articles-and-clean-routes.md). O manifesto `--narration-impact` diferencia fala e mapeamento; `--check-compatible` bloqueia divergências para análise, sem gerar áudio. Nenhuma equivalência de fontes autoriza substituir MP3 ou capítulos.
