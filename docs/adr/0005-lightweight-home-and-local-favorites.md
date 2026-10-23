# ADR 0005 — Catálogo leve e favoritos locais na página inicial

- Status: proposta implementada em Pull Request
- Data: 2026-10-23

## Contexto

A home buscava `content/articles/index.json` e então todos os JSONs completos via `Promise.allSettled()`, só exibindo a lista após a última resposta. O precache da PWA também incluía todos os artigos e capas, aumentando o custo de instalação/atualização.

## Decisão

1. `scripts/build-articles.mjs` passa a gerar `assets/articles-catalog.json` a partir dos artigos validados, contendo somente `slug`, datas, título, categoria, imagem, texto alternativo, `dek`, `excerpt` e tempo de leitura. Não incluir `bodyHtml`, capítulos de áudio, MP3 ou campos do corpo integral.
2. A home realiza uma única requisição ao catálogo compacto e renderiza o primeiro lote de seis artigos imediatamente. Os seguintes são acrescentados sob demanda por `IntersectionObserver`, com botão acessível de fallback. As imagens usam `loading=lazy` fora da primeira dobra.
3. O precache contém arquivos essenciais e o catálogo, **não** JSONs completos de artigos nem capas. Recursos abertos posteriormente podem entrar no cache de runtime existente do service worker. O uso offline de um artigo depende de o recurso ter sido visitado anteriormente.
4. Pesquisa baseada exclusivamente nos metadados já carregados, com campo na barra superior inspirado no padrão de aplicativos móveis. O GitHub mostra o total de **estrelas do repositório** consultado de forma independente e best-effort, com cache local de seis horas.
5. Cada card mantém dois ícones discretos (~80% do tamanho anterior) no **canto inferior direito**: favoritar e compartilhar, sem legendas visíveis. Pressionar e segurar o card por 480 ms abre um menu contextual leve, com resumo e três ações: **Ler artigo** (botão com texto), favorito e compartilhar (ícones). Enquanto mantém o dedo pressionado, a pessoa arrasta até uma ação e solta para executá-la. Soltar fora das ações fecha o menu sem efeito. Movimentar-se antes do tempo limite permite rolar normalmente a página. Com mouse, o gesto segue pressionar-arrastar-soltar; por teclado, Enter/Espaço abre o menu navegável e Escape fecha. Compartilhar usa Web Share API quando disponível, com fallback de cópia de link. A prévia não busca o JSON integral.
6. Favoritos são pessoais, armazenados em `localStorage` sob `tech-topics:favorites:v1`. Os ícones de favorito dos cards bastam; não adicionar filtro/checkbox extra na barra da home. Não existe contador público, sincronização entre dispositivos nem backend. Limpeza dos dados do navegador pode apagar a seleção.

7. O hero da home deve usar pouco espaço vertical, principalmente no mobile. As capas de artigos devem respeitar suas dimensões intrínsecas sem `object-fit: cover` ou recorte, inclusive no menu contextual de toque prolongado. Os ícones menores ficam no canto inferior direito do card, aproveitando a linha de metadados em vez de criar outra linha.

## Consequências e verificação

- A página inicial não deve disparar buscas de `content/articles/<slug>.json` nem download de MP3.
- A instalação/atualização da PWA não deve pré-carregar capas de artigos.
- A publicação de um novo artigo atualiza o catálogo no mesmo build e mantém a ordenação cronológica.
- Testar busca sem acentos, ordenação, favoritos persistidos (sem filtro), exibição integral de capas, espaçamentos compactos, pressione-arraste-solte (seleção e soltura fora), scroll normal antes do pressionamento longo, compartilhamento, teclado, viewport móvel e comportamento offline.
- O catálogo é um artefato gerado. Não editá-lo manualmente.
