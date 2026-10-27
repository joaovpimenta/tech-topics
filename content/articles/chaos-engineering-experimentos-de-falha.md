---
slug: chaos-engineering-experimentos-de-falha
language: pt-BR
title: "Chaos engineering: testar a resiliência sem criar um incidente"
category: Confiabilidade · Sistemas distribuídos · Observabilidade
date: 2 de outubro de 2026
publishedAt: 2026-10-02
read: 18 min de leitura
image: assets/chaos-engineering-experimentos-de-falha/chaos-engineering-experimentos-de-falha-cover.jpg
alt: Aquarela de um corredor de prédio com uma saída bloqueada por uma barreira temporária, enquanto pessoas seguem calmamente por uma rota alternativa sob observação.
dek: "Hipótese, estado estável, blast radius e stop conditions: como injetar falhas reais com escopo, métricas e mecanismos de parada."
excerpt: Um guia prático para desenhar experimentos de chaos engineering com hipótese, estado estável, blast radius, guardrails, observabilidade e recuperação.
speechMarkup:
  title:
    - text: Chaos engineering
      lang: en-US
    - text: ": testar a resiliência sem criar um incidente"
      lang: pt-BR
  dek:
    - text: "Hipótese, estado estável, "
      lang: pt-BR
    - text: blast radius
      lang: en-US
    - text: " e "
      lang: pt-BR
    - text: stop conditions
      lang: en-US
    - text: ": como injetar falhas reais com escopo, métricas e mecanismos de parada."
      lang: pt-BR
tags:
  - confiabilidade
  - resiliencia
  - sre
  - sistemas-distribuidos
---

Num prédio comercial, alguém aponta para a saída de emergência e pergunta se ela realmente daria conta caso o corredor principal ficasse indisponível; a resposta vem rápida: o plano está aprovado e o alarme passa nos testes. Mas isso prova que as pessoas encontrariam a rota alternativa, que a porta abriria e que a equipe saberia interromper o exercício se algo saísse do controle? Um treinamento pequeno bloqueia apenas um acesso, mantém observadores nas rotas e define um limite para parar a simulação. Essa cena resume <span lang="en-US">chaos engineering</span>: introduzir uma perturbação controlada, medir o comportamento que importa ao usuário e aprender onde a resiliência presumida não corresponde à resiliência real.

