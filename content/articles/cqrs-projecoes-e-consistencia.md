---
slug: cqrs-projecoes-e-consistencia
language: pt-BR
title: "CQRS: separar comandos e consultas sem esconder a consistência"
category: Arquitetura · Backend · Bancos de dados
date: 27 de setembro de 2026
publishedAt: 2026-09-27
read: 22 min de leitura
image: assets/cqrs-projecoes-e-consistencia/cqrs-projecoes-e-consistencia-cover.jpg
alt: Aquarela de uma cliente e uma atendente junto ao caderno de pedidos, enquanto outro funcionário atualiza cartões em um painel de retiradas.
dek: Modelos separados só valem o custo quando o contrato explica projeções, atraso de leitura, reconstrução e falhas de sincronização.
excerpt: "Um guia rigoroso sobre CQRS: comandos, consultas, projeções, consistência eventual, read-your-writes, rebuilds e adoção incremental."
speechMarkup:
  title:
    - text: "CQRS: separar comandos e consultas sem esconder a consistência"
      lang: pt-BR
tags:
  - arquitetura
  - bancos-de-dados
  - dados-distribuidos
  - sistemas-distribuidos
---

Na confeitaria, uma cliente muda a inscrição do bolo no balcão e aponta para o painel de retiradas: por que ainda aparece a frase antiga? A atendente fecha o caderno de pedidos e explica que a cozinha já recebeu a correção; o painel público é atualizado por outra pessoa e pode levar alguns instantes. Então qual informação vale agora? A confirmação do balcão decide o pedido, enquanto o painel é uma cópia preparada para consulta. Essa separação física antecipa o CQRS: comandos protegem mudanças na fonte de verdade, consultas leem projeções convenientes, e a arquitetura precisa tornar visível o intervalo entre as duas.

**CQRS**, sigla de <span lang="en-US">Command Query Responsibility Segregation</span>, separa o modelo que decide e registra mudanças do modelo que responde consultas. A ideia não exige dois bancos, mensageria ou <span lang="en-US">Event Sourcing</span>. A implementação mais simples pode ter dois conjuntos de objetos sobre a mesma transação e o mesmo banco; a mais distribuída pode usar serviços, esquemas e tecnologias distintos. O ponto invariável é não obrigar leitura e escrita a compartilhar um único modelo quando elas respondem a forças diferentes.

<div class="article-callout"><p><strong>Contrato essencial:</strong> um comando expressa intenção, valida regras e pode mudar estado; uma consulta observa estado sem produzir a mudança de negócio consultada. Separar responsabilidades não elimina consistência: obriga a definir qual estado é autoritativo, quanto atraso é aceitável e como uma projeção volta a convergir depois de uma falha.</p></div>

<h2>1. O que realmente é separado</h2>

No lado de comando, uma operação deve representar a intenção do domínio: `alterarInscricaoDoBolo`, `reservarEstoque` ou `aprovarLimite`. Esse caminho autentica, autoriza, valida formato, verifica invariantes, resolve concorrência e confirma a mudança na fonte de verdade. Um comando pode ser recusado e não precisa retornar toda a representação atual; deve retornar informação suficiente para o contrato, como identidade, resultado e versão confirmada.

No lado de consulta, o objetivo é entregar uma resposta adequada à tela ou ao consumidor. Uma projeção pode juntar cliente, pedido e entrega em uma linha já pronta, sem carregar as regras usadas para alterar cada agregado. A documentação do [Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs) descreve essa assimetria: o modelo de escrita concentra lógica e validação, enquanto o de leitura pode devolver DTOs otimizados para consultas.

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Comparação rolável entre comando e consulta"><table><thead><tr><th>Dimensão</th><th>Comando</th><th>Consulta</th></tr></thead><tbody><tr><td>Pergunta</td><td>Esta mudança pode acontecer?</td><td>O que devo mostrar agora?</td></tr><tr><td>Entrada</td><td>Intenção e pré-condições</td><td>Filtros, ordenação e paginação</td></tr><tr><td>Saída</td><td>Aceite, recusa, identidade e versão</td><td>DTO ou documento de leitura</td></tr><tr><td>Estado</td><td>Fonte de verdade</td><td>Visão derivada ou consulta especializada</td></tr><tr><td>Otimização</td><td>Invariantes e escrita concorrente</td><td>Latência, índices e formato da resposta</td></tr></tbody></table></div>

Separar métodos `POST` e `GET` em arquivos diferentes não basta. Se ambos dependem da mesma entidade mutável, do mesmo mapeamento e das mesmas decisões de persistência, houve organização de código, mas não necessariamente dois modelos. Também não é CQRS permitir que uma consulta esconda uma escrita, como marcar uma notificação como lida durante um `GET`: isso embaralha observação e mudança e dificulta <span lang="en-US">retries</span>, <span lang="en-US">cache</span> e auditoria.

