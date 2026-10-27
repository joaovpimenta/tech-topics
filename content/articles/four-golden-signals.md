---
slug: four-golden-signals
language: pt-BR
title: 'Four Golden Signals: da experiência do usuário ao diagnóstico'
category: Arquitetura · SRE
date: 12 de setembro de 2026
publishedAt: '2026-09-12'
read: 22 min de leitura
image: assets/four-golden-signals/four-golden-signals-cover.jpg
alt: 'Ilustração abstrata dos quatro sinais dourados: ondas de latência, tráfego,
  erros e capacidade.'
dek: 'Latência, tráfego, erros e saturação: um guia do zero à prática, com matemática,
  diagramas, PromQL e um simulador de fila.'
speechMarkup:
  title:
  - text: Four Golden Signals
    lang: en-US
  - text: ': da experiência do usuário ao diagnóstico'
    lang: pt-BR
excerpt: Aprenda a medir a saúde de um serviço com os quatro sinais dourados, interpretar
  falhas e ligar métricas a SLOs. Inclui gráficos, um simulador e exercícios locais.
tags:
- observabilidade
- sre
- desempenho
- confiabilidade
---

Olhe para um restaurante: o salão está aberto, a cozinha funciona e os funcionários estão trabalhando. Ainda assim, os clientes reclamam que os pedidos demoram, chegam errados ou ficam parados na fila. O que está acontecendo? É justamente isso que os <span lang="en-US">Four Golden Signals</span> ajudam a investigar: latência, tráfego, erros e saturação. Eles mostram quanto tempo o atendimento leva, quantos pedidos chegam, quantos falham e quão perto a cozinha está do limite.

<div class="fgs-guide">

Os **<span lang="en-US">Four Golden Signals</span> (FGS)**, ou quatro sinais dourados, organizam essa investigação em quatro perguntas: quanto demora, quanto trabalho chega, quanto falha e onde falta capacidade. Não são um produto nem quatro números mágicos: são quatro dimensões, que podem exigir várias métricas.

<nav class="fgs-toc" aria-label="Neste artigo"><strong>Neste guia</strong><ul><li><a href="#fgs-origem">Origem e princípios</a></li><li><a href="#fgs-sinais">Os quatro sinais</a></li><li><a href="#fgs-matematica">Matemática e simulador</a></li><li><a href="#fgs-instrumentacao">Arquitetura e instrumentação</a></li><li><a href="#fgs-promql">Consultas PromQL</a></li><li><a href="#fgs-incidentes">Falhas e decisões</a></li><li><a href="#fgs-slo">SLOs e alertas</a></li><li><a href="#fgs-exercicios">Revisão e experimentos</a></li><li><a href="#fgs-fontes">Fontes</a></li></ul></nav>

<h2 id="fgs-origem">1. Origem: uma heurística de engenharia, não uma lei</h2>

