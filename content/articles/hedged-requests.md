---
'slug': 'hedged-requests'
'language': 'pt-BR'
'title': 'Hedged Requests: trocar requisições extras por menor tail latency'
'category': 'Resiliência · Sistemas distribuídos'
'date': '2 de outubro de 2026'
'publishedAt': '2026-10-02'
'read': '24 min de leitura'
'image': 'assets/hedged-requests/hedged-requests-cover.jpg'
'alt': 'Biblioteca moderna em aquarela: uma pessoa espera no balcão enquanto um bibliotecário retorna com um livro e outro ainda procura por uma segunda cópia, com um relógio e marcações editoriais pretas destacando a corrida.'
'dek': 'Aprenda quando vale iniciar uma segunda cópia antes de a primeira falhar, como escolher o atraso, limitar carga extra e medir se a queda de tail latency compensa o trabalho duplicado.'
'speechMarkup':
  'title':
    - 'text': 'Hedged Requests'
      'lang': 'en-US'
    - 'text': ': trocar requisições extras por menor '
      'lang': 'pt-BR'
    - 'text': 'tail latency'
      'lang': 'en-US'
  'dek':
    - 'text': 'Aprenda quando vale iniciar uma segunda cópia antes de a primeira falhar, como escolher o atraso, limitar carga extra e medir se a queda de '
      'lang': 'pt-BR'
    - 'text': 'tail latency'
      'lang': 'en-US'
    - 'text': ' compensa o trabalho duplicado.'
      'lang': 'pt-BR'
'excerpt': 'Entenda como Hedged Requests reduzem p99 ao duplicar apenas a cauda, como calcular o custo, escolher o delay e impedir que a redundância vire sobrecarga.'
'tags':
  - 'desempenho'
  - 'resiliencia'
  - 'sistemas-distribuidos'
---

Você pede um livro raro no balcão da biblioteca e vê a atendente desaparecer entre as estantes. Vai esperar só por ela? O colega do outro balcão olha o relógio e responde que, se já passou o tempo normal de busca, pode procurar outra cópia em paralelo; quando um deles voltar primeiro, o outro recebe o sinal para parar. Em sistemas distribuídos, <span lang="en-US">Hedged Requests</span> fazem a mesma aposta: trocam uma pequena quantidade de trabalho duplicado por menor <span lang="en-US">tail latency</span>, desde que o atraso para disparar a cópia, o cancelamento e o orçamento de capacidade façam parte do mecanismo.

<div class='fgs-guide'>

**Uma requisição hedged não espera a primeira tentativa falhar.** O cliente inicia uma tentativa normal e, se ela permanecer pendente além de um atraso escolhido, dispara uma cópia equivalente para outro backend. A primeira resposta aceitável vence; as demais são canceladas. O objetivo é reduzir a cauda da distribuição de latência, não aumentar a média de throughput nem esconder indisponibilidade permanente.

<nav class='fgs-toc' aria-label='Neste artigo'><strong>Neste guia</strong><ul>
<li><a href='#hedge-cauda'>Por que a cauda domina</a></li>
<li><a href='#hedge-mecanismo'>Mecanismo e linha do tempo</a></li>
<li><a href='#hedge-matematica'>Matemática do ganho e do custo</a></li>
<li><a href='#hedge-seguranca'>Pré-condições de segurança</a></li>
<li><a href='#hedge-delay'>Como escolher o atraso</a></li>
<li><a href='#hedge-operacao'>Operação e observabilidade</a></li>
<li><a href='#hedge-comparacao'>Conceitos vizinhos</a></li>
<li><a href='#hedge-experimento'>Experimento reproduzível</a></li>
<li><a href='#hedge-revisao'>Resumo e revisão</a></li>
<li><a href='#hedge-fontes'>Fontes</a></li>
</ul></nav>

<a name="hedge-cauda"></a>

## 1. O problema não é a requisição típica: é a mais lenta

