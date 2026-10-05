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
