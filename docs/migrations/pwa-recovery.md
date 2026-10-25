# Recuperação da versão preparatória do PWA

Esta preparação mantém versões anteriores do cache e não recarrega abas automaticamente. A recuperação de publicação é uma ação operacional separada; nenhum deploy ou dispatch faz parte deste procedimento de validação local.

## Antes de uma publicação

1. Registre o SHA da última publicação Pages bem-sucedida e o ID/digest do artefato `github-pages` desse run.
2. Baixe o artefato, confirme o digest e a integridade ZIP/TAR, e confira se `.site-artifact.json` contém o shell e os recursos esperados. O artefato é uma cópia verificável do deploy, mas não é consumido diretamente por `actions/deploy-pages`; a rota suportada abaixo recompila o ref escolhido.
3. Confirme que `.github/workflows/pages.yml` no ref de recuperação ainda valida e publica `dist` e mantém `generate_audio=false` e `advance_topic=false`.
4. Verifique execuções `queued`, `in_progress` e `waiting`, Releases/capítulos e fila editorial antes de qualquer operação real. Os jobs `skipped` não substituem essa auditoria.

Para a preparação iniciada em `d817b9489035a721bf30c14779cf7a1dfa7ab734`, o Pages run `40145875178` concluiu a validação e a publicação. A evidência da PR118 referencia o artefato `12581275738` e o digest `7fb0b2370b2f8755907f0e6fee1bb9fea65aa6ab9827362e28253db4db679aa`, mas a cópia `pages-d817b948.zip` não está disponível nesta raiz; não presuma que ela existe nem use essa referência como arquivo local. O artefato Pages original `12536011249` está disponível nesta raiz como `.local/integration-87-88/rollback-pages-12536011249.zip`; SHA-256 conferido: `d9e8de30cb8272ca348fda80da85c2525cb2e019bb268209aa2809152b29a483`.

O deploy preparatório integrado de `c24e8811ff8bb611f6cf211e46bde59321d7f291` corresponde ao Pages run `40206726590` e ao artefato `12603729364`. A cópia exata está preservada como `.local/integration-87-88/rollback-c24/github-pages-12603729364.zip`, acompanhada de `provenance.json`; o SHA-256 `cf16b5ea1ffb9c37e5a50924a8abb2f5b506e5841a35e8e97eb368d996d41253` confere com o digest declarado, CRC ZIP validado e `artifact.tar` contém 73 arquivos públicos mais o manifesto. O artefato expira em `2026-10-26T15:24:05Z`; é uma cópia local exata, não um backup durável nem um rollback live.

## Redeploy do último ref válido

Para restaurar um deploy preparatório com um ref conhecido, crie uma branch de recuperação que aponte para o SHA validado e confira seu conteúdo antes de executar o workflow:

```sh
git switch --detach <sha-pages-validado>
git switch -c rollback/pwa-<sha-curto>
git show --stat --oneline HEAD
node scripts/validate-site.mjs
git push origin rollback/pwa-<sha-curto>
gh workflow run pages.yml \
  --ref rollback/pwa-<sha-curto> \
  -f generate_audio=false \
  -f advance_topic=false
```

O último comando publica em GitHub Pages. Exige autorização operacional, aprovação do environment se configurada e inspeção do run até `Deploy GitHub Pages` terminar. Não use rerun de workflows antigos. Para esta rodada, a validação local do ref `d817b948` e a inspeção de `workflow_dispatch` confirmam que o ref contém os jobs `Validate before deploy` e `Deploy GitHub Pages`; o dispatch acima não foi executado. O teste local não demonstra o resultado de um rollback live.

Após futura integração de uma entrega preparatória em main, um revert seletivo do merge da entrega seguido pelo fluxo Pages normal é outra rota. Revise o diff do revert para preservar alterações posteriores independentes e mantenha os dois controles explicitamente false. Nunca force push nem reverta indiscriminadamente para `d817b948` depois que P02 ou outras entregas tiverem integrado alterações válidas.

## Limites do cliente