A primeira edição de *<span lang="en-US">Site Reliability Engineering: How Google Runs Production Systems</span>* foi publicada em 2016, editada por Betsy Beyer, Chris Jones, Jennifer Petoff e Niall Richard Murphy. O capítulo *<span lang="en-US">Monitoring Distributed Systems</span>*, escrito por Rob Ewaschuk e editado por Beyer, apresenta os quatro sinais. Essa é uma referência histórica verificável; não demonstra que o nome ou cada prática tenham sido inventados naquele ano. [Registro do livro](https://research.google/pubs/site-reliability-engineering-how-google-runs-production-systems/) · [Capítulo original](https://sre.google/sre-book/monitoring-distributed-systems/).

A formulação trata latência como duração do atendimento, tráfego como demanda, erros como falhas explícitas ou de contrato e saturação como proximidade dos limites. O capítulo também distingue observação externa (*black-box*) e interna (*white-box*). As duas perspectivas se complementam. [Google SRE](https://sre.google/sre-book/monitoring-distributed-systems/).

<div class="article-callout">

**Interpretação operacional deste guia:** use os sinais para formular hipóteses. Uma correlação entre latência e fila não prova a causa; traces, logs, perfis e testes ajudam a confirmá-la. FGS é uma porta de entrada para observabilidade, não sua definição completa.

</div>

<h2 id="fgs-sinais">2. Os quatro sinais, do usuário ao recurso</h2>

<div class="signal-grid">

<div class="signal-card">

### Latência

Quanto tempo uma operação leva? Observe distribuição, p50, p95 e p99; separe sucessos, falhas e tempo limite.

</div>

<div class="signal-card">

### Tráfego

Quanto trabalho é oferecido e concluído? Use requisições/s, mensagens/s, bytes/s ou sessões, conforme o sistema.

</div>

<div class="signal-card">

### Erros

Quantas operações não cumprem o contrato? Inclua status, timeouts, respostas incorretas e falhas parciais.

</div>

<div class="signal-card">

### Saturação

Que limite restringe o serviço? Investigue filas, espera por conexões, throttling, memória e capacidade disponível.

</div>

</div>

### Latência: a média pode esconder quem está sofrendo

Defina o início e o fim da medição. A duração no servidor não inclui necessariamente DNS, conexão, rede ou renderização no cliente. Uma chamada assíncrona aceita em 20 ms pode levar minutos para produzir o resultado; meça também o tempo até a conclusão do trabalho.

Considere 100 requisições: 90 levam 100 ms e 10 levam 1.500 ms. A média é **(90 × 100 + 10 × 1.500) / 100 = 240 ms**. Pelo método do posto mais próximo, p50 = 100 ms e p95 = p99 = 1.500 ms. A média não está errada: responde a uma pergunta diferente da cauda.

<figure class="mermaid-figure">
<div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="Distribuição de latência: a maioria é rápida, mas uma cauda longa domina a experiência.">
<pre class="mermaid-source"><code>xychart-beta
  title &quot;100 requisições por duração&quot;
  x-axis [fast, tail]
  y-axis &quot;requisições&quot; 0 --&gt; 100
  bar [90, 10]</code></pre>
</div>
<details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">xychart-beta
  title &quot;100 requisições por duração&quot;
  x-axis [100ms, 1500ms]
  y-axis &quot;requisições&quot; 0 --&gt; 100
  bar [90, 10]</pre></details>
<figcaption>Dados sintéticos, não telemetria real. As barras representam quantidades, não duração; cada observação pertence a um dos dois grupos.</figcaption>
</figure>

Percentis de instâncias não devem ser simplesmente promediados. Para obter o p95 do serviço, agregue uma representação da distribuição. Histogramas permitem essa agregação; quantis pré-calculados por *summaries* não oferecem a mesma operação. Buckets mal posicionados reduzem a precisão. [Histogramas e summaries](https://prometheus.io/docs/practices/histograms/).

### Tráfego: demanda não é o mesmo que vazão

Uma API pode receber 1.200 requisições/s e concluir só 900/s. Meça entrada, rejeições, conclusões e trabalho em andamento sem somar fronteiras diferentes. Se retries elevarem 1.000 operações de usuário para 1.400 tentativas internas, contar apenas tentativas faz a demanda parecer 40% maior.

Em filas, acompanhe produção, consumo e idade da mensagem mais antiga. Se entram 120 mensagens/s e saem 100/s, o backlog cresce aproximadamente 20/s: em cinco minutos, mais 6.000 mensagens, enquanto essas taxas se mantiverem. Tráfego baixo também pode indicar falha de DNS, gateway ou coleta, não alívio de carga.

### Erros: uma resposta 200 pode estar errada

Comece pelo contrato: “criar um pedido correto dentro do prazo”. Um 500 é uma falha explícita; um pedido com valor errado é falha semântica; um timeout no cliente pode ser falha mesmo que o servidor termine depois. Nem todo 4xx deve entrar automaticamente no SLI de disponibilidade; uma entrada inválida e uma rejeição indevida são situações diferentes.

Defina um conjunto de eventos elegíveis e marque cada evento como bom ou ruim. Se uma requisição é lenta *e* falha, conte uma única requisição ruim no SLI composto. Não some categorias sobrepostas. Em 10.000 eventos elegíveis com 25 ruins, a fração ruim é 25/10.000 = 0,0025 = **0,25%**.

### Saturação: “ocupado” não significa necessariamente “sem capacidade”

CPU ocupada é utilização; espera na fila por CPU é evidência de saturação. Um pool com 80 conexões usadas de 100 está em 80% de utilização. Já espera para adquirir conexão, recusas e fila crescente mostram pressão sobre o limite. Um banco pode ter CPU baixa e estar bloqueado por locks ou I/O.

O método USE de Brendan Gregg distingue utilização, saturação e erros por recurso. É uma lente útil para aprofundar o quarto sinal, sem supor que toda porcentagem de uso revele o gargalo. [USE Method](https://www.brendangregg.com/usemethod.html).

<h2 id="fgs-matematica">3. A matemática que conecta demanda e espera</h2>

### Taxas, janelas e denominadores

<div class="fgs-formula">

`λ = ΔN / Δt   ·   e = N_ruins / N_elegíveis`

</div>

λ é uma taxa de chegada, em eventos/s. e é uma fração sem unidade; multiplique por 100 para expressá-la em porcentagem. Em 60 segundos, 6.000 chegadas correspondem a 100/s. Se não houver eventos elegíveis, a fração de erros não é zero: é indefinida. Mostre “sem tráfego”, não “100% saudável”.

Janelas curtas reagem rápido e oscilam; longas suavizam e atrasam. Com 2 eventos e 1 falha, a taxa é 50%; com 20.000 e 1 falha, 0,005%. O denominador é parte do diagnóstico.

### Lei de Little: concorrência, vazão e duração

<div class="fgs-formula">

`L = λ × W`

</div>

L é o número médio de operações dentro de uma fronteira; W é o tempo médio nessa fronteira; λ é a taxa média compatível com ela. A relação é associada a John D. C. Little e ao artigo de 1961. Sua aplicação exige médias bem definidas e cuidado com regime e fronteiras: não misture chegadas ao gateway com duração apenas no banco. [Paper original](https://pubsonline.informs.org/doi/10.1287/opre.9.3.383).

Exemplo próprio: em um regime estável, 200 operações/s com duração média de 0,15 s implicam aproximadamente **30 operações em andamento**. Se W passar a 0,60 s e a vazão continuar igual, L será 120. Isso ajuda a dimensionar e investigar concorrência; não determina sozinho a capacidade ideal de um pool.

### M/M/1: por que a espera cresce antes de 100%

Um modelo didático usa chegadas Poisson, tempos de serviço exponenciais independentes, um único servidor, disciplina FIFO e fila ilimitada. Com λ \< μ, a utilização é ρ = λ/μ e o tempo médio no sistema é W = 1/(μ − λ). Não confunda W com apenas a espera na fila: Wq = W − 1/μ. [Descrição do modelo M/M/1](https://www.mathworks.com/help/simevents/ug/m-m-1-queuing-system.html).

Se μ = 100 operações/s, o serviço médio isolado leva 10 ms. Com λ = 50/s, W = 20 ms; com 90/s, W = 100 ms; com 95/s, W = 200 ms. Aumentar a utilização de 90% para 95% dobra a duração média neste modelo.

<figure class="mermaid-figure">
<div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="O tempo médio cresce de forma não linear quando a carga se aproxima da capacidade.">
<pre class="mermaid-source"><code>xychart-beta
  title &quot;M/M/1 · capacidade 100 por segundo&quot;
  x-axis [load50, load80, load90, load95]
  y-axis &quot;tempo médio (ms)&quot; 0 --&gt; 220
  bar [20, 50, 100, 200]</code></pre>
</div>
<details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">xychart-beta
  title &quot;M/M/1 · capacidade 100 por segundo&quot;
  x-axis [50, 80, 90, 95]
  y-axis &quot;tempo médio (ms)&quot; 0 --&gt; 220
  bar [20, 50, 100, 200]</pre></details>
<figcaption>Resultados analíticos de um modelo idealizado, não uma previsão para sua API. Os comprimentos das barras usam a mesma escala linear.</figcaption>
</figure>

<section class="fgs-simulator" id="fgs-simulator" aria-labelledby="fgs-sim-title"><h3 id="fgs-sim-title">Experimente: aumente a demanda</h3><p>Capacidade fixa: μ = 100 operações/s. O controle altera λ e recalcula o modelo; não gera carga nem acessa servidores.</p><label for="fgs-arrival">Chegadas por segundo (λ)</label><input id="fgs-arrival" type="range" min="10" max="99" step="1" value="80" /><div class="fgs-sim-results" aria-live="polite" aria-atomic="true"><p>Tráfego: <output id="fgs-traffic" for="fgs-arrival">80 operações/s</output></p><p>Utilização: <output id="fgs-utilization" for="fgs-arrival">80%</output></p><p>Tempo médio total: <output id="fgs-duration" for="fgs-arrival">50 ms</output></p><p>Operações no sistema: <output id="fgs-concurrency" for="fgs-arrival">4</output></p></div><p class="fgs-small">O modelo não calcula erros, percentis, retries ou perdas. Para λ ≥ μ, não há regime estacionário com médias finitas neste modelo. Um sistema real pode rejeitar carga, ter filas finitas, múltiplos workers ou comportamento bem diferente.</p></section>

<h2 id="fgs-instrumentacao">4. Arquitetura: onde observar cada dimensão</h2>

<figure class="mermaid-figure">
<div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="A experiência do cliente atravessa gateway, API e banco; cada camada precisa de observabilidade.">
<pre class="mermaid-source"><code>flowchart LR
  C[Cliente] --&gt; G[Gateway]
  G --&gt; A[API]
  A --&gt; D[Banco]
  G -. métricas .-&gt; M[Coletor]
  A -. métricas .-&gt; M
  D -. métricas .-&gt; M</code></pre>
</div>
<details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">flowchart LR
  C[Cliente] --&gt; G[Gateway]
  G --&gt; A[API]
  A --&gt; D[Banco]
  G -. métricas .-&gt; M[Coletor]
  A -. métricas .-&gt; M
  D -. métricas .-&gt; M</pre></details>
<figcaption>Arquitetura ilustrativa. Não some contagens do gateway e da API como se fossem operações distintas do usuário.</figcaption>
</figure>

1.  **Escolha a jornada e o contrato.** Por exemplo, finalizar um pedido corretamente em até 1 segundo.
2.  **Delimite a observação.** Cliente, gateway, API, dependências e conclusão assíncrona têm fronteiras diferentes.
3.  **Instrumente o atendimento.** Conte eventos e resultados; registre duração em histogramas, inclusive falhas e timeouts.
4.  **Instrumente recursos limitantes.** Exponha tamanho de fila, tempo de espera por pool, throttling e limites relevantes.
5.  **Use dimensões controladas.** Serviço, rota normalizada, resultado e região. Evite IDs de usuário, pedido ou URL completa como labels.
6.  **Valide a coleta.** Compare contagens com uma fonte independente, teste ausência de séries e confirme unidades e intervalo de scrape.
7.  **Construa um painel de investigação.** Quatro dimensões na mesma linha do tempo; anote deploys e mudanças de configuração.
8.  **Teste uma falha.** Injete atraso ou erro apenas em ambiente local/de teste e confirme que o painel explica o impacto.

Cardinalidade pode explodir multiplicativamente: 20 rotas × 5 resultados × 3 regiões × 50 instâncias produzem até 15.000 combinações, antes dos buckets. Use IDs de correlação em logs/traces, não como rótulos ilimitados de métricas. Esse cálculo é uma estimativa do produto cartesiano; nem todas as combinações precisam existir.

<h2 id="fgs-promql">5. PromQL: consultas com escopo e unidade</h2>

Os nomes abaixo são um **contrato de instrumentação ilustrativo**, não nomes universais. Pressupomos contadores `http_requests_total{job,route,status}`, histogramas clássicos de duração em segundos e gauges de pool com labels compatíveis. Substitua o job, as rotas e a definição de erro pelos do seu serviço.

### Tráfego concluído, por rota

``` code-block
sum by (route) (
  rate(http_requests_total{job="checkout-api"}[5m])
)
```

Unidade: requisições/s. Como este contador é incrementado ao término, ele mede conclusões, não necessariamente chegadas. Para medir demanda oferecida, exponha um contador na entrada.

### Fração de respostas 5xx, por rota

``` code-block
sum by (route) (
  rate(http_requests_total{job="checkout-api",status=~"5.."}[5m])
)
/
sum by (route) (
  rate(http_requests_total{job="checkout-api"}[5m])
)
```

Multiplique por 100 para obter %. Aqui 5xx é apenas um proxy de falha técnica. Eventos sem resposta e falhas semânticas exigem instrumentação própria. Séries ausentes podem eliminar o resultado; inicialize os resultados esperados ou trate ausência explicitamente. Divisão por zero não representa saúde.

### p95 de sucessos, por rota, agregado entre instâncias

``` code-block
histogram_quantile(
  0.95,
  sum by (route, le) (
    rate(http_request_duration_seconds_bucket{
      job="checkout-api",status=~"2.."
    }[5m])
  )
)
```

Unidade: segundos. O label `le` é necessário para histogramas clássicos. Faça `rate` antes da soma para preservar o tratamento dos resets de contadores. O quantil é estimado por interpolação, não uma leitura exata dos eventos. [Referência das funções](https://prometheus.io/docs/prometheus/latest/querying/functions/).

Construa também um painel de duração de falhas: excluir erros do p95 de sucessos não é motivo para descartá-los da observação. Não agregue rotas com contratos muito diferentes sem uma justificativa.

### Fração de sucessos em até 300 ms

``` code-block
sum by (route) (
  rate(http_request_duration_seconds_bucket{
    job="checkout-api",status=~"2..",le="0.3"
  }[5m])
)
/
sum by (route) (
  rate(http_request_duration_seconds_count{
    job="checkout-api",status=~"2.."
  }[5m])
)
```

O bucket de 0,3 s precisa existir. Esta é uma fração de rapidez *condicionada aos sucessos*, não um SLI composto de sucesso e rapidez sobre todas as requisições. Para o composto, use bons e elegíveis da mesma população e inclua os eventos sem resposta no contrato.

### Ocupação do pool, por instância

``` code-block
db_pool_connections_in_use{job="checkout-api"}
/
db_pool_connections_limit{job="checkout-api"}
```

Unidade: fração do limite. O limite deve ser positivo, e ambos os gauges devem compartilhar os mesmos labels. Preserve instâncias: somar tudo pode esconder uma instância cheia. Junte essa utilização ao tempo de espera e ao tamanho da fila.

**Nota atual:** Prometheus também suporta histogramas nativos, cuja consulta não usa buckets `_bucket` nem o label `le`. A escolha depende do backend, da biblioteca e da configuração; não converta estas consultas cegamente. [Documentação atual](https://prometheus.io/docs/practices/histograms/).

<h2 id="fgs-incidentes">6. Leia padrões; não declare causas pelo gráfico</h2>

<div class="fgs-table-scroll" tabindex="0" role="region" aria-label="Cenários de incidente e hipóteses"><table><caption>Cenários hipotéticos para investigação</caption><thead><tr><th scope="col">Padrão observado</th><th scope="col">Hipótese</th><th scope="col">Como investigar</th></tr></thead><tbody><tr><td>Tráfego sobe; fila e latência sobem; erros aparecem depois</td><td>Capacidade insuficiente ou serviço mais caro</td><td>Compare chegada e conclusão, tempo de serviço, fila e throttling.</td></tr><tr><td>Tráfego estável; latência sobe; CPU baixa; espera por pool alta</td><td>Banco lento, locks ou conexões retidas</td><td>Traces, espera por conexão, duração de queries e locks.</td></tr><tr><td>Erros sobem; latência global cai</td><td>Falhas rápidas substituem sucessos lentos</td><td>Separe duração e volume por resultado; verifique dependências.</td></tr><tr><td>Cliente falha; API registra pouco tráfego e poucos erros</td><td>Problema antes da API ou na instrumentação</td><td>Probes externos, DNS, gateway e saúde da coleta.</td></tr><tr><td>Mensagens aceitas rápido; idade do backlog cresce</td><td>Conclusão assíncrona não acompanha entrada</td><td>Vazão dos consumidores, retries e tempo até o resultado final.</td></tr></tbody></table></div>

**Exemplo de incidente:** um deploy aumenta o tempo médio de consulta de 10 para 40 ms. Sem alterar a chegada de pedidos, mais requisições ficam em andamento. A fila do pool cresce; parte excede o deadline. Aumentar threads pode ampliar a pressão sobre o banco. O painel orienta a hipótese, mas é a comparação de traces e queries antes/depois do deploy que sustenta a investigação.

Retries podem mascarar erros de tentativas enquanto elevam latência e trabalho. Circuit breakers e load shedding podem aumentar rejeições intencionais e, ao mesmo tempo, proteger o restante do serviço. Meça rejeições separadamente e decida sua inclusão no SLI pelo contrato com o usuário.

<h2 id="fgs-slo">7. Transforme sintomas em objetivos e alertas</h2>

**SLI** é um indicador com população e regra de medição; **SLO** é a meta desse indicador em uma janela; **SLA** é um compromisso contratual, frequentemente com consequências comerciais. Exemplo próprio: “99,9% dos eventos elegíveis do checkout são corretos e terminam em até 1 segundo, em 30 dias”. Isso não é o mesmo que “p99 \< 1 s”.

<div class="fgs-formula">

`SLI = N_bons / N_elegíveis`  
`Orçamento = (1 − SLO) × N_elegíveis`  
`Burn rate = fração_ruim_observada / (1 − SLO)`

</div>

Com 1.000.000 de eventos elegíveis e SLO de 99,9%, o orçamento é 1.000 eventos ruins. Se uma janela recente tem 1% de eventos ruins, o burn rate é 0,01/0,001 = **10**. Mantida essa fração, o serviço consome orçamento dez vezes mais rápido que a taxa compatível com o SLO. “Esgota em três dias” exige hipóteses adicionais sobre volume, orçamento restante e horizonte; não é uma consequência automática do número 10.

Para um SLO baseado em eventos, não converta diretamente esse orçamento em minutos de indisponibilidade. Em janelas ainda abertas, o total de eventos do período também ainda não é conhecido.

O *SRE Workbook* apresenta alertas de múltiplas janelas: combinar uma janela longa e uma curta ajuda a detectar consumo relevante e confirmar que ele continua. Os valores do livro, como 14,4× em 1 h e 5 min para um SLO de 99,9%, são pontos de partida, não constantes universais. [<span lang="en-US">Alerting on SLOs</span>](https://sre.google/workbook/alerting-on-slos/).

- **Acione plantão** quando há impacto relevante ou risco iminente e uma ação útil para a equipe.
- **Abra trabalho planejado** para tendências de capacidade e degradações menos urgentes.
- **Inclua um runbook:** contrato afetado, evidências, links, primeiros passos e mitigação segura.
- **Teste a ausência de dados.** Não deixe um painel sem séries parecer um painel sem falhas.

Alertar cada gráfico separadamente pode produzir quatro notificações para o mesmo incidente. Agrupe por jornada/serviço e separe detecção de impacto de investigação de causa. Uma fila crescente pode merecer ação antes de haver falhas; a política depende do risco e do tempo disponível para reagir.

## 8. FGS, RED, USE e outras ferramentas

<div class="fgs-table-scroll" tabindex="0" role="region" aria-label="Comparação de métodos"><table><caption>Lentes complementares, não concorrentes</caption><thead><tr><th scope="col">Lente</th><th scope="col">Foco</th><th scope="col">Pergunta útil</th></tr></thead><tbody><tr><td>FGS</td><td>Serviço e seus limites</td><td>Como demanda, duração, falhas e capacidade se relacionam?</td></tr><tr><td>RED</td><td>Rate, <span lang="en-US">Errors</span>, Duration por serviço</td><td>Qual serviço está degradado?</td></tr><tr><td>USE</td><td><span lang="en-US">Utilization</span>, <span lang="en-US">Saturation</span>, <span lang="en-US">Errors</span> por recurso</td><td>Qual recurso está limitando o trabalho?</td></tr><tr><td>Traces e logs</td><td>Execuções e eventos específicos</td><td>Onde uma operação esperou e o que aconteceu?</td></tr><tr><td>SLIs e SLOs</td><td>Contrato e confiabilidade</td><td>Qual impacto é aceitável e quando agir?</td></tr></tbody></table></div>

O método RED é associado a Tom Wilkie; um relato da Grafana sobre sua apresentação informa sua criação em 2015. USE é associado a Brendan Gregg. Não atribua os quatro sinais a esses autores: são referências relacionadas, com propósitos próprios. [Relato sobre RED](https://grafana.com/blog/the-red-method-how-to-instrument-your-services/) · [USE original](https://www.brendangregg.com/usemethod.html).

Backpressure, rate limiting, bulkheads e load shedding são mecanismos de controle; FGS ajuda a observar seus efeitos. O painel não implementa resiliência. Em sistemas distribuídos, uma fronteira “saudável” não implica que a jornada inteira esteja saudável.

## 9. Limitações, <span lang="en-US">trade-offs</span> e quando não basta

- **Quatro dimensões não cobrem tudo.** Correção de dados, segurança, integridade e frescor podem exigir indicadores específicos.
- **Agregação reduz custo e esconde minorias.** Divida por rotas, regiões ou classes de trabalho quando o contrato justificar.
- **Granularidade custa.** Mais labels, buckets e retenção aumentam séries e armazenamento; menos detalhes dificultam investigação.
- **Instrumentação altera o sistema.** Meça overhead e perda de telemetria; não faça uma falha de exportação bloquear o checkout.
- **Uma taxa não informa todo o produto.** Em jobs e pipelines, acrescente conclusão, atraso, frescor, duplicação e qualidade do resultado.
- **Não use FGS como prova de conformidade ou segurança.** Ter latência baixa e erros técnicos baixos não demonstra ausência de vazamento.
- **Não transporte um limite genérico.** “CPU acima de 80%” pode ser irrelevante num serviço e urgente em outro.

**Anti-padrões:** alertar só por média; contar health checks como a jornada do usuário; misturar sucessos e falhas rápidas; fazer média de p95; tratar ausência como zero; usar IDs como labels; ignorar resultados assíncronos; confundir utilização de CPU com saturação de todo o sistema.

<h2 id="fgs-exercicios">10. Resumo mental e revisão</h2>

<div class="article-callout">

**Resumo mental:** tráfego descreve o trabalho; latência, a demora; erros, o descumprimento do contrato; saturação, a pressão sobre limites. Observe a mesma jornada em fronteiras bem definidas, procure padrões, confirme hipóteses e vincule a resposta operacional a objetivos de confiabilidade.

</div>

1.  Por que uma falha de banco pode reduzir a média de latência e piorar a experiência?
2.  Qual é a diferença entre 80% de ocupação de um pool e uma fila esperando por ele?
3.  Por que 100 operações de usuário podem gerar mais de 100 tentativas internas?
4.  Que informações faltam para interpretar uma taxa de erros de 10%?
5.  Por que o p95 global não é a média dos p95 das instâncias?
6.  Um job foi aceito em 20 ms e terminou em 10 minutos. Qual fronteira deve participar do SLI?

### Experimento 1 · Média versus cauda, com Python

Execute localmente com Python 3, sem instalar bibliotecas. O percentil aqui usa o posto mais próximo; outras convenções podem produzir valores diferentes em amostras pequenas.

``` code-block
from math import ceil
from statistics import mean

latencias_ms = sorted([100] * 90 + [1500] * 10)
def percentil(p):
    return latencias_ms[ceil(p * len(latencias_ms)) - 1]

print("media:", mean(latencias_ms), "ms")
for p in (0.50, 0.95, 0.99):
    print(f"p{int(p * 100)}:", percentil(p), "ms")
```

Resultado esperado: média 240 ms; p50 100 ms; p95 e p99 1.500 ms. Troque a amostra por 99 valores de 100 ms e um de 10.000 ms. O p99 passa a 100 ms por esta convenção: um quantil escolhido pode deixar a última observação fora. Investigue também o máximo e o volume.

### Experimento 2 · Capacidade, no simulador

No controle acima, compare λ = 50, 90, 95 e 99. Os tempos médios previstos são 20, 100, 200 e 1.000 ms. Explique por que a curva não é linear. Depois calcule W para λ = 90 e μ = 120: aproximadamente 33,3 ms. Pergunta: quais hipóteses seriam violadas por um pool de oito workers com cache?

### Experimento 3 · Defina um SLI sem dupla contagem

Em 1.000 checkouts, 12 falham, 20 ultrapassam o prazo e 5 pertencem aos dois grupos. Quantos são ruins? Pela união, 12 + 20 − 5 = **27**. O SLI composto é 973/1.000 = 97,3%. Defina agora quais entradas inválidas seriam inelegíveis e explique como isso muda o denominador.

<details class="fgs-review"><summary>Conferir as ideias centrais das perguntas</summary><p>Falhas rápidas podem dominar a média; ocupação e espera são dimensões diferentes; retries multiplicam tentativas; porcentagens precisam de população e janela; quantis não se agregam por média; trabalhos assíncronos exigem medir a conclusão da jornada, não apenas sua aceitação.</p></details>

<h2 id="fgs-fontes">11. Fontes e caminhos de aprofundamento</h2>

Fontes consultadas em 12 de setembro de 2026. O contexto histórico é separado das escolhas didáticas deste artigo. Os gráficos, exemplos numéricos e o simulador são originais e usam dados sintéticos; não representam resultados de produção.

1.  [Rob Ewaschuk — <span lang="en-US">Monitoring Distributed Systems</span>](https://sre.google/sre-book/monitoring-distributed-systems/). Fonte primária para os quatro sinais, no livro de SRE.
2.  [Beyer, Jones, Petoff e Murphy — <span lang="en-US">Site Reliability Engineering</span> (2016)](https://research.google/pubs/site-reliability-engineering-how-google-runs-production-systems/). Registro bibliográfico da edição que dá o contexto histórico.
3.  <a href="https://sre.google/workbook/alerting-on-slos/" lang="en-US">The Site Reliability Workbook — <span lang="en-US">Alerting on SLOs</span></a>. Alertas por consumo de orçamento e múltiplas janelas.
4.  [Prometheus — <span lang="en-US">Histograms and summaries</span>](https://prometheus.io/docs/practices/histograms/). Distribuições, agregação e histogramas clássicos/nativos.
5.  [Prometheus — <span lang="en-US">Query functions</span>](https://prometheus.io/docs/prometheus/latest/querying/functions/). Semântica de rate e histogram_quantile; confira a versão do backend.
6.  [Brendan Gregg — <span lang="en-US">The USE Method</span>](https://www.brendangregg.com/usemethod.html). Diagnóstico de recursos; consulte também seu livro *<span lang="en-US">Systems Performance</span>*.
7.  [Grafana — <span lang="en-US">The RED Method</span>](https://grafana.com/blog/the-red-method-how-to-instrument-your-services/). Relato técnico sobre a proposta de Tom Wilkie, uma referência relacionada, não a origem dos FGS.
8.  [John D. C. Little — <span lang="en-US">A Proof for the Queuing Formula</span>: L = λW (1961)](https://pubsonline.informs.org/doi/10.1287/opre.9.3.383). Paper original, DOI 10.1287/opre.9.3.383.
9.  [MathWorks — M/M/1 <span lang="en-US">Queuing System</span>](https://www.mathworks.com/help/simevents/ug/m-m-1-queuing-system.html). Descrição do modelo e suas hipóteses.

<a href="index.html#recent-posts" class="article-back">← Todos os artigos</a>

</div>
