# Navegação operacional

## Início

Execute `node scripts/doctor.mjs --json` para obter pré-requisitos, diagnósticos e comandos disponíveis. `.node-version` declara a versão usada na CI; Node mais novo é diagnosticado como aviso de reprodutibilidade. Python é opcional para tarefas do site; a CI instala a versão de `.python-version` para exigir os testes rápidos do TTS.

Leia somente o ramo que corresponde à tarefa:

- **Artigo:** fluxo editorial de `AGENTS.md`; o compositor lista catálogo e módulos sem carregar artigos completos.
- **Build, workflows ou publicação:** [PUBLISHING.md](../PUBLISHING.md). `scripts/validate-site.mjs` valida e gera; `scripts/build-site.mjs` empacota o estado já gerado em `dist/`.
- **Fila ou seleção:** [TOPIC_QUEUE.md](../TOPIC_QUEUE.md). A consulta JSON da fila não publica comentários; mantenha curadoria e seleção separadas.
- **Narração local ou hook:** [tools/tts/README.md](../../tools/tts/README.md); pronúncia do navegador está em [TTS.md](../TTS.md).
- **Issues, spec ou manutenção:** [issue-tracker.md](issue-tracker.md) e [spec aprovada](../specs/agent-automation.md).

## Mapa de mudanças

- `content/articles/` e `assets/<slug>/`: conteúdo e recursos específicos. A validação constrói o manifesto; não o edite manualmente.
- `generation/`: contratos compactos de escrita e registry allowlisted.
- `scripts/lib/`: regras compartilhadas de contratos, geração, fila e empacotamento. Teste pela interface usada pelos comandos.
- `scripts/`: entrypoints e suites determinísticas; `validate-site.mjs` coordena os gates usados localmente e na CI.
- `.github/workflows/`: eventos, permissões e encadeamento; lógica de conteúdo permanece nos módulos testados.
- `tools/tts/` e `.githooks/`: rotina local de narração; dados privados ficam em `.local/`.
- Arquivos JS/HTML/CSS na raiz: navegador, PWA e layout editorial.

## Verificação e entrega

Preserve alterações locais anteriores. Rode o comando único após integrar mudanças. Ele gera `content/articles/index.json`, `sw-version.js` e o pacote ignorado `dist/`; sucesso local não confirma publicação. Verifique os checks do PR e o deploy antes de declarar a mudança publicada. Registre testes pulados e falhas separadamente.

As revisões de rigor factual, metáfora, aparência de aquarela e qualidade da voz continuam exigindo julgamento. Automação não equivale a essas revisões.

## Narração Dora e estado das decisões

- **Implementação e modos da Action:** [KOKORO_ACTIONS.md](../KOKORO_ACTIONS.md);
  `tools/tts/kokoro_release.py` prepara spans bilíngues, monta
  chunks e sintetiza; `test_kokoro_release.py` valida texto e orçamento.
- **Decisão de áudio/prosódia e codec:** [ADR 0001](../adr/0001-kokoro-dora-prosody-and-encoding.md);
  **skip de publicação, workflow e CPU:** [ADR 0002](../adr/0002-publish-skip-and-kokoro-cpu.md);
  **player único (proposto):** [ADR 0003](../adr/0003-unified-audio-player-paragraph-sync.md).
- **Handoff consolidado:** [issue #56](https://github.com/joaovpimenta/tech-topics/issues/56).
  Verifique as PRs abertas antes de agir; a decisão auditiva
  `equilibrado-100` não é autorização para substituir MP3s.
- **Verificação:** `mode=compare` não publica Releases e pode criar
  comparações de bitrate sem inferência adicional. Execute a validação
  do projeto e, após CI verde, obtenha avaliação humana do áudio.