O service worker mantém as versões anteriores no Cache Storage. Uma atualização instalada permanece aguardando até que o ciclo natural do navegador termine os clientes controlados pela versão anterior. O PWA não chama `skipWaiting` nem assume o controle dessas abas; a interface só orienta o usuário a terminar a reprodução, fechar todas as abas do Tech Topics e reabrir o site. Não há recarga automática nem limpeza automática dos caches antigos nesta etapa. Se a instalação do candidato falhar por rede ou quota, só a cache incompleta do candidato é removida e o worker ativo anterior continua disponível.

Respostas já guardadas são servidas primeiro da cache da versão que controla a aba. Um recurso ainda não visitado é buscado na rede e armazenado somente nessa versão; respostas 404 nunca são guardadas como conteúdo. Navegações para `article.html?slug=...`, `/` e `index.html?...` compartilham a chave do shell pelo pathname. Assim, uma aba antiga não troca silenciosamente para shell/catálogo/lexicon de um deploy posterior. Novos itens chegam com a próxima versão do service worker, depois que o usuário fecha as abas anteriores e reabre o site.

Assets locais `js`/`css` com query única `v` só usam a chave precache sem query quando o valor de `v` coincide com a versão encontrada no shell da mesma cache. Respostas de rede a esses assets não são gravadas na cache versionada; scripts e estilos usados pelo shell devem estar completos no precache da instalação. Queries diferentes não são normalizadas nem gravadas nessa versão; outras queries conservam sua chave completa. Isso mantém scripts e estilos do shell v1 ligados aos bytes v1 quando o deploy atual já contém v2. A prova nesta rodada é um teste focado de cache sintético; não representa uma navegação real entre duas versões publicadas.

O fallback do loader não atravessa sozinho um catálogo legado congelado no Cache Storage. Uma aba controlada por um worker antigo, cujo catálogo não declara `transport`, não alcança o HTML novo enquanto esse worker servir sua própria cache. O fallback passa a ser elegível depois da troca natural para o worker/shell/catálogo novos, ou quando a resposta de catálogo recebida pela aba já declara o transporte.

`scripts/test-pwa-browser.cjs` executa dois níveis locais. O primeiro é um smoke sintético com o `sw.js` do checkout e fixtures A→B→A servidas em `localhost`. Após mudar o servidor para B, o primeiro acesso ao artigo não visitado ainda é feito pela aba controlada pelo worker A: a resposta de rede B é gravada na cache `a1` que esse worker controla. Enquanto as abas A estiverem abertas, leituras seguintes vêm dessa cache. Depois da ativação B, o teste inspeciona diretamente a Cache Storage `a1` para confirmar retenção; isso não significa que o worker B sirva recursos da cache A, pois ele usa sua própria cache `b1`. O retorno local usa a versão A e, ao final, só permanecem `tech-topics-a1` e `tech-topics-b1`.

O segundo nível (`scripts/test-pwa-history-browser.cjs`) cobre original fca72c3, cliente em d817 e preparatório c24, cada um contra uma fixture candidata declarada `html-v1` e retorno local ao artefato anterior. Usa os ZIPs Pages fca e c24 conferidos por SHA/proveniência, e `git archive` do ref d817 porque sua cópia Pages não veio. O HTML candidato de teste é montado em memória a partir do artigo CQRS existente; nenhum artigo ou índice versionado é alterado. A fixture declara o caminho e `buildId`, inclui o HTML no precache candidato, aposenta `content/articles/index.json` e o JSON individual, preserva slug/hash/favorito e verifica duas abas sem reload ou troca de controller durante a instalação. O teste também usa a falha sintética `QuotaExceededError` no `Cache.addAll` para confirmar que somente a cache parcial candidata é removida.

Quando os arquivos locais de áudio/capítulos CQRS existem, o teste toca o MP3 Kokoro original por Range no Chromium enquanto o candidato instala; isso prova reprodução técnica no browser, não escuta humana nem integridade auditiva. O smoke não acessa Pages live, não executa deploy/rollback e não é QA de dispositivo. Para testar o loader isolado contra o manifesto aposentado e suas falhas, execute também `scripts/test-article-loader.cjs`: o fallback só ocorre no manifesto com 404; 403/429/5xx, JSON malformado, transporte inválido e envelope divergente continuam indisponíveis.

