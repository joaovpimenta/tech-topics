---
slug: "relogios-logicos-lamport-vetores-e-causalidade-sem-relogio-global"
language: "pt-BR"
title: "Relógios lógicos: Lamport, vetores e causalidade sem relógio global"
category: "Sistemas distribuídos · Algoritmos"
date: "23 de setembro de 2026"
publishedAt: "2026-09-23"
read: "29 min de leitura"
image: "assets/relogios-logicos-lamport-vetores-e-causalidade-sem-relogio-global/relogios-logicos-lamport-vetores-e-causalidade-sem-relogio-global-cover.jpg"
alt: "Aquarela de dois restauradores que trocam uma peça etiquetada entre salas com relógios de parede discordantes."
dek: "Como ordenar eventos, detectar concorrência e rastrear versões quando mensagens carregam causalidade melhor que relógios de parede."
excerpt: "Um guia técnico sobre happened-before, relógios de Lamport, vetores, version vectors, HLC e os limites de cada modelo."
tags: ["sistemas-distribuidos","dados-distribuidos","algoritmos"]
---
Em uma oficina de restauração, Ana termina uma peça e a passa a Bruno com uma ficha carimbada; ao notar que os relógios das duas salas marcam horas diferentes, ele pergunta qual marca deveria provar que o trabalho dela veio antes do dele. Ana aponta para a ficha que viajou com a peça: não precisamos concordar sobre que horas são, responde, apenas carregar adiante a evidência do que já aconteceu. Essa é a intuição dos relógios lógicos: ordenar efeitos por relações observáveis, não pela ilusão de um relógio global perfeito.

<div class="article-callout">

**Ideia central:** um relógio lógico não tenta dizer que horas são. Ele atribui marcas a eventos para preservar uma relação de ordem. O relógio escalar de Lamport garante que causas recebem números menores que seus efeitos; relógios vetoriais também permitem reconhecer quando dois eventos são concorrentes.

</div>

<nav aria-label="Neste artigo"><strong>Neste guia</strong><ul><li><a href="#rl-problema">O problema da ordem</a></li><li><a href="#rl-happened-before">Happened-before</a></li><li><a href="#rl-lamport">Relógios de Lamport</a></li><li><a href="#rl-vetores">Relógios vetoriais</a></li><li><a href="#rl-replicacao">Replicação e bancos</a></li><li><a href="#rl-hlc">Relógios híbridos</a></li><li><a href="#rl-operacao">Implementação e operação</a></li><li><a href="#rl-experimento">Experimento</a></li><li><a href="#rl-fontes">Fontes</a></li></ul></nav>

<h2 id="rl-problema">1. O relógio da parede responde à pergunta errada</h2>

Em um único processo, a ordem do programa fornece uma sequência local. Em vários processos, cada máquina executa independentemente, mensagens levam tempos variáveis e relógios físicos derivam. Mesmo sincronizados por NTP, eles podem diferir, sofrer ajustes e não revelar se um evento teve informação suficiente para influenciar outro.

Considere dois serviços que gravam atualizações às 10:00:00.100 e 10:00:00.090 segundo seus relógios locais. O segundo número é menor, mas isso não prova que sua atualização aconteceu primeiro: os relógios podem estar desalinhados. E o inverso também importa. Dois eventos separados por 20 ms no horário de parede podem ser independentes; a diferença temporal não cria causalidade.

Leslie Lamport abriu seu artigo de 1978 observando que, em um sistema distribuído, às vezes é impossível afirmar qual de dois eventos ocorreu primeiro. Seu passo decisivo foi definir ordem sem recorrer ao tempo físico: a partir da sequência dentro de cada processo e das mensagens realmente trocadas. O resultado é uma ordem parcial, não uma única fila universal.

<figure class="mermaid-figure"><div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="Três processos executam eventos; mensagens criam caminhos causais de A para B, enquanto um evento em C permanece sem caminho para os demais."><pre class="mermaid-source">sequenceDiagram
  participant A as Processo A
  participant B as Processo B
  participant C as Processo C
  A->>A: a1 evento local
  A->>B: a2 envia m1
  C->>C: c1 evento local
  B->>B: b1 recebe m1
  B->>B: b2 evento local</pre></div><figcaption>Sequência ilustrativa. Há um caminho causal de a1 para a2, b1 e b2. Não há mensagem nem sequência local ligando c1 a esses eventos; c1 é concorrente com eles no modelo.</figcaption><details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">sequenceDiagram
  participant A as Processo A
  participant B as Processo B
  participant C as Processo C
  A->>A: a1 evento local
  A->>B: a2 envia m1
  C->>C: c1 evento local
  B->>B: b1 recebe m1
  B->>B: b2 evento local</pre></details></figure>

