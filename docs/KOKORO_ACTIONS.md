# Kokoro Dora no GitHub Actions — narração editorial em PT-BR

O Tech Topics utiliza **Kokoro-82M v1.0 (ONNX FP32)** com **pf_dora**, eSpeak G2P
`pt-br`, velocidade `0.95`, execução em CPU, sem GPU nem API externa.

## Preset editorial

| Parâmetro | Valor |
|---|---|
| Voz única | `pf_dora` para todo o artigo |
| Fonemização | `EspeakG2P(language="pt-br")` |
| Precisão | `kokoro-v1.0.onnx` FP32 |
| Velocidade | `0.95` |
| Segmentação | até 240 caracteres por síntese, priorizando pontuação e palavras |
| Pausa dentro do parágrafo | 180 ms |
| Pausa depois de parágrafo | 450 ms |
| Pausa após seção/título | 800 ms |
| WAV intermediário | 24 kHz, 16-bit PCM mono |
| MP3 | 96 kbps mono, normalização -19 LUFS / pico -1 dBTP |
| CPU | 4 threads de inferência, runner Ubuntu, timeout de 60 min |

As pausas, a normalização de volume e a compressão são implementadas no pipeline;
o Kokoro não possui um botão nativo chamado "narração editorial".

O texto é extraído por `tools/tts/precommit.py`, com o mesmo léxico
`content/tts-lexicon.json`, `speechMarkup` e ignorando menus, blocos de
código e outros componentes não narrativos. As tags `lang="en-US"` **não**
causam troca de voz: Dora pronuncia o texto inteiro com G2P brasileiro.
Revise especialmente termos ingleses e siglas.

## Geração automática

Após um **deploy bem-sucedido do Pages** em push na `main`,
[pages.yml](../.github/workflows/pages.yml) chama
[kokoro-audio.yml](../.github/workflows/kokoro-audio.yml).
A seleção encontra **apenas artigos JSON novos**, não edições.
O áudio é publicado na Release `tts-<slug>` com asset `<slug>.mp3`.

**Proteção de histórico:** Releases existentes não são sobrescritas na
publicação automática. A Release de `bulkhead`, produzida com Piper, permanece
intacta até aprovação humana explícita de uma substituição.

O workflow antigo [Piper](../.github/workflows/piper-audio.yml) permanece
disponível manualmente como fallback; ele não é mais invocado
automaticamente em novos deploys.

## Comparação A/B antes de substituir o áudio

[Compare Kokoro Dora versus Piper Cadu](../.github/workflows/kokoro-compare.yml)
roda nas Pull Requests relacionadas a Kokoro e pode ser iniciado manualmente.
O job prepara **a mesma amostra de ~1.200 caracteres** de `bulkhead` para:
- Kokoro Dora FP32, 0.95;
- Piper Cadu medium.

Os dois MP3s usam o mesmo alvo de volume e bitrate de 96 kbps.
As métricas objetivas de tempo de síntese, duração e fator tempo-real aparecem
na seção **Job summary**; os arquivos e o roteiro ficam em
**Artifacts → tts-compare-bulkhead-<run id>**, por 14 dias.

O teste não afirma superioridade de um modelo. A avaliação auditiva de
pronúncia, sotaque, naturalidade e transições ainda é humana.
Um trecho curto reduz custo, mas não substitui o teste de artigo completo.

## Execução manual

Abra [Publish Tech Topics audio (Kokoro Dora)](https://github.com/joaovpimenta/tech-topics/actions/workflows/kokoro-audio.yml)
em **Actions → Run workflow**, selecione `main`, informe o slug (por exemplo
`bulkhead`) e um modo:

- `compare` (padrão): gera MP3s comparáveis Kokoro/Piper **apenas como
  artifacts**, sem publicar nem sobrescrever Releases.
- `publish`: sintetiza **todo o artigo** e cria a Release `tts-<slug>`.
  Se a Release já existir, por padrão ela fica inalterada; marque
  `replace_existing=true` **somente após ouvir e aprovar** o novo MP3.

## Custo e segurança operacional

A workflow usa `actions/cache` para guardar modelo FP32 (~326 MB)
e arquivo de vozes (~28 MB), fixados nos assets oficiais `model-files-v1.1`.
Dependências Python com versões fixas: `kokoro-onnx==0.6.1`,
`misaki-fork==0.9.6`, `phonemizer-fork==3.3.2`,
`espeakng-loader==0.2.4`, `soundfile==0.13.1`. Precisa de
`espeak-ng` e `ffmpeg` no runner. Nenhuma chave de serviço externo é
necessária. `GITHUB_TOKEN` publica Releases com permissão `contents:write`.
Revisar tempos reais em Jobs e o uso do GitHub Actions antes de aumentar volume
de geração. Modelo carregado **uma vez por artigo**, não por parágrafo.

Modelo Kokoro: Apache 2.0. Pacote `kokoro-onnx`: MIT.

Fontes de implementação:
- https://github.com/thewh1teagle/kokoro-onnx/blob/main/examples/portuguese.py
- https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1
- https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md
