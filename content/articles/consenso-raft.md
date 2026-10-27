---
slug: consenso-raft
language: pt-BR
title: "Raft: como um cluster concorda sobre um log"
category: Sistemas distribuídos · Algoritmos
date: 25 de setembro de 2026
publishedAt: 2026-09-25
read: 27 min de leitura
image: assets/consenso-raft/consenso-raft-cover.jpg
alt: Aquarela de cinco arquivistas comparando livros; três cópias coincidem e apontam para o carimbo sobre o registro mestre.
dek: "Eleição de líder, replicação, commit e termos: as regras que preservam um único histórico mesmo quando nós falham e a rede se divide."
speechMarkup:
  title:
    - text: "Raft: como um "
      lang: pt-BR
    - text: cluster
      lang: en-US
    - text: " concorda sobre um "
      lang: pt-BR
    - text: log
      lang: en-US
  dek:
    - text: "Eleição de líder, replicação, "
      lang: pt-BR
    - text: commit
      lang: en-US
    - text: " e termos: as regras que preservam um único histórico mesmo quando nós falham e a rede se divide."
      lang: pt-BR
excerpt: "Um mergulho no Raft: maioria, eleição, replicação de log, segurança, disponibilidade e as sutilezas que quebram implementações."
tags:
  - dados-distribuidos
  - sistemas-distribuidos
---

Na sala de arquivos, cinco arquivistas comparam suas cópias antes de carimbar o livro mestre; uma delas pergunta se já podem registrar a nova página, e três apontam para a mesma linha. Mas as outras duas ainda discordam, alguém reage; esperamos todas? Não, responde quem segura o carimbo, três cópias coincidentes bastam para que qualquer outra maioria futura encontre ao menos uma delas. Essa combinação de autoridade temporária, maioria sobreposta e histórico ordenado é a intuição do Raft: fazer um <span lang="en-US">cluster</span> concordar sobre um <span lang="en-US">log</span> sem exigir que todos estejam disponíveis ao mesmo tempo.

<div class='article-callout'><p><strong>Ideia central:</strong> Raft elege um líder por termo. O líder escolhe a posição de cada comando, replica a entrada e só a considera confirmada quando uma maioria a armazenou segundo as regras do protocolo. Se perde contato com a maioria, a parte isolada para de avançar; isso preserva segurança, mas sacrifica disponibilidade.</p></div>

<nav aria-label='Neste artigo'><strong>Neste guia</strong><ul><li><a href='#raft-problema'>O problema e o contrato</a></li><li><a href='#raft-maioria'>Maioria e falhas</a></li><li><a href='#raft-eleicao'>Eleição de líder</a></li><li><a href='#raft-replicacao'>Replicação e commit</a></li><li><a href='#raft-corretude'>Por que as regras são seguras</a></li><li><a href='#raft-operacao'>Operação e desempenho</a></li><li><a href='#raft-experimento'>Experimento</a></li><li><a href='#raft-fontes'>Fontes</a></li></ul></nav>

<h2 id='raft-problema'>1. Consenso não é votar em qualquer valor</h2>