<h2 id="rl-happened-before">2. A relação <span lang="en-US">happened-before</span></h2>

Lamport chamou a relação de <span lang="en-US">happened-before</span>, representada aqui por `→`. Ela é a menor relação que satisfaz três regras:

1.  **Ordem local.** Se `a` e `b` pertencem ao mesmo processo e `a` ocorre antes de `b`, então `a → b`.
2.  **Mensagem.** Se `a` é o envio de uma mensagem e `b` é o recebimento daquela mensagem, então `a → b`.
3.  **Transitividade.** Se `a → b` e `b → c`, então `a → c`.

Quando nem `a → b` nem `b → a`, os eventos são concorrentes. Concorrente não significa necessariamente simultâneo no relógio físico. Significa que, na execução observada, não existe um caminho causal entre eles. Um poderia ter ocorrido sem conhecer o outro.

Essa definição modela causalidade potencial, não intenção de negócio. Se um serviço recebe uma mensagem e a ignora, o recebimento ainda vem depois do envio. Por outro lado, duas operações sobre o mesmo registro podem ser concorrentes segundo o protocolo mesmo que um analista depois descubra uma relação humana entre elas. O relógio só conhece os eventos e canais que o sistema representa.

<div class="article-callout">

**Invariante fundamental:** qualquer <span lang="en-US">timestamp</span> causal correto deve preservar `a → b ⇒ T(a) < T(b)`. A utilidade e o custo de cada família de relógios dependem do quanto ela também preserva no sentido inverso.

</div>

<h2 id="rl-lamport">3. Relógios escalares de Lamport</h2>

Cada processo mantém um inteiro `C`. O algoritmo recebe como entrada eventos locais, envios e mensagens com <span lang="en-US">timestamp</span>; produz um número por evento. Sua meta não é aproximar segundos, mas respeitar o invariante causal.

<pre class="code-block"><code>estado local em cada processo i:
  C_i = 0
&#10;evento local ou envio:
  C_i = C_i + 1
  se for envio, anexar C_i à mensagem
&#10;recebimento de mensagem com timestamp t:
  C_i = max(C_i, t) + 1</code></pre>

A regra de recebimento faz o relógio local saltar além tanto do passado conhecido localmente quanto do passado carregado pela mensagem. Se o envio recebeu 2, o recebimento será pelo menos 3. A transitividade mantém o crescimento ao longo de qualquer caminho causal.

<figure class="mermaid-figure"><div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="Processo A marca eventos com 1 e 2, envia a marca 2; B estava em 1 e ao receber calcula máximo de 1 e 2 mais 1, obtendo 3."><pre class="mermaid-source">sequenceDiagram
  participant A as Processo A
  participant B as Processo B
  A->>A: evento local C=1
  A->>B: envia m com C=2
  B->>B: evento local C=1
  B->>B: recebe m, max 1 e 2 mais 1 = 3
  B->>B: próximo evento C=4</pre></div><figcaption>Execução calculada pelas regras de Lamport. Os números crescem ao longo da causalidade, mas não medem duração nem atraso de rede.</figcaption><details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">sequenceDiagram
  participant A as Processo A
  participant B as Processo B
  A->>A: evento local C=1
  A->>B: envia m com C=2
  B->>B: evento local C=1
  B->>B: recebe m, max 1 e 2 mais 1 = 3
  B->>B: próximo evento C=4</pre></details></figure>

<h3>Por que o algoritmo está correto</h3>

A demonstração acompanha as três regras de <span lang="en-US">happened-before</span>. Dentro de um processo, cada evento incrementa `C`, logo a ordem local produz valores crescentes. No canal, o recebimento escolhe um valor maior que o <span lang="en-US">timestamp</span> do envio. Se `a → b` e `b → c`, a desigualdade numérica também é transitiva: `C(a) < C(b) < C(c)`. Portanto `a → c` preserva a ordem.

A recíproca é falsa: `C(a) < C(b)` não implica `a → b`. Dois processos podem incrementar seus contadores sem trocar mensagem. Um evento recebe 4 e outro 9 apenas por diferenças em suas histórias locais; os números impõem uma posição, mas não demonstram influência.

<h3>Da ordem parcial a uma ordem total</h3>

Algoritmos às vezes precisam escolher um vencedor determinístico mesmo entre eventos concorrentes. Uma tupla `(timestamp, id-do-processo)` fornece desempate: compare primeiro o número de Lamport, depois um identificador único e estável. Todos que veem as mesmas tuplas chegam à mesma fila.

Essa ordem total é uma extensão válida da ordem causal, mas o desempate é convenção. Se `(4, A)` precede `(4, B)`, isso não torna a operação de A causa da operação de B. Confundir decisão determinística com evidência causal é um dos erros mais comuns desse modelo.