**<span lang="en-US">Chaos engineering</span>** é a disciplina de experimentar sistemas distribuídos para aumentar a confiança de que eles resistem a condições turbulentas. A palavra central é experimentar, não quebrar. O objetivo é formular uma hipótese observável, injetar uma falha com escopo limitado, acompanhar sinais previamente escolhidos e interromper a execução antes que o impacto ultrapasse limites aceitáveis. Os [Principles of Chaos Engineering](https://principlesofchaos.org/pt/) colocam o comportamento mensurável do sistema estável no centro do método; a [AWS Well-Architected](https://docs.aws.amazon.com/pt_br/wellarchitected/latest/framework/rel_testing_resiliency_failure_injection_resiliency.html) organiza a prática em estado estável, hipótese, experimento, verificação e melhoria.

<div class="article-callout"><p><strong>Contrato essencial:</strong> um experimento de caos só é útil quando a equipe sabe o que espera observar, onde pode causar impacto, quais sinais indicam perigo e como interromper ou reverter a perturbação. Sem isso, há injeção de falha; não há engenharia.</p></div>

<h2>1. De onde veio a ideia de provocar falhas</h2>

Sistemas distribuídos convivem com falhas parciais: uma máquina pode desaparecer enquanto o restante continua vivo; a rede pode degradar sem cair por completo; uma zona pode ficar indisponível enquanto outras seguem atendendo. O problema é que arquiteturas resilientes frequentemente parecem corretas no diagrama e falham na interação entre mecanismos reais: <span lang="en-US">timeouts</span> incompatíveis, filas que crescem sem limite, <span lang="en-US">health checks</span> que retiram capacidade demais ou dependências que não degradam graciosamente.

Em 19 de julho de 2011, a Netflix publicou [The Netflix Simian Army](https://medium.com/netflix-techblog/the-netflix-simian-army-16e57fbab116). O texto descrevia Chaos Monkey, que desligava instâncias em produção durante o horário comercial, além de Latency Monkey e Chaos Gorilla para introduzir atraso e simular falhas de uma zona. A motivação era direta: projetar redundância não basta; é preciso testar se o sistema realmente sobrevive às falhas esperadas. O valor histórico não está no macaco nem na aleatoriedade, mas na mudança de postura: falhas previsíveis deixam de ser eventos raros que a equipe apenas espera e passam a ser condições exercitadas deliberadamente.

<h2>2. Estado estável vem antes da falha</h2>

Antes de escolher a perturbação, defina o comportamento normal que deve permanecer aceitável. Os Principles of Chaos Engineering recomendam olhar para saídas mensuráveis: <span lang="en-US">throughput</span>, taxa de erros, percentis de latência e outros sinais que representem a experiência real. Estado estável não significa ausência de qualquer degradação. Um serviço pode perder parte da capacidade e continuar dentro de seu contrato.

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Tabela rolável com exemplo de estado estável"><table><thead><tr><th>Sinal</th><th>Baseline</th><th>Limite no experimento</th></tr></thead><tbody><tr><td>Taxa de sucesso</td><td>99,97%</td><td>≥ 99,90%</td></tr><tr><td>Latência p99</td><td>180 ms</td><td>≤ 300 ms</td></tr><tr><td>Fila de requisições</td><td>p95 = 12</td><td>p95 ≤ 40</td></tr><tr><td>CPU</td><td>55%</td><td>≤ 80%</td></tr></tbody></table></div>

Esses números são ilustrativos. Em produção, os limites precisam vir de SLOs, histórico de carga, tolerância de negócio e capacidade conhecida. Um experimento que não sabe distinguir comportamento aceitável de incidente não consegue dizer se a hipótese foi sustentada.

<h2>3. Hipótese: transforme arquitetura em uma afirmação testável</h2>

Dizer que o sistema aguenta perder um pod é pouco. Uma hipótese testável seria: se um dos seis pods da API de checkout for encerrado durante carga de 1.500 requisições por minuto, o balanceador retirará a instância em até 10 segundos, o autoscaling reporá capacidade e a taxa de sucesso continuará acima de 99,9% sem p99 superior a 300 ms.

Essa formulação separa perturbação, mecanismo esperado, janela de recuperação e comportamento externo. Se a equipe não sabe qual <span lang="en-US">health check</span> remove a instância, quanto tempo o orquestrador leva para substituí-la ou qual sinal representa a experiência do checkout, o desenho do experimento já encontrou lacunas antes de injetar qualquer falha.

<pre class="code-block"><code>efeito_observado = métrica_durante_experimento - métrica_baseline</code></pre>

Para latência, +90 ms no p99 pode ser aceitável; para taxa de erro, +2 pontos percentuais pode ser catastrófico. Esse cálculo não é prova universal. Sistemas reais mudam carga, cache, dependências e topologia. O experimento aumenta evidência sobre condições específicas; não demonstra resiliência para todas as condições futuras.

<h2>4. <span lang="en-US">Blast radius</span>: limite o que pode ser afetado</h2>

<span lang="en-US">Blast radius</span> é o escopo potencial de impacto. Pode ser número de instâncias, porcentagem de tráfego, tenant, região, zona, rota ou janela de tempo. Os Principles of Chaos Engineering recomendam minimizar esse raio; a orientação do [Google Cloud](https://cloud.google.com/blog/products/devops-sre/getting-started-with-chaos-engineering) também trata sua definição como prática essencial.

1.  **Ambiente representativo:** valide ferramenta, permissões, telemetria e parada.
2.  **Produção com tráfego sintético:** exercite infraestrutura real sem usuário real quando possível.
3.  **Canário:** atinja uma pequena fração de instâncias ou requisições.
4.  **Escopo maior:** amplie apenas depois de evidência positiva e revisão explícita do risco.

<figure class="mermaid-figure"><div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="Progressão do raio de impacto de um experimento de caos, de ambiente controlado para canário de produção."><pre class="mermaid-source">flowchart LR&#10;  A[Ambiente representativo] --&gt; B[Produção com tráfego sintético]&#10;  B --&gt; C[Canário pequeno]&#10;  C --&gt; D[Escopo ampliado]&#10;  A -. falha de salvaguarda .-&gt; X[Interromper e corrigir]&#10;  B -. stop condition .-&gt; X&#10;  C -. impacto acima do limite .-&gt; X</pre></div><figcaption>Progressão ilustrativa. O aumento de escopo depende de evidência e risco; não existe porcentagem universal que torne um experimento seguro.</figcaption><details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">flowchart LR&#10;  A[Ambiente representativo] --&gt; B[Produção com tráfego sintético]&#10;  B --&gt; C[Canário pequeno]&#10;  C --&gt; D[Escopo ampliado]&#10;  A -. falha de salvaguarda .-&gt; X[Interromper e corrigir]&#10;  B -. stop condition .-&gt; X&#10;  C -. impacto acima do limite .-&gt; X</pre></details></figure>

<h2>5. <span lang="en-US">Stop conditions</span> transformam cautela em mecanismo</h2>

Decidir que alguém acompanhará um painel não é suficiente. Antes do experimento, estabeleça condições de parada objetivas. A AWS Fault Injection Service integra o conceito aos modelos de experimento: alarmes podem interromper a execução quando uma métrica ultrapassa um limite. Mesmo fora da AWS, o princípio é geral.

- **Usuário:** taxa de erro, latência, abandono, monitor sintético.
- **Capacidade:** saturação, crescimento de fila, conexões ou quota.
- **Controle:** perda de telemetria, impossibilidade de reverter ou falha da própria ferramenta de experimento.

Exemplo: encerre o experimento se a taxa de sucesso cair abaixo de 99,8% por dois minutos, se o p99 exceder 700 ms por três janelas consecutivas ou se o canário sintético falhar duas vezes. Se a perturbação puder afetar o pipeline de métricas, perder observabilidade também deve ser uma condição de parada.

<h2>6. Um experimento mínimo, passo a passo</h2>

Considere um serviço de catálogo em Kubernetes com seis réplicas distribuídas entre três zonas. O desenho promete tolerar a perda de uma réplica sem impacto visível.

1.  **Objetivo:** verificar se a perda de uma réplica ativa é absorvida sem violar o SLO.
2.  **Estado estável:** 2.000 req/min, sucesso ≥ 99,95%, p99 ≤ 220 ms.
3.  **Hipótese:** ao encerrar uma réplica, sucesso continuará ≥ 99,9% e p99 ≤ 300 ms; uma réplica nova ficará pronta em até 90 s.
4.  **Escopo:** uma réplica de um único deployment.
5.  **Salvaguardas:** interromper se sucesso \< 99,8%, p99 \> 600 ms por 2 min ou fila interna \> 100.
6.  **Observação:** latência, erros, eventos do balanceador, readiness, tempo de substituição e saturação restante.
7.  **Recuperação:** remover a perturbação, confirmar seis réplicas saudáveis e verificar backlog.

Suponha que o sucesso permaneça em 99,96%, mas o p99 suba para 480 ms e duas réplicas atinjam 92% de CPU. Não houve indisponibilidade, mas parte da hipótese foi refutada. A arquitetura tolera a falha funcionalmente, porém com margem de capacidade pequena. Essa é uma descoberta útil antes de uma falha real coincidir com um pico de tráfego.

<h2>7. Observabilidade não é decoração</h2>

Uma métrica global diz se houve impacto, mas não explica por que. Logs podem mostrar que o balanceador demorou a remover a instância; traces podem revelar <span lang="en-US">retries</span> em cascata; métricas de filas e pools podem mostrar saturação; eventos do orquestrador registram a recuperação da capacidade.

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Tabela rolável de sinais para experimentos de caos"><table><thead><tr><th>Camada</th><th>Pergunta</th><th>Exemplos</th></tr></thead><tbody><tr><td>Experiência</td><td>O usuário percebeu degradação?</td><td>SLI, canário, sucesso, p95/p99</td></tr><tr><td>Mecanismo</td><td>A proteção esperada funcionou?</td><td>failover, autoscaling, circuit breaker, fila</td></tr><tr><td>Infraestrutura</td><td>Como a falha se propagou?</td><td>nó, rede, zona, storage, quotas, control plane</td></tr></tbody></table></div>

Evite medir apenas o componente perturbado. É possível ter um componente saudável enquanto a jornada do usuário falha. Também não conclua causalidade apenas porque duas curvas mudaram juntas; use a linha do tempo do experimento, eventos de injeção e traces para sustentar a explicação.

<h2>8. Escolha falhas que investiguem uma incerteza</h2>

- **Compute:** encerrar processo, pod, VM ou nó para testar redistribuição e reposição.
- **Rede:** adicionar latência, perda, jitter, DNS falhando ou partição para testar timeouts, retries e degradação parcial.
- **Dependência:** devolver erro ou lentidão de um serviço downstream para observar circuit breakers, caches e caminhos alternativos.
- **Armazenamento:** aumentar latência de I/O ou indisponibilizar réplica para testar backpressure e failover.
- **Quota:** esgotar conexões, threads ou limites de API para encontrar saturação.
- **Zona ou região:** retirar capacidade geográfica para verificar roteamento e dependências escondidas.

Não comece pelo cenário mais dramático. A falha certa é a menor perturbação capaz de testar a hipótese que importa.

<h2>9. Ferramenta não substitui o experimento</h2>

Chaos Monkey, AWS Fault Injection Service, Chaos Mesh, Litmus e outras ferramentas automatizam partes da injeção e do controle. Elas não decidem qual hipótese merece ser testada nem qual impacto é aceitável. O repositório oficial do [Chaos Monkey](https://github.com/Netflix/chaosmonkey) descreve a ferramenta como um mecanismo de terminação aleatória de instâncias e containers em produção; práticas modernas adicionam escopo, logs, rollback e <span lang="en-US">stop conditions</span> explícitas.

A AWS desaconselha scripts ad hoc que não entendam o estado atual, não emitam logs ou não forneçam rollback e parada quando possível. O ponto não é proibir scripts; é impedir que a ferramenta de caos se torne uma fonte opaca de risco.

<h2>10. Produção não é um ritual</h2>

Produção concentra tráfego real, dados reais, configuração efetiva, quotas e dependências que ambientes artificiais não reproduzem. Também concentra risco ao usuário. A decisão deve ser gestão de risco: o experimento já passou em ambiente representativo? As <span lang="en-US">stop conditions</span> foram testadas? A reversão independe do componente perturbado? Há observabilidade suficiente? O raio de impacto é pequeno? A equipe responsável sabe da execução?

Se essas respostas forem negativas, avançar diretamente para produção não torna o teste mais autêntico; apenas aumenta risco sem aumentar proporcionalmente o aprendizado.

<h2>11. <span lang="en-US">Game days</span> e regressão automatizada</h2>

Um <span lang="en-US">game day</span> exercita sistema e organização juntos: engenharia, observabilidade, comunicação, runbooks, escalonamento e decisões humanas. Um experimento automatizado testa continuamente uma propriedade específica, como perder uma réplica sem violar o SLO. Quando uma hipótese já foi confirmada e o experimento é seguro, automatizá-lo pode transformar uma descoberta pontual em proteção contra regressão.

<h2>12. Anti-padrões</h2>

- **Quebrar produção sem hipótese:** gera estresse e pouco aprendizado reproduzível.
- **Testar algo já conhecido como quebrado:** corrija primeiro; caos investiga incerteza.
- **Medir apenas o componente:** pode declarar sucesso enquanto o usuário sofre.
- **Sem condição de parada:** transforma teste controlado em incidente potencialmente aberto.
- **Blast radius grande desde o início:** aumenta risco antes de validar ferramenta e rollback.
- **Confundir ausência de incidente com prova:** um experimento cobre condições limitadas.

<h2>13. O que significa um experimento que passou</h2>

Se a hipótese foi sustentada, significa que, sob aquela carga, topologia, configuração e perturbação, os sinais permaneceram dentro dos limites. Isso aumenta confiança, mas não elimina incerteza. Mudanças de versão, tráfego, caches, dependências e autoscaling podem invalidar a evidência.

<figure class="mermaid-figure"><div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="Ciclo de chaos engineering do estado estável até aprendizado e repetição."><pre class="mermaid-source">flowchart LR&#10;  S[Estado estável] --&gt; H[Hipótese]&#10;  H --&gt; G[Guardrails e blast radius]&#10;  G --&gt; I[Injetar falha]&#10;  I --&gt; O[Observar]&#10;  O --&gt; V{Dentro dos limites?}&#10;  V -- sim --&gt; L[Registrar evidência]&#10;  V -- não --&gt; P[Parar, recuperar e corrigir]&#10;  L --&gt; R[Repetir como regressão]&#10;  P --&gt; R&#10;  R --&gt; S</pre></div><figcaption>O experimento termina em evidência ou correção, não em uma declaração permanente de que o sistema é resiliente.</figcaption><details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">flowchart LR&#10;  S[Estado estável] --&gt; H[Hipótese]&#10;  H --&gt; G[Guardrails e blast radius]&#10;  G --&gt; I[Injetar falha]&#10;  I --&gt; O[Observar]&#10;  O --&gt; V{Dentro dos limites?}&#10;  V -- sim --&gt; L[Registrar evidência]&#10;  V -- não --&gt; P[Parar, recuperar e corrigir]&#10;  L --&gt; R[Repetir como regressão]&#10;  P --&gt; R&#10;  R --&gt; S</pre></details></figure>

<h2>Resumo mental</h2>

<span lang="en-US">Chaos engineering</span> não é aleatoriedade aplicada à produção. É método científico adaptado à operação: observe um estado estável, formule uma hipótese, injete uma perturbação realista com <span lang="en-US">blast radius</span> limitado, monitore sinais de usuário e mecanismo, pare se os limites forem violados e transforme o resultado em melhoria ou regressão automatizada. O produto do experimento não é caos; é evidência sobre resiliência.

<h2>Perguntas de revisão</h2>

1.  Por que uma hipótese precisa incluir comportamento externo, e não apenas o componente desligado?
2.  Qual é a diferença entre estado estável e ausência total de degradação?
3.  Por que <span lang="en-US">blast radius</span> e <span lang="en-US">stop conditions</span> não são detalhes opcionais?
4.  O que um experimento bem-sucedido realmente permite concluir?

<h2>Exercícios</h2>

1.  **Escreva uma hipótese:** escolha um serviço e inclua falha, mecanismo esperado, janela de recuperação e dois limites mensuráveis.
2.  **Desenhe guardrails:** para uma API com SLO de 99,9%, defina condições de parada para usuário, capacidade e perda de observabilidade.
3.  **Reduza o blast radius:** pegue um cenário de falha de região e proponha quatro degraus de experimento antes de atingir tráfego real amplo.

<h2>Fontes</h2>

- [Principles of Chaos Engineering — versão em português](https://principlesofchaos.org/pt/).
- [Netflix TechBlog — The Netflix Simian Army](https://medium.com/netflix-techblog/the-netflix-simian-army-16e57fbab116), 19 jul. 2011.
- [Netflix/chaosmonkey — repositório oficial](https://github.com/Netflix/chaosmonkey).
- [AWS Well-Architected — testar resiliência com engenharia do caos](https://docs.aws.amazon.com/pt_br/wellarchitected/latest/framework/rel_testing_resiliency_failure_injection_resiliency.html).
- [AWS Prescriptive Guidance — ciclo de vida contínuo do experimento](https://docs.aws.amazon.com/prescriptive-guidance/latest/chaos-engineering-on-aws/lifecycle.html).
- [Google Cloud — Getting started with chaos engineering](https://cloud.google.com/blog/products/devops-sre/getting-started-with-chaos-engineering).
