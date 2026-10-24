# Baseline operacional de 24/10/2026

Comandos para reproduzir as assinaturas e o ensaio DOM estão no [README M01](README.md). O contrato de integração está em [markdown-html-contracts.md](markdown-html-contracts.md).

Referência da #89: `main@fca72c31fcb57ffe9741a2390a04c2035639e14a`. Evidência estruturada em [operational-baseline-2026-10-24.json](operational-baseline-2026-10-24.json). Este é um registro de leitura em uma data, não uma garantia de que o estado remoto permaneça igual. Repetir a auditoria antes de cada corte e preservar esta revisão.

A captura v1 entregue em `054cd21` permanece como registro histórico, mas foi rejeitada como baseline autoritativa: a codificação do subprocesso Python corrompia caracteres não ASCII. A v2 corrigiu a codificação, mas a comparação semântica experimental Python↔DOM era insegura e está supersedida. A v3, vinculada à v2 pelo [README de reprodução](README.md), registra assinaturas nativas dos contratos Python e DOM separadamente; equivalência cruzada não é afirmada. A issue #94 deverá verificar mudanças antes/depois dentro de cada contrato antes do corte.

## Estado encontrado

Main local e remota coincidem no SHA acima; início sem alterações locais. As 26 tasks #89–#114 estavam abertas e sem comentários de implementação; nenhuma PR estava aberta. Grafo e responsáveis registrados em [#87](https://github.com/joaovpimenta/tech-topics/issues/87#issuecomment-6385396827) e [#88](https://github.com/joaovpimenta/tech-topics/issues/88#issuecomment-6385397317). Alterações em `favicon.svg` apareceram imediatamente nos worktrees criados, foram preservadas e não pertencem à entrega.

As fontes são 18; os índices versionados têm 17 e omitem `hedged-requests`. A validação Node 22.23.4 enumera as fontes e gera catálogo/manifesto com 18 e pacote com 73 arquivos públicos (o tar Pages contém também o manifesto gerenciado, total de 74 arquivos). Não apagar o artigo para satisfazer índice antigo. Os derivados de build não são autoria e não serão editados manualmente nesta baseline.

A fila #21 tem sete comentários. A última seleção é [5955313538](https://github.com/joaovpimenta/tech-topics/issues/21#issuecomment-5955313538), `backpressure-em-streams-e-filas`, ainda não publicada. IDs/autores/hashes dos comentários estão no snapshot. Nenhum comentário foi acrescentado à fila para testar código ou consumir essa pauta. Os comentários de coordenação foram escritos apenas nas issues #87/#88, cuja workflow de seleção foi ignorada pelas condições vigentes.

Consulta separada de execuções `in_progress`, `queued` e `waiting`, com limite 100, retornou listas vazias. Isso não impede execuções futuras ou reruns manuais antigos; a checagem precisa ser repetida imediatamente antes do corte. Não há janela migratória aberta nesta entrega.

## Áudio e mapa de capítulos

Foram encontradas 18 Releases `tts-<slug>`, cada uma com MP3 e `chapters.json`. Foram lidos somente metadados/notas e os pequenos arquivos de capítulos; nenhum MP3 foi baixado, gerado, substituído ou escutado. O snapshot registra Release/asset IDs, tamanhos, datas e digests disponíveis, hash SHA256 dos capítulos e hash das notas.

Todos os capítulos lidos são v2. Notas e assets concordam nos pares `(block_index, sentence_index)` e nos timestamps `start` em 18/18. O JSON bruto difere porque as notas omitem labels e os assets incluem labels de até 96 caracteres; não classificar essa diferença de apresentação como falha de sincronização.

Auditoria Chromium do `dist/` servido sob `/tech-topics/`, com rede externa abortada e síntese bloqueada: as 18 contagens de frases concordam com os capítulos. A comparação com o traversal real de `TechTopicsAudio.readingNodes` e `TechTopicsSpeech.buildBlocks` encontrou 15 mapas de índices iguais e três divergências a investigar:

| Slug | Primeira unidade divergente (índice zero) | Contagem DOM/chapters |
| --- | --- | --- |
| `consenso-raft` | 38 | 387/387 |
| `relogios-logicos-lamport-vetores-e-causalidade-sem-relogio-global` | 72 | 406/406 |
| `github-governance-as-code` | 56 | 334/334 |

São observações anteriores à migração, não regressões corrigidas e não autorização para regravar áudio. O verificador GPT-6.1 Sol interceptou o mount real e confirmou que o clone reproduz exatamente os blocos/runs/textos/índices nos 18 artigos. Contextos iniciais das divergências: Raft unidade 38, bloco DOM 17 versus chapter 16 (“Durável”); relógios unidade 72, bloco DOM 32 versus chapter 30 (“Que a diferença mede tempo.”); governance unidade 56, bloco DOM 31 versus chapter 30 (“Area”). Mesmo os 15 mapas iguais não provam identidade de texto, idiomas, aliases ou qualidade acústica; assinatura completa e futura comparação baseline→HTML continuam obrigatórias. Sem escuta real, não declarar QA auditivo.

## Auditoria corrigida da baseline v2 — supersedida

Após a captura UTF-8 e a comparação por tokens associados aos nós originais, o [relatório versionado por SHA](audits/dom-v2-fca72c31fcb57ffe9741a2390a04c2035639e14a.json) confirma 18/18 conteúdos semanticamente iguais à baseline Python, 18/18 mounts iguais aos clones e 15/18 mapas com `block_index`/`sentence_index` iguais aos capítulos. As únicas três divergências de índice são as já observadas: Raft na unidade 38, relógios na 72 e governance na 56. Conteúdo, línguas e pontuação dessas frases concordam; não há divergência semântica de conteúdo nesses três pontos.

