# Build, validação e publicação

## Preparação do artigo

Antes de escrever, consulte os módulos e o catálogo compacto dos temas publicados:

```sh
node scripts/compose-article-brief.mjs --list
```

Componha somente a task e os frameworks aplicáveis ao tema. O brief é emitido em stdout e não deve ser versionado:

```sh
node scripts/compose-article-brief.mjs \
  --topic "Circuit Breaker" \
  --task explain-concept \
  --framework distributed-systems \
  --framework backend \
  --depth advanced
```

O compositor bloqueia IDs desconhecidos, excesso de frameworks, paths fora da allowlist e duplicatas exatas de slug ou título. Leia artigos completos somente nos casos de possível sobreposição; a verificação semântica continua sendo uma decisão editorial.

Depois de escrever o primeiro parágrafo, use `node scripts/compose-cover-brief.mjs` para consultar as instruções de capa extraídas de `docs/VISUAL_STYLE.md`. Revise visualmente a aquarela antes de publicar.

## Comando único de validação

Depois de adicionar o artigo e seus assets, execute:

```sh
node scripts/validate-site.mjs
```

Esse comando executa o build, o lint editorial determinístico, as verificações de sintaxe JavaScript, os testes funcionais e a validação do registry de geração. Ele também verifica os diagramas Mermaid presentes, suas fontes e fallbacks; um artigo sem diagrama não precisa de um visual artificial.

O build reconstrói o manifesto com todos os artigos, ordenados do mais novo para o mais antigo, e atualiza os dados necessários ao cache da PWA. A mesma sequência é usada nas workflows de Pull Request e de GitHub Pages.

Não edite manualmente `content/articles/index.json` ou `sw-version.js` quando eles forem artefatos gerados pelo build.

## Verificações obrigatórias

Confirme, no mínimo:

- presença e tipos de todos os campos do contrato;
- validade de `publishedAt`;
- correspondência entre slug e nome do arquivo;
- ausência de slugs e tópicos repetidos;
- existência da capa e de todos os assets locais usados no corpo;
- os assets específicos de cada artigo ficam em `assets/<slug>/`; a raiz `assets/` contém apenas recursos compartilhados;
- validade dos JSONs;
- funcionamento dos links externos relevantes;
- tabelas largas envolvidas em contêineres próprios de rolagem horizontal, sem overflow horizontal no documento;
- ausência de `<script>`, handlers inline e URLs `javascript:` no conteúdo;
- marcação de idioma conforme `docs/TTS.md`;
- ausência de referências a arquivos temporários ou URLs de download expirável;
- cada campo `image` aponta para `assets/<slug>/<slug>-cover.jpg`, sem capa SVG;
- cada capa e ilustração conceitual foi revisada como pintura em aquarela editorial visível, e não apenas como vetor ou filtro que simula aquarela;
- o mapeamento entre artigo, slug e capa é um-para-um, sem deixar a capa de um artigo apontar para outra cena.

Execute testes adicionais somente quando existirem ou quando a alteração afetar uma funcionalidade não coberta pelo comando único.

## Inspeção da página

Confira a página inicial e o novo artigo em:

`article.html?slug=<slug>`

Verifique em desktop e celular:

- imagens carregadas;
- diagramas legíveis;
- gráficos corretos;
- ausência de conteúdo cortado;
- responsividade;
- em telas pequenas, a página não cria scroll horizontal; apenas tabelas, código, fórmulas e diagramas largos podem rolar dentro do próprio componente;
- texto alternativo e legendas apropriados;
- página exibindo o artigo solicitado, não um fallback.

Quando o artigo contiver marcação multilíngue para TTS, confira também se os trechos com `lang` estão semanticamente corretos. Uma validação completa da troca de voz depende das vozes disponíveis no navegador/dispositivo e deve ser tratada como limitação quando não puder ser reproduzida no ambiente de execução.

## Revisão do diff

Antes de publicar, revise o diff e confirme que:

- nenhum artigo anterior foi substituído, editado ou removido sem instrução explícita;
- nenhum asset anterior foi modificado ou removido sem necessidade;
- apenas arquivos esperados fazem parte da mudança;
- arquivos gerados correspondem ao estado atual do conteúdo;
- nenhuma capa nova foi publicada sem passar pelo critério permanente de aquarela de `docs/VISUAL_STYLE.md`.

## Publicação

Publique na branch `main` com mensagem de commit descritiva, conforme o fluxo vigente do repositório.

O workflow do GitHub Pages deve terminar com sucesso antes de declarar a publicação concluída.

Na publicação agendada, a Action `Select next Tech Topics article` seleciona outra pauta da [fila editorial](TOPIC_QUEUE.md) após o deploy bem-sucedido. Confirme o estado dessa Action e o comentário de seleção; se a fila estiver vazia, registre a limitação sem confundir o status do deploy do artigo com o preparo da próxima execução.

Se ocorrer uma falha:

- informe o problema;
- não declare o artigo como publicado;
- corrija a causa quando estiver dentro do escopo da tarefa e volte a validar.

## Relatório final

Ao concluir uma publicação de artigo, informe brevemente:

- título e slug;
- URL do artigo;
- total de artigos;
- visuais e imagens adicionados;
- validações realizadas;
- limitações relevantes;
- SHA do commit;
- status do deploy.


## Esteira de validação

A workflow `Validate Tech Topics` executa em Pull Requests e sob acionamento manual. Em pushes para `main`, a workflow de Pages executa a mesma validação antes do deploy e publica o artefato validado, sem reconstruí-lo na etapa de deploy.

O lint automatiza regras estruturais e de segurança. Rigor factual, qualidade da metáfora, correspondência entre abertura e capa e aparência de aquarela continuam sendo critérios editoriais que precisam de revisão humana ou visual.
