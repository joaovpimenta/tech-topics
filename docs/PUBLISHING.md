# Build, validação e publicação

## Build

Depois de adicionar um novo artigo, execute:

```sh
node scripts/build-articles.mjs
```

O comando reconstrói o manifesto com todos os artigos, ordenados do mais novo para o mais antigo, e atualiza os dados necessários ao cache da PWA.

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
- ausência de referências a arquivos temporários ou URLs de download expirável.
- cada campo `image` aponta para `assets/<slug>/<slug>-cover.jpg`, sem capa SVG;
- cada capa e ilustração conceitual foi revisada como pintura em aquarela editorial visível, e não apenas como vetor ou filtro que simula aquarela;
- o mapeamento entre artigo, slug e capa é um-para-um, sem deixar a capa de um artigo apontar para outra cena.

Execute também:

```sh
node --check app.js
node --check article.js
node scripts/lint-articles.mjs
node scripts/test-pwa.cjs
node scripts/test-fgs.cjs
```

Execute outros testes específicos do projeto quando existirem ou quando a alteração afetar a funcionalidade coberta por eles.

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
- arquivos gerados correspondem ao estado atual do conteúdo.
- nenhuma capa nova foi publicada sem passar pelo critério permanente de aquarela de `docs/VISUAL_STYLE.md`.

## Publicação

Publique na branch `main` com mensagem de commit descritiva, conforme o fluxo vigente do repositório.

O workflow do GitHub Pages deve terminar com sucesso antes de declarar a publicação concluída.

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


## Validação de diagramas Mermaid

Antes de publicar, execute também `node scripts/test-diagrams.cjs`. A verificação deve confirmar que:

- todo artigo tem pelo menos um diagrama Mermaid quando houver visual técnico;
- não há `<svg>` inline nem referência a `.svg` no `bodyHtml`;
- cada diagrama tem fonte Mermaid e fallback correspondente;
- não há SVG técnico em `assets/<slug>/`;
- o carregador compartilhado inclui `mermaid-theme.js`;
- capas JPG, favicon e ícones continuam referenciados corretamente.



## Esteira de validação

A workflow `Validate Tech Topics` executa em Pull Requests e em pushes para `main`. Ela roda o build, o lint determinístico, a verificação de sintaxe JavaScript e os testes funcionais antes que a publicação seja considerada válida. A workflow de Pages possui uma etapa de validação equivalente e só executa o deploy depois que ela passa.

O lint automatiza regras estruturais e de segurança. Rigor factual, qualidade da metáfora, correspondência entre abertura e capa e aparência de aquarela continuam sendo critérios editoriais que precisam de revisão humana ou visual.
