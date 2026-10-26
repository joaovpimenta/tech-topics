# Gates de browser P02/P03 — 2026-10-25

## Alvo e proveniência

Execução no worktree isolado `agent/p03-browser-gates`, baseado em `c24e8811ff8bb611f6cf211e46bde59321d7f291`. O tree com a correção estreita de status em `audio.js` e os testes desta entrega foi validado e testado; `node scripts/validate-site.mjs`, com Node `v22.23.4`, reconstruiu `dist/` desse tree antes dos testes. Não foi usado `dist/` antigo. Chrome `156.0.8078.47`; os scripts abriram servidor somente em `127.0.0.1`.

O artefato `.site-artifact.json` foi gerado pelo build e lista os 73 arquivos públicos. SHA-256 do `dist/.site-artifact.json`: `6fbcd70e6bc6fc7ed3ecb98592595457f3000ee45b7d1513143e4806c59e6fde`. SHA-256 do HTML público `dist/article.html`: `a84ebe7791d21521657a11cfd9b2c35ee0f82cd18ed56d5861a4b3864b8370d5`. Os módulos runtime e o JSON de artigo servidos pelo loader são idênticos aos respectivos inputs versionados:

| Arquivo | SHA-256 do input e do `dist/` |
| --- | --- |
| `app.js` | `271cc6546fd3b9c7314c526a7ddd57b88e6360a8bb3b5fa5e7b965a2e87ba2f4` |
| `article.js` | `fc9ebb4531f9564c8320a8b28953349e21a63742069c5e40633214263acceed0` |
| `speech.js` | `ed80527092a489c8914b3d1539c1cd1d7d597cc796adf332710ddfcee8a625cb` |
| `audio.js` | `0c6ea536ab3328b61abc19facc1297de64d5b74711a502556fa0e239394810af` |
| `styles.css` | `1ded4deaa6aaf0d0029e8cbe8efe665805740a0e32147b4b509633d79cf54745` |
| `content/articles/consenso-raft.json` | `59ba44efb9ceed24e9c2d6d69fe20e7fdee0f557b7b9bb9b505f9b85feef25b6` |

`dist/article.html` é transformado pelo builder para prefixo Pages e por isso tem identidade própria. O outro script, `test-speech-browser.cjs`, serve os arquivos do checkout diretamente; ele executa a mesma revisão de fontes cujos hashes acima foram comparados ao build. Nenhuma medição de performance foi executada nesta rodada.

## Casos cobertos

`node scripts/test-loader-regressions.cjs` abriu o `dist/article.html` reconstruído e manteve `article.js`, `speech.js` e `audio.js` reais. As interações foram cliques Playwright nos controles visíveis. Respostas de Release, serviço de voz, mídia e import/render Mermaid foram controladas no browser.

- Mermaid em import pendente e render controlado de 900 ms não bloqueiam corpo, controles nem o primeiro gesto. Os quatro diagramas mantêm código acessível e legenda enquanto aguardam. A falha de import produz mensagem de fallback nos quatro; fontes e legendas continuam presentes, ações funcionam e uma única sessão de voz é criada.
- Léxico antigo não é buscado durante a montagem. Abrir o artigo não emite fala; um clique visível em `Ouvir artigo` cria exatamente uma utterance enquanto a dependência permanece pendente.
- API de Release pendente, 404, 403, 429 e offline foram simuladas. Com Web Speech disponível, cada cenário inicia a voz do dispositivo após o gesto sem tentar tocar mídia desconhecida. Consulta pendente liberada depois não promove nem reinicia a sessão escolhida.
- MP3 descoberto com `readyState=0` não é tratado como pronto: com Web Speech disponível, a voz local assume antes de `play()`. Para autoplay bloqueado, o mock começa com mídia pronta e rejeita `play()` com `NotAllowedError`; a tentativa única retorna à voz local.
- Sem Web Speech, API 404 deixa as ações ativas e anuncia “O navegador não oferece leitura por voz.” sem utterance. Com MP3 encontrado mas `readyState=0` e `play()` pendente, o status primeiro diz “Carregando áudio gravado…” e, após o limite atual de 1,2 s, termina “O MP3 ainda não iniciou. Verifique a conexão e tente novamente.”; não afirma que começou.
- Lista de vozes vazia apresenta disponibilidade antes da interação. O caso de voz tardia envia `voiceschanged`, comprova que nenhuma fala começa sem gesto, limpa o estado inicial e só então o clique visível inicia uma utterance. A callback `onstart` é sintetizada imediatamente no mock; isso não mede saída acústica.
- Cada clique mede o intervalo do evento `click` recebido até o `onstart` do mock. Nesta máquina, a execução final reportou 1,8–3,3 ms nos casos com voz. São tempos de callback simulado, sem significado como latência acústica, INP ou resultado de campo.

