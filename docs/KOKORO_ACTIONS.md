> **Pausa seletiva:** todos os disparos manuais, backfills e síntese
> de artigos novos continuam bloqueados. Exceção editorial autorizada:
> quando um artigo existente muda sua fala (texto, `lang`, `data-tts-say`),
> o Pages faz deploy e regenera somente o MP3 e `chapters.json` daquele slug. O lote antigo [#39883809928](https://github.com/joaovpimenta/tech-topics/actions/runs/39883809928)
> usa um commit anterior e **não é afetado retroativamente**. Para retomar
> novas gerações, é necessária instrução explícita e remoção do bloqueio.

# Kokoro Dora — narração automática e manual com PT-BR + inglês

O Tech Topics usa **somente Kokoro-82M v1.0 (FP32 / ONNX)**, voz
`pf_dora`, CPU em GitHub Actions. **Padrão vigente na `main` (PR #58):** preset `equilibrado`,
velocidade **1.00**, alvo de 300/teto de 350 tokens reais após G2P,
MP3 **128 kbps**, mono 24 kHz e `loudnorm=I=-19:TP=-1:LRA=11`.
Releases antigas permanecem intactas; a comparação 96/128/160 kbps
usa o mesmo WAV normalizado e não altera o padrão de publicação.
O modelo e a voz são mantidos em cache. Piper não faz mais parte
dos workflows de narração.

**A leitura pelo TTS nativo do navegador/dispositivo continua disponível** no
site pelo botão **Ouvir artigo** (`speech.js`, Web Speech API), independente
dos MP3s publicados. A validação normal executa apenas um **smoke test**
rápido e simulado para confirmar a chamada de síntese PT-BR/EN-US; não depende
de drivers de áudio, navegadores instalados nem de uma matriz de sistemas.

## Arquitetura independente do motor

A preparação e a segmentação de frases são responsáveis por definir **o que
é narrado** e **como dividir** cada frase. `narration_text.py` extrai texto
e pronúncia editorial; `segmentation.py` é o planejador sem dependência
do modelo. `kokoro_release.py` usa o modelo somente para capacidade real
G2P/tokenizador e geração acústica. A montagem atribui timestamps com base
nas amostras WAV resultantes, preservando o par `(block_index, sentence_index)`.
Veja [ADR 0004](adr/0004-tts-segmentation-backend-boundary.md).

**Somente o Kokoro gera áudio** no projeto. A geração Chatterbox, os hooks de
pré-commit e a dependência de voz privada foram removidos. O navegador ainda
pode oferecer Web Speech API como opção de leitura no dispositivo, sem produzir
MP3s.

## Fonemização bilíngue — sem troca de narrador

A narração usa as tags e o léxico editorial existentes, sem alterar o HTML visível:

```html
<p>O padrão <span lang="en-US">Bulkhead</span> evita falhas em cascata.</p>
```

- Texto sem `lang` recebe eSpeak G2P `pt-br`, assim como `lang="pt-BR"`.
- `lang="en-US"` recebe eSpeak G2P `en-us`.
- O `speechMarkup` de `title` e `dek` recebe a mesma lógica.
- O léxico `content/tts-lexicon.json` pode sobrescrever texto falado e idioma
  (`speak` + `lang`); siglas sem entrada são soletradas em PT-BR.
- `data-tts-say`, `data-tts-mode="spell"` e `"word"` prevalecem
  sobre o léxico, conforme `docs/TTS.md`.
- Menus, código, controles e outros trechos não narrativos continuam excluídos.
- As porções em português e inglês são convertidas para **uma mesma sequência
  de fonemas em cada frase**. O Kokoro sintetiza essa sequência em uma chamada
  **sempre com Dora** — não há segunda voz ou emenda de WAVs.

O modelo é multilíngue, mas a naturalidade de um som inglês com a voz brasileira
precisa ser conferida ouvindo os MP3s. Não há conversão fonética automática de
nomes sem tags.

## Preset de locução

| Configuração | Valor |
|---|---|
| Modelo | `kokoro-v1.0.onnx`, FP32 |
| Voz | `pf_dora` para PT-BR e EN-US |
| G2P | `EspeakG2P(pt-br)` e `EspeakG2P(en-us)` |
| Velocidade | 1.00 (`equilibrado-100`) |
| Blocos de síntese | alvo 300/teto 350 tokens reais; guarda de 500 caracteres fonéticos |
| Cortes internos necessários | 25 ms; priorizar frase completa e pontuação |
| Pausa normal entre chunks | 140 ms |
| Pausa ao final de parágrafo | 380 ms |
| Pausa após título ou seção | 700 ms |
| Áudio interno | WAV PCM mono 24 kHz |
| Publicação | MP3 128 kbps, -19 LUFS, TP -1 dB |
| Infraestrutura | GitHub-hosted Ubuntu, CPU 4 threads, timeout 60 min |

**Configuração vigente para novos assets.** Consulte o
[ADR 0001](adr/0001-kokoro-dora-prosody-and-encoding.md) para a escolha
`equilibrado-100`, tokenização antes da inferência, `trim=True`,
`continuous=False`, limites fonéticos e comparações auditivas.
O antigo 0.95 / 96 kbps permanece somente como referência histórica.

As pausas e a normalização são feitas pelo pipeline, não por um preset
nativo do Kokoro.

## Automático: novos artigos após o deploy

O build público compila o catálogo `html-v1` e os artigos HTML diretamente das
fontes Markdown; fontes individuais e `content/articles/index.json` não entram
no pacote. Leituras JSON ficam restritas a revisões históricas no comparador de
migração e à inspeção de artefatos de rollback. Todos os jobs de efeito permanecem congelados por condições globais `false`.

Nas execuções `push` e `workflow_dispatch`, a workflow [Pages](../.github/workflows/pages.yml)
resolve o SHA do run mais recente na `main` cujo job `Deploy GitHub Pages`
terminou com sucesso, mesmo se outro job daquele run falhou. Confirma que essa
revisão é ancestral do SHA atual e usa esse ponto como início do diff. Dispatch
de revisão diferente ou ultrapassada, SHA ausente/zerado ou SHA fora da história
atual bloqueia a validação e o deploy.

Depois que uma mudança aprovada reativar os efeitos, a workflow chama
[Publish Tech Topics audio (Kokoro Dora)](../.github/workflows/kokoro-audio.yml)
**após o deploy bem-sucedido na `main`**. Somente novos slugs do inventário
compartilhado `content/articles/*.md` são candidatos; mudanças em artigos existentes não refazem áudios. No estado atual,
os cálculos continuam ativos, mas os jobs de efeito permanecem congelados.
Com catálogo `html-v1`, o adapter Python lê o HTML compilado do artefato
validado e confere o SHA de fonte, o `buildId` e os envelopes antes de qualquer
trabalho. A leitura histórica JSON permanece disponível para comparação e
rollback. Versões antigas do app seguem atendidas pelo cache já controlado até
a atualização natural do service worker; o cliente atual exige o catálogo
`html-v1` e não consulta endpoints de artigo JSON.

Cada artigo recebe uma GitHub Release `tts-<slug>` com `<slug>.mp3`
e `<slug>.chapters.json`. O Kokoro grava os instantes de início de cada
frase completa nas amostras WAV, identificando `block_index` e
`sentence_index` em `version=2`. Frases longas repartidas em vários chunks
mantêm um marcador lógico. O site consulta os marcadores nas notas da Release
e permite pular à próxima frase sem
depender de uma requisição JSON cross-origin à hospedagem dos assets.
Releases existentes nunca são substituídas automaticamente.
**Áudios antigos sem esses marcadores continuam tocando, mas não podem
pular frases com precisão até serem regenerados em schema v2 com
`mode=publish` e `replace_existing=true`.**

## Manual: escolher artigo por nome ou o mais recente

Abra [Actions → Publish Tech Topics audio (Kokoro Dora)](https://github.com/joaovpimenta/tech-topics/actions/workflows/kokoro-audio.yml)
e clique em **Run workflow**, branch `main`.

Campo **article**:

- `bulkhead` ou `Bulkhead`;
- `Four Golden Signals` ou `four-golden-signals`;
- título completo de um artigo;
- **vazio** ou `latest`: escolher o artigo com maior `publishedAt`
  no catálogo da revisão selecionada; não é o commit mais recentemente editado.

Se um nome corresponder a mais de um título, a execução falha com aviso
de ambiguidade, em vez de escolher um silenciosamente.

Campo **mode**:
- **`preview` (padrão)**: sintetiza os primeiros ~1.200 caracteres em CPU;
  publica MP3 e relatório de fonemas como `Actions → Artifacts` por 14 dias.
  Não cria nem altera Releases.
- **`review`**: sintetiza **o artigo completo** com o preset de produção,
  exporta MP3 128 kbps, capítulos e métricas como um **Artifact de revisão
  por 30 dias** (inclui SHA-256). Verifica codec, 350 tokens e sequência dos
  capítulos. **Não cria nem altera Releases**, incluindo artigos que já
  possuem `tts-<slug>`; use este modo para validar Bulkhead antes de
  qualquer substituição ou backfill.
- **`publish`**: sintetiza o artigo completo com capítulos de **frase** (schema `version=2`) e cria uma Release.
  Se ela já existe, é preservada; `replace_existing=true` permite
  substituir somente quando solicitado manualmente.
- **`compare`**: produz nove amostras curtas para escuta, cruzando
  três configurações de prosódia e velocidades 0.95/1.00/1.05;
  não publica nem substitui Releases (detalhes abaixo).
Para revisão integral antes do backfill: `article=bulkhead`, `mode=review`, `replace_existing=false`. Acesse o artifact `kokoro-dora-review-bulkhead-*`, valide duração, pausas, pronúncia, volume e capítulos em navegador. A aprovação auditiva e de interface antecede qualquer substituição da Release histórica.

Exemplo para testar a palavra *Bulkhead*: `article=bulkhead`,
`mode=preview`. Para atualizar o áudio antigo depois de ouvi-lo:
`article=bulkhead`, `mode=publish`, `replace_existing=true`.

## Comparação de prosódia, tokens e compressão — somente Dora

A opção manual `compare` testa a **voz fixa `pf_dora`**, somente no
**título + primeiro parágrafo do corpo** (metáfora de abertura, sem `dek`).
Compara as três velocidades `0.95`, `1.00`, `1.05` cruzadas com os
três perfis de pausas `atual`, `equilibrado`, `fluido`.

A opção aprovada na escuta e adotada para novas publicações é **Equilibrado 1.00**:
pausa de parágrafo 380 ms, pausa depois de título 700 ms, e 140 ms
entre sentenças distintas. No `compare`, as
emendas obrigatórias no meio de uma frase usam **25 ms** de silêncio.

### Chunking por tokens reais antes do TTS

Cada frase completa é uma unidade de navegação e recebe um timestamp por amostra WAV. Frases curtas **não** são combinadas em uma inferência; frases longas podem usar vários chunks com o mesmo `(block_index, sentence_index)` e junção interna de 25 ms. Vírgulas não criam unidades navegáveis. A fonemização PT-BR/EN-US acontece **antes de `kokoro.create()`**.
O pipeline usa `kokoro.tokenizer.tokenize(fonemas, limit=None)`
para contar tokens reais e escolher cortes antes da inferência.
**Não existe limite de 320 caracteres editoriais na preparação de novas sínteses, inclusive em `publish`.**

- **Alvo de contexto:** 300 tokens para uma frase; frases menores são sintetizadas separadamente, sem agregação com a seguinte.
- **Teto de inferência:** 350 tokens; acima dele, buscar vírgula,
  ponto e vírgula ou dois-pontos mais próximos do alvo, ou, só como
  alternativa, separar entre palavras. Não separar uma palavra ao meio.
- **Segundo teto técnico:** 500 caracteres na **string de fonemas**
  produzida pelo G2P, pois `kokoro-onnx` divide internamente em
  510 caracteres fonéticos. É um limite diferente de caracteres do
  texto do artigo ou tokens do vocabulário; ambos precisam ser aferidos.
- Os `block_index` permanecem associados ao parágrafo original; `sentence_index`
  identifica cada frase dentro dele. Fragmentos de uma frase longa compartilham
  a mesma unidade de navegação e destaque no player.
- A biblioteca já utiliza `trim=True` por padrão; o pipeline o envia
  explicitamente. Isso remove silêncio da borda dos lotes da biblioteca,
  não significa corte semântico de frases.

### Compressão sem inferência extra

A fonte permanece WAV mono PCM a 24 kHz. O MP3 de novas publicações é
**128 kbps CBR**, com `loudnorm=I=-19:TP=-1:LRA=11`. No `compare`,
além dos nove MP3s, o workflow produz do **mesmo WAV Equilibrado 1.00**:

| Arquivo | Compressão |
|---|---|
| `equilibrado-100/bulkhead.mp3` | 96 kbps MP3 (referência histórica do `compare`) |
| `equilibrado-100/bulkhead-128k.mp3` | 128 kbps MP3 |
| `equilibrado-100/bulkhead-160k.mp3` | 160 kbps MP3 |
| `equilibrado-100/bulkhead-lossless.wav` | WAV PCM sem perdas, após a mesma normalização |

Todos têm o mesmo áudio antes da codificação e os mesmos parâmetros de
normalização. Se a diferença entre o MP3 e o WAV for mínima, aumentar
bitrate não corrigirá problemas de pronúncia, prosódia ou recortes:
apenas reduzirá os artefatos da compressão, aumentando o arquivo.

`publish` e `preview` já usam Equilibrado 1.00 e MP3 128 kbps.
`review` e `compare` geram Artifacts sem publicar Releases. O backfill aprovado usa `all_articles=true` com `mode=publish` e `replace_existing=true`: revisa todos os artigos publicados, pula os que já têm schema v2 e guarda backups dos MP3 antigos como Artifacts de 90 dias antes de substituí-los. A migração inicial foi iniciada no merge da PR #66, run [#39883809928](https://github.com/joaovpimenta/tech-topics/actions/runs/39883809928). O gatilho automático de uso único foi removido após o disparo; novos backfills e retries usam o comando manual `workflow_dispatch` com `all_articles=true`, `mode=publish` e `replace_existing=true`. Runs normais do Pages não fazem backfill. Nenhuma Release existente é sobrescrita implicitamente fora dessa operação expressamente aprovada;
substituição exige `mode=publish` com `replace_existing=true` manual.

### E o modo `continuous`?

O modelo ONNX `kokoro-v1.0.onnx` hospedado em
`model-files-v1.1` **expõe saída de durações** e, segundo a
documentação oficial do exportador, permite
`create(continuous=True)`. Compatibilidade de formato **não garante**
melhor qualidade com Dora ou com fonemas mesclados PT-BR/EN-US.
Ele permanece **desligado** até um teste auditivo específico; não
é necessária uma decisão/ADR separada para manter essa configuração.

**Como executar** após o merge: Actions → Publish Tech Topics audio
(Kokoro Dora), `article=bulkhead`, `mode=compare`, com
`replace_existing=false`. Baixar o artifact `kokoro-dora-compare-*`
para ouvir as variantes; não publica nem substitui MP3 de Release.

## Execuções redundantes evitadas

O workflow **Pages** continua fazendo build e deploy quando código, CSS ou
artigos mudam: isso é necessário para atualizar o site e o cache da PWA.
Ele **não recria o texto editorial**: cada slug tem uma fonte `.md`; o build
indexa os metadados e compila o corpo diretamente para HTML no pacote candidato.

Quando um push na `main` não adiciona nenhum slug `.md` ao
inventário, o job de áudio **nem é agendado**. A seleção editorial automática
também só é acionada se o push adicionar um novo slug; mudanças de código,
layout ou edição de artigo existente não selecionam outro tópico. O caller
confere `sourceSha`/`buildId` contra o artefato implantado e registra essa
identidade na seleção; reruns do mesmo artefato não avançam a fila novamente.
A seleção por comentário autorizado ou `workflow_dispatch` continua explícita.

Mesmo havendo um artigo novo, o workflow de áudio confere as Releases
`tts-<slug>` **antes de criar jobs de síntese**. Release já existente
faz skip por padrão. `preview` e `review` são solicitações manuais
intencionais e podem rodar um artigo existente; `publish` só substitui
áudio existente com `replace_existing=true`. A checagem de Release é
repetida no início do job como proteção contra duas execuções concorrentes.

## Configuração de execução

Cada job de síntese utiliza uma instância Kokoro FP32 com quatro threads
em um runner. O profiling de CPU e memória e o modo `profile` foram
removidos para simplificar a operação. O relatório normal
`<slug>.metrics.json` permanece disponível com duração e tempo total
da síntese para suporte e validação, sem coleta contínua de CPU/RSS.

## ADRs e decisões de governança

- [ADR 0001 — Prosódia, 350 tokens, trim, bitrate e continuous](adr/0001-kokoro-dora-prosody-and-encoding.md): perfil Dora Equilibrado 1.00 **aceito**, implementação integrada à `main` na PR #58.
- [ADR 0002 — Execução, concorrência e skip](adr/0002-kokoro-execution-cost-and-parallelism.md): uma instância × quatro threads; nenhuma síntese redundante para artigo/Release existentes.
- [ADR 0003 — Player único e capítulos](adr/0003-unified-article-audio-and-chapter-synchronization.md): sincronização por par `(block_index, sentence_index)` no schema v2, com fallback v1 por bloco.

A melhoria de qualidade de 96 para 128 kbps é uma decisão de
**codificação para novos arquivos**, não uma garantia de diferença audível.
O `compare` já permite ouvir 96/128/160 e WAV a partir do mesmo
áudio-fonte. Conservar os arquivos antigos até autorização explícita
de substituição; nenhuma mudança de bitrate por si só regrava Releases.

## Validação e custo

A validação geral de PR em [Validate Tech Topics](../.github/workflows/validate.yml)
executa os testes leves de seleção manual, idiomas, léxico, corte de blocos,
exceções locais e integridade dos artigos **uma vez em Ubuntu**. Não baixa
o modelo Kokoro e não gera MP3 no CI, para reduzir o uso de CPU e o tempo
das revisões. Para testar a síntese real com a voz Dora e as tags inglesas,
use o modo `preview` do único workflow manual Kokoro: ele produz o áudio
e o relatório de fonemas sem alterar Releases.

Dependências fixadas:
`kokoro-onnx==0.6.1`, `misaki-fork==0.9.6`,
`phonemizer-fork==3.3.2`, `espeakng-loader==0.2.4`,
`soundfile==0.13.1`, além de `espeak-ng` e `ffmpeg`.
Nenhum token externo ou GPU. São usadas 4 threads CPU e o modelo
FP32 é carregado uma vez por artigo. As métricas gerais de duração e tempo total da síntese
ficam em `<slug>.metrics.json`.

A melhoria de pronúncia só é considerada aprovada editorialmente após
comparar o áudio novo com o anterior. O roteiro de narração/podcast é
um projeto separado e não está incorporado neste fluxo.

Fontes:
- https://github.com/thewh1teagle/kokoro-onnx/blob/main/examples/portuguese.py
- https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md

### Separadores sem fonemas (correção de robustez)

O eSpeak pode retornar fonemas vazios para pontuação isolada entre trechos
multilíngues (ex.: `Backoff / jitter`). O adapter Kokoro aceita resultado vazio
**apenas quando o trecho não possui caracteres alfanuméricos**, omitindo o
separador na sequência IPA. O texto original e `(block_index,sentence_index)`
permanecem intactos, sem gerar chunk/capítulo extra. Palavra com fonemização
vazia continua sendo erro. Regressão baseada nos jobs de
`github-governance-as-code` e `retries-backoff-jitter` do backfill
[#39883809928](https://github.com/joaovpimenta/tech-topics/actions/runs/39883809928).

A pausa atual de geração continua em vigor; esta correção não dispara síntese.

## Sincronização seletiva após alterações editoriais

A validação Pages, tanto em `push` quanto em `workflow_dispatch`, executa
`article_selection.py --spoken-changes` entre o SHA do último job
`Deploy GitHub Pages` bem-sucedido e a revisão atual. O baseline considera
o resultado desse job mesmo se uma etapa posterior do workflow falhar; se não
houver SHA verificável na história atual, a validação bloqueia o deploy.
Compara
texto narrável, spans de idioma e pausas,
sem executar Kokoro. Imagem, CSS, metadados, diagrams ou conteúdo ignorado
pelo TTS não criam novos jobs. Depois de deploy bem-sucedido, somente
`refresh_existing=true` vindo do Pages em `main` é autorizado:
revalida o diff e agenda **um job por slug alterado** com
`replace_existing=true`, limitado a 2 em paralelo. Antes de substituir,
guarda a Release antiga em Artifact por 90 dias; publica juntos MP3 e
`chapters.json` v2, verificando ambos. A exceção não libera
workflow_dispatch, backfill nem geração de novos artigos. Acompanhe
[issue #75](https://github.com/joaovpimenta/tech-topics/issues/75).

### Congelamento de efeitos durante a migração Markdown

Pages expõe `generate_audio` e `advance_topic`; Kokoro expõe `generate_audio`
e a fila expõe `advance_topic`, todos como booleanos com default `false`. O
caller Pages envia explicitamente `false`. Durante a migração, uma condição
global literal `false` nos jobs de
efeito bloqueia qualquer entrada, inclusive `workflow_dispatch`, `issue_comment`
e `workflow_call`; informar `true` não pode liberar o job. A validação, o
deploy e os cálculos de inventário e alterações narráveis continuam ocorrendo.
Falhas desses gates continuam falhando o job de validação e, portanto, não
chegam ao deploy.

Ao restaurar permissões, primeiro revise e remova a condição global apenas em
uma mudança aprovada, preserve os defaults `false` e confira que todos os
callers passam as flags explicitamente. Audite runs anteriores à mudança e
jobs ainda em voo no painel Actions; não use rerun de uma execução antiga,
pois ela executa a definição de workflow associada à revisão original. Cancele
ou aguarde os jobs em voo antes da retomada e reconcilie Releases e fila em
leitura. Os workflows de seleção e Kokoro deixaram de constar em
`paths-ignore` de Pages para que mudanças na política sejam propagadas; as
condições globais seguem sendo a barreira efetiva. O gate de deploy real fica
pendente até a integração autorizada e uma execução Pages posterior.

## Inventário do piloto v2

Os leitores aceitam fontes planas e `articles/<slug>/article.md` durante o [piloto #143](specs/article-v2-pilot.md). Rename, capa, links ou sumário não equivalem a mudança de fala. O gate global de síntese continua desligado, e capítulos/MP3 existentes são consultados apenas em leitura para a auditoria.
