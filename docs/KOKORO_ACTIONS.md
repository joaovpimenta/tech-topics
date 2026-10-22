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

Exemplo para testar a palavra *Bulkhead*: `article=bulkhead`,
`mode=preview`. Para atualizar o áudio antigo depois de ouvi-lo:
`article=bulkhead`, `mode=publish`, `replace_existing=true`.

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
