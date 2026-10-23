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

A workflow [Pages](../.github/workflows/pages.yml) chama
[Publish Tech Topics audio (Kokoro Dora)](../.github/workflows/kokoro-audio.yml)
**após o deploy bem-sucedido na `main`**.
Somente novos arquivos `content/articles/<slug>.json` adicionados pelo push
são publicados; mudanças em artigos existentes não refazem áudios.

Cada artigo recebe uma GitHub Release `tts-<slug>` com `<slug>.mp3`
e `<slug>.chapters.json`. O Kokoro grava os instantes de início de cada
bloco narrativo (título, subtítulo, seção ou parágrafo) a partir das amostras
WAV, e publica os mesmos marcadores nas notas da Release. O site consulta
essas notas pela API do GitHub e permite pular ao próximo parágrafo sem
depender de uma requisição JSON cross-origin à hospedagem dos assets.
Releases existentes nunca são substituídas automaticamente.
**Áudios antigos sem esses marcadores continuam tocando, mas não podem
pular parágrafos com precisão até serem regenerados manualmente com
`mode=publish` e `replace_existing=true`.**

## Manual: escolher artigo por nome ou o mais recente

Abra [Actions → Publish Tech Topics audio (Kokoro Dora)](https://github.com/joaovpimenta/tech-topics/actions/workflows/kokoro-audio.yml)
e clique em **Run workflow**, branch `main`.

Campo **article**:

- `bulkhead` ou `Bulkhead`;
- `Four Golden Signals` ou `four-golden-signals`;
- título completo de um artigo;
- **vazio** ou `latest`: escolher o artigo com maior `publishedAt`
  entre os JSONs da `main`; não é o commit mais recentemente editado.

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
entre sentenças agrupadas em chamadas diferentes. No `compare`, as
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
- Os `block_index` da narração permanecem associados aos parágrafos
  originais para o player, mesmo com múltiplos chunks no mesmo parágrafo.
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
`review` e `compare` geram Artifacts sem publicar Releases. O backfill aprovado usa `all_articles=true` com `mode=publish` e `replace_existing=true`: revisa todos os artigos publicados, pula os que já têm schema v2 e guarda backups dos MP3 antigos como Artifacts de 90 dias antes de substituí-los. A migração inicial é disparada uma única vez no merge com marcador `[tts-backfill-v2]`; runs normais do Pages não fazem backfill. Nenhuma Release existente é sobrescrita implicitamente fora dessa operação expressamente aprovada;
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
Ele **não recria o texto editorial**: os artigos existentes já estão
versionados em `content/articles/<slug>.json`; o build apenas indexa
e empacota esses dados.

Quando um push na `main` não adiciona nenhum `content/articles/<slug>.json`
novo, o job de áudio **nem é agendado**. A seleção editorial automática
também só é acionada se o push tocar artigos e de fato adicionar um JSON
novo; mudanças de código, layout ou edição de artigo existente não
selecionam outro tópico. A seleção por comentário autorizado ou
`workflow_dispatch` continua explícita.

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
- [ADR 0003 — Player único e capítulos](adr/0003-unified-article-audio-and-chapter-synchronization.md): decisão implementada na PR #53; sincronização por `block_index`, sujeita à compatibilidade dos capítulos.

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
