---
slug: "load-shedding-controle-de-sobrecarga"
language: "pt-BR"
title: "Load shedding: recusar cedo para continuar servindo"
category: "Resiliência"
date: "21 de setembro de 2026"
publishedAt: "2026-09-21"
read: "28 min de leitura"
image: "assets/load-shedding-controle-de-sobrecarga/load-shedding-controle-de-sobrecarga-cover.jpg"
alt: "Aquarela de uma balsa na linha segura de carga enquanto um marinheiro fecha a rampa diante de uma passageira com mala no cais."
dek: "Como controle de admissão, filas limitadas, deadlines e prioridade preservam trabalho útil quando a demanda ultrapassa a capacidade."
speechMarkup: {"title":[{"text":"Load shedding","lang":"en-US"},{"text":": recusar cedo para continuar servindo","lang":"pt-BR"}],"dek":[{"text":"Como controle de admissão, filas limitadas, ","lang":"pt-BR"},{"text":"deadlines","lang":"en-US"},{"text":" e prioridade preservam trabalho útil quando a demanda ultrapassa a capacidade.","lang":"pt-BR"}]}
excerpt: "Um guia técnico sobre load shedding: quando rejeitar, quais sinais usar, como evitar colapso por filas e retries e como testar a política."
tags: ["resiliencia","desempenho","sre","confiabilidade"]
---
Na doca, uma passageira aponta para um canto vazio da balsa e pergunta por que a rampa já está subindo; o marinheiro responde que o limite não é o último palmo de convés, mas o peso que ainda permite atravessar com segurança. Ela protesta que deixar uma mala para trás parece desperdício, e ele mostra a linha d’água: aceitar tudo faria todos perderem a viagem. Em sistemas, <span lang="en-US">load shedding</span> é esse fechamento deliberado da rampa — recusar parte do trabalho antes que fila, latência e consumo de recursos transformem excesso de demanda em colapso.

<div class="article-callout">

**Ideia central:** disponibilidade não é aceitar toda requisição. Sob sobrecarga, é concluir o máximo de trabalho útil dentro do contrato, rejeitando cedo o que não cabe no orçamento de capacidade.

</div>

<nav aria-label="Neste artigo"><strong>Neste guia</strong><ul><li><a href="#ls-problema">Do excesso ao colapso</a></li><li><a href="#ls-matematica">Matemática da admissão</a></li><li><a href="#ls-politicas">Políticas de rejeição</a></li><li><a href="#ls-arquitetura">Arquitetura e protocolo</a></li><li><a href="#ls-operacao">Operação e observabilidade</a></li><li><a href="#ls-experimento">Experimento reproduzível</a></li><li><a href="#ls-fontes">Fontes</a></li></ul></nav>

<h2 id="ls-problema">1. O problema não é só receber demais</h2>

Um serviço tem capacidade finita de CPU, memória, conexões, threads, I/O e dependências. Quando a taxa de chegada ultrapassa a taxa sustentável, o excesso entra em alguma fila: explícita no aplicativo, implícita no sistema operacional, no pool de conexões, no balanceador ou no banco. Fila compra tempo para absorver rajadas; não cria capacidade.

Se o excesso persiste, a espera aumenta. Clientes atingem o tempo limite e repetem chamadas. O trabalho antigo continua consumindo recursos mesmo quando sua resposta já não tem valor. Coleta de lixo, troca de contexto e contenção encarecem cada operação. O sistema passa a concluir menos justamente quando recebe mais: é o início do colapso por sobrecarga.

<figure class="mermaid-figure"><div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="Ciclo de colapso: excesso de chegadas cria fila e latência, que geram timeouts e retries, ampliando a carga."><pre class="mermaid-source">flowchart LR
  A[Chegadas acima da capacidade] --&gt; Q[Fila cresce]
  Q --&gt; L[Latência aumenta]
  L --&gt; T[Tempo limite no cliente]
  T --&gt; R[Novas tentativas]
  R --&gt; A
  Q --&gt; S[Memória e contenção]
  S --&gt; C[Capacidade efetiva cai]
  C --&gt; Q</pre></div><figcaption>Ciclo causal ilustrativo. Há dois reforços: repetições aumentam a entrada e contenção reduz a capacidade efetiva. O texto ao redor descreve os mesmos caminhos.</figcaption><details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">flowchart LR
  A[Chegadas acima da capacidade] --&gt; Q[Fila cresce]
  Q --&gt; L[Latência aumenta]
  L --&gt; T[Tempo limite no cliente]
  T --&gt; R[Novas tentativas]
  R --&gt; A
  Q --&gt; S[Memória e contenção]
  S --&gt; C[Capacidade efetiva cai]
  C --&gt; Q</pre></details></figure>