<h2>2. Existe um gradiente, não um pacote fechado</h2>

Uma referência histórica útil é o princípio <span lang="en-US">Command Query Separation</span>, de Bertrand Meyer: uma operação deveria responder uma pergunta ou alterar estado, não fazer ambos. Greg Young levou a separação para modelos arquiteturais e popularizou o nome CQRS. A introdução do projeto [<span lang="en-US">CQRS Journey</span>](https://github.com/MicrosoftArchive/cqrs-journey/blob/master/docs/Reference_02_CQRSIntroduction.markdown) registra a formulação prática de Young e ressalta que o padrão não obriga bancos separados.

Isso permite adotar CQRS em degraus:

1.  **Interfaces separadas, mesmo processo e banco:** comandos usam um modelo de domínio; consultas usam SQL ou DTOs próprios.
2.  **Esquemas de leitura no mesmo banco:** tabelas ou visões materializadas evitam joins caros, ainda sob uma infraestrutura comum.
3.  **Projeção assíncrona em armazenamento separado:** eventos ou captura de mudanças alimentam um <span lang="en-US">read store</span> independente.
4.  **Serviços e tecnologias distintos:** cada lado escala e evolui separadamente, pagando o custo de rede, sincronização e operação distribuída.

Os benefícios mudam em cada degrau. No primeiro, o ganho principal é clareza do modelo. No último, aparecem escala independente e persistência especializada, mas também atraso de propagação, duplicação de dados, mais modos de falha e migrações coordenadas. A documentação da [AWS](https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/cqrs-pattern.html) recomenda o padrão quando leitura e escrita têm requisitos diferentes de <span lang="en-US">throughput</span>, latência ou consistência; isso é uma condição a medir, não um benefício automático.

<figure class="mermaid-figure"><div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="Comandos atualizam a fonte de verdade e mudanças confirmadas alimentam uma projeção consultada pela API de leitura."><pre class="mermaid-source">flowchart LR&#10;  C[Cliente] -- comando --&gt; A[API de comando]&#10;  A -- valida e confirma --&gt; W[Fonte de verdade]&#10;  W -- mudança confirmada --&gt; P[Projetor]&#10;  P -- atualiza --&gt; R[Modelo de leitura]&#10;  C -- consulta --&gt; Q[API de consulta]&#10;  Q -- lê --&gt; R</pre></div><figcaption>Arquitetura conceitual de CQRS com projeção separada. As setas não prescrevem <span lang="en-US">broker</span> nem banco específico; a sincronização pode ser local ou assíncrona.</figcaption><details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">flowchart LR&#10;  C[Cliente] -- comando --&gt; A[API de comando]&#10;  A -- valida e confirma --&gt; W[Fonte de verdade]&#10;  W -- mudança confirmada --&gt; P[Projetor]&#10;  P -- atualiza --&gt; R[Modelo de leitura]&#10;  C -- consulta --&gt; Q[API de consulta]&#10;  Q -- lê --&gt; R</pre></details></figure>

<h2>3. Uma execução normal ainda contém dois tempos</h2>

Considere o pedido `B-42`. A versão 7 contém a inscrição antiga. A cliente envia o comando com `expectedVersion = 7`; o lado de escrita revalida o prazo de alteração, confirma a nova inscrição e produz a versão 8. Só depois a projeção de acompanhamento recebe a mudança e atualiza sua linha para a versão 8.

<figure class="mermaid-figure"><div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="A confirmação da versão oito antecede a atualização da projeção, criando uma janela de leitura obsoleta."><pre class="mermaid-source">sequenceDiagram&#10;  participant U as Cliente&#10;  participant C as Comando&#10;  participant W as Escrita&#10;  participant P as Projetor&#10;  participant R as Leitura&#10;  U-&gt;&gt;C: alterar B-42 com versao 7&#10;  C-&gt;&gt;W: validar e confirmar versao 8&#10;  W--&gt;&gt;C: versao 8 confirmada&#10;  C--&gt;&gt;U: aceite com versao 8&#10;  U-&gt;&gt;R: consultar B-42&#10;  R--&gt;&gt;U: versao 7 ainda visivel&#10;  W-&gt;&gt;P: mudanca da versao 8&#10;  P-&gt;&gt;R: atualizar projecao&#10;  U-&gt;&gt;R: consultar com minimo 8&#10;  R--&gt;&gt;U: versao 8</pre></div><figcaption>Sequência ilustrativa. O comando já terminou corretamente quando a primeira consulta retorna a versão anterior; isso é atraso de projeção, não rollback da escrita.</figcaption><details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">sequenceDiagram&#10;  participant U as Cliente&#10;  participant C as Comando&#10;  participant W as Escrita&#10;  participant P as Projetor&#10;  participant R as Leitura&#10;  U-&gt;&gt;C: alterar B-42 com versao 7&#10;  C-&gt;&gt;W: validar e confirmar versao 8&#10;  W--&gt;&gt;C: versao 8 confirmada&#10;  C--&gt;&gt;U: aceite com versao 8&#10;  U-&gt;&gt;R: consultar B-42&#10;  R--&gt;&gt;U: versao 7 ainda visivel&#10;  W-&gt;&gt;P: mudanca da versao 8&#10;  P-&gt;&gt;R: atualizar projecao&#10;  U-&gt;&gt;R: consultar com minimo 8&#10;  R--&gt;&gt;U: versao 8</pre></details></figure>

A versão visível torna o contrato testável. Sem ela, a interface só percebe que algum campo parece antigo. Com ela, o cliente sabe que o comando confirmou a versão 8 e pode distinguir uma projeção atrasada de uma perda de escrita.

<h2>4. Consistência eventual precisa de prazo e comportamento</h2>

Dizer que a projeção é “eventualmente consistente” não define uma experiência. É preciso estabelecer quanto atraso cabe no negócio, o que a API faz enquanto a versão mínima não chegou e como o operador detecta que a convergência parou. O Azure alerta que armazenamentos separados podem servir dados obsoletos e que ações baseadas nesse estado exigem cuidado.

Defina, para cada projeção, um orçamento de obsolescência. O atraso observado pode ser decomposto assim:

<pre class="code-block"><code>atraso_visivel = tempo_de_publicacao&#10;                 + espera_na_fila&#10;                 + tempo_de_projecao&#10;                 + atraso_de_replicacao_ou_cache</code></pre>

Se o compromisso for p95 abaixo de 2 segundos e p99 abaixo de 10 segundos, monitore exatamente o intervalo entre o commit autoritativo e a primeira leitura que expõe aquela versão. Medir apenas o tempo do <span lang="en-US">handler</span> esconde fila, <span lang="en-US">retries</span>, <span lang="en-US">cache</span> e replicação.

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Tabela rolável de estratégias para leitura após escrita"><table><thead><tr><th>Estratégia</th><th>Garantia pretendida</th><th>Custo ou limite</th></tr></thead><tbody><tr><td>Resposta do comando traz a representação confirmada</td><td>A tela mostra o resultado imediato daquela ação</td><td>Não atualiza outras projeções nem consultas futuras</td></tr><tr><td>Token de versão e espera por <code>minVersion</code></td><td>A consulta não responde com versão menor que a requerida</td><td>Pode esperar, devolver “ainda processando” ou expirar</td></tr><tr><td>Leitura temporária na fonte</td><td><span lang="en-US">Read your writes</span> para um fluxo específico</td><td>Reacopla a consulta ao modelo de escrita e pode custar caro</td></tr><tr><td>Atualização síncrona da projeção</td><td>Visibilidade no mesmo commit local</td><td>Somente quando fonte e projeção compartilham atomicidade</td></tr><tr><td>Interface mostra estado pendente</td><td>Honestidade sobre processamento assíncrono</td><td>Exige desenho de produto e estados explícitos</td></tr></tbody></table></div>

Um token de consistência pode ser a versão do agregado, a posição monotônica do log ou outro marcador comparável pela projeção. Ele não deve ser um timestamp de relógios independentes usado como se provasse ordem. O servidor também precisa limitar a espera: segurar conexões indefinidamente apenas transforma atraso de projeção em saturação da API.

<h2>5. A projeção é estado derivado, não uma segunda autoridade</h2>

O <span lang="en-US">write model</span> decide se a alteração preserva as invariantes. A projeção reorganiza dados já confirmados para um padrão de leitura. Se o painel diz que ainda há estoque, um novo comando de compra deve verificar o estoque autoritativo outra vez; não pode aceitar a venda porque uma cópia atrasada parecia favorável.

A [documentação de <span lang="en-US">Materialized View</span> da Microsoft](https://learn.microsoft.com/en-us/azure/architecture/patterns/materialized-view) trata a projeção como uma visão descartável e reconstruível. Essa palavra exige condições concretas: deve existir uma fonte capaz de recriá-la, um procedimento testado, capacidade para executar o rebuild e uma forma segura de trocar a versão em uso.

CQRS não implica <span lang="en-US">Event Sourcing</span>. Há três fontes comuns para reconstrução:

- **Eventos como fonte de verdade:** reproduza o histórico compatível em uma projeção nova.
- **Estado atual autoritativo:** faça snapshot das tabelas de escrita e derive a visão atual; depois aplique mudanças ocorridas após um watermark.
- **Snapshot mais log de mudanças:** carregue uma base consistente e avance pelo log, CDC ou outbox até alcançar o tráfego atual.

Uma outbox com retenção curta pode alimentar atualizações normais e ainda ser insuficiente para um rebuild completo. Eventos de integração também podem omitir dados históricos necessários a uma projeção nova. “Reproduzível” precisa ser provado com a fonte e a retenção reais.

<h2>6. Entrega duplicada e ordem não são detalhes do <span lang="en-US">broker</span></h2>

Se o projetor atualizar o <span lang="en-US">read store</span> e cair antes de confirmar seu <span lang="en-US">checkpoint</span>, a mesma mudança pode chegar outra vez. O <span lang="en-US">handler</span> deve ser idempotente ou registrar efeito e posição na mesma transação do armazenamento de leitura. A documentação da [KurrentDB](https://docs.kurrent.io/dev-center/use-cases/mix-and-match-database/tutorial/tutorial-2) mostra esse desenho ao atualizar projeção e posição de stream atomicamente.

Uma estratégia por agregado mantém `last_applied_version`. Eventos com versão igual ou menor são duplicados ou antigos; uma versão maior que a próxima esperada indica lacuna. Essa regra só funciona se a versão pertencer a uma sequência bem definida e se o evento trouxer semântica suficiente. Aplicar diretamente a versão 10 depois da 8 pode ser seguro para um evento que carrega o estado completo, mas incorreto para um delta “somar 5”.

<figure class="mermaid-figure"><div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="O projetor compara a versão recebida, ignora duplicatas, aplica a próxima versão e isola lacunas ou eventos inválidos."><pre class="mermaid-source">flowchart TD&#10;  E[Evento recebido] --&gt; V{Comparar versao}&#10;  V -- antiga ou igual --&gt; I[Ignorar com metrica]&#10;  V -- proxima --&gt; T[Atualizar visao e checkpoint]&#10;  V -- existe lacuna --&gt; L[Parar particao e reconciliar]&#10;  T -- sucesso --&gt; A[Confirmar entrega]&#10;  T -- falha --&gt; N[Nova tentativa]&#10;  L -- corrigido --&gt; N</pre></div><figcaption>Política ilustrativa para eventos ordenados por agregado. O tratamento correto de lacunas depende do contrato do evento e da fonte disponível para reconciliação.</figcaption><details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">flowchart TD&#10;  E[Evento recebido] --&gt; V{Comparar versao}&#10;  V -- antiga ou igual --&gt; I[Ignorar com metrica]&#10;  V -- proxima --&gt; T[Atualizar visao e checkpoint]&#10;  V -- existe lacuna --&gt; L[Parar particao e reconciliar]&#10;  T -- sucesso --&gt; A[Confirmar entrega]&#10;  T -- falha --&gt; N[Nova tentativa]&#10;  L -- corrigido --&gt; N</pre></details></figure>

Um evento inválido não deve desaparecer em um log. Quarentena, alerta e ferramenta de reprocessamento são parte do sistema. Se a ordem por agregado importa, deixar a versão seguinte ultrapassar a mensagem problemática pode corromper a visão; parar todo o tópico, por outro lado, permite que um único agregado bloqueie os demais. Particionamento e isolamento do erro são decisões conjuntas.

<h2>7. O caminho de publicação também pode falhar</h2>

Confirmar a mudança e publicar uma mensagem em operações independentes reabre a janela de escrita dupla. O artigo de [Transactional Outbox](article.html?slug=transactional-outbox) deste site aprofunda esse mecanismo: mudança e intenção de publicação entram na mesma transação local; um relay entrega depois e o consumidor tolera repetição. A própria orientação do Azure recomenda outbox e consumidor idempotente para manter modelos separados.

CDC é outra opção quando o banco fornece um log de mudanças adequado. Ainda assim, a projeção precisa de contrato de schema, <span lang="en-US">checkpoint</span>, retenção, reprocessamento e observabilidade. Capturar qualquer atualização de coluna não cria automaticamente um evento de domínio estável.

<div class="signal-grid"><section class="signal-card"><h3>Falha no lado de escrita</h3><p>Comandos param ou são recusados. Consultas podem continuar mostrando o último estado confirmado, desde que comuniquem a idade da visão.</p></section><section class="signal-card"><h3>Falha no projetor</h3><p>Comandos podem continuar; o backlog e a obsolescência crescem. O sistema deve limitar a dívida e alertar antes de violar o contrato.</p></section><section class="signal-card"><h3>Falha no lado de leitura</h3><p>A fonte continua correta, mas a experiência de consulta degrada. Um fallback para a escrita só é seguro se foi projetado e dimensionado.</p></section></div>

<h2>8. Backlog transforma disponibilidade em atraso</h2>

Se chegam **λ** mudanças por segundo e o projetor aplica **μ**, o backlog cresce à taxa `λ − μ` quando λ é maior. Durante uma parada de 40 segundos com λ = 120 eventos/s, acumulam-se 4.800 eventos. Após a recuperação com μ = 200 eventos/s e entrada mantida, a drenagem líquida é 80/s; voltar a zero exige 60 segundos.

<pre class="code-block"><code>backlog = 120 × 40 = 4.800 eventos&#10;taxa_liquida = 200 − 120 = 80 eventos/s&#10;tempo_de_drenagem = 4.800 ÷ 80 = 60 s</code></pre>

O sistema permanece “disponível” para comandos durante 100 segundos de dados progressivamente antigos: 40 de falha e 60 de recuperação. Por isso, conte backlog e também meça a idade do evento mais antigo e o atraso ponta a ponta. Aumentar consumidores ajuda apenas se banco, partição e índices suportarem o paralelismo sem destruir a ordem exigida.

<h2>9. O contrato HTTP deve admitir o estado intermediário</h2>

Se o comando é processado de modo síncrono e já confirmou a mudança, uma resposta de sucesso pode incluir `entityVersion: 8` e a representação relevante. Se o comando apenas entrou numa fila e ainda pode falhar, `202 Accepted` deve vir com uma identidade de operação e um recurso onde consultar seu estado. Não use 202 para mascarar que o servidor não sabe como acompanhar o trabalho.

<pre class="code-block"><code>POST /orders/B-42/message-changes&#10;Idempotency-Key: 7f31...&#10;If-Match: "7"&#10;&#10;200 OK&#10;{&#10;  "orderId": "B-42",&#10;  "entityVersion": 8,&#10;  "message": "Viva, Lia"&#10;}</code></pre>

A consulta pode aceitar `minVersion=8`. Se a projeção está na 7, há opções legítimas: esperar por poucos milissegundos dentro de um limite, devolver um estado de processamento, ou pedir nova tentativa. O código de resposta depende do contrato escolhido; o ponto é não devolver silenciosamente a versão 7 como se satisfizesse a exigência.

<span lang="en-US">Idempotency-Key</span> protege repetições do comando; `If-Match` ou uma versão esperada protege concorrência otimista. São problemas distintos. Repetir a mesma intenção não deveria criar duas mudanças; duas intenções diferentes baseadas na mesma versão não deveriam sobrescrever uma à outra sem regra explícita.

<h2>10. Segurança e privacidade atravessam todas as cópias</h2>

Uma projeção denormalizada pode aumentar o raio de exposição porque reúne campos que antes estavam separados. O <span lang="en-US">read store</span> precisa de autorização própria, criptografia, auditoria e minimização de dados; não herda magicamente os controles da fonte. A orientação de <span lang="en-US">Materialized View</span> da Microsoft exige propagar retenção, exclusão e redação para cada visão derivada.

Se uma pessoa pede remoção de um dado, apagar apenas na escrita deixa cópias em projeções, <span lang="en-US">cache</span>s, índices de busca e backups. Defina prazo e mecanismo de propagação, prove por reconciliação e decida como rebuilds evitam reintroduzir o campo a partir de histórico que ainda o contém.

<h2>11. Reconstruir sem publicar uma visão pela metade</h2>

Uma mudança de schema pode exigir uma projeção `orders_v2`. Truncar a visão ativa e preenchê-la novamente expõe resultados incompletos durante horas. Um caminho mais seguro é construir uma versão paralela, alcançar o fluxo atual, comparar invariantes e só então trocar o alias ou roteamento.

<figure class="mermaid-figure"><div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="Uma projeção nova é preenchida, alcança o fluxo vivo, é validada e substitui atomicamente a versão anterior."><pre class="mermaid-source">stateDiagram-v2&#10;  [*] --&gt; CriarV2&#10;  CriarV2 --&gt; Backfill&#10;  Backfill --&gt; AlcancarFluxo&#10;  AlcancarFluxo --&gt; Validar&#10;  Validar --&gt; Corrigir: divergencia&#10;  Corrigir --&gt; Backfill&#10;  Validar --&gt; TrocarLeitura: aprovado&#10;  TrocarLeitura --&gt; Observar&#10;  Observar --&gt; VoltarV1: problema&#10;  Observar --&gt; RemoverV1: estavel&#10;  RemoverV1 --&gt; [*]</pre></div><figcaption>Fluxo operacional recomendado para rebuild, com publicação versionada e possibilidade de rollback. Os nomes são estados conceituais, não comandos de uma ferramenta.</figcaption><details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">stateDiagram-v2&#10;  [*] --&gt; CriarV2&#10;  CriarV2 --&gt; Backfill&#10;  Backfill --&gt; AlcancarFluxo&#10;  AlcancarFluxo --&gt; Validar&#10;  Validar --&gt; Corrigir: divergencia&#10;  Corrigir --&gt; Backfill&#10;  Validar --&gt; TrocarLeitura: aprovado&#10;  TrocarLeitura --&gt; Observar&#10;  Observar --&gt; VoltarV1: problema&#10;  Observar --&gt; RemoverV1: estavel&#10;  RemoverV1 --&gt; [*]</pre></details></figure>

O <span lang="en-US">backfill</span> deve registrar a posição do snapshot; o consumo incremental parte depois dela. Durante o <span lang="en-US">dual run</span>, compare contagens, somas e amostras por chave, considerando diferenças esperadas de atraso. A troca deve ser atômica do ponto de vista do leitor. Mantenha a versão anterior pelo tempo necessário para rollback e somente depois remova dados e código.

Teste rebuilds regularmente. Um procedimento nunca executado pode descobrir tarde demais que eventos antigos não são mais desserializáveis, que uma tabela fonte perdeu retenção ou que a capacidade disponível levaria dias para alcançar o tráfego.

<h2>12. Uma projeção por necessidade, não um espelho universal</h2>

O valor do lado de leitura está em modelar perguntas concretas. A tela de acompanhamento pode precisar de `orderId`, mensagem, status e prazo. O relatório financeiro exige valores e datas. Misturar tudo numa projeção universal recria o modelo compartilhado que CQRS pretendia evitar e torna cada mudança mais cara.

Também não crie uma tabela por endpoint sem considerar governança. Projeções demais multiplicam armazenamento, pipelines, índices, controles de acesso, rebuilds e exclusões. O padrão <span lang="en-US">Materialized View</span> alerta que muitas visões especializadas podem tornar capacidade e custo inaceitáveis.

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Tabela rolável de opções de arquitetura de leitura"><table><thead><tr><th>Opção</th><th>Quando costuma bastar</th><th>Risco principal</th></tr></thead><tbody><tr><td>CRUD com DTO de consulta</td><td>Domínio simples e carga moderada</td><td>Modelo de persistência vazar para a API</td></tr><tr><td>SQL especializado no mesmo banco</td><td>Consultas diferentes, sem necessidade de isolamento</td><td>Disputa de recursos com escrita</td></tr><tr><td>Réplica de leitura</td><td>Mesmo schema e escala de leitura</td><td>Atraso de replicação e consultas ainda complexas</td></tr><tr><td>Visão materializada</td><td>Resultados caros e previsíveis</td><td>Política de refresh e obsolescência</td></tr><tr><td>CQRS assíncrono com store próprio</td><td>Modelos, carga ou tecnologia realmente divergentes</td><td>Consistência e operação distribuída</td></tr></tbody></table></div>

<h2>13. Observabilidade: medir convergência, não só disponibilidade</h2>

Um painel de CQRS precisa ligar o commit à visibilidade. Métricas úteis incluem:

- **atraso ponta a ponta:** tempo do commit até a versão aparecer em cada projeção;
- **idade do item mais antigo:** detecta pouco volume preso por muito tempo;
- **backlog por partição:** localiza desequilíbrio e bloqueio;
- **taxas de entrada e aplicação:** mostram se há capacidade de drenagem;
- **duplicatas, lacunas e quarentena:** revelam qualidade da entrega;
- **divergência de reconciliação:** compara invariantes da fonte e da visão;
- **progresso e ETA de rebuild:** tornam a recuperação operável.

Não coloque IDs de pedidos como labels de métricas. Use logs e traces correlacionados por `command_id`, `event_id`, agregado, versão e posição; agregue métricas por projeção, partição e resultado. Um trace deve mostrar commit, publicação, consumo e atualização, mas amostragem não pode apagar justamente os caminhos lentos que violam o SLO.

<h2>14. O que CQRS não garante</h2>

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Tabela rolável de equívocos e correções sobre CQRS"><table><thead><tr><th>Equívoco</th><th>Correção</th></tr></thead><tbody><tr><td>CQRS exige dois bancos</td><td>Modelos podem compartilhar processo e armazenamento.</td></tr><tr><td>CQRS é <span lang="en-US">Event Sourcing</span></td><td>Eventos históricos são uma fonte possível, não requisito.</td></tr><tr><td>Consulta rápida é automática</td><td>Schema, índices, refresh e capacidade ainda precisam ser projetados.</td></tr><tr><td>Consistência eventual resolve conflitos</td><td>Invariantes e concorrência continuam pertencendo à escrita.</td></tr><tr><td><span lang="en-US">Broker</span> garante exatamente uma aplicação</td><td>Duplicatas e resultados ambíguos exigem idempotência.</td></tr><tr><td>Projeção é backup</td><td>É estado derivado; pode omitir dados e ter retenção diferente.</td></tr><tr><td>Separar equipes elimina acoplamento</td><td>Contratos, versões, operação e incidentes continuam conectados.</td></tr></tbody></table></div>

CQRS também não transforma um domínio simples em um domínio rico. Martin Fowler recomenda aplicá-lo apenas a porções específicas em que a complexidade ou a assimetria de carga justifiquem o salto mental; para muitos sistemas, CRUD e uma consulta bem desenhada são mais seguros.

<h2>15. Quando não usar</h2>

- As regras de escrita são simples e as consultas cabem em índices e DTOs comuns.
- O negócio exige que toda leitura reflita imediatamente o commit e não aceita um caminho explícito de consistência.
- A equipe ainda não opera filas, replay, reconciliação e migrações de dados com segurança.
- Não existe fonte confiável para reconstruir projeções nem orçamento para criá-la.
- O motivo é apenas seguir uma arquitetura popular, sem medida de contenção, custo de consulta ou divergência de modelos.

Uma base de relatórios ou uma visão materializada isolada pode resolver a consulta problemática sem separar todo o contexto. CQRS deve caber dentro de uma fronteira de domínio coerente; aplicá-lo globalmente produz eventos, contratos e dependências demais.

<h2>16. Adoção incremental</h2>

1.  **Meça a dor:** identifique consultas, invariantes, contenção e carga que o modelo único não atende.
2.  **Separe contratos em código:** comandos nomeados de negócio e consultas que retornam DTOs, ainda no mesmo processo.
3.  **Crie uma projeção pequena:** escolha uma tela com ganho claro e defina fonte, versão e SLO de obsolescência.
4.  **Torne a atualização confiável:** use transação local, outbox ou CDC conforme a fronteira; trate duplicatas.
5.  **Automatize reconciliação e rebuild:** prove recuperação antes de aumentar o número de visões.
6.  **Separe infraestrutura só quando necessário:** use dados de escala, custo e disponibilidade para justificar outro store ou serviço.
7.  **Faça rollout versionado:** <span lang="en-US">backfill</span>, <span lang="en-US">dual run</span>, validação, <span lang="en-US">cutover</span> e rollback.

<h2>17. Experimento local: ver o atraso e a reconstrução</h2>

O experimento usa somente Python 3 e biblioteca padrão. Ele mantém um dicionário autoritativo de escrita, uma outbox em memória e uma projeção separada. Não implementa rede, <span lang="en-US">broker</span> nem <span lang="en-US">Event Sourcing</span>; o rebuild vem de um snapshot da fonte atual.

<a href="../../assets/cqrs-projecoes-e-consistencia/cqrs-projection-experiment.py" download>Baixar o experimento Python</a> e executar:

<pre class="code-block"><code>python3 cqrs-projection-experiment.py</code></pre>

<details><summary>Ver o código completo</summary><pre class="code-block"><code>&quot;&quot;&quot;Experimento deterministico de CQRS, somente com a biblioteca padrao.&#10;&#10;O exemplo separa um estado autoritativo de escrita de uma projecao de leitura,&#10;mostra uma leitura obsoleta, tolera entrega duplicada e reconstrui a projecao a&#10;partir de um snapshot da fonte. Nao implementa broker, rede ou Event Sourcing.&#10;&quot;&quot;&quot;&#10;&#10;from copy import deepcopy&#10;&#10;write_store = {&quot;B-42&quot;: {&quot;message&quot;: &quot;Parabens, Lia&quot;, &quot;version&quot;: 1}}&#10;outbox = []&#10;read_model = deepcopy(write_store)&#10;&#10;def change_message(order_id, message, expected_version):&#10;    current = write_store[order_id]&#10;    if current[&quot;version&quot;] != expected_version:&#10;        raise ValueError(&quot;versao inesperada&quot;)&#10;    new_version = current[&quot;version&quot;] + 1&#10;    write_store[order_id] = {&quot;message&quot;: message, &quot;version&quot;: new_version}&#10;    outbox.append({&quot;event_id&quot;: f&quot;{order_id}:{new_version}&quot;,&#10;                   &quot;order_id&quot;: order_id, &quot;message&quot;: message,&#10;                   &quot;version&quot;: new_version})&#10;    return new_version&#10;&#10;def project(event):&#10;    current = read_model.get(event[&quot;order_id&quot;], {&quot;version&quot;: 0})&#10;    if event[&quot;version&quot;] &lt;= current[&quot;version&quot;]:&#10;        return &quot;ignored&quot;&#10;    read_model[event[&quot;order_id&quot;]] = {&#10;        &quot;message&quot;: event[&quot;message&quot;], &quot;version&quot;: event[&quot;version&quot;]}&#10;    return &quot;applied&quot;&#10;&#10;accepted_version = change_message(&quot;B-42&quot;, &quot;Viva, Lia&quot;, 1)&#10;print(&quot;command accepted at version&quot;, accepted_version)&#10;print(&quot;query before projection&quot;, read_model[&quot;B-42&quot;])&#10;event = outbox[0]&#10;print(&quot;first delivery&quot;, project(event))&#10;print(&quot;duplicate delivery&quot;, project(event))&#10;print(&quot;query after projection&quot;, read_model[&quot;B-42&quot;])&#10;&#10;rebuilt_model = deepcopy(write_store)&#10;assert rebuilt_model == read_model&#10;print(&quot;rebuilt projection matches&quot;, rebuilt_model == read_model)&#10;&#10;arrival_rate = 120&#10;recovery_rate = 200&#10;outage_seconds = 40&#10;backlog = arrival_rate * outage_seconds&#10;drain_seconds = backlog / (recovery_rate - arrival_rate)&#10;print(&quot;backlog after outage&quot;, backlog)&#10;print(&quot;drain time in seconds&quot;, int(drain_seconds))</code></pre></details>

<h3>Experimento 1 — observar a janela de inconsistência</h3>

A primeira consulta imprime a versão 1 mesmo depois de o comando aceitar a 2. Só após `project(event)` a leitura converge. Adicione uma espera antes da projeção e meça o intervalo; isso representa atraso controlado, não uma medida de produção.

<h3>Experimento 2 — repetir uma entrega</h3>

O mesmo evento é projetado duas vezes. A primeira aplicação retorna `applied`; a segunda, `ignored`. Troque o evento de estado completo por um delta acumulativo e remova a verificação de versão para observar como a repetição corrompe o resultado.

<h3>Experimento 3 — reconstruir e dimensionar recuperação</h3>

O script reconstrói a visão a partir do estado autoritativo e confirma igualdade. Depois calcula 4.800 eventos acumulados e 60 segundos de drenagem. Altere `recovery_rate` para 120: não haverá capacidade líquida para reduzir o backlog; a fórmula exigirá tratar explicitamente o denominador zero.

<h2>18. Resumo mental e revisão</h2>

<div class="article-callout"><p><strong>Pense em duas responsabilidades e uma dívida temporal:</strong> o comando decide e confirma na fonte de verdade; a consulta lê uma forma preparada para sua pergunta; o pipeline entre ambos acumula atraso, falhas e custo operacional. CQRS é valioso quando essa separação resolve uma assimetria real e perigoso quando apenas distribui um CRUD que já funcionava.</p></div>

1.  Por que dois bancos não são requisito para CQRS?
2.  Qual resposta permite distinguir uma escrita perdida de uma projeção atrasada?
3.  Por que uma consulta obsoleta nunca deve validar a próxima mudança de negócio?
4.  Em que janela um projetor pode aplicar o mesmo evento duas vezes?
5.  Quais fontes permitem reconstruir uma projeção sem <span lang="en-US">Event Sourcing</span>?
6.  Por que backlog zero e baixa idade do item mais antigo respondem perguntas diferentes?
7.  Quando uma réplica de leitura ou visão materializada é mais adequada que CQRS completo?

<h2>Fontes e leituras</h2>

Fontes consultadas em 27 de setembro de 2026. Os exemplos de API, versões, métricas, cálculo de backlog e código Python são construções didáticas próprias, não benchmarks nem contratos prescritos pelas fontes.

- Microsoft Azure Architecture Center — [<span lang="en-US">CQRS Pattern</span>](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs). Modelos separados, variantes de armazenamento, sincronização, benefícios, consistência eventual e relação opcional com <span lang="en-US">Event Sourcing</span>.
- Microsoft Patterns & Practices — [<span lang="en-US">CQRS Journey</span>: Introduction](https://github.com/MicrosoftArchive/cqrs-journey/blob/master/docs/Reference_02_CQRSIntroduction.markdown). Formulação histórica, motivações e ausência de obrigação de separar bancos.
- Martin Fowler — [CQRS](https://martinfowler.com/bliki/CQRS.html). Escopo de uso, relação com modelos complexos e alerta contra adoção ampla sem benefício.
- AWS Prescriptive Guidance — [<span lang="en-US">CQRS pattern</span>](https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/cqrs-pattern.html). Fluxo entre comando, evento e consulta, opções de armazenamento e critérios de uso.
- Microsoft Azure Architecture Center — [<span lang="en-US">Materialized View Pattern</span>](https://learn.microsoft.com/en-us/azure/architecture/patterns/materialized-view). Visões derivadas, refresh, rebuild, publicação versionada, custos e ciclo de vida.
- KurrentDB — [Project events to a <span lang="en-US">read model</span>](https://docs.kurrent.io/dev-center/use-cases/mix-and-match-database/tutorial/tutorial-2). <span lang="en-US">Checkpoint</span> e atualização da projeção na mesma transação do armazenamento de leitura.

<a class="article-back" href="index.html#recent-posts">← Voltar para o arquivo</a>