<div class="article-table-scroll" tabindex="0" role="region" aria-label="O que um timestamp de Lamport permite ou não concluir"><table><thead><tr><th scope="col">Observação</th><th scope="col">Conclusão válida</th><th scope="col">Conclusão inválida</th></tr></thead><tbody><tr><td><code>a → b</code></td><td><code>C(a) &lt; C(b)</code></td><td>Que a diferença mede tempo.</td></tr><tr><td><code>C(a) &lt; C(b)</code></td><td>Uma ordem numérica pode ser escolhida.</td><td>Que a causou b.</td></tr><tr><td><code>C(a) = C(b)</code></td><td>Os valores empataram.</td><td>Que ocorreram simultaneamente.</td></tr><tr><td><code>(C, id)</code> ordena tudo</td><td>Há uma fila determinística.</td><td>Que toda adjacência é causal.</td></tr></tbody></table></div>

<h2 id="rl-vetores">4. Relógios vetoriais: guardar conhecimento por processo</h2>

Para saber se dois eventos são concorrentes, um único inteiro não basta. Relógios vetoriais, desenvolvidos independentemente por Colin Fidge e Friedemann Mattern no fim dos anos 1980, mantêm um componente por participante. Em um sistema com A, B e C, A pode carregar `[2, 0, 0]`: conhece dois eventos de A e nenhum de B ou C.

Cada processo `i` guarda um vetor `V` de tamanho `N`:

<pre class="code-block"><code>estado local:
  V = [0, 0, ..., 0]
&#10;evento local ou envio no processo i:
  V[i] = V[i] + 1
  se for envio, anexar uma cópia de V
&#10;recebimento de mensagem com vetor M:
  para cada posição k: V[k] = max(V[k], M[k])
  V[i] = V[i] + 1</code></pre>

O máximo componente a componente faz uma união do conhecimento causal. O incremento final registra o novo evento local de recebimento. Para comparar dois vetores `X` e `Y`, definimos `X < Y` quando todo componente de X é menor ou igual ao de Y e pelo menos um é estritamente menor.

<figure class="mermaid-figure"><div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="A cria vetores 100 e 200 e envia 200 a B; B combina e chega a 210. C produz 001 sem comunicação. Os vetores 210 e 001 são incomparáveis."><pre class="mermaid-source">flowchart LR
  A1[A local: 1,0,0] --> A2[A envia: 2,0,0]
  A2 -->|mensagem| B1[B recebe: 2,1,0]
  B1 --> B2[B local: 2,2,0]
  C1[C local: 0,0,1]
  B2 -. nenhum vetor domina .- C1</pre></div><figcaption>Valores calculados para três processos. B2 contém a história de A e B. C1 contém apenas a de C. Como 2,2,0 e 0,0,1 são incomparáveis, os eventos são concorrentes.</figcaption><details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">flowchart LR
  A1[A local: 1,0,0] --> A2[A envia: 2,0,0]
  A2 -->|mensagem| B1[B recebe: 2,1,0]
  B1 --> B2[B local: 2,2,0]
  C1[C local: 0,0,1]
  B2 -. nenhum vetor domina .- C1</pre></details></figure>

<h3>A equivalência que o escalar não oferece</h3>

No modelo clássico, com componentes corretamente associados aos processos, relógios vetoriais satisfazem `a → b ⇔ V(a) < V(b)`. Se um vetor domina outro, ele contém todo o passado representado pelo menor e pelo menos um evento adicional. Se são incomparáveis, cada lado conhece algo que o outro não conhece: há concorrência.

Para `X=[2,2,0]` e `Y=[0,0,1]`, X é maior nos dois primeiros componentes e menor no terceiro. Nem X domina Y nem Y domina X. Um sistema de replicação pode então preservar ambas as versões e pedir uma fusão sem fingir que o maior horário de parede é necessariamente a versão correta.

<h3>Complexidade</h3>

Relógios de Lamport usam um contador por processo e um inteiro por mensagem: atualização e comparação são constantes. Vetores densos usam `O(N)` estado, bytes por <span lang="en-US">timestamp</span> e trabalho de mesclagem, em que N é o número de participantes identificados. Comparar dois vetores também custa `O(N)`.

Em três réplicas fixas, isso é barato. Em milhões de clientes dinâmicos, é inviável. Representações esparsas economizam zeros, mas seu tamanho ainda acompanha os participantes vistos. O problema não é apenas memória: identidade, entrada, saída e reciclagem segura de componentes passam a fazer parte do protocolo.

<h2>5. Um exemplo completo, passo a passo</h2>

