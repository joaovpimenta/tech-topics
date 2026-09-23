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

Após finalizar a abertura, use `node scripts/compose-cover-brief.mjs` para extrair de `docs/VISUAL_STYLE.md` apenas as instruções necessárias para criar e revisar a capa.

## Onde cada regra deve ficar

- Decisão que exige julgamento durante a escrita: `editorial/AUTHORING.md`.
- Lente analítica reutilizável de um domínio: `frameworks/`.
- Forma de organizar um tipo de entrega: `tasks/`.
- Invariante objetiva: script de lint ou teste, com explicação humana em `docs/`.
- Direção detalhada para gerar e revisar a capa: `docs/VISUAL_STYLE.md`.

Evite copiar uma regra entre essas camadas. O brief aponta para a validação final, mas não repete a implementação do lint.