Latência média responde pouco sobre a experiência de quem cai na cauda. Se um endpoint tem p50 de 25 ms, p95 de 60 ms e p99 de 800 ms, metade das chamadas é rápida, mas uma em cada cem pode levar mais de uma ordem de grandeza a mais. Em uma chamada isolada isso já incomoda; em serviços com <span lang="en-US">fan-out</span>, a cauda se amplifica porque a resposta do pai costuma depender do filho mais lento.

Suponha, como modelo didático, que cada uma de 100 subchamadas independentes tenha 1% de probabilidade de ultrapassar 250 ms. A probabilidade de **pelo menos uma** delas ser lenta é:

<div class='code-block'><pre><code>P(alguma lenta) = 1 − (1 − 0,01)^100&#10;                 ≈ 63,4%</code></pre></div>

A hipótese de independência raramente é perfeita em produção, mas o cálculo mostra por que um percentil aparentemente pequeno por backend pode dominar a latência de uma operação agregada. O artigo clássico [<span lang="en-US">The Tail at Scale</span>](<https://research.google/pubs/the-tail-at-scale/>), de Jeffrey Dean e Luiz André Barroso, descreve esse efeito em serviços de grande escala e popularizou o termo <span lang="en-US">hedged requests</span> para uma das técnicas de mitigação.

<div class='article-callout'><strong>Intuição:</strong> se a lentidão extrema estiver ligada ao estado momentâneo de uma réplica, fila, conexão ou máquina, outra cópia da mesma operação pode escapar daquele evento raro. Se a causa for compartilhada por todas as cópias, a duplicação só compra mais carga.</div>

<h3>Um resultado histórico útil, mas não uma meta</h3>

No benchmark descrito em [<span lang="en-US">The Tail at Scale</span>](<https://barroso.org/publications/TheTailAtScale.pdf>), uma leitura de 1.000 chaves do Bigtable distribuídas por 100 servidores usou uma segunda requisição após 10 ms. O p99,9 da operação caiu de aproximadamente 1.800 ms para 74 ms com cerca de 2% de requisições adicionais. Esses números pertencem àquele experimento e àquela carga; servem para mostrar a ordem de grandeza possível, não para definir um atraso universal de 10 ms ou prometer o mesmo ganho em outro sistema.

<a name="hedge-mecanismo"></a>

## 2. O que uma Hedged Request faz, passo a passo

Considere uma operação lógica `R` que pode ser atendida por duas réplicas equivalentes. O cliente envia a tentativa primária para A no instante `t = 0`. Se A responder antes do atraso `d`, nada muda: houve uma única tentativa. Se `d` expirar e a chamada ainda estiver pendente, o cliente envia uma segunda tentativa para B. A primeira resposta que satisfaz a política vence, e o cliente cancela a tentativa perdedora.

<figure class="mermaid-figure">
  <div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="Linha do tempo de uma requisição hedged: a tentativa primária começa primeiro, a cópia começa após o atraso, a cópia responde antes e o cliente cancela a tentativa original.">
    <pre class="mermaid-source">sequenceDiagram&#10;  participant C as Cliente&#10;  participant A as Réplica A&#10;  participant B as Réplica B&#10;  C-&gt;&gt;A: tentativa 1 em t=0&#10;  Note over C,A: aguarda o atraso d&#10;  C-&gt;&gt;B: tentativa 2 se A ainda está pendente&#10;  B--&gt;&gt;C: primeira resposta aceitável&#10;  C--&gt;&gt;A: cancelamento da tentativa perdedora</pre>
  </div>
  <figcaption>A segunda tentativa só existe para chamadas que atravessam o atraso. O cancelamento reduz desperdício, mas não deve ser tratado como rollback de efeitos já aplicados.</figcaption>
  <details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">sequenceDiagram&#10;  participant C as Cliente&#10;  participant A as Réplica A&#10;  participant B as Réplica B&#10;  C-&gt;&gt;A: tentativa 1 em t=0&#10;  Note over C,A: aguarda o atraso d&#10;  C-&gt;&gt;B: tentativa 2 se A ainda está pendente&#10;  B--&gt;&gt;C: primeira resposta aceitável&#10;  C--&gt;&gt;A: cancelamento da tentativa perdedora</pre></details>
</figure>

A política oficial de [<span lang="en-US">request hedging</span> do gRPC](<https://grpc.io/docs/guides/request-hedging/>) segue essa estrutura: `hedgingDelay` controla o intervalo antes das cópias, `maxAttempts` limita o número de tentativas simultâneas e uma lista de status não fatais define quais respostas permitem continuar. O <span lang="en-US">deadline</span> da chamada vale para toda a cadeia, não reinicia a cada cópia.

<h3>Hedging não é retry com nome novo</h3>

Um <span lang="en-US">retry</span> tradicional começa **depois** que uma tentativa falha, é rejeitada ou estoura um timeout. Hedging começa **enquanto** a tentativa anterior ainda pode terminar com sucesso. A própria documentação do gRPC descreve a ideia como repetir a requisição antes de receber a falha. Essa diferença de tempo muda o risco: hedging pode reduzir p99 mesmo quando nenhuma tentativa falharia, mas mantém duas execuções concorrentes por algum intervalo.

Isso também explica por que [retries com backoff e jitter](<article.html?slug=retries-backoff-jitter>) e hedging resolvem sintomas diferentes. Retry é uma política de recuperação diante de falha transitória; hedging é uma política de redução de variância e de <span lang="en-US">tail latency</span>. Um sistema pode usar ambos, mas precisa de um orçamento único para impedir multiplicação de tentativas em camadas diferentes.

<a name="hedge-matematica"></a>

## 3. A matemática: transformar cauda em corrida

Comece pelo caso mais simples: duas réplicas com tempos de resposta independentes e identicamente distribuídos, `T₁` e `T₂`. Defina `S(t) = P(T > t)`, a probabilidade de uma tentativa ainda não ter terminado no tempo `t`. Se as duas cópias começarem juntas, o tempo lógico é `H = min(T₁, T₂)`. Portanto:

<div class='code-block'><pre><code>P(H &gt; t) = P(T₁ &gt; t e T₂ &gt; t)&#10;           = S(t)²</code></pre></div>

O quadrado é a fonte do ganho idealizado. Se apenas 10% das tentativas individuais excedem um certo tempo, duas cópias independentes excedem esse mesmo tempo com probabilidade de 1%. Nesse modelo, o p99 da corrida entre duas cópias coincide aproximadamente com o p90 de uma cópia. A conclusão depende de independência: uma pausa de <span lang="en-US">garbage collection</span> local pode ser independente; congestionamento regional, saturação do mesmo banco ou uma chave quente compartilhada podem não ser.

<h3>Com atraso, você paga só pela cauda</h3>

O desenho mais comum não duplica todas as chamadas. A tentativa 2 começa apenas após `d`. Para `t < d`, a segunda tentativa ainda não existe. Para `t ≥ d`, no mesmo modelo de independência:

<div class='code-block'><pre><code>P(H &gt; t) = S(t),                         se t &lt; d&#10;&#10;P(H &gt; t) = S(t) × S(t − d),              se t ≥ d</code></pre></div>

A probabilidade de sequer iniciar uma cópia é:

<div class='code-block'><pre><code>q = P(T₁ &gt; d) = S(d)</code></pre></div>

Com no máximo duas tentativas, a taxa de tentativas iniciadas fica aproximadamente em `λ × (1 + q)`, onde `λ` é a taxa de requisições lógicas. Se `d` for o p95 da distribuição saudável, `q ≈ 5%`; para 20.000 requisições lógicas por segundo, o mecanismo inicia em torno de 1.000 tentativas extras por segundo, para um multiplicador de tentativas de cerca de `1,05×`.

Esse cálculo mede **tentativas iniciadas**, não CPU realmente consumida. Uma cópia cancelada antes de entrar na fila pode custar quase nada; uma cópia que já executou uma consulta pesada pode consumir quase o trabalho completo. A documentação de [cancelamento do gRPC](<https://grpc.io/docs/guides/cancellation/>) recomenda que servidores interrompam computação quando recebem o cancelamento, mas o handler da aplicação precisa cooperar; o protocolo não consegue desfazer trabalho arbitrário já realizado.

<h3>O ganho desaparece quando a lentidão é correlacionada</h3>

Considere duas réplicas atrás do mesmo balanceador, no mesmo cluster e dependentes do mesmo banco saturado. A segunda cópia não amostra um estado realmente diferente: ela encontra a mesma fila ou cria mais competição pelo mesmo recurso. O trabalho acadêmico [<span lang="en-US">Reducing Latency via Redundant Requests</span>](<https://www.cs.cmu.edu/~harchol/Papers/Sigmetrics15.pdf>) analisa justamente a troca entre redução de resposta e trabalho redundante em sistemas multi-servidor. O ponto operacional é simples: redundância é útil quando existe variabilidade explorável entre caminhos; perto da saturação, o custo adicional pode alimentar a própria cauda.

<a name="hedge-seguranca"></a>

## 4. Pré-condições antes de duplicar uma chamada

<div class='signal-grid'>
<section class='signal-card'><h3>Resultado equivalente</h3><p>As tentativas precisam poder produzir uma resposta semanticamente intercambiável. Réplicas com versões de dados diferentes podem trocar latência por inconsistência.</p></section>
<section class='signal-card'><h3>Efeito seguro</h3><p>Prefira leitura ou operação idempotente. Para comandos com efeito, use deduplicação por chave de operação e defina o que acontece se duas execuções chegarem ao commit.</p></section>
<section class='signal-card'><h3>Cancelamento cooperativo</h3><p>A tentativa perdedora deve perceber o cancelamento cedo o suficiente para liberar CPU, conexão, lock e trabalho upstream.</p></section>
<section class='signal-card'><h3>Capacidade reservada</h3><p>O sistema precisa de um orçamento para cópias. Hedging sem limite durante sobrecarga é um amplificador de fila.</p></section>
</div>

<h3>Idempotência é a barreira contra efeitos duplicados</h3>

O [RFC 9110](<https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2>) define uma operação idempotente como aquela cujo efeito pretendido no servidor é o mesmo após múltiplas requisições idênticas que após uma única. Essa propriedade é ainda mais importante em hedging do que em retry, porque as duas execuções podem coexistir. Um `GET` de leitura é um candidato natural; um comando de cobrança, reserva de estoque ou envio de mensagem exige uma chave idempotente ou outro mecanismo de deduplicação no ponto que aplica o efeito.

Cancelar a cópia perdedora não é um mecanismo de transação. A documentação de conceitos do [gRPC](<https://grpc.io/docs/what-is-grpc/core-concepts/#cancelling-an-rpc>) alerta que alterações feitas antes do cancelamento não são revertidas. Se o servidor já confirmou uma escrita, o sinal de cancelamento só pode impedir trabalho futuro.

<h3>Escolha caminhos realmente diferentes</h3>

Enviar a cópia para a mesma conexão HTTP/2, o mesmo processo ou a mesma réplica frequentemente preserva o motivo da lentidão. Uma política útil combina hedging com seleção de backend: outra réplica, outra conexão ou, quando o custo e a consistência permitem, outra zona. A diversidade deve ser suficiente para escapar de filas locais sem atravessar fronteiras caras apenas por reflexo.

<a name="hedge-delay"></a>

## 5. Como escolher o hedge delay

O atraso `d` controla a fronteira entre benefício e carga. Pequeno demais, ele transforma quase toda requisição em duplicata. Grande demais, ele dispara quando o <span lang="en-US">deadline</span> já está perto e pouco resta para a cópia vencer.

<div class='article-table-scroll' tabindex='0' role='region' aria-label='Estratégias para escolher o atraso de hedging'>
<table>
<thead><tr><th>Estratégia</th><th>Vantagem</th><th>Risco</th></tr></thead>
<tbody>
<tr><td>Percentil fixo, como p95 saudável</td><td>Simples; orçamento de carga fácil de estimar</td><td>Fica desatualizado quando a distribuição muda</td></tr>
<tr><td>Percentil móvel por operação</td><td>Acompanha latência de rotas diferentes</td><td>Pode perseguir um incidente e aumentar atraso justamente quando o sistema degrada</td></tr>
<tr><td>Valor absoluto por classe de chamada</td><td>Fácil de razonar com <span lang="en-US">deadline</span></td><td>Ignora mudanças de hardware, região e tamanho de payload</td></tr>
<tr><td>Sem atraso</td><td>Maior potencial de redução de cauda</td><td>Quase dobra tentativas e exige capacidade muito folgada</td></tr>
</tbody>
</table>
</div>

O artigo <span lang="en-US">The Tail at Scale</span> descreve esperar até o p95 esperado como uma forma de limitar o volume extra a aproximadamente 5% sob uma distribuição estável. O [Apache Cassandra](<https://cassandra.apache.org/doc/stable/cassandra/developing/cql/ddl.html#speculative-retry-options>) expõe a mesma família de ideia como `speculative_retry`: o coordenador pode consultar réplicas adicionais quando uma leitura fica lenta, e a documentação alerta que fazê-lo com frequência pode degradar o cluster.

<h3>Não use a média para decidir a cauda</h3>

Uma média de 25 ms pode coexistir com p99 de 500 ms. Como o mecanismo só deve atuar sobre o subconjunto lento, escolha a política a partir de histogramas e percentis da mesma classe de chamadas: método, rota, região e, quando relevante, tamanho de resposta. Evite criar dimensões de alta cardinalidade apenas para calibrar o atraso; agrupe por classes operacionais que realmente recebem políticas diferentes.

<h3>O deadline é o teto de todo o experimento</h3>

Se o cliente tem 120 ms de orçamento e dispara o hedge em 110 ms, a cópia quase não tem tempo para produzir valor. Um desenho mais explícito reserva partes do orçamento:

<div class='code-block'><pre><code>deadline lógico = 120 ms&#10;hedge delay      = 45 ms&#10;tempo restante   = 75 ms para a tentativa vencedora&#10;máximo           = 2 tentativas em voo</code></pre></div>

No gRPC, o <span lang="en-US">deadline</span> se aplica à operação completa. Essa semântica evita que cada cópia renove o relógio e transforme uma chamada curta em uma sequência longa de apostas.

<a name="hedge-operacao"></a>

## 6. Uma política de produção precisa de orçamento, não só de delay

Uma implementação mínima deve responder cinco perguntas: quando disparar, para onde enviar, quantas cópias permitir, o que conta como resposta vencedora e quando suspender o mecanismo. Um pseudocódigo simplificado:

<div class='code-block'><pre><code>deadline = contexto.deadline&#10;primaria = iniciar(escolherReplica())&#10;&#10;aguardar(min(hedgeDelay, deadline.restante))&#10;&#10;se primaria terminou:&#10;    retornar primaria&#10;&#10;se hedgeBudget permite e capacidade saudável:&#10;    secundaria = iniciar(escolherOutraReplica())&#10;&#10;resultado = primeiraRespostaAceitavel(primaria, secundaria)&#10;cancelarAsOutras()&#10;retornar resultado</code></pre></div>

**O orçamento de hedges deve ser independente do tráfego lógico.** Um limite simples pode restringir `hedges_started / logical_requests` por janela; outro pode usar tokens que se recuperam com sucessos. A política de [throttling do gRPC](<https://grpc.io/docs/guides/request-hedging/#throttling-hedged-rpcs>), por exemplo, mantém um contador por nome de servidor e deixa de disparar novas cópias quando falhas consomem tokens suficientes. O detalhe do algoritmo pode variar; o requisito é existir um freio que reaja antes da fila entrar em realimentação positiva.

<h3>O que medir</h3>

<div class='signal-grid'>
<section class='signal-card'><h3>Latência lógica</h3><p>p50, p95, p99 e p99,9 da operação percebida pelo chamador. O objetivo do mecanismo aparece aqui.</p></section>
<section class='signal-card'><h3>Hedge rate</h3><p><code>hedges_started / logical_requests</code>. Mostra o multiplicador de tentativas criado pela política.</p></section>
<section class='signal-card'><h3>Hedge win rate</h3><p><code>hedge_wins / hedges_started</code>. Se quase nenhuma cópia vence, o atraso pode estar tarde demais ou a lentidão pode ser correlacionada.</p></section>
<section class='signal-card'><h3>Trabalho desperdiçado</h3><p>CPU, bytes, consultas e tempo de fila consumidos por tentativas canceladas. Contagem de requests sozinha subestima custo.</p></section>
</div>

Correlacione esses sinais com saturação: filas, utilização de CPU, conexões, limites de concorrência, throttling e rejeições. Um p99 menor acompanhado de CPU permanentemente mais alta e fila crescente pode apenas deslocar a cauda para outros clientes.

<h3>Traces devem representar uma operação lógica com várias tentativas</h3>

Em <span lang="en-US">distributed tracing</span>, mantenha um span lógico pai e crie spans filhos para cada tentativa. Registre atributos como índice da tentativa, backend escolhido, atraso que disparou a cópia, vencedor, motivo de cancelamento e se a tentativa iniciou trabalho no servidor. Assim é possível responder se a cauda caiu porque a segunda réplica era realmente mais rápida ou porque a primeira estava presa sempre no mesmo caminho.

<div class='article-callout'><strong>Evite uma métrica enganosa:</strong> contar cada tentativa hedged como uma nova requisição de usuário infla o tráfego aparente e mistura demanda com mecanismo de resiliência. Exponha tráfego lógico e tráfego de tentativas separadamente.</div>

<h3>Modos de falha mais comuns</h3>

- **Hedging durante saturação:** a fila cresce, o atraso expira em mais chamadas, mais cópias entram, e a fila cresce ainda mais.
- **Cópias no mesmo domínio de falha:** ambas encontram o mesmo banco, conexão, cache miss ou chave quente.
- **Cancelamento tardio:** a resposta já chegou ao cliente, mas o perdedor continua consumindo CPU e I/O.
- **Efeito não idempotente:** duas execuções válidas produzem dois efeitos de negócio.
- **Limite em várias camadas:** frontend, gateway e serviço fazem hedging independentemente e multiplicam tentativas.
- **Atraso adaptativo sem guarda:** o percentil móvel sobe durante incidente, fazendo a política reagir tarde quando mais seria observada.
- **Duplicação de cache miss:** duas cópias atravessam o cache vazio e aumentam o trabalho justamente na chave quente.

<a name="hedge-comparacao"></a>

## 7. Hedging, retries e técnicas vizinhas

<div class='article-table-scroll' tabindex='0' role='region' aria-label='Comparação entre hedging e mecanismos relacionados'>
<table>
<thead><tr><th>Mecanismo</th><th>Quando cria trabalho adicional</th><th>Objetivo primário</th><th>Risco principal</th></tr></thead>
<tbody>
<tr><td><span lang="en-US">Hedged request</span></td><td>Antes da primeira tentativa falhar, após um atraso</td><td>Reduzir variância e <span lang="en-US">tail latency</span></td><td>Amplificar carga e efeitos duplicados</td></tr>
<tr><td><span lang="en-US">Retry</span></td><td>Após falha, rejeição ou timeout</td><td>Recuperar falha transitória</td><td><span lang="en-US">Retry storm</span></td></tr>
<tr><td>Balanceamento de carga</td><td>Normalmente não duplica</td><td>Escolher um backend melhor antes da execução</td><td>Decisão baseada em sinal desatualizado</td></tr>
<tr><td>Execução especulativa</td><td>Duplica trabalho lento em tarefas mais longas</td><td>Mitigar <span lang="en-US">stragglers</span></td><td>Consumo extra prolongado</td></tr>
<tr><td><span lang="en-US">Load shedding</span></td><td>Não cria trabalho; rejeita cedo</td><td>Preservar estabilidade sob sobrecarga</td><td>Reduzir disponibilidade aparente</td></tr>
<tr><td>Timeout</td><td>Não cria uma nova tentativa por si só</td><td>Limitar tempo de espera</td><td>Encerrar trabalho que terminaria logo depois</td></tr>
</tbody>
</table>
</div>

Em leituras replicadas, hedging também se aproxima de **speculative read**. O Cassandra chama o mecanismo de `speculative_retry`: o coordenador consulta réplicas adicionais além das inicialmente necessárias para o nível de consistência quando a resposta demora. A semântica do banco ainda determina quantas respostas são necessárias para satisfazer o nível de consistência; a tentativa especulativa é um acelerador, não uma nova garantia de consistência.

<h3>Quando usar</h3>

- latência de cauda é material para o SLO ou para um <span lang="en-US">fan-out</span> grande;
- há múltiplos backends semanticamente equivalentes e alguma independência de filas ou falhas;
- a operação é leitura, idempotente ou deduplicada de forma confiável;
- o sistema possui capacidade ociosa mensurável e um orçamento rígido para cópias;
- cancelamento chega ao trabalho servidor e aos <span lang="en-US">upstreams</span> em tempo útil;
- métricas e traces distinguem requisição lógica, tentativas e trabalho desperdiçado.

<h3>Quando evitar</h3>

- o backend já opera próximo da saturação;
- as réplicas dependem do mesmo gargalo e a lentidão é altamente correlacionada;
- a chamada produz efeitos não idempotentes sem deduplicação;
- o payload é muito grande ou cruza região cara, tornando a cópia desproporcionalmente custosa;
- o <span lang="en-US">deadline</span> é tão curto que a segunda tentativa não teria tempo para vencer;
- a causa real é falta de capacidade permanente, caso em que hedging mascara o sintoma e piora o recurso escasso.

<a name="hedge-experimento"></a>

## 8. Experimento reproduzível: cauda independente versus correlacionada

O arquivo [`hedged-requests-experimento.py`](<../../assets/hedged-requests/hedged-requests-experimento.py>) usa apenas a biblioteca padrão do Python. Ele gera uma distribuição rápida com uma pequena cauda lenta, calcula o p95 de aquecimento como `hedge delay` e compara chamadas sem e com hedging. Com a semente padrão e 100.000 requisições, a execução produz:

<div class='code-block'><pre><code>python hedged-requests-experimento.py --requests 100000 --delay-percentile 0.95 --seed 7&#10;&#10;delay=29.5 ms (percentil 0.950 da amostra de aquecimento)&#10;sem hedge    p50=   22.2 ms p95=   29.8 ms p99=  254.3 ms p99.9=  850.9 ms&#10;com hedge    p50=   22.1 ms p95=   29.8 ms p99=   52.2 ms p99.9=   59.5 ms&#10;hedge_rate=5.38% attempt_multiplier=1.054x hedge_win_rate=41.88%</code></pre></div>

O modelo é deliberadamente sintético e não prevê produção. Ele serve para observar a mecânica: o p50 quase não muda, a política atua sobre pouco mais de 5% das chamadas e a cauda cai porque as lentidões das duas réplicas são independentes no cenário padrão.

Agora adicione um atraso compartilhado com `--correlated-tail 0.05`. Na mesma semente, o p99 com hedging fica por volta de 313 ms em vez de 52 ms, o multiplicador de tentativas sobe para aproximadamente `1,10×` e a taxa de vitória da cópia cai para perto de 23%. A diferença não prova um limite universal; mostra por que correlação entre réplicas precisa ser parte da avaliação.

<a name="hedge-revisao"></a>

## 9. Resumo mental

Pense em hedging como **comprar uma segunda chance antes de saber se a primeira falhou**. O preço é trabalho concorrente; o benefício é transformar parte da cauda em uma corrida entre caminhos. O mecanismo tende a funcionar quando a lentidão é rara e parcialmente independente, quando a segunda cópia pode ir para um backend realmente distinto e quando o perdedor pode ser cancelado cedo.

O parâmetro central é o atraso `d`. Ele define quantas chamadas entram na corrida: aproximadamente `S(d)`. Um p95 saudável sugere, em primeira aproximação, cerca de 5% de cópias; mas o custo real depende do trabalho executado antes do cancelamento. Por isso uma política completa combina <span lang="en-US">hedge delay</span>, número máximo de tentativas, <span lang="en-US">deadline</span>, seleção de réplica, idempotência, orçamento de carga e telemetria.

<h3>Perguntas de revisão</h3>

1. Por que o p50 pode permanecer praticamente igual enquanto o p99 cai muito com hedging?
2. Qual hipótese permite escrever `P(H > t) = S(t)²`, e o que acontece quando ela deixa de valer?
3. Por que cancelar a tentativa perdedora não torna automaticamente segura uma operação não idempotente?
4. Se o <span lang="en-US">hedge delay</span> for o p95, qual multiplicador de tentativas você espera em primeira aproximação com no máximo duas tentativas?
5. Quais métricas revelam que o mecanismo reduziu latência às custas de sobrecarga crescente?

<h3>Exercícios</h3>

1. Rode o experimento com `--delay-percentile 0.90`, `0.95` e `0.99`. Compare p99, `hedge_rate` e `attempt_multiplier`; escolha um ponto que você defenderia para um backend com 15% de capacidade ociosa.
2. Rode `--correlated-tail 0.00`, `0.02`, `0.05` e `0.10`. Observe quando a segunda cópia deixa de comprar diversidade suficiente.
3. Desenhe um trace de uma operação com primária lenta, hedge vencedor e cancelamento propagado a dois serviços upstream. Liste quais atributos você precisaria para calcular `hedge_win_rate` e trabalho desperdiçado.

<a name="hedge-fontes"></a>

## 10. Fontes

- [Google Research — <span lang="en-US">The Tail at Scale</span>, Jeffrey Dean e Luiz André Barroso](<https://research.google/pubs/the-tail-at-scale/>). Origem da discussão de hedged e tied requests e do benchmark clássico de Bigtable.
- [Dean &amp; Barroso — PDF de <span lang="en-US">The Tail at Scale</span>, Communications of the ACM, 2013](<https://barroso.org/publications/TheTailAtScale.pdf>). Resultados e mecanismo detalhado.
- [gRPC — <span lang="en-US">Request Hedging</span>](<https://grpc.io/docs/guides/request-hedging/>). Configuração de `maxAttempts`, `hedgingDelay`, status não fatais, throttling e pushback.
- [gRPC — Cancellation](<https://grpc.io/docs/guides/cancellation/>) e [Core Concepts](<https://grpc.io/docs/what-is-grpc/core-concepts/#cancelling-an-rpc>). Propagação do cancelamento e limite de não reverter efeitos já aplicados.
- [RFC 9110, seção 9.2.2 — Idempotent Methods](<https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2>). Semântica de idempotência relevante para repetição segura de operações.
- [Apache Cassandra — Speculative retry options](<https://cassandra.apache.org/doc/stable/cassandra/developing/cql/ddl.html#speculative-retry-options>). Exemplo de leituras especulativas e alerta sobre impacto no cluster.
- [Gardner et al. — <span lang="en-US">Reducing Latency via Redundant Requests</span>, SIGMETRICS 2015](<https://www.cs.cmu.edu/~harchol/Papers/Sigmetrics15.pdf>). Análise de redundância, latência e custo em sistemas multi-servidor.

</div>
