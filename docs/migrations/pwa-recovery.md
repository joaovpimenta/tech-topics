# Recuperação da versão preparatória do PWA

Esta preparação mantém versões anteriores do cache e não recarrega abas automaticamente. A recuperação de publicação é uma ação operacional separada; nenhum deploy ou dispatch faz parte deste procedimento de validação local.

## Antes de uma publicação

1. Registre o SHA da última publicação Pages bem-sucedida e o ID/digest do artefato `github-pages` desse run.
2. Baixe o artefato, confirme o digest e a integridade ZIP/TAR, e confira se `.site-artifact.json` contém o shell e os recursos esperados. O artefato é uma cópia verificável do deploy, mas não é consumido diretamente por `actions/deploy-pages`; a rota suportada abaixo recompila o ref escolhido.
3. Confirme que `.github/workflows/pages.yml` no ref de recuperação ainda valida e publica `dist` e mantém `generate_audio=false` e `advance_topic=false`.
4. Verifique execuções `queued`, `in_progress` e `waiting`, Releases/capítulos e fila editorial antes de qualquer operação real. Os jobs `skipped` não substituem essa auditoria.

Para a preparação iniciada em `d817b9489035a721bf30c14779cf7a1dfa7ab734`, o Pages run `40145875178` concluiu a validação e a publicação. O artefato `12581275738` foi baixado no workspace como `pages-d817b948.zip`; SHA-256 local: `7fb0b2370b2f8755907f0e6fee1bb9fea65aa6ab9827362e28253db4db679aa`. A captura operacional anterior apontava para o artifact `12536011249` e digest `d9e8de30cb8272ca348fda80da85c2525cb2e019bb268209aa2809152b29a483`; o ZIP local desse artefato não foi encontrado. O artifact atual expira em 26/10/2026 às 00:14 UTC, portanto não é backup durável.

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

O fallback do loader não atravessa sozinho um catálogo legado congelado no Cache Storage. Uma aba controlada por um worker antigo, cujo catálogo não declara `transport`, não alcança o HTML novo enquanto esse worker servir sua própria cache. O fallback passa a ser elegível depois da troca natural para o worker/shell/catálogo novos, ou quando a resposta de catálogo recebida pela aba já declara o transporte. O smoke real de duas versões e múltiplas abas continua como gate pendente; não foi executado nesta preparação.

Favoritos permanecem no `localStorage`. A URL de cada aba não é reescrita enquanto a versão antiga estiver aberta; restaurar o mesmo slug/fragmento ao reabrir depende do histórico ou da restauração de sessão do navegador. Não existe restauração automática da rota. A interface orienta a aguardar o fim de qualquer leitura ou reprodução antes de fechar as abas.

Offline é limitado aos arquivos pré-cacheados e aos recursos que uma visita anterior guardou. Artigos JSON completos, imagens fora do precache, MP3s/chapters de Releases e endpoints nunca visitados podem exigir conexão. Não há promessa de instalação inicial offline nem de recuperar uma publicação removida do servidor estando permanentemente offline.
