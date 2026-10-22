# Kokoro Dora — narração automática e manual com PT-BR + inglês

O Tech Topics usa **somente Kokoro-82M v1.0 (FP32 / ONNX)**, voz
`pf_dora`, CPU em GitHub Actions. Velocidade `0.95`, áudio mono
24 kHz, MP3 96 kbps normalizado para -19 LUFS (TP -1 dB).
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
| Velocidade | 0.95 |
| Blocos de síntese | até ~240 caracteres, evitando cortes de palavra |
| Pausa dentro do bloco | 180 ms |
| Pausa ao final de parágrafo | 450 ms |
| Pausa após título ou seção | 800 ms |
| Áudio interno | WAV PCM mono 24 kHz |
| Publicação | MP3 96 kbps, -19 LUFS, TP -1 dB |
| Infraestrutura | GitHub-hosted Ubuntu, CPU 4 threads, timeout 60 min |

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
- **`publish`**: sintetiza o artigo completo e cria uma Release.
  Se ela já existe, é preservada; `replace_existing=true` permite
  substituir somente quando solicitado manualmente.
- **`compare`**: produz nove amostras curtas para escuta, cruzando
  três configurações de prosódia e velocidades 0.95/1.00/1.05;
  não publica nem substitui Releases (detalhes abaixo).
- **`profile`**: sintetiza **o artigo completo uma única vez**, ainda de forma
  sequencial, sem gerar MP3, sem criar/substituir Release e sem executar um
  benchmark paralelo automaticamente. Salva `<slug>.cpu-profile.json`,
  `<slug>.metrics.json` e `<slug>.chapters.json` como artefato de Actions
  por 14 dias e mostra resumo em **GITHUB_STEP_SUMMARY**.
  O relatório amostra a cada segundo CPU da inferência nativa,
  afinidade/quota efetiva do runner, RSS máximo e tempos por segmento.
  Um indicador conservador aponta se vale **investigar** 2 instâncias;
  não significa que paralelismo já traga ganho.

Exemplo para testar a palavra *Bulkhead*: `article=bulkhead`,
`mode=preview`. Para atualizar o áudio antigo depois de ouvi-lo:
`article=bulkhead`, `mode=publish`, `replace_existing=true`.

## Comparação rápida de prosódia e velocidade — somente Dora

O modo manual `compare` prepara **apenas o título falado e o primeiro
parágrafo `<p>` do corpo do artigo** (a introdução metafórica). Não inclui
o `dek`, chamadas laterais nem qualquer parágrafo posterior. Usa o mesmo
Kokoro ONNX FP32, fonemização bilíngue e voz fixa **`pf_dora`** em
**nove amostras curtas**, cruzando:

| Pausas/chunking | Velocidades |
|---|---|
| `atual`: parágrafo 0,45 s; chunk 0,18 s; split atual até 240 caracteres | `0.95`, `1.00`, `1.05` |
| `equilibrado`: parágrafo 0,38 s; chunk 0,14 s; frases inteiras, máximo 320 caracteres | `0.95`, `1.00`, `1.05` |
| `fluido`: parágrafo 0,30 s; chunk 0,10 s; frases inteiras, máximo 320 caracteres | `0.95`, `1.00`, `1.05` |

Os perfis também ajustam `sentence_pause`/`clause_pause` do
`kokoro-onnx` para `0.25/0.10`, `0.22/0.08` e `0.18/0.06`
segundos, respectivamente. Essas pausas internas **só são relevantes
quando a biblioteca divide fonemas em batches**; não são parâmetros
de emoção e podem não alterar trechos curtos.

No `mode=compare`, **todos os três presets** usam divisão por frases:
cada sentença que caiba em 320 caracteres vira uma única chamada de síntese,
independentemente de ter 90, 240 ou 315 caracteres. Só quando uma
**sentença ultrapassa 320 caracteres**, o pipeline tenta dividir na
**última vírgula/ponto e vírgula/dois-pontos** seguros antes do teto.
Se não houver pontuação interna adequada, usa uma fronteira entre palavras,
nunca corta o meio de uma palavra. Na emenda em vírgula, a pausa artificial
é limitada a 20 ms, evitando uma respiração duplicada sobre a pontuação.

320 caracteres são **um teto editorial**, não o limite real do modelo:
antes da inferência no `compare`, o pipeline conta os **tokens reais
do fonemizador de PT-BR/EN-US** via tokenizer do Kokoro. Se ultrapassar
450 tokens (margem para o contexto de ~510), divide novamente e valida;
não confia apenas no número de caracteres. Preserva o `block_index`
dos parágrafos, permitindo a navegação futura pelo player.

A linha `atual` no comparativo mantém as **pausas e velocidades de
produção**, mas usa o **novo corte por frases** para que as nove amostras
sejam comparáveis. Os nove arquivos do experimento anterior continuam
guardados no artefato da respectiva execução, como referência da mudança.
O fluxo `publish` e o `profile` **não mudam seu segmentador existente**
até que a melhoria seja aprovada auditivamente.

**Para ouvir**: depois que esta alteração estiver na branch
`main`, abra Actions → **Publish Tech Topics audio (Kokoro Dora)**,
selecione `article=bulkhead`, `mode=compare`,
`replace_existing=false`. A Action reutiliza a sessão ONNX, exporta
os nove MP3s com o mesmo tratamento `ffmpeg`, publica um único artefato
`kokoro-dora-compare-bulkhead-<run_id>` (14 dias) e escreve a tabela
com os tempos no resumo da execução. Não altera nenhuma Release.
Os nomes são `atual-095/bulkhead.mp3`,
`equilibrado-100/bulkhead.mp3`, `fluido-105/bulkhead.mp3`, etc.
A escolha final deve considerar naturalidade das frases, transições,
pronúncia e ritmo, antes de qualquer mudança na narração padrão.

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
faz skip por padrão. `preview` e `profile` são solicitações manuais
intencionais e podem rodar um artigo existente; `publish` só substitui
áudio existente com `replace_existing=true`. A checagem de Release é
repetida no início do job como proteção contra duas execuções concorrentes.

## Como analisar possível paralelismo dentro do runner

1. Execute **Run workflow → main**, `article=bulkhead`,
   `mode=profile` (uma medição de referência por artigo; não publique áudio).
2. Abra a execução e leia o resumo de CPU/RSS. Baixe o artefato
   `kokoro-cpu-profile-bulkhead-<run_id>` para ver as amostras ao longo
   do tempo, inferências por segmento e o fator de tempo real.
3. Se CPU p90 estiver abaixo de 75% e média abaixo de 55% do orçamento
   do runner, com amostras suficientes, vale criar **outro experimento**
   com duas instâncias limitadas a 1–2 threads cada, comparando tempo
   total, memória e qualidade. Caso contrário, não há indício suficiente
   de CPU ociosa. Três instâncias não devem ser padrão sem números.

O modo normal continua com um único Kokoro CPU FP32 e `pf_dora`.
O profiling não ativa multiprocessamento nem muda o áudio.

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
FP32 é carregado uma vez por artigo. A medição de tempo de inferência
fica em `<slug>.metrics.json`.

A melhoria de pronúncia só é considerada aprovada editorialmente após
comparar o áudio novo com o anterior. O roteiro de narração/podcast é
um projeto separado e não está incorporado neste fluxo.

Fontes:
- https://github.com/thewh1teagle/kokoro-onnx/blob/main/examples/portuguese.py
- https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md
