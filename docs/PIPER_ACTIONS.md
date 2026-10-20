# Publicação de áudio com Piper TTS

O Tech Topics publica áudio **MP3 em português brasileiro** com a voz
`pt_BR-cadu-medium` do Piper 1.8.0, usando **somente CPU** no GitHub Actions.

O extrator de `tools/tts/precommit.py` é reutilizado; ele lê os JSONs em
`content/articles/<slug>.json`, respeita o léxico e as marcas de pronúncia
definidas em [TTS.md](TTS.md), e exclui código, navegação e visuais não narrativos.
O Piper não alterna automaticamente para vozes inglesas nas marcações `lang`;
termos técnicos devem ser revisados pelo ouvido. O fluxo local de Chatterbox
e o player do navegador permanecem independentes.

## Publicação automática

A workflow [Build and deploy Tech Topics to GitHub Pages](../.github/workflows/pages.yml)
chama [Publish Tech Topics audio (Piper)](../.github/workflows/piper-audio.yml)
**depois que o deploy de Pages termina com sucesso** em pushes para `main`.
Somente arquivos JSON **adicionados** em `content/articles/` no push são
selecionados; edições em artigos antigos e mudanças em `index.json` não
disparam nova narração. Se o push acrescentar vários artigos, há uma
execução por artigo. A publicação de Pages não espera pela qualidade auditiva
do áudio, que deve ser avaliada separadamente.

Cada artigo recebe uma release estável com tag `tts-<slug>` e arquivo
`<slug>.mp3` em [Releases](https://github.com/joaovpimenta/tech-topics/releases).
Uma release já existente não é recriada automaticamente. Os arquivos
originais dos artigos e a página pública não são alterados.

## Execução manual

1. Abra [Actions → Publish Tech Topics audio (Piper)](https://github.com/joaovpimenta/tech-topics/actions/workflows/piper-audio.yml).
2. Clique em **Run workflow**, escolha a branch `main` e informe o **slug**
   do artigo — por exemplo, `bulkhead`, sem `.json`.
3. Para substituir um áudio publicado, ative **Substituir o MP3 caso a release
   já exista**. Caso contrário, a workflow não modifica a release existente.
4. Consulte a execução e baixe o MP3 em **Releases** (tag `tts-<slug>`).

Os runners do GitHub executam Piper em CPU. Não são necessários token externo
nem credenciais do Hugging Face: os pesos da voz são públicos. O workflow usa
`GITHUB_TOKEN` com permissão `contents: write` para publicar releases.
A voz ONNX (~63 MB) é mantida em cache entre execuções; o MP3 é comprimido em
mono a 64 kbps com ffmpeg. Cada execução sintetiza em arquivo temporário e
não adiciona áudio ao histórico Git.

**Operação:** nenhuma release foi gerada apenas pela instalação da workflow.
Execute manualmente para verificar qualidade, pronúncia e tempo de síntese de
um artigo real antes de depender dela para publicação sem revisão.
Se a política de Actions desabilitar escrita com `GITHUB_TOKEN`, será
necessário ajustar a permissão do repositório.
