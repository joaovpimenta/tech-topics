# P06 — cards iniciais estáticos

## Estado e escopo da evidência

A comparação completa foi executada antes da integração atual em dois SHAs específicos:

| Papel | SHA medido | Arquivo bruto local | SHA-256 do JSON |
|---|---|---|---|
| Baseline | `fce9ac1b15efd6a34d2a33fe3b4598590b2259d5` | `.local/integration-87-88/p06-full-fce.json` | `d093977bd4f9f197c73f2130ae7db615c0cd88321fc028079bba353512b14d9` |
| Candidata P06 | `f493482e6927ae0a69dd7f9a5fda73f50d682dd7` | `.local/integration-87-88/p06-full-f493.json` | `578bcb31ac349aa55388d6ed0ebe8e29012b57be9ecaa9a31440e325e5798685` |

Cada SHA teve 40 amostras (10 em cada grupo home/artigo × frio/quente), todas válidas. `roundValid` e os hashes de fontes e `dist/` antes/depois passaram nos dois relatórios. A medição foi serial: baseline primeiro, candidata depois. O harness tinha SHA-256 `2621ae508f2d11f7f76813805e677ed30c827dc30dbe153a284ef18b8e9f6aff`; runtime Node `v22.23.4`, Chrome `156.0.8078.47` e Playwright do runtime primário.

### Procedência dos artefatos medidos

Os `dirtyFiles` registrados nos JSONs fazem parte da identidade da captura. Portanto, os artefatos testados não vieram de worktrees pristine construídas somente a partir dos SHAs acima: cada um foi construído a partir da revisão histórica indicada, com arquivos gerados deterministicamente e ajustes locais preservados no workspace. Os hashes de fontes e `dist/` registrados nos JSONs continuam sendo os hashes observados antes/depois da respectiva rodada; eles não transformam a captura em resultado de artefato pristine.

- Baseline (`p06-full-fce.json`): `assets/articles-catalog.json`, `content/articles/index.json`, `favicon.svg` e `sw-version.js` aparecem em `dirtyFiles`.
- Candidata (`p06-full-f493.json`): `favicon.svg` e `sw-version.js` aparecem em `dirtyFiles`.
- O build regenerou o catálogo e o manifesto a partir das fontes disponíveis no workspace, incluindo `hedged-requests`, ausente no manifesto baseline versionado. Também regenerou os metadados de versão em `sw-version.js`.
- `favicon.svg` foi o mesmo ajuste local preservado nos dois workspaces. Seu SHA-256 foi `90a6388638113b7196edebdde3a4b2404ced13f0b42c7aef260bb55298f1f556` em ambos.

As medições e números abaixo pertencem a esses artefatos históricos com essa procedência. Não devem ser descritos como resultados exatos de artefatos pristine construídos apenas dos SHAs registrados.