`node scripts/test-speech-browser.cjs` passou em 1280 px e 375 px. Gestos visíveis verificaram pause/resume, navegação por capítulos, seek, velocidade `1.25×`, alternância de fonte no dock único, destaques e fechamento. Uma corrida adicional usa `page.clock.install()` seguido de `pauseAt()` explícito: antes do clique, o snapshot público de `createPlayer()` confirma MP3 pendente; o leitor escolhe “Usar voz do dispositivo”, a sessão fica em modo `device` e o áudio gravado pausa. A promise de `play()` antiga é resolvida e o clock avança 1,3 s; a sessão continua no dispositivo com uma única utterance. Não foi usado `evaluate(...click())`, force click ou elemento oculto.

## Limites

- Não houve QA físico Android, Safari/iOS, inspeção visual humana no app, áudio acústico ou chamada ao serviço real de síntese. Os fakes não afirmam que uma voz instalada produzirá som offline.
- Os status e URLs HTTP são fault injection local, não respostas/headers de GitHub Pages ou Release em produção.
- A escolha manual da voz local limpa o status da tentativa MP3 cancelada. Fallback automático conserva a mensagem explicativa. Os dois comportamentos passam pela unit pública e pelo fluxo browser com clock pausado.
- A amostra final de 1,8–3,3 ms só cobre clique→callback simulado. Não mede corpo→controles, não valida a meta global de 200 ms e não substitui a janela exclusiva pedida para 40 navegações.
- O `dist/` e os arquivos de manifesto/cache modificados pelo build são gerados no worktree e não fazem parte dos arquivos desta entrega.

## Correção de escopo — preservação de posição entre fontes

As afirmações acima de que a troca no teste de browser validava a alternância entre MP3 e voz do dispositivo eram amplas demais. O caso usava somente três timestamps V1 artificiais para o artigo CQRS; esse catálogo não correspondia aos 308 blocos de fala e, portanto, não provava preservação de posição. O teste cobria apenas a pausa do MP3 e o estado de fonte escolhido. O teste de corrida com notas V1 vazias também não provava mapeamento de posição. Esses resultados não são evidência para a correção da task #109.

A correção manual agora exige associação validada entre capítulo e bloco/frase. Com capítulos V2 correspondentes, a troca gravado→dispositivo inicia na frase do capítulo atual; dispositivo→gravado busca o timestamp do mesmo capítulo antes de conferir prontidão do MP3. A taxa é compartilhada. Se uma sessão estava pausada, a outra também permanece pausada, sem tocar uma utterance transitória. Sem associação comprovada, a escolha é recusada com mensagem e mantém posição, fonte, taxa e intenção atuais. A promoção automática (#111) continua fora do escopo.

`node --test scripts/test-audio.cjs` passou com 22 testes, incluindo mapeamento V2 em ambos os sentidos, pausa, taxa, rejeição de V1 incompatível e cancelamento/tentativa tardia. `scripts/fixtures/audio-switch-browser.html` e os gestos Playwright adicionados em `scripts/test-speech-browser.cjs` cobrem a mesma associação por uma fixture curta controlada. Essa suíte browser não foi executada neste worktree: `playwright` não está instalado e `TECH_TOPICS_PLAYWRIGHT` não está configurado. O resultado precisa ser confirmado em ambiente com Playwright/Chromium antes de declarar QA de browser concluído.