O hash do texto obtido concatenando segmentos DOM não coincide em 18/18, pois `buildBlocks` corta espaços nas bordas de segmentos. A v2 tratava a pontuação como um hash global e removia sinais dos tokens, então sua afirmação 18/18 de igualdade de conteúdo não era uma prova semântica suficiente. O resultado é mantido como histórico, não como gate atual.

## Assinaturas nativas da revisão v3

A captura Python v3 guarda assinaturas exatas de texto narrado, runs/idiomas, índices, pausas, chunks legados, fontes, metadados e assets. O [relatório DOM v3 por SHA](audits/dom-v3-fca72c31fcb57ffe9741a2390a04c2035639e14a.json) preserva hashes por unidade das sequências nativas `player.blocks`: texto bruto de cada segmento, `lang`, `blockIndex`, `sentenceIndex` e word mapping com ranges e IDs de nós. Não há canonicalização nem tentativa de declarar as duas sequências equivalentes. A auditoria confirmou mount original igual ao clone em 18/18 e índices DOM/capítulos iguais em 15/18.

Os desvios de capítulo continuam em Raft (índice 38), relógios (72) e governance (56); não foram alterados. Testes cobrem em cada contrato pontuação decimal, símbolos, aliases, idiomas e fronteiras, e garantem reprodutibilidade do mesmo input e ferramenta. A issue #94 deverá demonstrar regressões antes/depois usando as assinaturas nativas independentes. Não há síntese ou QA auditivo.

## Política normal e configuração de corte

Os workflows originais ainda não têm os inputs `generate_audio` e `advance_topic`. A captura registra o comportamento vigente para a retomada #105, em vez de inventar valores de configuração inexistentes:

- Pages valida e publica. Push em main com artigo JSON genuinamente novo chama seleção após `needs: [validate, deploy]`; comentário confiável de curadoria na #21 e dispatch são entradas independentes da fila.
- Kokoro está congelado para manual/backfill/áudio novo. A exceção vigente permite somente fala alterada de artigo existente em push main após Pages, com `refresh_existing=true`, SHAs before/after e `replace_existing=true`. A chamada inútil de áudio novo do Pages não supera a trava interna.
- Nenhum destes comportamentos foi ampliado. #90 deverá introduzir política versionada e ambos os controles false em todas as entradas; erro de diff/paridade continuará bloqueando deploy. #105 restaura somente o comportamento anterior, em commit separado e após seus gates.

Não iniciar conversão nem ensaio com efeitos até #90 integrada e auditada; inputs novos não cancelam jobs de versões anteriores. Nunca rerodar um workflow antigo como atalho para rollback. Uma publicação legítima durante a pausa exige nova revisão vinculada da baseline, reconciliação da fila/deploy e repetição dos gates.

## Destino e limites de rollback

Último Pages bem-sucedido: [run 40032968639](https://github.com/joaovpimenta/tech-topics/actions/runs/40032968639), SHA inicial. Artifact `github-pages`, ID `12536011249`, 8.355.039 bytes. Digest da API e do ZIP recuperado: `sha256:d9e8de30cb8272ca348fda80da85c2525cb2e019bb268209aa2809152b29a483`. ZIP verificado por CRC e tar lido sem extração; catálogo contém os 18 slugs.

Retenção remota informada: **24/10/2026 às 19:20:40 de São Paulo** (`2026-10-24T22:20:40Z`). Uma cópia local foi preservada em `.local/integration-87-88/rollback-pages-12536011249.zip` no checkout principal; não é versionada nem possui garantia de backup fora desta máquina. Manifesto dos 74 arquivos/hashes está no snapshot para conferir recuperação. Não afirmar recuperabilidade remota depois da expiração sem nova prova.

Antes de corte autorizado: conferir presença/digest do ZIP local ou de cópia durável autorizada, extrair em destino novo validado sem traversal, validar hashes e os 18 slugs, ensaiar compatibilidade de cliente/cache e republicar somente por caminho atual com efeitos false. Se o artefato não estiver disponível, interromper o corte. Rebuild do SHA original serve como ensaio adicional, não substitui identidade do artefato efetivamente publicado.

Após o corte HTML, preferir o último artefato HTML validado. Recuar além da fronteira legada exige restaurar em conjunto shell/fontes/transporte/SW e preservar controles false. Recuperar Pages/reverter código/alterar automações em produção exige a autorização humana correspondente; este registro não executa nenhum desses passos.

## Reprodução e gates restantes

Capturas remotas em leitura: `gh api repos/joaovpimenta/tech-topics/releases --paginate`; `gh api repos/joaovpimenta/tech-topics/releases/assets/<id> -H 'Accept: application/octet-stream'` para cada asset `*.chapters.json`; `gh api repos/joaovpimenta/tech-topics/actions/runs/40032968639/artifacts`; `gh api repos/joaovpimenta/tech-topics/actions/artifacts/12536011249/zip` para arquivo binário; `gh run list --status <in_progress|queued|waiting> --limit 100`. Usar captura binária por subprocesso/arquivo, sem converter ZIP por encoding de texto. Comentários da fila lidos pela API paginada, sem POST.

Validação local inicial: PATH com Node 22.23.4, `node scripts/validate-site.mjs`: todos os gates passaram, inclusive 43 testes Python, 18 artigos e 54 diagramas. Auditoria de DOM é simulação sem áudio, não QA humano. PR/checks do novo código, revisão Sol no SHA final, revisão dos contratos, compatibilidade PWA, merge autorizado, deploy e QA real continuam gates separados; nenhum foi concluído por este documento.
