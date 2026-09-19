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
- validade dos JSONs;
- funcionamento dos links externos relevantes;
- ausência de `<script>`, handlers inline e URLs `javascript:` no conteúdo;
- marcação de idioma conforme `docs/TTS.md`;
- ausência de referências a arquivos temporários ou URLs de download expirável.
- cada campo `image` aponta para `assets/<slug>-cover.jpg`, sem capa SVG;
- cada capa e ilustração conceitual foi revisada como pintura em aquarela editorial visível, e não apenas como vetor ou filtro que simula aquarela;
- o mapeamento entre artigo, slug e capa é um-para-um, sem deixar a capa de um artigo apontar para outra cena.

Execute também:

```sh
node --check app.js
node --check article.js
node scripts/test-pwa.cjs
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