Os seis caminhos de capa da home são iguais nos dois relatórios e os seis JPGs têm hashes idênticos. O resultado foi aceito pelo Sol como evidência de redução de LCP/CLS na comparação original. Os dados abaixo continuam restritos a esses SHAs: a integração atual sobre main `06822cd62ae86640f2bcc5a5ffb0814eecea3f8d` contém mudanças de áudio (#121), hover (#122) e compiler (#123) que não estavam na candidata medida. Nenhum valor deste relatório deve ser atribuído ao SHA da integração atual sem nova medição.

## Resultados observados

P75 por grupo, exceto quando indicado. Delta = candidata P06 medida − baseline. A captura pequena é laboratorial, serial e não tem intervalo de confiança; as diferenças são descritivas.

| Cenário | Métrica | Baseline | Candidata P06 | Delta |
|---|---|---:|---:|---:|
| Home fria | LCP (ms) | 5.624 | 4.740 | −884 |
| Home fria | Proxy geométrico de texto do primeiro card (ms) | 942,4 | 927,7 | −14,7 |
| Home fria | `legacyContentMs` (ms) | 967,9 | 979,0 | +11,1 |
| Home fria | CLS | 0,38149 | 0,02841 | −0,35308 |
| Home fria | Bytes transferidos | 2.697.455 | 2.710.691 | +13.236 (+0,49%) |
| Home fria | Long tasks: máximo p75 / duração total p75 (ms) | 101 / 101 | 143 / 143 | +42 / +42 |
| Home quente | LCP (ms) | 344 | 248 | −96 |
| Home quente | Proxy geométrico de texto do primeiro card (ms) | 306,3 | 254,5 | −51,8 |
| Home quente | `legacyContentMs` (ms) | 356,9 | 376,8 | +19,8 |
| Home quente | CLS | 0,10163 | 0,03916 | −0,06246 |
| Home quente | Bytes transferidos | 0 | 0 | 0 |
| Home quente | Long tasks: máximo p75 / duração total p75 (ms) | 105 / 105 | 147 / 147 | +42 / +42 |
| Artigo frio | LCP (ms) | 1.608 | 1.608 | 0 |
| Artigo frio | CLS | 0,48413 | 0,48413 | 0 |
| Artigo frio | Bytes transferidos | 453.009 | 453.009 | 0 |
| Artigo frio | Body→controls (ms) | 290,2 | 287,4 | −2,8 |
| Artigo quente | LCP (ms) | 1.048 | 1.056 | +8 |
| Artigo quente | CLS | 0,28765 | 0,28768 | +0,00004 |
| Artigo quente | Bytes transferidos | 42.237 | 42.237 | 0 |
| Artigo quente | Body→controls (ms) | 292,2 | 287,3 | −4,9 |

O relatório bruto guarda por amostra a contagem, a duração máxima e a soma de duração de long tasks. Na home fria, a soma das durações das long tasks nos 10 samples subiu de 1.003 para 1.423 ms (+420 ms); na home quente, de 1.064 para 1.451 ms (+387 ms). A contagem p75 ficou em 1 nos dois lados da home. No artigo, a contagem p75 foi 3; as durações e os valores por amostra estão nos JSONs.

### Custo frio de transferência

Na home fria, a composição observada de HTML/renderizador/app acrescentou 19.101 B, cerca de 0,71% do total frio do baseline:

- `index.html`: 4.961 → 19.045 B, +14.084 B;
- `home-card-renderer.js`: novo, 5.913 B de `transferSize` (5.613 B no arquivo `dist/`);
- `app.js`: −896 B;
- `favicon.ico`: requisitado em todas as 20 amostras home do baseline, 5.865 B frios; não requisitado em nenhuma das 20 amostras da candidata.

O item do favicon reduz o delta líquido observado para +13.236 B (+0,49%). Não omitir esse custo ao apresentar o resultado de bytes.

## Interpretação e limites

- O LCP da home fria da candidata foi 4,74 s, acima do limite de referência de 2,5 s. O CLS dos artigos continuou acima de 0,1 nos dois perfis, e o p75 body→controls de aproximadamente 287–292 ms ainda ultrapassa a referência de 200 ms.
- `legacyContentMs` preserva o relógio Node antigo: começa antes de `goto` e termina depois de `domcontentloaded` e da condição de conteúdo. O proxy de primeiro texto usa `Range`, retângulo, viewport e estilos computados após CSS; não garante paint e não é FCP nem LCP.
- Além da diferença de catálogo entre os SHAs medidos — a candidata continha `hedged-requests`, ausente no manifesto baseline versionado — os JSONs registram arquivos locais e saídas determinísticas de build em `dirtyFiles`. Embora as seis capas iniciais sejam iguais, essa comparação não isola perfeitamente somente a mudança dos cards para métricas de bytes/carga.
- O servidor serviu `dist/` local sob `/tech-topics/` com `Cache-Control: max-age=3600`. Service workers ficaram bloqueados e `page.route` não foi usado. Mermaid foi um stub; fetch de Release foi 404 mockado; Web Speech foi síncrono e mockado. Não se mediu CDN/Pages, acústica, Kokoro, CPU/RSS nem hover.
- A integração P06 na main atual tem validação funcional própria. O benchmark acima não cobre as mudanças atuais de áudio, hover ou compiler e não é evidência de ganho para o código final integrado.

Os JSONs brutos vivem no diretório local ignorado `.local/integration-87-88/`; seus hashes são registrados acima para detectar substituição. Eles foram preservados sem edição. Não publicar métricas como resultado de produção ou declarar metas globais atingidas com base nesta amostra.