O objetivo prático é manter uma máquina de estados replicada. Cada servidor guarda um <span lang="en-US">log</span> ordenado de comandos; ao aplicar a mesma sequência a uma máquina determinística, todas as réplicas chegam ao mesmo estado. Se a entrada 42 significa `definir limite = 900`, nenhuma réplica pode aplicar outro comando na posição 42. O [artigo de Diego Ongaro e John Ousterhout](https://raft.github.io/raft.pdf), publicado em versão estendida em 2014, apresenta Raft como um algoritmo de consenso para administrar esse <span lang="en-US">log</span> replicado.

A entrada do algoritmo não é apenas uma requisição do cliente. Cada nó recebe comandos, mensagens de pares e eventos de temporizador. O resultado externo é uma sequência confirmada de comandos; internamente, o nó também produz mensagens, gravações duráveis e mudanças de papel. A topologia clássica é um grupo pequeno e fixo de servidores que falham por parada e podem se recuperar do armazenamento estável. Raft não foi projetado para nós bizantinos que mentem, forjam mensagens ou violam deliberadamente o protocolo.

O contrato separa duas propriedades:

- **Segurança:** nada incorreto acontece. Dois servidores não aplicam comandos diferentes no mesmo índice. A segurança independe de relógios precisos e deve resistir a atraso, perda, duplicação, reordenação e partição de mensagens no modelo não bizantino.
- **Disponibilidade:** algo útil continua acontecendo. Para eleger líder e confirmar novas entradas, uma maioria precisa estar ativa, comunicável e capaz de persistir. Temporizadores e latência importam aqui.

Essa distinção explica um comportamento que surpreende em incidentes: um <span lang="en-US">cluster</span> seguro pode estar completamente indisponível. Recusar uma escrita sem quórum é a ação correta quando aceitá-la criaria dois históricos confirmados.

<h2>2. Estado mínimo: o que cada servidor lembra</h2>

Em qualquer instante, um servidor é **seguidor**, **candidato** ou **líder**. Todos persistem `currentTerm`, `votedFor` e o <span lang="en-US">log</span> antes de responder de forma que dependa desses dados. Também acompanham `commitIndex`, a maior entrada conhecida como confirmada, e `lastApplied`, a maior já aplicada à máquina de estados. O líder mantém por seguidor `nextIndex`, a próxima posição a enviar, e `matchIndex`, a maior posição comprovadamente replicada.

<div class='article-table-scroll' tabindex='0' role='region' aria-label='Tabela rolável com o estado principal de um servidor Raft'><table><thead><tr><th scope='col'>Estado</th><th scope='col'>Persistência</th><th scope='col'>Por que importa</th></tr></thead><tbody><tr><td><code>currentTerm</code></td><td>Durável</td><td>Detecta mensagens e líderes obsoletos.</td></tr><tr><td><code>votedFor</code></td><td>Durável</td><td>Impede dois votos do mesmo servidor no mesmo termo.</td></tr><tr><td><span lang="en-US">Log</span></td><td>Durável</td><td>Guarda comandos, índice e termo de criação.</td></tr><tr><td><code>commitIndex</code></td><td>Volátil ou reconstruível, conforme a implementação</td><td>Separa armazenado de seguro para aplicar.</td></tr><tr><td><code>lastApplied</code></td><td>Compatível com a durabilidade da máquina de estados</td><td>Evita reaplicação incorreta após recuperação.</td></tr><tr><td><code>nextIndex</code> e <code>matchIndex</code></td><td>Volátil, só no líder</td><td>Dirige reparo e avanço de cada seguidor.</td></tr></tbody></table></div>

O <span lang="en-US">log</span> contém pares `(term, command)` em índices consecutivos. O termo registra sob qual liderança a entrada nasceu; ele não muda quando líderes futuros a replicam. Uma entrada armazenada ainda pode ser não confirmada. Só depois do <span lang="en-US">commit</span> ela pode alimentar a máquina de estados e uma resposta definitiva ao cliente.

<h2 id='raft-maioria'>3. A matemática da maioria</h2>

Para `n` votantes, o tamanho do quórum é:

<pre class='code-block'><code>quórum = piso(n / 2) + 1</code></pre>

O número máximo de falhas de parada toleradas sem perder progresso é:

<pre class='code-block'><code>f = piso((n - 1) / 2)</code></pre>

<div class='article-table-scroll' tabindex='0' role='region' aria-label='Tabela rolável com tamanho de cluster, maioria e falhas toleradas'><table><thead><tr><th scope='col'>Votantes</th><th scope='col'>Maioria</th><th scope='col'>Falhas toleradas com progresso</th></tr></thead><tbody><tr><td>1</td><td>1</td><td>0</td></tr><tr><td>3</td><td>2</td><td>1</td></tr><tr><td>5</td><td>3</td><td>2</td></tr><tr><td>7</td><td>4</td><td>3</td></tr></tbody></table></div>

Quaisquer duas maiorias do mesmo conjunto se intersectam. Em cinco nós, duas coleções de três não podem ser disjuntas: somariam seis lugares em um universo de cinco. Essa interseção não prova sozinha toda a corretude do Raft, mas transporta informação entre decisões. Uma maioria futura inclui pelo menos um servidor de uma maioria anterior.

Adicionar um quarto votante a um <span lang="en-US">cluster</span> de três aumenta a maioria de dois para três sem aumentar a tolerância a falhas, que continua em um. Por isso números ímpares costumam usar recursos com mais eficiência. Réplicas não votantes podem servir outras finalidades, mas não contam para a maioria.

<h2>4. Termos são épocas lógicas, não segundos</h2>

Raft divide a execução em termos numerados monotonamente. Um termo pode ter uma eleição bem-sucedida e um líder, ou terminar sem líder por votos divididos. Servidores descobrem novos termos em momentos diferentes; um nó pode nem observar certos termos.

Toda mensagem carrega o termo do emissor. Quem recebe um termo maior atualiza seu `currentTerm` e volta a seguidor. Mensagens com termo menor são obsoletas e rejeitadas. Assim, um líder isolado continua podendo se imaginar líder, mas perde autoridade assim que encontra evidência de um termo mais novo. Termo é um relógio lógico de liderança, não uma duração.

<figure class='mermaid-figure'><div class='mermaid-diagram' data-mermaid='true' data-mermaid-label='Máquina de estados do Raft: seguidor vira candidato após timeout; maioria o torna líder; termo maior devolve candidato ou líder ao estado seguidor.'><pre class='mermaid-source'>stateDiagram-v2&#10;  [*] --> Seguidor&#10;  Seguidor --> Candidato: timeout de eleição&#10;  Candidato --> Líder: votos da maioria&#10;  Candidato --> Candidato: timeout e novo termo&#10;  Candidato --> Seguidor: líder válido ou termo maior&#10;  Líder --> Seguidor: observa termo maior</pre></div><figcaption>Máquina de estados conceitual. O temporizador provoca tentativa de eleição; apenas mensagens e votos com termos válidos estabelecem autoridade.</figcaption><details class='mermaid-fallback'><summary>Ver o código Mermaid</summary><pre class='code-block'>stateDiagram-v2&#10;  [*] --> Seguidor&#10;  Seguidor --> Candidato: timeout de eleição&#10;  Candidato --> Líder: votos da maioria&#10;  Candidato --> Candidato: timeout e novo termo&#10;  Candidato --> Seguidor: líder válido ou termo maior&#10;  Líder --> Seguidor: observa termo maior</pre></details></figure>

<h2 id='raft-eleicao'>5. Eleição: primeiro autoridade, depois replicação</h2>

O líder envia <span lang="en-US">heartbeats</span>, mensagens `AppendEntries` que podem não carregar entradas. Um seguidor que passa um <span lang="en-US">election timeout</span> sem comunicação válida incrementa o termo, torna-se candidato, vota em si e envia `RequestVote` em paralelo.

Um votante concede no máximo um voto por termo e somente se o <span lang="en-US">log</span> do candidato for pelo menos tão atualizado quanto o seu. A comparação usa primeiro o termo da última entrada; se empatar, usa o índice final. Esse detalhe impede que um candidato com histórico mais longo, mas de termo antigo, desaloje comandos já protegidos por um <span lang="en-US">log</span> mais atual.

<figure class='mermaid-figure'><div class='mermaid-diagram' data-mermaid='true' data-mermaid-label='Em um cluster de cinco nós, B sofre timeout, inicia o termo 8, pede votos e recebe confirmações de A e C; com seu próprio voto forma maioria de três e começa a enviar heartbeats.'><pre class='mermaid-source'>sequenceDiagram&#10;  participant B as Candidato B&#10;  participant A as Servidor A&#10;  participant C as Servidor C&#10;  participant D as Servidor D&#10;  participant E as Servidor E&#10;  B->>B: timeout, termo 8, vota em si&#10;  B->>A: RequestVote termo 8&#10;  B->>C: RequestVote termo 8&#10;  B->>D: RequestVote termo 8&#10;  B->>E: RequestVote termo 8&#10;  A-->>B: voto concedido&#10;  C-->>B: voto concedido&#10;  B->>A: heartbeat como líder&#10;  B->>C: heartbeat como líder&#10;  B->>D: heartbeat como líder&#10;  B->>E: heartbeat como líder</pre></div><figcaption>Sequência ilustrativa. O voto próprio mais A e C forma três de cinco; respostas de D e E não são necessárias para eleger B.</figcaption><details class='mermaid-fallback'><summary>Ver o código Mermaid</summary><pre class='code-block'>sequenceDiagram&#10;  participant B as Candidato B&#10;  participant A as Servidor A&#10;  participant C as Servidor C&#10;  participant D as Servidor D&#10;  participant E as Servidor E&#10;  B->>B: timeout, termo 8, vota em si&#10;  B->>A: RequestVote termo 8&#10;  B->>C: RequestVote termo 8&#10;  B->>D: RequestVote termo 8&#10;  B->>E: RequestVote termo 8&#10;  A-->>B: voto concedido&#10;  C-->>B: voto concedido&#10;  B->>A: heartbeat como líder&#10;  B->>C: heartbeat como líder&#10;  B->>D: heartbeat como líder&#10;  B->>E: heartbeat como líder</pre></details></figure>

Se vários seguidores expiram juntos, os votos podem se dividir. Raft resolve isso com timeouts aleatórios: candidatos esperam durações diferentes antes de iniciar ou reiniciar a disputa. O exemplo didático do paper usa 150 a 300 ms, mas não é uma configuração universal. O intervalo real deve refletir rede, disco, pausas do processo e ambiente.

A maioria garante no máximo um vencedor por termo: dois candidatos diferentes precisariam de duas maiorias, que se intersectam, mas o servidor da interseção não pode votar duas vezes no mesmo termo. Ainda pode haver líderes de termos distintos por algum tempo; termos e regras de <span lang="en-US">commit</span> tornam o antigo incapaz de confirmar um histórico concorrente.

<h2 id='raft-replicacao'>6. Replicação: anexar, provar e aplicar</h2>

Depois de eleito, o líder é a única origem de novas entradas. Uma escrita típica percorre cinco passos:

1.  O cliente envia um comando ao líder.
2.  O líder acrescenta `(term, command)` ao próprio <span lang="en-US">log</span> e persiste a mudança.
3.  O líder envia `AppendEntries` aos seguidores, incluindo o índice e o termo da entrada imediatamente anterior.
4.  Ao receber confirmações suficientes, o líder avança `commitIndex`.
5.  Os servidores aplicam entradas confirmadas, em ordem, à máquina de estados; o líder responde ao cliente.

<figure class='mermaid-figure'><div class='mermaid-diagram' data-mermaid='true' data-mermaid-label='Cliente envia comando ao líder; líder persiste e replica para quatro seguidores; confirmações de dois seguidores completam maioria de três; líder aplica e responde.'><pre class='mermaid-source'>sequenceDiagram&#10;  participant C as Cliente&#10;  participant L as Líder&#10;  participant A as Seguidor A&#10;  participant B as Seguidor B&#10;  participant D as Seguidor D&#10;  participant E as Seguidor E&#10;  C->>L: comando x=7&#10;  L->>L: persiste entrada índice 12&#10;  par replicação paralela&#10;    L->>A: AppendEntries&#10;    L->>B: AppendEntries&#10;    L->>D: AppendEntries&#10;    L->>E: AppendEntries&#10;  end&#10;  A-->>L: persistido até 12&#10;  B-->>L: persistido até 12&#10;  L->>L: maioria, commit 12, aplica&#10;  L-->>C: sucesso</pre></div><figcaption>Fluxo comum calculado para cinco votantes. Líder, A e B formam a maioria; D e E podem alcançar a entrada depois.</figcaption><details class='mermaid-fallback'><summary>Ver o código Mermaid</summary><pre class='code-block'>sequenceDiagram&#10;  participant C as Cliente&#10;  participant L as Líder&#10;  participant A as Seguidor A&#10;  participant B as Seguidor B&#10;  participant D as Seguidor D&#10;  participant E as Seguidor E&#10;  C->>L: comando x=7&#10;  L->>L: persiste entrada índice 12&#10;  par replicação paralela&#10;    L->>A: AppendEntries&#10;    L->>B: AppendEntries&#10;    L->>D: AppendEntries&#10;    L->>E: AppendEntries&#10;  end&#10;  A-->>L: persistido até 12&#10;  B-->>L: persistido até 12&#10;  L->>L: maioria, commit 12, aplica&#10;  L-->>C: sucesso</pre></details></figure>

O campo `prevLogIndex` com `prevLogTerm` é a prova de prefixo. O seguidor só aceita novas entradas se possuir a entrada anterior com o mesmo termo. Se rejeita, o líder recua `nextIndex` até encontrar o último ponto comum; então remove o sufixo conflitante do seguidor e copia o sufixo correto. O líder nunca sobrescreve o próprio <span lang="en-US">log</span>.

<pre class='code-block'><code>ao receber AppendEntries(term, prevIndex, prevTerm, entries, leaderCommit):&#10;  rejeitar se term &lt; currentTerm&#10;  rejeitar se log[prevIndex].term != prevTerm&#10;  remover sufixo que conflita com entries&#10;  anexar entradas ainda ausentes&#10;  commitIndex = min(leaderCommit, índice da última entrada local)&#10;  responder sucesso</code></pre>

Essa checagem preserva a propriedade de correspondência: se dois <span lang="en-US">logs</span> têm entrada com mesmo índice e termo, armazenam o mesmo comando e possuem prefixos idênticos até ali. Não é uma comparação de conteúdo arbitrária; índice e termo identificam a história que autorizou aquela posição.

<h2>7. <span lang="en-US">Commit</span> não significa apenas estar em três discos</h2>

Uma entrada criada no termo atual pode ser confirmada quando está no líder e em uma maioria. Isso também confirma, indiretamente, todas as entradas anteriores do <span lang="en-US">log</span> do líder. Há uma sutileza importante: um líder não deve confirmar uma entrada de termo anterior apenas contando suas réplicas atuais.

O paper mostra uma execução em que uma entrada antiga aparece temporariamente em uma maioria e ainda pode ser substituída por um líder futuro. A regra conservadora é contar maioria diretamente apenas para entradas do termo do líder atual. Quando uma entrada do termo atual é confirmada, a propriedade de correspondência torna seguro considerar o prefixo anterior confirmado.

Implementações frequentemente acrescentam uma entrada vazia ao assumir a liderança. Ao confirmá-la, o novo líder estabelece um ponto do próprio termo e, por consequência, torna seguro o prefixo herdado. Essa entrada não é enfeite: fecha uma lacuna de conhecimento sobre <span lang="en-US">commits</span> de lideranças anteriores.

<div class='article-callout'><p><strong>Três estados diferentes:</strong> uma entrada pode estar <em>anexada</em> no líder, <em>replicada</em> em alguns nós e <em>confirmada</em>. Só o último estado autoriza aplicação definitiva. Responder ao cliente antes desse ponto pode expor um comando que desaparece após nova eleição.</p></div>

<h2 id='raft-corretude'>8. O encadeamento que preserva a segurança</h2>

A corretude surge da composição de invariantes, não de uma única maioria:

1.  **Segurança da eleição:** no máximo um líder por termo, porque cada nó dá no máximo um voto e maiorias se intersectam.
2.  **<span lang="en-US">Log</span> somente crescente no líder:** o líder anexa; nunca reescreve ou apaga entradas próprias.
3.  **Correspondência de <span lang="en-US">logs</span>:** mesmo índice e termo implicam mesmo comando e mesmo prefixo.
4.  **Completude do líder:** toda entrada confirmada aparece no <span lang="en-US">log</span> dos líderes de termos posteriores.
5.  **Segurança da máquina de estados:** se um servidor aplica uma entrada em certo índice, nenhum outro aplica comando diferente nesse índice.

A restrição de voto liga eleição e replicação. Um candidato precisa de maioria; qualquer entrada confirmada estava em uma maioria anterior. As maiorias se cruzam. O votante que carrega a entrada só aceita candidato cujo <span lang="en-US">log</span> seja ao menos tão atualizado. A comparação por último termo e índice impede que um histórico desatualizado conquiste autoridade e apague o confirmado.

Essa explicação é uma intuição de prova, não substitui a especificação formal. O projeto mantém uma [especificação TLA+](https://github.com/ongardie/raft.tla), e a dissertação de Ongaro dedica capítulos à prova de segurança e às extensões práticas. Para modificar o protocolo, teste de integração não basta: uma otimização pode preservar o caminho comum e quebrar uma interleaving rara.

<h2>9. Partição: uma metade continua, a outra espera</h2>

Considere cinco nós separados em grupos de três e dois. O grupo de três pode eleger líder e confirmar novas entradas. O grupo de dois não alcança maioria, mesmo que ainda contenha o antigo líder. Ele pode aceitar conexões por engano se a camada externa não fizer verificação, mas não consegue confirmar segundo Raft.

<figure class='mermaid-figure'><div class='mermaid-diagram' data-mermaid='true' data-mermaid-label='Uma partição divide cinco nós em A B C e D E. A B C possui maioria de três e pode eleger e confirmar; D E possui dois e para.'><pre class='mermaid-source'>flowchart LR&#10;  subgraph M[Partição com maioria]&#10;    A[A]&#10;    B[B]&#10;    C[C]&#10;    A <--> B&#10;    B <--> C&#10;  end&#10;  subgraph m[Partição minoritária]&#10;    D[D]&#10;    E[E]&#10;    D <--> E&#10;  end&#10;  M --> P[Pode eleger e confirmar]&#10;  m --> S[Sem maioria, não avança]</pre></div><figcaption>Cenário ilustrativo com cinco votantes. A partição preserva um único lado capaz de progredir; segurança é mantida pela indisponibilidade do lado minoritário.</figcaption><details class='mermaid-fallback'><summary>Ver o código Mermaid</summary><pre class='code-block'>flowchart LR&#10;  subgraph M[Partição com maioria]&#10;    A[A]&#10;    B[B]&#10;    C[C]&#10;    A <--> B&#10;    B <--> C&#10;  end&#10;  subgraph m[Partição minoritária]&#10;    D[D]&#10;    E[E]&#10;    D <--> E&#10;  end&#10;  M --> P[Pode eleger e confirmar]&#10;  m --> S[Sem maioria, não avança]</pre></details></figure>

Quando a rede volta, o antigo líder observa termo maior, rebaixa-se e repara seu <span lang="en-US">log</span>. Entradas não confirmadas do lado minoritário podem ser sobrescritas. Isso é correto: foram tentativas, não decisões. O cliente que recebeu timeout não sabe se sua operação foi confirmada antes da falha; deve consultar o resultado ou repetir com identidade estável.

Raft tolera falha por parada, não <span lang="en-US">split brain</span> bizantino. Se operadores clonam armazenamento e iniciam duas instâncias com a mesma identidade, se o disco confirma antes de tornar dados duráveis, ou se a aplicação ignora a ordem de persistência, as premissas foram violadas. O algoritmo não corrige uma implementação que mente sobre seu próprio estado estável.

<h2>10. Segurança independe do tempo; progresso não</h2>

Relógios errados e mensagens muito atrasadas não deveriam produzir <span lang="en-US">logs</span> confirmados divergentes. Podem, porém, gerar eleições sucessivas e impedir progresso. A relação desejável do paper é intuitivamente:

<pre class='code-block'><code>tempo de broadcast  &lt;&lt;  timeout de eleição  &lt;&lt;  tempo médio entre falhas</code></pre>

Se o timeout é curto demais para o pior caminho frequente de rede mais persistência, seguidores saudáveis suspeitam do líder e elevam termos. Se é longo demais, a falha real demora a ser percebida. A aleatoriedade precisa ter largura suficiente para separar candidatos, mas não substitui medição.

A documentação de [<span lang="en-US">tuning</span> do etcd 3.6](https://etcd.io/docs/v3.6/tuning/) usa por padrão <span lang="en-US">heartbeat</span> de 100 ms e timeout de eleição de 1000 ms em redes locais, recomenda relacionar <span lang="en-US">heartbeat</span> ao RTT e lembra que disco lento entra no tempo observado. Esses valores são específicos do etcd e do ambiente descrito; copiá-los para outra implementação sem medir latência de cauda, pausas e `fsync` é uma falsa segurança.

Uma pausa longa de coleta de lixo, CPU sem agendamento, volume saturado ou fila de rede cheia pode parecer falha de líder. O sintoma é churn de liderança, termos crescendo e picos de latência, mesmo sem perda definitiva de máquinas. Investigue o caminho completo, não apenas ping.

<h2 id='raft-operacao'>11. Durabilidade, snapshots e recuperação</h2>

`currentTerm`, `votedFor` e novas entradas precisam ser duráveis antes de certas respostas. Um nó que concede voto e perde `votedFor` no reboot pode votar duas vezes no mesmo termo. Um seguidor que confirma uma entrada antes de persistir pode desaparecer da maioria que supostamente a guardava.

A ordem de efeitos importa. A biblioteca [etcd-io/raft](https://github.com/etcd-io/raft) separa o núcleo determinístico de rede e disco; seu contrato orienta persistir estado e entradas antes de enviar mensagens que dependem deles e aplicar `CommittedEntries` em ordem. Essa separação melhora testabilidade, mas transfere obrigações críticas à aplicação hospedeira.

O <span lang="en-US">log</span> não pode crescer para sempre. Um snapshot captura o estado até um índice confirmado e permite remover prefixos antigos. O snapshot deve carregar metadados suficientes, como último índice e termo incluídos, para continuar checagens de consistência. Seguidores muito atrasados recebem o snapshot em vez de milhões de entradas. Compactar não significa apagar informação antes de incorporá-la a um estado durável e instalável.

Na recuperação, restaure snapshot, estado persistente e sufixo do <span lang="en-US">log</span> antes de participar. Não trate cache em memória como fonte de verdade. Teste quedas entre cada par de operações de disco e mensagem; os bugs mais perigosos vivem entre gravei, respondi e reiniciei.

<h2>12. Raft não torna clientes exatamente uma vez</h2>

Considere: o líder confirma uma compra, responde, mas a resposta se perde. O cliente repete no novo líder. Raft ordena os dois comandos; não sabe que representam a mesma intenção. Sem deduplicação, a máquina de estados pode cobrar duas vezes.

Uma solução comum atribui a cada sessão um identificador e um número de sequência. A máquina de estados registra o maior número aplicado e a resposta correspondente. Uma repetição retorna o resultado guardado sem repetir o efeito. O estado de deduplicação faz parte da máquina replicada e do snapshot; deixá-lo apenas no líder perde a proteção após eleição.

Também há diferença entre escrita confirmada e leitura linearizável. Um líder antigo pode responder com estado obsoleto se estiver isolado e ainda não souber do novo termo. Caminhos seguros incluem confirmar que o líder ainda possui quórum no termo atual, usar um índice de leitura estabelecido pelo protocolo ou aplicar uma <span lang="en-US">lease</span> com premissas explícitas de relógio. O README do etcd-io/raft distingue leituras por quórum e leituras baseadas em <span lang="en-US">lease</span>; a segunda opção depende dos relógios das máquinas.

<h2>13. Mudança de membros também é consenso</h2>

Trocar a configuração de uma vez em cada servidor abre uma janela em que duas maiorias disjuntas podem existir: uma na configuração antiga e outra na nova. O algoritmo descrito no paper usa <span lang="en-US">joint consensus</span>. Durante a transição, decisões exigem maiorias das configurações antiga e nova; os conjuntos se sobrepõem até que a nova configuração seja confirmada.

Implementações práticas podem usar protocolos de mudança diferentes, inclusive alterações de um membro por vez com salvaguardas. Não misture variantes por memória. Siga o contrato e as correções da biblioteca escolhida; a própria página da [dissertação](https://github.com/ongardie/dissertation) registra errata importante sobre mudanças de servidor único.

Operacionalmente, remova ou adicione votantes pelo <span lang="en-US">log</span> de configuração, não editando arquivos manualmente em máquinas isoladas. Evite substituir vários nós simultaneamente. Um membro novo precisa alcançar o <span lang="en-US">log</span> antes de sua ausência aumentar o risco de indisponibilidade.

<h2>14. Custo e escalabilidade</h2>

No caminho comum, uma escrita faz o líder persistir, enviar para seguidores e aguardar confirmações de maioria. A comunicação é `O(n)` por lote para `n` membros, e a latência mínima inclui armazenamento durável e aproximadamente uma ida e volta entre líder e quórum. Pipelining e batching amortizam custo, mas não removem o ponto de coordenação.

Espaço cresce com o <span lang="en-US">log</span> não compactado e com snapshots. Estado volátil do líder cresce linearmente com os membros. Replicar para regiões distantes aumenta a latência do quórum se forem necessárias respostas remotas; a minoria lenta não bloqueia o caminho comum, mas a composição geográfica da maioria decide a cauda.

Raft não transforma um único grupo em banco infinitamente escalável. Muitos sistemas particionam dados em vários grupos Raft. Isso aumenta throughput agregado, mas introduz roteamento, balanceamento, transações entre grupos e milhares de líderes e <span lang="en-US">logs</span> para operar. O algoritmo resolve ordem dentro de cada grupo; não fornece atomicidade global entre grupos por si só.

<div class='article-table-scroll' tabindex='0' role='region' aria-label='Tabela rolável de operações, custos e gargalos do Raft'><table><thead><tr><th scope='col'>Operação</th><th scope='col'>Custo dominante</th><th scope='col'>Caso patológico</th></tr></thead><tbody><tr><td>Eleição</td><td>Uma rodada de pedidos de voto em paralelo</td><td>Votos divididos e termos sucessivos.</td></tr><tr><td>Escrita</td><td><code>fsync</code>, rede para seguidores e espera por maioria</td><td>Disco ou rede de cauda no quórum mais rápido.</td></tr><tr><td>Reparo de seguidor</td><td>Busca de prefixo comum e cópia de sufixo</td><td>Seguidor muito atrasado exige snapshot.</td></tr><tr><td>Leitura linearizável</td><td>Confirmação de autoridade ou protocolo de índice</td><td>Líder isolado não pode provar atualidade.</td></tr><tr><td>Snapshot</td><td>Serialização e armazenamento do estado</td><td>Snapshot grande disputa I/O com replicação.</td></tr></tbody></table></div>

<h2>15. Raft, Paxos e <span lang="en-US">Viewstamped Replication</span></h2>

Raft não inventou consenso nem é uma versão simplesmente melhor de todo protocolo anterior. Ele foi desenhado com compreensibilidade como meta explícita, decompondo eleição, replicação e segurança e adotando um líder forte. O paper afirma equivalência a Multi-Paxos em tolerância a falhas e desempenho, mas as famílias organizam o raciocínio e as variações de maneira diferente.

Multi-Paxos costuma ser apresentado a partir de decisões Paxos repetidas e de uma liderança otimizada. <span lang="en-US">Viewstamped Replication</span> também antecede Raft e trabalha com visões, primário e réplicas. Protocolos de produção incorporam extensões, correções e garantias próprias; comparar apenas diagramas de três caixas esconde diferenças de reconfiguração, leitura, snapshots, recuperação e modelo de falha.

Escolha uma implementação madura, especifique o contrato desejado e valide integrações de armazenamento e transporte. Implementar Raft do zero pode ser excelente exercício; usá-lo assim para guardar configuração crítica em produção é outra decisão.

<h2>16. Observabilidade que revela problemas reais</h2>

- **Termo e mudanças de líder:** crescimento frequente indica instabilidade.
- **Tempo desde o último <span lang="en-US">heartbeat</span> e latência de mensagens:** separe mediana de p99 e p99,9.
- **Latência de `fsync`:** observe líder e seguidores; disco entra no protocolo.
- **`commitIndex - lastApplied`:** mede atraso da máquina de estados.
- **`leaderCommit - matchIndex` por seguidor:** revela replicação atrasada.
- **Tamanho do <span lang="en-US">log</span> e idade do snapshot:** antecipa recuperação cara.
- **Propostas pendentes, rejeitadas e tempos de <span lang="en-US">commit</span>:** conecta saturação ao impacto no cliente.
- **Quantidade de votantes saudáveis:** diferencie nó vivo de nó capaz de participar do quórum.

Alertar apenas quando não existe líder perde o período em que o líder muda dez vezes por minuto. Alertar apenas por CPU perde disco lento. Correlacione termos, latência de persistência, filas de rede, pausas do processo e falhas do ambiente.

<h2>17. Anti-padrões e limites</h2>

<div class='article-table-scroll' tabindex='0' role='region' aria-label='Tabela rolável de anti-padrões do Raft e suas consequências'><table><thead><tr><th scope='col'>Anti-padrão</th><th scope='col'>Consequência</th><th scope='col'>Correção</th></tr></thead><tbody><tr><td>Responder antes do <span lang="en-US">commit</span></td><td>Sucesso pode desaparecer após eleição.</td><td>Responda após confirmação e aplicação exigida pelo contrato.</td></tr><tr><td>Conceder voto antes de persistir</td><td>Reboot permite segundo voto no mesmo termo.</td><td>Durabilize termo e voto antes da resposta.</td></tr><tr><td>Aceitar candidato só pelo índice mais alto</td><td><span lang="en-US">Log</span> longo de termo antigo pode vencer.</td><td>Compare último termo e depois índice.</td></tr><tr><td>Confirmar entrada antiga só por contagem</td><td>Entrada aparentemente majoritária pode ser sobrescrita.</td><td>Confirme diretamente uma entrada do termo atual.</td></tr><tr><td>Ler de qualquer líder aparente</td><td>Partição devolve dado obsoleto.</td><td>Use protocolo de leitura linearizável.</td></tr><tr><td>Timeout copiado de tutorial</td><td>Eleições espúrias ou detecção lenta.</td><td>Meça RTT, disco, filas e pausas.</td></tr><tr><td>Dois nós para alta disponibilidade</td><td>Qualquer falha perde a maioria.</td><td>Use três votantes ou reveja o requisito.</td></tr><tr><td>Deduplicação só no líder</td><td>Retry após eleição repete efeito.</td><td>Replicar identidade e resposta na máquina de estados.</td></tr><tr><td>Editar membros fora do <span lang="en-US">log</span></td><td>Configurações incompatíveis e maiorias perigosas.</td><td>Use o protocolo de reconfiguração da implementação.</td></tr><tr><td>Confiar em Raft contra nós maliciosos</td><td>O modelo de falha é violado.</td><td>Use protocolo bizantino e autenticação adequados.</td></tr></tbody></table></div>

<h2 id='raft-experimento'>18. Experimento reproduzível</h2>

O arquivo <a href='../../assets/consenso-raft/raft-quorum-experiment.py' download>raft-quorum-experiment.py</a> usa somente a biblioteca padrão do Python. Ele modela a ponta do <span lang="en-US">log</span> como `(último termo, último índice)`, aplica a regra de voto e compara as partições de três e dois nós.

<pre class='code-block'><code>python3 raft-quorum-experiment.py&#10;&#10;cluster=5, maioria=3&#10;D pede votos com ponta LogTip(last_term=3, last_index=9): 2 votos&#10;D pode virar líder? False&#10;A pede votos com ponta LogTip(last_term=4, last_index=8): 5 votos&#10;A pode virar líder? True&#10;partição A-B-C pode confirmar entrada? True&#10;partição D-E pode confirmar entrada? False&#10;interseção entre maiorias: {'C'}</code></pre>

D tem nove entradas, uma a mais que A, mas seu último termo é 3; A termina no termo 4 e portanto é mais atualizado. A, B e C negam o candidato desatualizado. Depois, o programa mostra que três nós podem confirmar e dois não, e que duas maiorias de três compartilham C.

O experimento não implementa Raft completo: não há rede, persistência, retransmissão nem máquina de estados. Essa limitação é intencional. Ele isola duas invariantes que devem permanecer verdadeiras dentro de uma implementação maior.

<h2>19. Quando Raft não é a resposta</h2>

Não use consenso quando a aplicação aceita convergência posterior e conflitos podem ser resolvidos por CRDTs ou regras de negócio; o custo de coordenação pode ser desnecessário. Não crie um grupo Raft por item de baixa importância sem considerar quantidade de <span lang="en-US">logs</span>, líderes, snapshots e tráfego operacional.

Raft também não substitui banco de dados, transporte, autorização, criptografia, backup, idempotência ou transação entre serviços. Ele oferece um <span lang="en-US">log</span> ordenado sob premissas específicas. A máquina de estados e o produto inteiro ainda podem conter bugs determinísticos, aplicar comandos não idempotentes ou expor uma API incoerente.

Se participantes podem agir maliciosamente, use protocolos tolerantes a falhas bizantinas. Se uma autoridade externa única já é confiável e a indisponibilidade dela é aceitável, uma arquitetura mais simples pode vencer. Consenso compra continuidade diante de falhas de uma minoria; não elimina todas as falhas e cobra em latência, complexidade e operação.

<h2>Resumo mental</h2>

<div class='article-callout'><p><strong>Volte ao arquivo.</strong> Cada linha do livro mestre tem posição e época. Uma pessoa segura o carimbo por um mandato temporário. Ela propõe a linha, confere o prefixo das cópias e só carimba depois que três de cinco a guardaram. Se a sala se divide, o grupo de três continua e o de dois espera. Na próxima troca de responsável, ninguém com cópia desatualizada recebe votos suficientes. É a combinação dessas regras, não o carimbo sozinho, que mantém um único histórico.</p></div>

<h2>Perguntas de revisão</h2>

1.  Qual diferença existe entre uma entrada anexada, replicada e confirmada?
2.  Por que duas maiorias de um mesmo conjunto sempre compartilham ao menos um nó?
3.  Por que um candidato com mais entradas pode ser menos atualizado?
4.  Como `prevLogIndex` e `prevLogTerm` preservam a correspondência de <span lang="en-US">logs</span>?
5.  Por que o líder só confirma diretamente, por contagem, entradas do termo atual?
6.  O que acontece com um líder antigo na partição minoritária?
7.  Quais dados precisam ser persistidos antes de certas respostas?
8.  Por que uma escrita Raft não é automaticamente exatamente uma vez?
9.  Que passo extra torna uma leitura linearizável?
10. Como timeout de eleição curto demais pode derrubar disponibilidade sem violar segurança?

<h2>Exercícios</h2>

<h3>1. Percorra uma eleição</h3>

Desenhe cinco <span lang="en-US">logs</span> cujas pontas sejam `(4,8)`, `(4,8)`, `(4,7)`, `(3,10)` e `(3,10)`. Faça cada nó candidatar-se e calcule quais votos pode receber pela regra de atualização. Verifique se algum candidato de termo final 3 alcança três votos.

<h3>2. Provoque indisponibilidade segura</h3>

Suba uma implementação didática de Raft com cinco processos, identifique o líder e bloqueie tráfego para formar partições 3–2. Envie escritas aos dois lados. Registre termos, respostas ao cliente e <span lang="en-US">logs</span> antes e depois da reunião. O lado minoritário deve falhar ou aguardar, nunca confirmar um histórico concorrente.

<h3>3. Teste quedas nos limites de persistência</h3>

Instrumente um nó para encerrar logo antes e logo depois de persistir `votedFor`, e antes e depois de responder a `AppendEntries`. Reinicie com o disco preservado. Confirme que ele não vota duas vezes no termo e não afirma guardar entrada ausente. Testes baseados em propriedades podem gerar sequências de quedas, duplicações e reordenações.

<h2 id='raft-fontes'>Fontes e leituras</h2>

Fontes consultadas em 25 de setembro de 2026. A sala de arquivos, os exemplos numéricos, os diagramas e o experimento são materiais didáticos próprios; legendas identificam cenários calculados ou ilustrativos.

1.  Diego Ongaro e John Ousterhout — [<span lang="en-US">In Search of an Understandable Consensus Algorithm</span>, versão estendida](https://raft.github.io/raft.pdf), 20 de maio de 2014. Fonte primária para estados, termos, eleição, replicação, segurança, <span lang="en-US">commit</span> e mudança conjunta de membros.
2.  [USENIX ATC 2014 — apresentação do Raft](https://www.usenix.org/conference/atc14/technical-sessions/presentation/ongaro). Registro da publicação e do prêmio de melhor paper.
3.  Diego Ongaro — <a lang="en-US" href='https://github.com/ongardie/dissertation'><span lang="en-US">Consensus: Bridging Theory and Practice</span></a>, tese de doutorado, Stanford University, 2014. Aprofunda clientes, snapshots, reconfiguração, prova e implementação; a página também mantém errata.
4.  Diego Ongaro — [especificação TLA+ do Raft](https://github.com/ongardie/raft.tla). Modelo formal atualizado em relação à versão da tese.
5.  Projeto etcd — [biblioteca raft](https://github.com/etcd-io/raft). Contrato de integração entre núcleo determinístico, persistência, transporte e aplicação; inclui extensões de leitura, compactação e fluxo.
6.  Projeto etcd — <a lang="en-US" href='https://etcd.io/docs/v3.6/tuning/'><span lang="en-US">Tuning</span></a>. Orientação operacional sobre <span lang="en-US">heartbeat</span>, timeout de eleição, latência de disco e rede.
7.  [site oficial do Raft](https://raft.github.io/). Reúne paper, visualizações, implementações, dissertação, especificação e trabalhos relacionados.

<a class='article-back' href='index.html#recent-posts'>← Todos os artigos</a>
