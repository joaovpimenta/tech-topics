# Piloto de autoria v2 — #143

A [issue #143](https://github.com/joaovpimenta/tech-topics/issues/143) é o contrato do trabalho; o [ADR 0007](../adr/0007-self-contained-articles-and-clean-routes.md) registra as decisões. Esta entrega cobre infraestrutura e o piloto Bulkhead. Os demais 17 artigos permanecem planos até aprovação do mantenedor, conforme o gate F5 antes de F6.

## Mapa do piloto

| Antes | Depois | URL publicada preservada |
| --- | --- | --- |
| `content/articles/bulkhead.md` | `articles/bulkhead/article.md` | Corpo em `content/articles/bulkhead.html` |
| `assets/bulkhead/bulkhead-cover.jpg` | `articles/bulkhead/cover.jpg` | `assets/bulkhead/bulkhead-cover.jpg` |
| Campos title/dek/image/alt/slug no frontmatter | Preâmbulo e diretório como fonte única | Slots e metadados `html-v1` |
| Índice HTML | `## Neste artigo` com links Markdown | `nav` não narrável |
| Link `article.html?slug=bulkhead` | Rota `bulkhead/` | Consulta e hashes antigos continuam válidos |

Os headings HTML simples foram convertidos a Markdown preservando o texto; aliases antigos continuam presentes. O diagrama usa fence Mermaid nativa com contexto existente e legenda preservada. Não foi feita edição editorial da prosa.

## Evidência e limites

Baseline publicada: `fe86752b9d23a9cb4d9137cc20cb6ffb7883a959`, pacote com 73 arquivos. O preview misto contém 91 arquivos: acrescenta as 18 entradas de rota sem duplicar fontes autorais. As 18 Releases e seus capítulos foram inventariados em leitura; cada JSON baixado foi conferido contra o digest publicado.

Na comparação inicial do preview, DOM original e montado coincidiram nos 18 artigos; os índices dos capítulos existentes corresponderam em 18/18. O hash agregado de DOM permaneceu `867f2a8a803e69ee172e53efc27938a161e87af2f77c41fdf930e076bc3a4590`, e o das assinaturas Python permaneceu `cdd891b6f7eed0d532f3485ef96b55789226ed8d0e699739807bfc16e0661a6b`. Essa verificação inicial usou fonte local ainda não commitada; a evidência final deve vincular o SHA candidato e seu buildId antes de aprovação.

Os testes de navegador cobrem raiz e `/tech-topics/`, abertura direta, capas, recomendações, zoom, hashes legados, rolagem física, voltar/avançar e busca. Offline se aplica ao conteúdo previamente cacheado; não há promessa de acervo inteiro offline. Nenhum teste técnico constitui escuta humana ou aprovação visual editorial.

## Revisão do mantenedor

Revisar o [Markdown do piloto](../../articles/bulkhead/article.md), seu sumário e Mermaid no GitHub e o pacote HTML correspondente em celular e desktop. Conferir o título/dek/capa únicos, a abertura, âncoras antigas, recomendações, controles e áudio existente. Após aceite explícito, executar os 17 restantes em lotes e concluir a limpeza e os templates. Esta entrega não fecha #143, #87 ou #129.
