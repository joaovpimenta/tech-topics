# Tech Topics

Este repositório mantém o site Tech Topics e seus artigos.

Ao criar um artigo, não carregue toda a documentação no contexto por padrão. Primeiro componha o brief mínimo com `scripts/compose-article-brief.mjs`, escolhendo uma task e de um a três frameworks do registry. Esse brief é o contrato ativo de escrita e inclui apenas as lentes selecionadas.

Consulte os documentos detalhados somente na etapa em que forem necessários:

1. `docs/EDITORIAL.md` para escopo, pesquisa e revisão humana;
2. `docs/VISUAL_STYLE.md` antes de gerar ou revisar a capa;
3. `docs/ARTICLE_FORMAT.md` ao investigar formato ou renderização;
4. `docs/TTS.md` para decisões de pronúncia e marcação multilíngue;
5. `docs/PUBLISHING.md` antes de concluir e publicar.

`generation/` contém instruções compactas para o modelo; `docs/` explica as políticas; scripts de lint e testes garantem invariantes objetivas. Não copie a mesma regra entre camadas. Quando uma regra objetiva mudar, altere primeiro sua validação e depois a documentação humana correspondente.

## Princípios

- Escreva os artigos em português brasileiro.
- Não substitua, remova nem edite artigos existentes durante a criação de um novo artigo, salvo instrução explícita.
- Evite temas já cobertos, inclusive equivalentes semânticos, sinônimos e variações superficiais.
- Preserve compatibilidade com GitHub Pages, o layout editorial e a identidade visual existentes.
- O conteúdo deve ser tecnicamente rigoroso, didático e fundamentado em fontes confiáveis.
- Antes de gerar capas ou ilustrações conceituais, siga `docs/VISUAL_STYLE.md`.
- Toda capa e toda ilustração conceitual deve ser uma pintura em aquarela editorial visível, seguindo integralmente o style anchor de `docs/VISUAL_STYLE.md`. Essa é uma regra permanente: o formato do arquivo, filtros ou formas planas não transformam uma arte vetorial em aquarela.
- Use JPG raster para capas e ilustrações conceituais. Use blocos Mermaid para diagramas técnicos e gráficos estruturais. Reserve SVG para favicon e ícones compartilhados; não crie ou versione SVGs de diagramas.
- Siga as regras de acessibilidade, composição visual e text-to-speech documentadas.
- Não declare recursos, interações, imagens, simuladores ou arquivos que não existam de fato.
- Não altere o carregador compartilhado ou a arquitetura comum do site sem instrução explícita quando a tarefa for apenas criar um artigo.

## Execução

- Liste tasks e frameworks disponíveis com `node scripts/compose-article-brief.mjs --list`.
- Gere o brief em stdout e use somente os módulos selecionados; não concatene a pasta `generation/` inteira nem persista o brief no repositório.
- Se houver um assunto explícito para a execução, use-o apenas se ainda não tiver sido coberto conforme `docs/EDITORIAL.md`.
- Caso contrário, escolha um novo tema relevante dentro do escopo editorial.
- Trate o repositório como fonte de verdade para formato, build, validação e publicação.
- Antes de concluir, execute as verificações obrigatórias definidas em `docs/PUBLISHING.md`.
- Uma tarefa só está concluída quando as validações obrigatórias passaram e o estado da publicação foi verificado.


## Validação automatizada

A qualidade estrutural dos artigos é validada por `scripts/lint-articles.mjs` e pelos testes do projeto. A workflow `Validate Tech Topics` roda em Pull Requests e na `main`; não considere um artigo pronto enquanto essa validação não passar. Regras subjetivas, como rigor factual, qualidade da metáfora e aparência de aquarela, continuam exigindo revisão editorial ou visual humana.
