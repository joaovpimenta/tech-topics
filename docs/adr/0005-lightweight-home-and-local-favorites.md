# ADR 0005 — Catálogo leve e favoritos locais na página inicial

- Status: proposta implementada em Pull Request
- Data: 2026-10-23

## Contexto

A home buscava `content/articles/index.json` e então todos os JSONs completos via `Promise.allSettled()`, só exibindo a lista após a última resposta. O precache da PWA também incluía todos os artigos e capas, aumentando o custo de instalação/atualização.

## Decisão

1. `scripts/build-articles.mjs` passa a gerar `assets/articles-catalog.json` a partir dos artigos validados, contendo somente `slug`, datas, título, categoria, imagem, texto alternativo, `dek`, `excerpt`, **a abertura textual completa do primeiro parágrafo** (`opening`) e tempo de leitura. Não incluir `bodyHtml`, capítulos de áudio, MP3 ou campos do corpo integral.
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

## Revisão de interação — 2026-10-23

- Bloquear arrasto nativo de imagens e links dos cards com `draggable=false`, `dragstart.preventDefault()`, bloqueio de seleção e `-webkit-touch-callout: none`. Preservar `touch-action: pan-y` para rolagem normal **antes** do limiar de pressão longa; depois do limiar, cancelar o movimento padrão para manter o controle do gesto.
- A prévia por pressão longa deve ser uma superfície maior (até ~440 px de largura e ~500 px de altura, respeitando o viewport), com capa sem corte, título legível, categoria, resumo e três alvos de ação amplos. O conteúdo descritivo pode rolar dentro da prévia, mas a linha de ações permanece visível.
- Posicionar a linha de ações próxima ao ponto inicial do dedo sempre que possível. Ativar a ação somente se o dedo for solto **sobre** Ler, favoritar ou compartilhar. Soltar em qualquer área restante cancela, sem navegar nem modificar favoritos. Esc e teclado permanecem acessíveis.

## Correção do feedback pressionar–arrastar–soltar — 2026-10-23

- Evitar prévia alta fixada no topo quando isso coloca as ações abaixo do dedo: ajustar a altura à área disponível acima do ponto pressionado; se o toque começar perto da borda superior, posicionar a linha de ações **primeiro**, abaixo do dedo, e atualizar a orientação textual.
- Selecionar continuamente a ação por coordenadas do dedo, incluindo SVGs internos e tolerância pequena nas bordas durante o movimento. A confirmação usa hit-test sem tolerância no ponto de soltura para não executar uma ação fora do botão.
- Ao entrar ou trocar de ação, realçar o botão com preenchimento, escala, halo e instrução de soltura. Vibração curta (12 ms) somente na transição, quando `navigator.vibrate` estiver disponível; não bloquear a experiência em Safari/iOS ou quando a vibração estiver desativada. Respeitar `prefers-reduced-motion` e manter teclado acessível.
- Testar transição entre Ler, favorito e compartilhar; ausência de vibração repetida enquanto o dedo fica parado; cancelamento fora dos botões; posição na metade e no topo do viewport; fallback visual sem API de vibração.

## Refinamento de prévia longa — 2026-10-23

- Ao pressionar e segurar, a prévia apresenta a **alegoria de abertura** extraída do primeiro `<p>` de `bodyHtml`, sem substituir pelo `dek` nem pelo `excerpt` resumido. O campo `opening` é texto simples calculado em `scripts/build-articles.mjs` para cada artigo publicado e armazenado somente no catálogo leve; jamais carregar o JSON completo em cada toque.
- Remover marcação inline e decodificar entidades HTML para preservar a leitura visível do parágrafo integral. No cliente, usar `textContent` para impedir que a prévia interprete marcação HTML.
- Reservar espaço vertical para o texto: mostrar a capa inteira como miniatura ao lado do título, introdução em região rolável e ações Ler/Favoritar/Compartilhar fixas na borda acessível ao gesto. Quando o catálogo ainda estiver em cache sem `opening`, recorrer ao `dek`/`excerpt`.
- Validar o campo para todos os artigos no build, garantir ausência de marcação HTML e impedir novas buscas por JSON integral ao abrir a prévia.

## Ajuste definitivo da interação por gesto — 2026-10-23

- A ação sob o dedo é resolvida por `getBoundingClientRect()` de cada botão, não por `:hover` nem por `event.target`/retargeting. O gesto conserva a identidade do contato e recebe `touchmove`, `touchend` e `touchcancel` na fase de captura, com prevenção de scroll somente após os 480 ms de pressão.
- O primeiro contato com um alvo real ativa `is-targeted`, preenchimento, escala, halo e texto de soltura; trocar de alvo atualiza a seleção e vibra apenas uma vez por mudança em dispositivos que suportam `navigator.vibrate`. O feedback visual é obrigatório mesmo sem vibração (iOS/Safari).
- Se o navegador cancelar o gesto após o menu estar aberto, preservar o pop-up em modo tocável, permitindo selecionar diretamente uma ação ou fechar com Escape. Em release fora dos alvos, cancelar normalmente. Testes devem usar toque físico simulado por Chromium/DevTools, não mockar o elemento sob o dedo.


## Correção do alvo preso no arrasto — 2026-10-23

- Em Android/WebKit, `:hover` pode continuar ativo no primeiro botão tocado, independentemente de a classe `is-targeted` ter mudado. Durante o gesto, o feedback visual depende **exclusivamente** de `is-targeted` e nunca de `:hover`; hover volta a valer só com ponteiro fino e fora de `data-gesture-active`.
- O hit-test prefere o botão de centro mais próximo quando áreas ampliadas dos controles se sobrepõem. A ação ativa e o halo precisam acompanhar o dedo nas transições em ambas as direções, removendo sombra/escala do alvo anterior. Vibração ocorre na mudança de ação, não continuamente.
- Regressão obrigatória em Chromium com toque: Ler → Favoritar → Compartilhar → Favoritar → Ler → Compartilhar → fora da área, verificando classe e `getComputedStyle().boxShadow` de **todos** os botões após cada transição. Conferir também em dispositivo Android real antes de mesclar.
