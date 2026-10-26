# Sistema de geração

Esta pasta contém somente conhecimento que precisa entrar no contexto do modelo ao escrever um artigo.

- `tasks/`: define a intenção e a estrutura cognitiva da entrega;
- `frameworks/`: adiciona perguntas próprias dos domínios selecionados;
- `editorial/AUTHORING.md`: reúne decisões editoriais subjetivas que a CI não consegue garantir;
- `registry.json`: é a allowlist versionada dos módulos disponíveis.

Não concatene a pasta inteira. Liste tasks, frameworks e os resumos dos temas publicados com `node scripts/compose-article-brief.mjs --list`. Leia um artigo completo só quando houver possível sobreposição. Depois gere um brief mínimo com:

```sh
node scripts/compose-article-brief.mjs \
  --topic "Circuit Breaker" \
  --task explain-concept \
  --framework distributed-systems \
  --framework backend \
  --depth advanced
```

O comando escreve o brief em stdout. Ele não chama um provedor de LLM, não cria arquivos e não persiste o prompt composto.

O formato preparado para artigos é `content/articles/<slug>.md` com `templates/article.md`. Até a ativação HTML em #97, use Markdown somente em fixtures e previews da migração: o build público vigente ainda lê JSON e ignora `.md`. A descoberta compartilhada lê Markdown e JSON legado durante a transição, rejeita dois arquivos para o mesmo slug e valida vínculos de série e pré-requisitos no corpus combinado. Tags de Markdown são obrigatórias e devem usar IDs de `taxonomy/tags.json`; rótulos repetidos não são aliases. O template contém placeholders intencionais e não pode ser publicado sem preenchimento. `updatedAt` é opcional: inclua somente quando uma fonte sustentar a data.

Após finalizar a abertura, use `node scripts/compose-cover-brief.mjs` para extrair de `docs/VISUAL_STYLE.md` apenas as instruções necessárias para criar e revisar a capa.

## Onde cada regra deve ficar

- Decisão que exige julgamento durante a escrita: `editorial/AUTHORING.md` (inclusive fala de código inline e significado contextual de setas).
- Lente analítica reutilizável de um domínio: `frameworks/`.
- Forma de organizar um tipo de entrega: `tasks/`.
- Invariante objetiva: script de lint ou teste, com explicação humana em `docs/`.
- Direção detalhada para gerar e revisar a capa: `docs/VISUAL_STYLE.md`.

Evite copiar uma regra entre essas camadas. O brief aponta para a validação final, mas não repete a implementação do lint.
