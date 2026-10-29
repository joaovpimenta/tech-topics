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

Ao final, o comando constrói e valida um pacote HTML temporário. Esse preview aceita fontes editoriais ainda não commitadas e não altera `dist/`. O empacotamento usa uma allowlist, verifica referências locais e preserva os caminhos relativos. Documentação, instruções de geração, scripts e ferramentas locais não fazem parte do deploy. O conjunto público é distinto do precache: um download local pode ser publicado sem ser baixado antecipadamente pela PWA.

`node scripts/build-site.mjs` constrói o pacote de produção em `dist/` e exige que fontes, taxonomia, léxico e assets editoriais coincidam com o `sourceSha`; a CI chama esse build no commit validado. O build de produção também exige histórico Git completo para recuperar o `addedAt` original; checkouts rasos falham, então jobs que constroem `dist` usam `fetch-depth: 0`. O preview local pode usar o catálogo anterior quando o histórico não estiver disponível. Para inspecionar fontes locais ainda não commitadas, gere um preview descartável com `node scripts/build-markdown-preview.mjs --output-dir <novo-diretório-dentro-do-temp-do-sistema>`. A CI exige os testes rápidos do TTS, sem síntese ou modelos; localmente são pulados com diagnóstico explícito quando Python não está disponível. Use `TECH_TOPICS_PYTHON` para indicar outro interpretador.

O build reconstrói o catálogo leve com todos os artigos, ordenados do mais novo para o mais antigo, e atualiza os dados necessários ao cache da PWA. A mesma sequência é usada nas workflows de Pull Request e de GitHub Pages.

Não edite manualmente `sw-version.js` quando ele for artefato gerado pelo build. O antigo índice de artigos foi removido.

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

Para alterações no player, execute também `node scripts/test-speech-browser.cjs` com Playwright e Chromium disponíveis. O teste cobre a página real em desktop e celular e usa síntese simulada para navegação e sincronização; a qualidade da voz exige escuta real. `TECH_TOPICS_PLAYWRIGHT` aceita o caminho do módulo Playwright e `TECH_TOPICS_CHROMIUM` o executável do navegador. Sem Playwright, o comando informa explicitamente que pulou o teste.

Para auditar a interface, instale o pacote Python `playwright==1.57.0` e o navegador (`python -m playwright install chromium`), gere `dist/` e execute `python scripts/test-ui-browser.py`. A suíte percorre larguras de 320 a 1920 px, verifica geometria e interações e inclui testes de toque. Defina `TECH_TOPICS_UI_SCREENSHOTS` como um diretório para guardar capturas. A CI anexa essas imagens ao job de navegador; a revisão visual continua necessária para avaliar legibilidade e estética.

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

Antes do deploy, tanto `push` quanto `workflow_dispatch` resolvem a revisão do último job `Deploy GitHub Pages` concluído com sucesso, mesmo que outro job posterior daquele workflow tenha falhado. No dispatch, a revisão selecionada também precisa ser o HEAD atual da `main`; um ref manual diferente ou ultrapassado falha fechado. Se não houver SHA anterior verificável ou ele não pertencer à história atual, a validação falha e bloqueia o deploy; não invente uma baseline vazia. Na publicação agendada, o job reutilizável `Select next Tech Topics article` escolhe a próxima pauta da [fila editorial](TOPIC_QUEUE.md) **após o deploy bem-sucedido do Pages** e somente se o inventário `.md` entre esse deploy anterior e a revisão atual contiver um slug novo. Em `html-v1`, o caller fixa o SHA da fonte e o `buildId` do pacote; reruns do mesmo artefato não criam outra seleção. Mudanças apenas de código ou documentação não acionam a seleção. Confirme o estado dessa Action e o comentário de seleção; se a fila estiver vazia, registre a limitação sem confundir o status do deploy do artigo com o preparo da próxima execução.

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

A workflow `Validate Tech Topics` executa em Pull Requests e sob acionamento manual. Em pushes relevantes para o site na `main`, a workflow de Pages executa a mesma validação, constrói o pacote de produção no mesmo SHA e o envia para deploy sem reconstruí-lo na etapa de deploy. Pushes que modificam exclusivamente documentação, instruções de geração (exceto `generation/taxonomy/tags.json`, consumido pelo catálogo público), ferramentas TTS ou o workflow de validação `.github/workflows/validate.yml` não disparam um novo build do site. Mudanças nos workflows Kokoro e de seleção de pauta continuam acionando Pages para que mudanças de política sejam propagadas.

Os checks de PR executam a validação em Ubuntu, usando a versão declarada em `.node-version`; a proteção de branch continua exigindo `Content and application lint`. A workflow de Pages envia somente `dist/`. O build desta etapa compila o catálogo `html-v1` e um HTML por slug diretamente das fontes `.md`; fontes individuais e o antigo `content/articles/index.json` ficam fora do pacote. O inventário corrente rejeita artigos JSON. A seleção automática da fila ocorre apenas após inclusão de novo slug `.md`; mudanças de código, CSS ou JavaScript não autorizam outra seleção e não reprocessam a narração publicada. Os efeitos de áudio e fila continuam bloqueados.

A proteção da `main` exige o check estável `Content and application lint`. Esse check agrega a matriz do PR e só passa quando todas as plataformas passam; não renomeie sem atualizar a proteção correspondente.

O lint automatiza regras estruturais e de segurança. Rigor factual, qualidade da metáfora, correspondência entre abertura e capa e aparência de aquarela continuam sendo critérios editoriais que precisam de revisão humana ou visual.

## Rotas e piloto de autoria v2

A #143 permite corpus misto durante o [piloto Bulkhead](specs/article-v2-pilot.md). O pacote gera `<slug>/index.html`, mantém o transporte `content/articles/<slug>.html` e copia a capa v2 para a URL pública anterior em `assets/`. Visite também a rota limpa e o link legado com hash, sob raiz e `/tech-topics/`; `python scripts/test-pilot-routes-browser.py` cobre esses caminhos. A política offline preserva o conteúdo previamente visitado, sem pré-carregar o acervo inteiro.
