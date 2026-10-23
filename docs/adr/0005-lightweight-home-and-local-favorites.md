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
5. Cada card expõe apenas dois botões com ícones no canto superior direito: favoritar e compartilhar. Compartilhar usa Web Share API quando disponível, com fallback de cópia de link. A prévia abre por pressão prolongada, ou por teclado com foco no card, sem buscar o artigo inteiro.
6. Favoritos são pessoais, armazenados em `localStorage` sob `tech-topics:favorites:v1`, com filtro próprio. Não existe contador público, sincronização entre dispositivos nem backend. Limpeza dos dados do navegador pode apagar a seleção.

## Consequências e verificação

- A página inicial não deve disparar buscas de `content/articles/<slug>.json` nem download de MP3.
- A instalação/atualização da PWA não deve pré-carregar capas de artigos.
- A publicação de um novo artigo atualiza o catálogo no mesmo build e mantém a ordenação cronológica.
- Testar busca sem acentos, ordenação, favoritos persistidos, gestos, compartilhamento, teclado, viewport móvel e comportamento offline.
- O catálogo é um artefato gerado. Não editá-lo manualmente.