Rode os testes browser depois de `node scripts/validate-site.mjs`, com `TECH_TOPICS_PLAYWRIGHT` e `TECH_TOPICS_CHROMIUM` apontando para Playwright/Chromium. O histórico usa `.local/integration-87-88` por padrão; `TECH_TOPICS_M03_EVIDENCE_ROOT` pode apontar para outra pasta com os mesmos nomes de ZIP. Se os ZIPs exatos estiverem ausentes, o teste usa os objetos Git dos refs e informa essa fonte. O MP3 e `chapters.json` usam o diretório local de CQRS por padrão; `TECH_TOPICS_M03_MP3_PATH` e `TECH_TOPICS_M03_CHAPTERS_PATH` permitem indicar outros arquivos. Sem áudio local, o teste explicita que playback não foi provado. Esses ensaios cobrem os critérios locais da #91, mas não substituem a evidência live/dispositivo de gates posteriores.

## Evidência local da M03 — 25/10/2026

Ambiente: base `c24e8811ff8bb611f6cf211e46bde59321d7f291`, worktree `agent/m03-artifact-gates`, Node `22.23.4`, Playwright e Chrome `156.0.8078.47`. ZIPs usados: fca `d9e8de30cb8272ca348fda80da85c2525cb2e019bb268209aa2809152b29a483`; c24 `cf16b5ea1ffb9c37e5a50924a8abb2f5b506e5841a35e8e97eb368d996d41253`; d817 usou `git archive` porque não há ZIP local. A candidata foi uma fixture `html-v1` montada em memória a partir do artigo CQRS de `dist`, com precache novo e os endpoints JSON aposentados simulados como 404.

| Cliente inicial | Artefato de origem | Resultado local |
|---|---|---|
| Original `fca72c3` | ZIP Pages `12536011249`, SHA conferido | HTML declarado e retorno ao catálogo JSON original |
| Pré-preparação `d817b948` | Objeto Git `d817b9489035a721bf30c14779cf7a1dfa7ab734` | HTML declarado e retorno ao catálogo JSON original |
| Preparatório `c24e8811` | ZIP Pages `12603729364`, SHA/proveniência/CRC conferidos | HTML declarado e retorno ao catálogo JSON original |

Nos três cenários, duas abas mantiveram slug/hash/favorito e o controller anterior, sem reload, enquanto a reprodução do MP3 `cqrs-projecoes-e-consistencia.mp3` avançava. A fonte local do MP3 tem SHA-256 `3ea4f5de93f91270cf5a5013eb3cace314267c113fa2da7dbee0c80b035c9f36`; o arquivo de capítulos tem SHA-256 `fd990f168a4d2535657c7b16f46caaa2f2d8bafde9e457a38149e9621af64a81`. O teste de loader também cobre manifesto 404 com slug e sem slug (primeira entrada do catálogo), artigo JSON individual 404, falhas 403/429/503/JSON malformado, transporte/path/buildId/envelope inválidos e HTML transitório sem montar conteúdo. Injeções browser de `QuotaExceededError` e HTTP 503 no precache removeram a cache parcial e mantiveram o cliente/cópia antiga funcionais.

Verificações executadas: `node scripts/validate-site.mjs` passou, incluindo lint do corpus, 43 testes Python e empacotamento local de `dist`; `node scripts/test-article-loader.cjs` passou; `node scripts/test-pwa-browser.cjs` passou o smoke A→B→A e iniciou a matriz histórica descrita acima. Nenhum corpus, índice, Release, capítulo público, fila ou artefato Pages foi alterado por esses ensaios. Playback decodificado e `currentTime > 0` não equivalem a escuta humana. Não houve navegação Pages live, deploy, rollback live ou QA de dispositivo; esses controles não são afirmados como concluídos por esta evidência local.

Favoritos permanecem no `localStorage`. A URL de cada aba não é reescrita enquanto a versão antiga estiver aberta; restaurar o mesmo slug/fragmento ao reabrir depende do histórico ou da restauração de sessão do navegador. Não existe restauração automática da rota. A interface orienta a aguardar o fim de qualquer leitura ou reprodução antes de fechar as abas.

Offline é limitado aos arquivos pré-cacheados e aos recursos que uma visita anterior guardou. Artigos JSON completos, imagens fora do precache, MP3s/chapters de Releases e endpoints nunca visitados podem exigir conexão. Não há promessa de instalação inicial offline nem de recuperar uma publicação removida do servidor estando permanentemente offline.
