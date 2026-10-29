# Recomendações por tags — validação da issue #145

A seleção usa o catálogo carregado pelo artigo e é executada no navegador, sem consultar Markdown, HTML de sugestões ou a API do GitHub. Os cards compartilham a implementação da home. `scripts/test-recommendations.cjs` cobre prioridade, fallback, unicidade e amostragem; `scripts/test-recommendations-browser.py` verifica navegação, redimensionamento, layout, prévia por teclado e toque prolongado com favorito e compartilhamento.

O teste de navegador também alterna favoritos no artigo e nos cards da mesma página, verifica o fallback em memória quando o armazenamento está indisponível ou cheio e provoca falhas na seleção e montagem das recomendações. A validação integrada e as suítes de recomendações e responsividade passaram antes da publicação.

## Escopo confirmado: isolamento das recomendações

A revisão com o mantenedor confirmou que a funcionalidade reutiliza o catálogo existente, já utilizado pela home e pelo carregador do artigo. O requisito de resiliência se aplica a falhas na seleção ou montagem das sugestões: elas permanecem ocultas e não interrompem a leitura, os controles ou o rodapé do artigo carregado.

O carregador continua usando o catálogo para localizar o HTML principal e validar o transporte e o identificador da compilação. Tornar o próprio artigo independente do catálogo não faz parte da #145. O teste de navegador provoca falhas na seleção e na montagem dos cards para verificar o isolamento, sem alterar o contrato de carregamento existente.
