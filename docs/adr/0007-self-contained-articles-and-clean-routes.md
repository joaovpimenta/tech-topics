# ADR 0007 — Artigos autocontidos e rotas estáticas por slug

## Estado e contexto

Implementação piloto da [issue #143](https://github.com/joaovpimenta/tech-topics/issues/143), iniciada sobre `fe86752b9d23a9cb4d9137cc20cb6ffb7883a959`. O site já publica 18 artigos compilados de Markdown, mas a autoria plana separa metadados, conteúdo e imagens. Links de consulta também dificultam a leitura da biblioteca no GitHub. As pendências de #87/#129 continuam separadas.

## Decisão

A fonte v2 é `articles/<slug>/article.md`, acompanhada de `cover.jpg` e recursos exclusivos locais. O preâmbulo Markdown contém H1, dek em blockquote e capa; o compilador deriva seus metadados e extrai os mesmos slots `heading`, `dek` e `body` do transporte `html-v1`. O sumário escrito pelo autor vira uma `nav` ignorada pela narração. As âncoras automáticas seguem a grafia Unicode do GitHub, e aliases legados permanecem como âncoras vazias.

Cada slug recebe `dist/<slug>/index.html`. Referências são resolvidas desde a raiz efetiva do site, sem elemento `base` que altere fragmentos. O transporte interno e as URLs públicas de imagens mantêm os caminhos anteriores. Links de autoria relativos apontam a fontes; o resolvedor global valida seus destinos e fragmentos e os converte em rotas públicas. Fontes e assets entram no inventário e na identidade do build; Markdown não entra no pacote público.

O piloto permite temporariamente corpus misto: Bulkhead em v2 e 17 fontes planas. Esse limite evita converter todo o acervo antes da revisão do mantenedor. F6/F7 — restantes, template definitivo e remoção do suporte corrente ao layout plano — dependem do aceite do piloto.

## Narração e operação

Mover fontes, imagens ou links não é motivo para gerar áudio. Fala e índices são comparados separadamente, e divergências bloqueiam a publicação até análise específica. A prova do piloto inclui comparação de DOM e capítulos existentes, distinta de testes simulados. Baselines históricas permanecem imutáveis; nenhuma decisão deste ADR encerra #94 ou reativa Kokoro.

O cache preserva a estratégia existente: páginas e corpos previamente visitados podem abrir offline quando retidos pelo navegador; artigos inéditos no cache não passam a ser baixados em massa. Rotas novas participam da identidade de versão e da limpeza de cache. MP3s não entram no precache.

## Alternativas e consequências

Manter o layout plano exigiria reconstruir o artigo fora do GitHub. Uma SPA ou um `base href` simplificaria parte das URLs, mas prejudicaria abertura direta, âncoras ou compatibilidade do Pages. Duplicar corpo em JSON/HTML autoral criaria outra fonte de verdade. A compilação estática mantém uma fonte editorial, ao custo de testar inventários, resolvedor global, corpus misto e histórico.

Rollback restaura o commit e o pacote HTML anteriores e verifica a atualização do cache. Não exige síntese, substituição de Release, consumo da fila ou sobrescrita de histórico.