O capítulo [<em lang="en-US">Addressing Cascading Failures</em>, do livro de SRE do Google](https://sre.google/sre-book/addressing-cascading-failures/), define <span lang="en-US">load shedding</span> como descartar parte da carga quando o servidor se aproxima da sobrecarga, para evitar falta de memória, latência extrema e falhas de saúde enquanto preserva trabalho útil. É uma descrição operacional, não uma garantia de que qualquer limite escolhido será correto.

<span lang="en-US">Admission control</span>, ou controle de admissão, é o mecanismo que decide se um novo trabalho entra. <span lang="en-US">Load shedding</span> é o resultado deliberado de rejeitar, cancelar ou simplificar uma parte da carga. Na prática os termos se sobrepõem, mas a distinção ajuda: o controlador mede e decide; o sistema executa a política.

<h2>2. O que o conceito não é</h2>

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Comparação entre mecanismos de controle de carga"><table><thead><tr><th scope="col">Mecanismo</th><th scope="col">Pergunta principal</th><th scope="col">Resposta típica</th></tr></thead><tbody><tr><td><span lang="en-US">Load shedding</span></td><td>Este trabalho ainda cabe sem pôr o serviço em risco?</td><td>Recusar, cancelar ou degradar agora.</td></tr><tr><td><span lang="en-US">Rate limiting</span></td><td>Este cliente ou rota excedeu uma taxa contratada?</td><td>Aplicar cota por janela ou balde.</td></tr><tr><td><span lang="en-US">Backpressure</span></td><td>O produtor pode desacelerar ao ritmo do consumidor?</td><td>Propagar demanda ou pausar a produção.</td></tr><tr><td><span lang="en-US">Circuit breaker</span></td><td>A dependência parece incapaz de atender novas chamadas?</td><td>Abrir o circuito e falhar rapidamente.</td></tr><tr><td><span lang="en-US">Bulkhead</span></td><td>Quanto recurso uma classe pode monopolizar?</td><td>Isolar pools e limites.</td></tr><tr><td>Escala horizontal</td><td>Podemos aumentar a capacidade futura?</td><td>Adicionar instâncias após algum atraso.</td></tr></tbody></table></div>

Uma cota de 100 requisições por segundo pode proteger justiça comercial e ainda aceitar 100 operações caríssimas que saturam o banco. Um limite de concorrência pode rejeitar 20 requisições lentas mesmo abaixo da taxa contratada. Por isso taxa e admissão resolvem problemas relacionados, mas não idênticos.

<span lang="en-US">Backpressure</span> é preferível quando a fonte consegue obedecer ao sinal e esperar sem violar seu próprio contrato. Na borda pública, entretanto, o servidor não controla todos os produtores. Em algum ponto a pressão precisa terminar em capacidade, espera limitada, degradação ou rejeição.

<h2 id="ls-matematica">3. Um orçamento simples de capacidade</h2>

Comece com um modelo deliberadamente simples. Seja λ a taxa oferecida, μ a taxa sustentável e λa a taxa admitida. Se toda requisição tiver custo semelhante e o controlador conhecer μ, então:

<div class="code-block"><pre><code>λa = min(λ, μ)
fração rejeitada = max(0, 1 − μ / λ)</code></pre></div>

Se chegam 1.500 requisições por segundo e o sistema sustenta 1.000, admitir aproximadamente 1.000 e rejeitar 500 produz uma fração de 33,3%. Isso não promete 1.000 sucessos: dependências, variância e falhas continuam existindo. O cálculo apenas explicita que aceitar 100% de uma demanda 50% maior não é um plano de capacidade.

Requisições raramente têm o mesmo custo. Uma busca em cache pode consumir 2 ms de CPU; um relatório pode ocupar um worker por 2 s e abrir dezenas de consultas. O capítulo <a href="https://sre.google/sre-book/handling-overload/" lang="en-US"><em lang="en-US">Handling Overload</em></a> alerta que consultas por segundo podem ser uma aproximação ruim e descreve sinais de recursos, custo normalizado e criticidade por requisição. Taxa é útil quando representa trabalho homogêneo; não deve virar uma unidade universal.

<h3>Concorrência conecta taxa e duração</h3>

A Lei de Little fornece uma intuição útil em regime estável: `L = λ × W`. Se um serviço conclui 1.000 operações por segundo com duração média de 80 ms, há cerca de 80 operações dentro da fronteira. Se a duração sobe para 400 ms e a taxa se mantém, a concorrência implícita sobe para 400. Pools, memória e conexões precisam absorver essa diferença.

Um limite de 120 operações simultâneas, neste exemplo, mantém uma margem sobre o estado normal. Quando a duração aumenta, novas chamadas são rejeitadas antes que 400 operações ocupem recursos. O valor 120 é hipotético: deve vir de teste de carga, SLO, perfil de custo e comportamento das dependências.

<h3>Fila tem dimensão de tempo, não só de itens</h3>

Se há `Q` itens à frente e a vazão disponível é `μ`, uma aproximação da espera é `Wq ≈ Q / μ`. Com 500 requisições aguardando e 100 conclusões por segundo, a espera estimada é 5 s. Se o cliente só aceita 800 ms, enfileirar essa nova requisição cria trabalho quase certamente inútil.

O Google SRE mostra um exemplo em que uma fila dez vezes maior que o pool acrescenta cerca de um segundo de espera a operações de 100 ms e recomenda filas pequenas para tráfego estável. Em redes, o [RFC 8289, sobre CoDel](https://www.rfc-editor.org/rfc/rfc8289), argumenta que o tempo de permanência do pacote na fila é um sinal melhor de congestionamento persistente do que apenas o tamanho da fila. A aplicação dessa ideia a RPCs é uma analogia de engenharia; o RFC especifica filas de rede, não um algoritmo universal para APIs.

<figure class="mermaid-figure"><div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="Gráfico ilustrativo da vazão útil: sem rejeição ela cai após a saturação; com rejeição precoce permanece próxima da capacidade."><pre class="mermaid-source">xychart-beta
  title &quot;Carga oferecida e conclusões úteis&quot;
  x-axis [500, 900, 1100, 1500, 2000]
  y-axis &quot;conclusões úteis por segundo&quot; 0 --&gt; 1200
  line [500, 900, 850, 600, 300]
  line [500, 900, 1000, 1000, 1000]</pre></div><figcaption>Dados puramente ilustrativos, não medição. A primeira linha representa um sistema que continua aceitando e entra em colapso; a segunda, um sistema que limita admissão perto de 1.000 por segundo. Os valores servem para mostrar a forma do problema, não para estimar uma implantação.</figcaption><details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">xychart-beta
  title &quot;Carga oferecida e conclusões úteis&quot;
  x-axis [500, 900, 1100, 1500, 2000]
  y-axis &quot;conclusões úteis por segundo&quot; 0 --&gt; 1200
  line [500, 900, 850, 600, 300]
  line [500, 900, 1000, 1000, 1000]</pre></details></figure>

<h2 id="ls-politicas">4. Cinco famílias de política</h2>

<h3>Limite estático de concorrência</h3>

Mantenha no máximo `C` operações em andamento. Se `in_flight ≥ C`, rejeite a nova chegada ou permita uma fila pequena. É simples, rápido e fácil de testar. Também envelhece: uma mudança de hardware, custo da rota ou latência da dependência pode tornar `C` conservador ou perigoso.

<h3>Fila limitada e descarte por idade</h3>

Um buffer de tamanho finito absorve rajadas curtas. Ao atingir o limite, a política pode rejeitar a chegada mais nova, remover trabalho antigo ou priorizar o item com maior chance de concluir dentro do prazo. A escolha depende da semântica. Em telemetria de estado, o dado mais recente pode substituir o antigo; em pagamentos, descartar silenciosamente é inaceitável.

<span lang="en-US">Deadline</span> explícito melhora a decisão. Se restam 40 ms e o custo mínimo observado é 80 ms, começar a operação desperdiçará capacidade. A documentação do [gRPC sobre <span lang="en-US">deadlines</span>](https://grpc.io/docs/guides/deadlines/) recomenda que clientes definam prazos realistas e que servidores parem o trabalho cancelado; a aplicação precisa cooperar, pois cancelar o RPC não interrompe automaticamente toda tarefa que ela iniciou.

<h3>Sinal de recurso e limiar gradual</h3>

CPU, memória, fila de execução, espera por conexão e pressão de heap podem alimentar o controlador. Um limiar binário é fácil, mas tende a oscilar perto da fronteira. Uma resposta gradual começa a reduzir trabalho em `T1` e chega à rejeição máxima em `T2`. Histerese ou médias suavizadas evitam alternância a cada amostra.

O [<span lang="en-US">overload manager</span> do Envoy](https://www.envoyproxy.io/docs/envoy/latest/configuration/operations/overload_manager/overload_manager) oferece gatilhos por limiar e escalonados. A documentação atual mostra ações como drenar conexões persistentes antes de parar novas requisições e responder 503 quando a pressão atinge o ponto configurado. É uma referência de implementação; os números de exemplo, como 95% de memória, não são recomendação universal.

<h3>Prioridade, cota e justiça</h3>

Nem todo trabalho tem o mesmo valor. Finalizar compra pode ser mais crítico que atualizar recomendações; uma operação interativa pode vencer um lote adiável. Porém uma fila de prioridade sem orçamento deixa classes baixas famintas. Reserve uma parcela por classe, permita empréstimo quando houver folga e teste o comportamento quando todas estiverem cheias.

O Google descreve cotas por cliente e quatro níveis de criticidade propagados pela pilha. O [<span lang="en-US">API Priority and Fairness</span> do Kubernetes](https://kubernetes.io/docs/concepts/cluster-administration/flow-control/) também distribui concorrência por níveis e limita requisições pendentes. Esses modelos mostram princípios, não uma taxonomia obrigatória. A classificação precisa refletir contrato de negócio e não pode ser controlada livremente por um cliente não confiável.

<h3>Concorrência adaptativa</h3>

Em vez de fixar `C`, o controlador observa a duração sem fila e a duração atual. O projeto [Netflix <span lang="en-US">concurrency-limits</span>](https://github.com/Netflix/concurrency-limits) implementa algoritmos inspirados em controle de congestionamento. Seu algoritmo Vegas estima uma fila por `L × (1 − minRTT / sampleRTT)` e sobe ou desce o limite conforme essa estimativa atravessa faixas configuradas.

Esse feedback adapta-se a mudanças, mas pode confundir aumento legítimo do tempo de serviço com fila, reagir a amostras ruidosas ou sincronizar instâncias. Defina mínimo, máximo, janela, aquecimento e comportamento diante de falta de amostras. Mantenha um modo de observação antes de permitir rejeição automática.

<h2 id="ls-arquitetura">5. Arquitetura: uma decisão barata antes do trabalho caro</h2>

<figure class="mermaid-figure"><div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="Arquitetura de controle de admissão: sinais locais ajustam um limite; requisições aceitas seguem para fila curta e workers, enquanto excesso é rejeitado cedo."><pre class="mermaid-source">flowchart LR
  R[Requisição] --&gt; A{Cabe no orçamento?}
  A -- sim --&gt; Q[Fila curta]
  Q --&gt; W[Workers]
  W --&gt; D[Dependência]
  A -- não --&gt; J[Rejeição rápida]
  W -. duração e concorrência .-&gt; C[Controlador]
  D -. erro e saturação .-&gt; C
  C -. ajusta limite .-&gt; A</pre></div><figcaption>Arquitetura conceitual. A checagem fica antes da alocação cara; sinais de execução e dependências fecham a malha. A fila é pequena e limitada.</figcaption><details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">flowchart LR
  R[Requisição] --&gt; A{Cabe no orçamento?}
  A -- sim --&gt; Q[Fila curta]
  Q --&gt; W[Workers]
  W --&gt; D[Dependência]
  A -- não --&gt; J[Rejeição rápida]
  W -. duração e concorrência .-&gt; C[Controlador]
  D -. erro e saturação .-&gt; C
  C -. ajusta limite .-&gt; A</pre></details></figure>

1.  **Classifique a solicitação.** Identifique rota, locatário, custo estimado, criticidade e prazo, sem confiar em prioridade arbitrária enviada pelo usuário.
2.  **Leia sinais locais.** Concorrência, espera, memória e capacidade da dependência devem refletir a instância que será protegida.
3.  **Calcule o orçamento.** Use limite estático, controlador adaptativo ou combinação; mantenha margem para saúde, administração e conclusão do trabalho aceito.
4.  **Decida antes da alocação cara.** Não leia um corpo gigantesco, abra transação ou faça chamada remota para só então rejeitar.
5.  **Responda com semântica estável.** Informe se a rejeição é de cota, sobrecarga transitória ou prazo expirado e se repetir é seguro.
6.  **Contabilize aceitos e recusados.** O denominador é carga oferecida, não apenas o que passou pelo portão.
7.  **Feche o ciclo.** Clientes aplicam orçamento de repetição e atraso; o serviço reabre capacidade gradualmente.

<h3>Um portão em cada fronteira relevante</h3>

O portão de borda economiza rede e autenticação pesada, mas enxerga mal a saturação de uma instância específica. A proteção local reage rápido e evita que um nó morra, mas ainda paga o custo de conexão e roteamento. Uma dependência pode exigir seu próprio limite, separado da capacidade geral da API.

Uma arquitetura robusta costuma combinar camadas: cota no cliente ou gateway, concorrência por rota no serviço e pool limitado para cada dependência. Evite controladores independentes tomando decisões contraditórias. Documente qual camada é autoridade para cada erro e cada tentativa.

O capítulo <em lang="en-US">Handling Overload</em> descreve <span lang="en-US">throttling</span> no cliente quando rejeitar no servidor também custa caro. Ao perceber muitas recusas, o cliente passa a falhar localmente parte das chamadas. Isso reduz a carga de rejeição na rede e no backend, mas exige informação recente; clientes esporádicos têm uma visão pior do estado.

<h2>6. HTTP e gRPC: o erro faz parte do protocolo</h2>

No HTTP, `429 Too Many Requests` comunica que aquele usuário enviou requisições demais em certo período. O [RFC 6585](https://www.rfc-editor.org/rfc/rfc6585) permite `Retry-After` e observa que responder a todo excesso também consome recursos. Use 429 para cota ou política atribuível ao cliente; não o transforme automaticamente no código para qualquer saturação interna.

`503 Service Unavailable` indica, segundo o [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110#section-15.6.4), incapacidade temporária por sobrecarga ou manutenção. Também pode carregar `Retry-After`. Um balanceador pode usar 503 para tentar outro destino; um cliente final pode exibir indisponibilidade. A resposta correta depende de onde o erro é consumido.

<pre class="code-block"><code>HTTP/1.1 503 Service Unavailable
Retry-After: 2
Content-Type: application/problem+json
&#10;{
  "type": "https://example.invalid/problems/overloaded",
  "status": 503,
  "retryable": true
}</code></pre>

O exemplo é um contrato hipotético. `Retry-After: 2` não deve fazer todos os clientes voltarem exatamente dois segundos depois. Aplique dispersão aleatória, limite global de repetições e respeite idempotência. O artigo [Retries sem tempestade](article.html?slug=retries-backoff-jitter) aprofunda essa composição.

No gRPC, `RESOURCE_EXHAUSTED` pode representar cota ou recurso esgotado; `UNAVAILABLE` indica condição transitória que pode admitir repetição com atraso. A [documentação de códigos do gRPC](https://grpc.io/docs/guides/status-codes/) também alerta que operações não idempotentes não são automaticamente seguras para repetir. Padronize metadados de causa e comportamento entre serviços.

<figure class="mermaid-figure"><div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="Sequência de uma rejeição rápida: o gateway propaga prazo e classe; o controlador recusa sem iniciar dependências; o cliente espera com jitter dentro do orçamento."><pre class="mermaid-source">sequenceDiagram
  participant C as Cliente
  participant G as Gateway
  participant A as Controle de admissão
  participant S as Serviço
  C-&gt;&gt;G: requisição com prazo
  G-&gt;&gt;A: classe, custo e prazo restante
  A--&gt;&gt;G: sem capacidade — rejeitar
  G--&gt;&gt;C: 503 e Retry-After
  Note over A,S: nenhuma dependência cara foi iniciada
  C-&gt;&gt;C: espera com dispersão e orçamento</pre></div><figcaption>Sequência ilustrativa. O ponto essencial é recusar antes de iniciar o serviço caro e impedir repetição sincronizada.</figcaption><details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">sequenceDiagram
  participant C as Cliente
  participant G as Gateway
  participant A as Controle de admissão
  participant S as Serviço
  C-&gt;&gt;G: requisição com prazo
  G-&gt;&gt;A: classe, custo e prazo restante
  A--&gt;&gt;G: sem capacidade — rejeitar
  G--&gt;&gt;C: 503 e Retry-After
  Note over A,S: nenhuma dependência cara foi iniciada
  C-&gt;&gt;C: espera com dispersão e orçamento</pre></details></figure>

<h2>7. Rejeitar, degradar ou adiar?</h2>

Rejeição não é a única saída. Degradação graciosa reduz custo mantendo valor parcial: servir cache um pouco antigo, omitir recomendações, limitar a busca ou produzir resolução menor. Adiamento persistente move trabalho para uma fila durável quando o prazo de negócio permite. Ambos precisam de contrato explícito.

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Escolha entre rejeição, degradação e adiamento"><table><thead><tr><th scope="col">Opção</th><th scope="col">Use quando</th><th scope="col">Risco principal</th></tr></thead><tbody><tr><td>Rejeitar cedo</td><td>O resultado perderá valor depois do prazo ou não há capacidade segura.</td><td>Cliente repete agressivamente ou usuário recebe erro.</td></tr><tr><td>Degradar</td><td>Há uma resposta mais barata e ainda correta para um contrato reduzido.</td><td>Modo raro fica sem teste ou viola expectativas silenciosamente.</td></tr><tr><td>Adiar</td><td>O trabalho pode terminar depois e possui persistência e idempotência.</td><td>Backlog cresce sem limite ou expira escondido.</td></tr><tr><td>Descartar silenciosamente</td><td>Somente telemetria ou estado substituível com perda declarada.</td><td>Perda invisível em dados de negócio.</td></tr></tbody></table></div>

O modo degradado precisa ser exercitado. O Google SRE recomenda testar regularmente esse caminho porque código raramente usado tende a falhar no incidente real. Acione alertas quando muitas instâncias degradarem e ofereça um modo simples de desabilitar controladores complexos.

<h2>8. <span lang="en-US">Autoscaling</span> não substitui o fusível</h2>

Escalar exige detectar pressão, decidir, provisionar, iniciar, aquecer conexões e receber tráfego. A rajada pode esgotar o serviço antes disso. O controlador de admissão atua em milissegundos e protege a janela até a nova capacidade chegar.

Há ainda um laço perigoso: filas grandes elevam métricas, a escala aumenta, as instâncias novas recebem backlog e cache frio, a dependência compartilhada satura, e a capacidade real não cresce. Escala horizontal só ajuda quando o gargalo escala junto. Mantenha admissão local mesmo com escala automática.

Também não se deve rejeitar toda carga ao primeiro sinal. Um backend saudável deve continuar aceitando o que consegue concluir e rejeitar apenas o excesso. Fechar totalmente cria oscilação, remove amostras do controlador e pode derrubar rotas críticas junto com trabalho dispensável.

<h2 id="ls-operacao">9. O que medir</h2>

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Métricas para operar controle de admissão"><table><thead><tr><th scope="col">Métrica</th><th scope="col">Pergunta</th></tr></thead><tbody><tr><td>Taxa oferecida</td><td>Quanto trabalho tentou entrar, antes da rejeição?</td></tr><tr><td>Taxa admitida e concluída</td><td>Quanto passou e quanto terminou dentro do contrato?</td></tr><tr><td>Rejeições por motivo e classe</td><td>Foi cota, concorrência, memória, fila, prazo ou dependência?</td></tr><tr><td>Concorrência e limite vigente</td><td>O controlador está protegendo ou estrangulando?</td></tr><tr><td>Tempo na fila e idade máxima</td><td>O trabalho ainda tem chance de ser útil?</td></tr><tr><td>Duração de serviço sem fila</td><td>O custo real da operação mudou?</td></tr><tr><td>Repetições por solicitação lógica</td><td>A rejeição está virando amplificação?</td></tr><tr><td>Sucesso por prioridade e cliente</td><td>Alguma classe está monopolizando ou morrendo de fome?</td></tr></tbody></table></div>

Separe carga oferecida de carga atendida. Se o painel começa depois do controlador, um incidente pode parecer tráfego normal enquanto 70% das chegadas são recusadas. Separe também rejeição rápida de falha interna: ambas são respostas não bem-sucedidas, mas indicam ações diferentes.

Evite usar apenas CPU. Um serviço pode estar bloqueado por conexões com CPU baixa; outro pode ter CPU alta por trabalho útil e fila vazia. Combine sinal de recurso com resultado do usuário: latência, prazo, fila, erro e vazão útil. Os [Four Golden Signals](article.html?slug=four-golden-signals) organizam essa leitura.

<h3>Teste de carga: encontre o joelho, não o ponto de queda</h3>

Aumente a carga gradualmente e depois em rajadas. Observe onde a latência deixa de crescer de modo aproximadamente estável, onde a fila passa a não drenar e onde a vazão útil começa a cair. Configure o limite antes desse joelho, com margem para variância e falhas parciais.

Valide pelo menos quatro cenários: uma rota cara isolada, dependência lenta, perda de uma fração das instâncias e clientes que repetem. Depois reduza a carga e meça recuperação. Um controlador que protege a subida, mas demora minutos para reabrir, pode causar indisponibilidade desnecessária.

<h2>10. Anti-padrões e modos de falha</h2>

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Anti-padrões de load shedding"><table><thead><tr><th scope="col">Anti-padrão</th><th scope="col">Consequência</th><th scope="col">Correção</th></tr></thead><tbody><tr><td>Fila ilimitada</td><td>Excesso vira memória e latência.</td><td>Capacidade e idade máximas explícitas.</td></tr><tr><td>Limite só em requisições por segundo</td><td>Operações caras atravessam juntas.</td><td>Custo, concorrência e recurso real.</td></tr><tr><td>Rejeitar depois de abrir transação</td><td>A recusa mantém o custo principal.</td><td>Decisão antes da alocação cara.</td></tr><tr><td>Todos os clientes voltam no mesmo instante</td><td>Nova onda sincronizada.</td><td>Atraso aleatório e orçamento global.</td></tr><tr><td>Prioridade enviada pelo próprio cliente</td><td>Todos se declaram críticos.</td><td>Classificação autenticada no servidor.</td></tr><tr><td>Modo degradado nunca exercitado</td><td>Falha justamente na emergência.</td><td>Teste contínuo em pequena fração.</td></tr><tr><td>Controlador sem limites</td><td>Oscila entre zero e excesso.</td><td>Piso, teto, histerese e aquecimento.</td></tr><tr><td>Contar rejeição como sucesso de saúde</td><td>Painel esconde indisponibilidade.</td><td>SLI do usuário e métricas do controlador.</td></tr><tr><td>Falhar aberto sob falta de sinal</td><td>Telemetria quebrada remove a proteção.</td><td>Política explícita por risco e último valor seguro.</td></tr></tbody></table></div>

<span lang="en-US">Fail open</span> e <span lang="en-US">fail closed</span> não têm resposta universal. Em um endpoint de emergência, rejeitar por telemetria ausente pode ser pior; em uma operação que derruba o banco, aceitar sem limite pode espalhar a falha. Escolha por classe e registre o modo ativo.

<h2 id="ls-experimento">11. Experimento reproduzível: aceitar menos, concluir mais</h2>

O arquivo <a href="../../assets/load-shedding-controle-de-sobrecarga/load-shedding-experimento.py" download="">load-shedding-experimento.py</a> usa apenas a biblioteca padrão do Python. Ele simula 30 s: 80 requisições/s por 5 s, 180/s por 15 s e novamente 80/s por 10 s. A capacidade é 100/s e o prazo útil, 500 ms.

<pre class="code-block"><code>python3 load-shedding-experimento.py</code></pre>

Na fila ilimitada, as 3.900 chegadas são aceitas. O modelo conclui 2.900 dentro da janela, mas somente 512 antes do prazo; 2.388 conclusões já expiraram e 1.000 itens permanecem na fila. Com limite de 25 itens, 1.176 chegadas são rejeitadas, todas as 2.724 admitidas terminam dentro do prazo e a fila drena.

<figure class="mermaid-figure"><div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="Resultados do experimento: fila ilimitada conclui 512 trabalhos úteis; admissão limitada conclui 2724."><pre class="mermaid-source">xychart-beta
  title &quot;Conclusões dentro do prazo&quot;
  x-axis [Ilimitada, Limitada]
  y-axis &quot;requisições úteis em 30 s&quot; 0 --&gt; 3000
  bar [512, 2724]</pre></div><figcaption>Dados calculados pelo experimento determinístico incluído no artigo, não benchmark de produção. A admissão limitada rejeita cedo 1.176 chegadas e entrega 2.724 respostas úteis; a fila ilimitada aceita tudo, mas entrega só 512 dentro de 500 ms.</figcaption><details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">xychart-beta
  title &quot;Conclusões dentro do prazo&quot;
  x-axis [Ilimitada, Limitada]
  y-axis &quot;requisições úteis em 30 s&quot; 0 --&gt; 3000
  bar [512, 2724]</pre></details></figure>

O resultado não prova que 25 seja um limite ideal nem modela múltiplos workers, variância, cancelamento ou rede. Ele isola uma ideia: conclusão depois do prazo pode consumir capacidade sem produzir valor. Altere `QUEUE_LIMIT`, `DEADLINE_SECONDS` e a função `arrival_rate`; procure o ponto em que a rejeição cai sem reintroduzir expiração.

<h2>12. Quando não usar</h2>

Não introduza um controlador adaptativo complexo em um serviço pequeno que já possui fila limitada e carga muito abaixo da capacidade. Primeiro corrija vazamentos, consultas ruins, ausência de timeout e retries ilimitados. Rejeição não compensa uma operação que deveria ser barata.

Não descarte trabalho que o domínio exige preservar. Faturas, comandos financeiros e eventos de auditoria podem precisar de fila durável, deduplicação e recuperação, não de perda. Ainda assim, a borda pode recusar a criação de novo trabalho quando nem a persistência segura possui capacidade.

Não use prioridade para esconder subdimensionamento permanente. Se a taxa média de trabalho obrigatório excede a capacidade, o controlador apenas escolhe quem sofre. É preciso reduzir custo, aumentar capacidade ou renegociar o contrato.

<h2>Resumo mental</h2>

<div class="article-callout">

**Volte à balsa.** A fila no cais é visível, a linha d’água é um sinal de recurso e a rampa é o ponto de admissão. Uma travessia concluída vale mais que muitas passagens aceitas e abandonadas no meio. Meça o peso, preserve margem, embarque o que cabe, recuse antes de içar a carga e diga quando haverá outra viagem.

</div>

<h2>Perguntas de revisão</h2>

1.  Por que aceitar uma requisição não significa aumentar vazão útil?
2.  Qual é a diferença entre cota de taxa e limite de concorrência?
3.  Quando idade da fila é um sinal melhor que tamanho da fila?
4.  Por que uma resposta 503 pode agravar a sobrecarga se o cliente repetir imediatamente?
5.  Como prioridade sem orçamento causa starvation?
6.  Por que escala automática não elimina a necessidade de admissão local?

<h2>Exercícios</h2>

<h3>1. Calcule a rejeição mínima</h3>

Um serviço recebe 2.400 operações/s e sustenta 1.800 operações/s de custo homogêneo. Calcule a fração mínima a rejeitar no modelo simples. Depois explique por que o resultado muda se 10% das operações custarem dez vezes mais.

<h3>2. Execute e altere o simulador</h3>

Baixe o experimento, execute-o e mude o limite para 5, 50 e 200. Compare rejeições, conclusões úteis, latência média e fila remanescente. Em seguida reduza o prazo para 200 ms e escolha um limite coerente.

<h3>3. Desenhe a política de uma API</h3>

Para uma API de comércio, classifique checkout, busca, recomendação e exportação em prioridade, prazo e política de excesso. Defina códigos HTTP, fila máxima, repetição permitida e as métricas necessárias para provar que uma classe não monopoliza as demais.

<h2 id="ls-fontes">Fontes e leituras</h2>

Fontes consultadas em 21 de setembro de 2026. Fórmulas simplificadas, cenário da balsa, gráfico de colapso e experimento são materiais didáticos próprios; legendas distinguem dados calculados de ilustrações.

1.  Alejandro Forero Cuervo — <a href="https://sre.google/sre-book/handling-overload/" lang="en-US"><em lang="en-US">Handling Overload</em></a>, Google SRE Book. Capacidade, cotas, criticidade, rejeição local, repetição e proteção por tarefa.
2.  Mike Ulrich — <a href="https://sre.google/sre-book/addressing-cascading-failures/" lang="en-US"><em lang="en-US">Addressing Cascading Failures</em></a>, Google SRE Book. Filas, <span lang="en-US">load shedding</span>, degradação e testes de sobrecarga.
3.  IETF — [RFC 6585: <span lang="en-US">Additional HTTP Status Codes</span>](https://www.rfc-editor.org/rfc/rfc6585). Semântica de 429 e `Retry-After`.
4.  IETF — [RFC 9110: HTTP <span lang="en-US">Semantics</span>](https://www.rfc-editor.org/rfc/rfc9110). Semântica de 503 e `Retry-After`.
5.  Kathleen Nichols et al. — [RFC 8289: <span lang="en-US">Controlled Delay Active Queue Management</span>](https://www.rfc-editor.org/rfc/rfc8289). Tempo de permanência e controle de fila CoDel.
6.  Envoy Project — [<span lang="en-US">Overload manager</span>](https://www.envoyproxy.io/docs/envoy/latest/configuration/operations/overload_manager/overload_manager). Monitores, gatilhos graduais e ações de proteção.
7.  Netflix — [<span lang="en-US">concurrency-limits</span>](https://github.com/Netflix/concurrency-limits). Implementações de limites adaptativos orientados por atraso.
8.  gRPC — [<span lang="en-US">Deadlines</span>](https://grpc.io/docs/guides/deadlines/) e [<span lang="en-US">Status Codes</span>](https://grpc.io/docs/guides/status-codes/). Propagação de prazo, cancelamento e códigos de recurso.
9.  Kubernetes — <a href="https://kubernetes.io/docs/concepts/cluster-administration/flow-control/" lang="en-US"><span lang="en-US">API Priority and Fairness</span></a>. Concorrência, filas e isolamento por nível de prioridade.

<a href="index.html#recent-posts" class="article-back">← Todos os artigos</a>