Suponha três réplicas que começam em zero. A modifica uma peça, envia seu estado a B, enquanto C trabalha isoladamente:

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Evolução passo a passo dos relógios de Lamport e vetoriais"><table><thead><tr><th scope="col">Evento</th><th scope="col">Lamport</th><th scope="col">Vetor</th><th scope="col">O que se tornou conhecido</th></tr></thead><tbody><tr><td>A1: alteração local</td><td>1</td><td>[1,0,0]</td><td>Um evento de A.</td></tr><tr><td>A2: envio para B</td><td>2</td><td>[2,0,0]</td><td>O envio inclui a história de A.</td></tr><tr><td>C1: alteração isolada</td><td>1</td><td>[0,0,1]</td><td>Um evento independente de C.</td></tr><tr><td>B1: recebe A2</td><td>3</td><td>[2,1,0]</td><td>B incorpora A e registra o recebimento.</td></tr><tr><td>B2: finaliza</td><td>4</td><td>[2,2,0]</td><td>Mais um evento local de B.</td></tr></tbody></table></div>

O escalar informa corretamente que A2 antecede B1, pois 2 é menor que 3. Ele também coloca C1, com 1, antes de B2, com 4, embora C nunca tenha enviado informação a B. O vetor distingue as relações: `[2,0,0] < [2,1,0]`, portanto A2 causa B1; `[0,0,1]` e `[2,2,0]` são incomparáveis, portanto C1 e B2 são concorrentes.

Esse exemplo também mostra por que ordenar e detectar causalidade são objetivos diferentes. Lamport resolve o primeiro com pouco estado. Vetores resolvem o segundo com mais metadados. Nenhum mede quantos milissegundos se passaram.

<h2 id="rl-replicacao">6. De eventos a versões de dados</h2>

Em armazenamento replicado, a pergunta costuma mudar de evento para versão: esta versão inclui aquela ou surgiu em paralelo? **<span lang="en-US">Version vectors</span>** aplicam a mesma ideia a históricos de réplicas. Cada componente normalmente representa uma réplica responsável por registrar atualizações, não cada cliente final.

O artigo do Amazon Dynamo, publicado em 2007, descreve objetos imutáveis versionados e ramificações quando falhas ou partições permitem atualizações concorrentes. Vetores de versão permitem dizer que uma versão descende de outra ou que ambas são irmãs concorrentes. O sistema pode descartar versões dominadas e preservar irmãos para reconciliação semântica.

<figure class="mermaid-figure"><div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="Uma versão base se ramifica durante uma partição em atualização na réplica A e atualização na réplica C; após reconexão, os vetores são incomparáveis e ambas as versões são preservadas para fusão."><pre class="mermaid-source">flowchart LR
  V0[Base 1,0,0] --> P{Partição}
  P --> VA[A atualiza 2,0,0]
  P --> VC[C atualiza 1,0,1]
  VA --> J{Reconexão}
  VC --> J
  J --> K[Versões concorrentes]
  K --> M[Fusão de negócio]
  M --> VF[Nova versão que inclui ambas]</pre></div><figcaption>Fluxo ilustrativo de replicação otimista. Os vetores 2,0,0 e 1,0,1 são incomparáveis; escolher apenas o maior horário poderia perder uma atualização válida.</figcaption><details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">flowchart LR
  V0[Base 1,0,0] --> P{Partição}
  P --> VA[A atualiza 2,0,0]
  P --> VC[C atualiza 1,0,1]
  VA --> J{Reconexão}
  VC --> J
  J --> K[Versões concorrentes]
  K --> M[Fusão de negócio]
  M --> VF[Nova versão que inclui ambas]</pre></details></figure>

<h3>Relógio vetorial não é automaticamente um <span lang="en-US">version vector</span></h3>

A estrutura matemática é semelhante, mas a granularidade importa. Um relógio vetorial clássico descreve eventos por processo. Um <span lang="en-US">version vector</span> resume a história de uma versão por réplica. Se muitos clientes escrevem através do mesmo coordenador, atribuir todos a um único componente pode esconder concorrência entre clientes dependendo de como o contexto é devolvido e reapresentado.

O trabalho [Dotted <span lang="en-US">Version Vectors</span>](https://arxiv.org/abs/1011.5808), de Nuno Preguiça, Carlos Baquero, Paulo Sérgio Almeida, Victor Fonte e Ricardo Gonçalves, separa um evento individual, o ponto, do contexto causal resumido. A proposta captura concorrência sem fazer o metadado crescer com todos os clientes ou todas as atualizações; seu tamanho cresce com os servidores que registram atualizações para o item, limitado pelo grau de replicação.

Não há compressão gratuita. Podar componentes, reciclar identidades ou agregar autores pode perder distinções causais. A implementação precisa declarar qual história está sendo resumida e qual imprecisão aceita.

<h2>7. Por que <span lang="en-US">last-write-wins</span> não substitui causalidade</h2>

<span lang="en-US">Last-write-wins</span> escolhe um vencedor por <span lang="en-US">timestamp</span> ou regra de desempate. É simples e útil quando a semântica aceita sobrescrita: por exemplo, um campo de presença efêmero em que só o último estado interessa. Mas, se relógios derivam, uma gravação posterior pode receber <span lang="en-US">timestamp</span> físico menor e ser descartada. Mesmo com clocks perfeitos, duas edições independentes continuam sendo concorrentes; escolher uma não as reconcilia.

Para um carrinho de compras, perder silenciosamente um item pode ser pior que manter dois irmãos e uni-los. Para uma configuração cujo valor deve ser único, expor conflito pode ser pior que desempatar. Relógios descrevem relação; a política de negócio decide entre mesclar, rejeitar, preservar irmãos, usar um CRDT ou coordenar antes de escrever.

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Comparação entre estratégias de ordenação e causalidade"><table><thead><tr><th scope="col">Mecanismo</th><th scope="col">Estado por <span lang="en-US">timestamp</span></th><th scope="col">Detecta concorrência</th><th scope="col">Aproxima horário</th><th scope="col">Uso típico</th></tr></thead><tbody><tr><td>Relógio físico</td><td>Instante</td><td>Não</td><td>Sim, com incerteza</td><td>TTL, auditoria temporal, experiência do usuário.</td></tr><tr><td>Lamport</td><td>Um contador</td><td>Não</td><td>Não</td><td>Ordem causal consistente e desempate total.</td></tr><tr><td>Vetorial</td><td>Um componente por participante</td><td>Sim</td><td>Não</td><td>Depuração causal e replicação otimista.</td></tr><tr><td>HLC</td><td>Tempo físico mais parte lógica</td><td>Não sozinho</td><td>Sim, aproximadamente</td><td>Snapshots e ordenação próxima do horário real.</td></tr><tr><td>TrueTime</td><td>Intervalo de incerteza</td><td>Não como vetor</td><td>Sim, com limite explícito</td><td>External consistency com protocolo próprio.</td></tr></tbody></table></div>

<h2 id="rl-hlc">8. <span lang="en-US">Hybrid Logical Clocks</span>: perto do relógio, ainda lógico</h2>

Relógios vetoriais preservam causalidade, mas seu tamanho cresce. Relógios físicos são compactos e legíveis, mas podem regredir ou ordenar causas incorretamente. Os <span lang="en-US">Hybrid Logical Clocks</span>, propostos por Sandeep Kulkarni, Murat Demirbas, Deepak Madappa, Bharadwaj Avva e Marcelo Leone, combinam uma parte próxima do tempo físico com uma parte lógica.

O artigo de 2014 preserva a propriedade `e → f ⇒ HLC(e) < HLC(f)` e mantém o valor próximo do relógio NTP. Isso é útil para leituras por snapshot e <span lang="en-US">timestamps</span> de banco que precisam ser compactos e aproximadamente interpretáveis. A parte lógica avança quando o relógio físico não pode avançar sem violar a causalidade.

HLC não recupera toda a informação de um vetor. De dois <span lang="en-US">timestamps</span> HLC ordenados não se conclui que houve causalidade; eventos concorrentes também recebem uma ordem. Ele também não cria sincronização física perfeita, linearizabilidade ou external consistency sozinho. Essas garantias dependem do protocolo completo.

O contraste com TrueTime é instrutivo. O Spanner expõe um intervalo de incerteza do relógio e usa esperas e protocolos para oferecer external consistency. O HLC é um relógio lógico compacto sobre o tempo físico disponível. Ambos tratam incerteza temporal, mas com contratos, infraestrutura e garantias diferentes.

<h2>9. Escolha pelo predicado que você precisa responder</h2>

Antes de escolher um relógio, escreva a pergunta do sistema:

- **Preciso apenas ordenar pedidos deterministicamente?** Um Lamport <span lang="en-US">timestamp</span> com desempate estável pode bastar.
- **Preciso saber se duas versões são concorrentes?** Use contexto causal, <span lang="en-US">version vectors</span>, dotted <span lang="en-US">version vectors</span> ou estrutura equivalente.
- **Preciso mostrar horário ao usuário ou expirar dados?** Use relógio físico, com política explícita para deriva e ajustes.
- **Preciso de <span lang="en-US">timestamps</span> compactos próximos do horário e que respeitem causalidade?** Avalie HLC.
- **Preciso de serialização ou external consistency?** Um relógio é componente, não solução: combine consenso, controle de concorrência, quóruns e regras de commit adequadas.

A pergunta errada leva ao mecanismo errado. Colocar um <span lang="en-US">timestamp</span> físico em toda gravação não resolve conflitos causais. Colocar um vetor em todo evento de uma frota dinâmica pode tornar o metadado maior que o dado. A arquitetura deve pagar apenas pela informação que usa.

<h2 id="rl-operacao">10. Detalhes que quebram implementações</h2>

<h3>Identidade e reinicialização</h3>

Um componente vetorial representa uma identidade lógica. Se um processo reinicia, zera o contador e reutiliza o mesmo ID, novos eventos podem parecer anteriores a eventos antigos. Persista o contador com o estado, atribua uma nova geração à identidade ou use um protocolo de associação que impeça reutilização ambígua.

Para contadores de Lamport, o mesmo problema aparece quando <span lang="en-US">timestamps</span> sobrevivem em mensagens ou armazenamento. O valor local após recuperação precisa ser pelo menos maior que qualquer valor persistido ou recebido. Overflow também deve ser tratado: inteiros de largura fixa não são infinitos, ainda que 64 bits tornem o horizonte distante em muitos sistemas.

<h3>Duplicação e reordenação de mensagens</h3>

O máximo componente a componente é idempotente: combinar o mesmo conhecimento duas vezes não o reduz nem o duplica. Isso torna o contexto causal tolerante a mensagens repetidas. Mas o efeito de negócio transportado pela mensagem pode não ser idempotente. Relógio vetorial não impede cobrar duas vezes; ele só ajuda a relacionar eventos.

Mensagens podem chegar fora de ordem. O algoritmo não exige FIFO para manter o vetor monotônico, pois o máximo nunca perde conhecimento. Protocolos que usam a ordem para decidir aplicação, contudo, ainda precisam de buffer, números de sequência, deduplicação ou rejeição explícita.

<h3>Participação dinâmica</h3>

Adicionar e remover réplicas exige mais que redimensionar um array. Um componente antigo só pode ser descartado quando o sistema sabe que seu conhecimento foi incorporado e que aquela identidade não voltará com eventos legítimos. Durante partições, essa certeza pode exigir coordenação ou metadados adicionais.

Alternativas como <span lang="en-US">interval tree clocks</span>, vetores esparsos, dotted <span lang="en-US">version vectors</span> e clocks específicos de CRDT atacam diferentes padrões de dinamismo. Nenhuma é universal. Escolha com base em número de escritores, duração das partições, topologia de replicação e necessidade de detectar toda concorrência.

<h2>11. Observabilidade: o <span lang="en-US">timestamp</span> também precisa ser operado</h2>

Instrumente o mecanismo. Métricas úteis incluem tamanho médio e p99 do contexto causal, saltos do contador ao receber mensagens, número de versões concorrentes por chave, conflitos resolvidos automaticamente ou enviados à aplicação, gerações de réplica ativas e falhas ao persistir estado.

Para HLC ou relógios físicos, observe offset NTP, passos para trás, distância entre parte lógica e física e rejeições por desvio máximo. Um crescimento repentino da parte lógica pode indicar relógio físico parado, tráfego causal intenso ou uma máquina muito adiantada contaminando <span lang="en-US">timestamps</span>.

Registre contexto suficiente para depurar, mas não transforme cada log em um vetor gigante. Em muitos casos, o identificador da versão, a origem e um hash do contexto bastam nos logs normais; o vetor completo fica em eventos de conflito ou amostras. Defina retenção, pois metadados causais podem revelar topologia e identificadores internos.

<h2>12. Modos de falha e anti-padrões</h2>

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Anti-padrões de relógios lógicos e causalidade"><table><thead><tr><th scope="col">Anti-padrão</th><th scope="col">Falha resultante</th><th scope="col">Correção</th></tr></thead><tbody><tr><td>Tratar Lamport menor como causa</td><td>Inventa dependências entre eventos concorrentes.</td><td>Use vetores ou guarde a relação explícita.</td></tr><tr><td>Usar diferença de Lamport como latência</td><td>Produz duração sem unidade física.</td><td>Meça com relógio monotônico local ou protocolo temporal.</td></tr><tr><td>Ordenar por relógio de parede e chamar de causal</td><td>Deriva e ajustes podem perder atualizações.</td><td>Separe tempo físico de contexto causal.</td></tr><tr><td>Zerar contador após reinício</td><td>Novos eventos parecem antigos.</td><td>Persistência ou nova identidade de geração.</td></tr><tr><td>Reutilizar ID de réplica cedo</td><td>Histórias diferentes ocupam o mesmo componente.</td><td>Reconfiguração segura e IDs únicos.</td></tr><tr><td>Podar vetor sem prova</td><td>Concorrência vira dominância falsa.</td><td>Compactação com protocolo e limite declarado.</td></tr><tr><td>Um componente por cliente</td><td>Metadado cresce sem limite.</td><td>Modelar autores por réplica ou usar dots.</td></tr><tr><td>Preservar irmãos sem limite</td><td>Explosão de versões.</td><td>Política de fusão, CRDT ou coordenação.</td></tr><tr><td>Acreditar que HLC dá linearizabilidade</td><td>Garantia maior que o protocolo.</td><td>Analisar commit, consenso e isolamento completos.</td></tr></tbody></table></div>

<h2>13. Testes de correção que valem a pena</h2>

1.  **Propriedade local.** Gere sequências aleatórias e confirme que <span lang="en-US">timestamps</span> crescem dentro de cada processo.
2.  **Propriedade de mensagem.** Para cada envio e recebimento correspondentes, confirme que o <span lang="en-US">timestamp</span> do recebimento domina o do envio.
3.  **Concorrência conhecida.** Crie dois processos sem comunicação. Relógios vetoriais devem ficar incomparáveis mesmo que Lamport os ordene.
4.  **Duplicação.** Entregue a mesma mensagem duas vezes. O contexto mesclado não deve perder conhecimento; o efeito deve obedecer à política de idempotência.
5.  **Reordenação.** Entregue mensagens antigas depois das novas. O relógio nunca deve regredir.
6.  **Recuperação.** Reinicie uma réplica com estado persistido e com estado perdido. O segundo caso deve ser rejeitado ou receber nova identidade.
7.  **Partição e reunião.** Faça atualizações dos dois lados. O sistema deve classificá-las como concorrentes e aplicar a política de reconciliação definida.

Testes baseados em propriedades são adequados porque os invariantes importam mais que uma sequência fixa. Gere grafos de eventos, compute o fechamento transitivo de <span lang="en-US">happened-before</span> e compare com o resultado do relógio. Para vetores, todo par causal deve ser comparável na direção correta e todo par sem caminho deve ser incomparável.

<h2 id="rl-experimento">14. Experimento reproduzível</h2>

O arquivo <a href="../../assets/relogios-logicos-lamport-vetores-e-causalidade-sem-relogio-global/relogios-logicos-experimento.py" download="">relogios-logicos-experimento.py</a> implementa ambos os algoritmos com a biblioteca padrão do Python. Ele reproduz o cenário de A, B e C e compara os vetores.

<pre class="code-block"><code>python3 relogios-logicos-experimento.py
&#10;A altera peça       Lamport=1  vetor=[1, 0, 0]
A envia para B      Lamport=2  vetor=[2, 0, 0]
C altera em paralelo Lamport=1  vetor=[0, 0, 1]
B recebe de A       Lamport=3  vetor=[2, 1, 0]
B finaliza          Lamport=4  vetor=[2, 2, 0]
&#10;A2 -> B1? True
B2 versus C1: concorrente</code></pre>

O último par é a demonstração principal. O escalar coloca C1, de valor 1, antes de B2, de valor 4; o vetor informa que não existe dominância. Altere o programa para C enviar uma mensagem a B antes de B2. Depois do recebimento, o vetor de B deve incorporar o componente de C e passar a dominar C1.

<h2>15. Quando não usar</h2>

Não use relógios vetoriais quando a aplicação nunca consulta causalidade e uma ordem total convencional basta. Não acrescente contexto causal a um pipeline analítico apenas porque eventos podem chegar fora de ordem; tempo de evento, <span lang="en-US">watermarks</span> e IDs de deduplicação podem ser as abstrações corretas.

Também não os use como substitutos de coordenação quando o invariante exige exclusão mútua ou saldo não negativo. Detectar que duas retiradas foram concorrentes não desfaz dinheiro gasto. Nesses casos, consenso, transações, reservas ou partição de autoridade evitam estados inválidos antes que precisem ser reconciliados.

Por fim, não troque auditoria temporal por ordem lógica. Um <span lang="en-US">timestamp</span> de Lamport diz quem pode ter influenciado quem, mas não informa a hora legal de uma assinatura nem o tempo de retenção. Guarde relógios físicos e evidência apropriada quando o requisito é cronológico.

<h2>Resumo mental</h2>

<div class="article-callout">

**Volte à oficina.** O relógio da parede ajuda a dizer a hora, mas pode discordar entre salas. A ficha que acompanha a peça prova que o trabalho de Ana chegou a Bruno antes de ele continuar. Um número de Lamport mantém essa sequência com pouco custo. Uma ficha com um contador por oficina também revela quando duas peças foram alteradas em paralelo. HLC aproxima a ficha da hora da parede. Nenhuma ficha decide sozinha como fundir duas restaurações conflitantes: essa é a regra do negócio.

</div>

<h2>Perguntas de revisão</h2>

1.  Por que dois eventos com horários físicos diferentes ainda podem ser concorrentes?
2.  Quais três regras definem <span lang="en-US">happened-before</span>?
3.  O que `C(a) < C(b)` permite concluir em um relógio de Lamport?
4.  Por que a recíproca da condição de Lamport é falsa?
5.  Como a comparação componente a componente detecta concorrência?
6.  Qual custo cresce com o número de participantes em um vetor denso?
7.  Por que <span lang="en-US">version vectors</span> normalmente representam réplicas, não clientes?
8.  Que informação HLC preserva e qual informação ele não recupera?
9.  Por que <span lang="en-US">last-write-wins</span> é política de resolução, não prova causal?

<h2>Exercícios</h2>

<h3>1. Calcule os <span lang="en-US">timestamps</span></h3>

Desenhe três processos. Faça A enviar para B, B enviar para C e C executar dois eventos locais. Calcule os relógios de Lamport e os vetores em cada passo. Depois adicione um evento independente em A e identifique quais pares são concorrentes.

<h3>2. Quebre a recíproca</h3>

Construa a menor execução em que `C(a) < C(b)`, mas `a` não acontece antes de `b`. Explique por que acrescentar o ID do processo produz uma ordem total sem transformar o par em causal.

<h3>3. Simule recuperação</h3>

Modifique o experimento para persistir vetores em JSON. Reinicie B primeiro restaurando o arquivo e depois perdendo-o. Mostre uma execução em que reutilizar a identidade B com vetor zero classifica incorretamente uma versão. Proponha uma geração de réplica para impedir a ambiguidade.

<h2 id="rl-fontes">Fontes e leituras</h2>

Fontes consultadas em 23 de setembro de 2026. A oficina, os exemplos, diagramas e o experimento são materiais didáticos próprios; as legendas distinguem valores calculados de ilustrações.

1.  Leslie Lamport — [<span lang="en-US">Time, Clocks, and the Ordering of Events in a Distributed System</span>](https://lamport.azurewebsites.net/pubs/time-clocks.pdf), Communications of the ACM, julho de 1978. Define <span lang="en-US">happened-before</span>, relógios lógicos escalares e a extensão para ordem total.
2.  Colin J. Fidge — [<span lang="en-US">Timestamps</span> <span lang="en-US">in Message-Passing Systems That Preserve the Partial Ordering</span>](https://raw.githubusercontent.com/ChristopherBiscardi/papers/master/papers/timestamps-in-message-passing-systems-that-preserve-the-partial-ordering.pdf), Australian Computer Science Conference, 1988. Apresenta o algoritmo vetorial desenvolvido independentemente no mesmo período.
3.  Friedemann Mattern — [<span lang="en-US">Virtual Time and Global States of Distributed Systems</span>](https://vs.inf.ethz.ch/publ/papers/VirtTimeGlobStates.pdf), 1989. Modela tempo vetorial e sua relação isomórfica com causalidade.
4.  D. S. Parker et al. — [<span lang="en-US">Detection of Mutual Inconsistency in Distributed Systems</span>](https://pages.cs.wisc.edu/~remzi/Classes/739/Papers/parker83detection.pdf), IEEE Transactions on Software Engineering, maio de 1983. Introduz <span lang="en-US">version vectors</span> para detectar cópias mutuamente inconsistentes.
5.  Giuseppe DeCandia et al. — [<span lang="en-US">Dynamo: Amazon’s Highly Available Key-value Store</span>](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf), SOSP 2007. Aplica versionamento, vetores e reconciliação de versões concorrentes.
6.  Nuno Preguiça et al. — [Dotted <span lang="en-US">Version Vectors</span>: <span lang="en-US">Logical Clocks for Optimistic Replication</span>](https://arxiv.org/abs/1011.5808), 2010. Preserva causalidade com metadados limitados pelo número de servidores que registram atualizações.
7.  Sandeep S. Kulkarni et al. — [<span lang="en-US">Logical Physical Clocks and Consistent Snapshots in Globally Distributed Databases</span>](https://cse.buffalo.edu/tech-reports/2014-04.pdf), 2014. Propõe <span lang="en-US">Hybrid Logical Clocks</span> próximos do tempo físico e compatíveis com a ordem causal.
8.  James C. Corbett et al. — [<span lang="en-US">Spanner: Google’s Globally-Distributed Database</span>](https://research.google.com/archive/spanner-osdi2012.pdf), OSDI 2012. Descreve TrueTime, intervalos de incerteza e external consistency.

<a href="index.html#recent-posts" class="article-back">← Todos os artigos</a>
