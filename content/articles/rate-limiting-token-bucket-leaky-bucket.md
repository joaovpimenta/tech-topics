---
'slug': 'rate-limiting-token-bucket-leaky-bucket'
'language': 'pt-BR'
'title': 'Rate Limiting: Token Bucket, Leaky Bucket e limites sob rajadas'
'category': 'Resiliência'
'date': '2 de outubro de 2026'
'publishedAt': '2026-10-02'
'read': '28 min de leitura'
'image': 'assets/rate-limiting-token-bucket-leaky-bucket/rate-limiting-token-bucket-leaky-bucket-cover.jpg'
'alt': 'Aquarela editorial de uma entrada de teatro com duas pessoas diante de catracas, uma bandeja de fichas e marcações pretas tracejadas destacando os controles de passagem.'
'dek': 'Como escolher entre crédito acumulável e vazão suavizada, dimensionar rajadas e aplicar limites coerentes em APIs distribuídas.'
'speechMarkup':
  'title':
    - 'text': 'Rate Limiting'
      'lang': 'en-US'
    - 'text': ': '
      'lang': 'pt-BR'
    - 'text': 'Token Bucket'
      'lang': 'en-US'
    - 'text': ', '
      'lang': 'pt-BR'
    - 'text': 'Leaky Bucket'
      'lang': 'en-US'
    - 'text': ' e limites sob rajadas'
      'lang': 'pt-BR'
'excerpt': 'Um guia técnico para dimensionar taxa e rajada, comparar Token Bucket e Leaky Bucket e aplicar limites corretos em APIs distribuídas.'
'tags':
  - 'desempenho'
  - 'resiliencia'
  - 'sistemas-distribuidos'
---

Na entrada de um pequeno teatro, duas pessoas chegam juntas e uma pergunta por que ambas podem atravessar agora, mas quem vier logo depois talvez precise esperar; o atendente aponta para uma bandeja de fichas acumuladas durante os minutos de calmaria e explica que cada passagem consome uma ficha, reposta aos poucos. Ao lado, outra catraca abre em intervalos regulares para manter o corredor num ritmo constante, mesmo quando alguém chega com pressa. Em sistemas, <span lang="en-US">rate limiting</span> pode seguir essas duas intuições: <span lang="en-US">Token Bucket</span> acumula crédito para absorver rajadas controladas, enquanto <span lang="en-US">Leaky Bucket</span> modela uma saída drenada a uma taxa previsível e transforma excesso em espera ou rejeição.

<div class="article-callout"><p><strong>Ideia central:</strong> um limite de taxa não é apenas um número de requisições por segundo. Ele define quanto crédito pode acumular, como uma rajada é tratada e onde o estado do limite vive. A mesma taxa média pode produzir experiências muito diferentes dependendo do algoritmo.</p></div>

<nav aria-label="Neste artigo"><strong>Neste guia</strong><ul><li><a href="#rl-problema">Taxa, capacidade e rajada</a></li><li><a href="#rl-token">Token Bucket</a></li><li><a href="#rl-leaky">Leaky Bucket</a></li><li><a href="#rl-comparacao">Comparação</a></li><li><a href="#rl-distribuido">Estado distribuído</a></li><li><a href="#rl-http">Contrato HTTP</a></li><li><a href="#rl-operacao">Falhas e operação</a></li><li><a href="#rl-fontes">Fontes</a></li></ul></nav>

<a name="rl-problema"></a>

## 1. A taxa média não conta toda a história

<span lang="en-US">Rate limiting</span> controla a quantidade de trabalho aceita de uma identidade, rota ou classe de tráfego dentro de um intervalo. Ele pode proteger uma dependência, impor uma cota comercial, reduzir abuso ou dividir capacidade entre clientes. Isso é diferente de <span lang="en-US">load shedding</span>: o primeiro normalmente aplica um contrato de taxa; o segundo reage à capacidade efetiva e rejeita trabalho para evitar colapso.

Considere uma API com limite nominal de 100 requisições por segundo. Aceitar exatamente uma requisição a cada 10 ms é um contrato. Permitir 100 chamadas de uma vez e depois bloquear por quase um segundo é outro. Ambos podem ter a mesma média de longo prazo, mas impõem perfis de concorrência e latência diferentes ao servidor.

Um modelo útil para rajadas é um envelope de tráfego. Se `r` é a taxa sustentada e `B` é a capacidade de crédito, o trabalho admitido em qualquer intervalo de duração `Δt` é limitado aproximadamente por:

<div class="code-block"><pre><code>admitido(Δt) ≤ r × Δt + B</code></pre></div>

Com `r = 50/s` e `B = 100`, um cliente ocioso pode acumular até 100 unidades e enviá-las quase imediatamente. Depois disso, o crédito volta a aparecer a 50 por segundo. O parâmetro `B` não é detalhe de implementação: ele é o orçamento explícito de rajada.

Os modelos de balde aparecem há décadas em controle de tráfego de redes. O [RFC 3290](<https://www.rfc-editor.org/rfc/rfc3290>) descreve token bucket e leaky bucket no contexto de diferenciação de serviços, inclusive a ideia de limitar tráfego por uma taxa e um tamanho de rajada. APIs reutilizam a mesma matemática, embora a unidade possa ser requisições, bytes ou custo ponderado.

<a name="rl-token"></a>

## 2. Token Bucket: guardar crédito para usar depois

No <span lang="en-US">Token Bucket</span>, existe um balde com capacidade `B`. Tokens entram à taxa `r`, até o teto `B`. Uma operação de custo `c` só é admitida se houver pelo menos `c` tokens; em caso positivo, o controlador desconta o custo de forma atômica.

<div class="code-block"><pre><code>agora = clock_monotonic()&#10;tokens = min(B, tokens + r * (agora - ultimo))&#10;ultimo = agora&#10;&#10;if tokens &gt;= custo:&#10;    tokens -= custo&#10;    admitir()&#10;else:&#10;    rejeitar_ou_esperar()</code></pre></div>

A atualização pode ser preguiçosa: não é preciso criar um temporizador que insira tokens a cada milissegundo. Ao receber uma requisição, calcula-se quanto tempo passou desde a última atualização e quanto crédito teria sido reposto. Assim, admissão e recarga continuam O(1) em tempo e O(1) em estado por chave.

O benefício é separar taxa sustentada de tolerância a rajadas. Se uma interface recebe pouca carga durante alguns segundos, ela acumula crédito e pode absorver uma pequena concentração de chamadas sem aumentar a taxa média permitida. Isso é útil para aplicações interativas, clientes móveis que retomam conectividade ou tarefas que naturalmente chegam em lotes.

O custo é uma possível explosão de concorrência. Um balde de 10.000 tokens permite 10.000 operações quase simultâneas se estiver cheio. O limite médio pode estar correto e, ainda assim, uma dependência ser derrubada por um pico permitido. Por isso `B` deve nascer de um orçamento de capacidade e frequentemente coexistir com limite de concorrência, fila limitada ou <span lang="en-US">load shedding</span>.

Serviços reais expõem essa semântica. A documentação do [filtro local de rate limit do Envoy](<https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/local_rate_limit_filter>) configura um token bucket com capacidade, tokens por recarga e intervalo de recarga. A [documentação da AWS sobre throttling](<https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-throttling.html>) também usa a imagem de um balde de tokens para distinguir capacidade de rajada e taxa de reposição.

<a name="rl-leaky"></a>

## 3. Leaky Bucket: duas definições que precisam ser nomeadas

<span lang="en-US">Leaky Bucket</span> é um termo historicamente ambíguo. Em uma interpretação de <em lang="en-US">traffic shaping</em>, chegadas entram numa fila finita e saem a uma taxa de drenagem aproximadamente constante. Se a fila enche, o excesso é descartado. Aqui o objetivo principal é suavizar a saída.

<div class="code-block"><pre><code>fila ≤ C&#10;saída(t) ≈ d × t&#10;se fila cheia: rejeitar chegada</code></pre></div>

Esse formato troca latência por regularidade. Uma rajada de 100 itens com drenagem de 20/s pode levar cerca de 5 s para ser escoada, ignorando tempo de serviço adicional. Se o prazo da operação for 500 ms, a fila pode transformar tráfego válido em trabalho que já chegará atrasado. Para chamadas síncronas, <span lang="en-US">shaping</span> só é adequado quando esperar faz parte do contrato.

Outra interpretação, presente em literatura de policiamento, acompanha um nível conceitual de fluido que vaza continuamente. Cada chegada aumenta esse nível; se ultrapassar a capacidade, a chegada é marcada ou rejeitada. Ela pode ser implementada sem fila real, apenas com estado numérico e tempo da última atualização. Nesse uso, o comportamento se aproxima de um policer de rajada.

O próprio [RFC 3290](<https://www.rfc-editor.org/rfc/rfc3290>) alerta para diferentes usos dos termos e descreve o leaky bucket associado a uma saída suavizada. Em sistemas de aplicação, portanto, escrever apenas leaky bucket numa configuração é insuficiente: documente se há fila, se a chegada espera e qual é a política quando a capacidade se esgota.

<figure class="mermaid-figure"><div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="Comparação entre Token Bucket, que acumula tokens e admite uma rajada imediata quando há crédito, e Leaky Bucket como shaper, que coloca chegadas em fila e as libera numa taxa de drenagem."><pre class="mermaid-source">flowchart LR&#10;  subgraph TB[Token Bucket]&#10;    I1[Requisições] --&gt; D1{Há tokens?}&#10;    D1 --&gt;|sim| A1[Admitir agora]&#10;    D1 --&gt;|não| R1[Rejeitar ou aguardar]&#10;    F1[Recarga a taxa r] --&gt; B1[Balde até B]&#10;    B1 --&gt; D1&#10;  end&#10;  subgraph LB[Leaky Bucket como shaper]&#10;    I2[Requisições] --&gt; Q2[Fila limitada C]&#10;    Q2 --&gt; O2[Saída a taxa d]&#10;    Q2 --&gt;|cheia| R2[Rejeitar excesso]&#10;  end</pre></div><figcaption>Fluxo conceitual. Token Bucket preserva crédito de períodos ociosos; Leaky Bucket como shaper converte parte da rajada em espera para regularizar a saída.</figcaption><details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">flowchart LR&#10;  subgraph TB[Token Bucket]&#10;    I1[Requisições] --&gt; D1{Há tokens?}&#10;    D1 --&gt;|sim| A1[Admitir agora]&#10;    D1 --&gt;|não| R1[Rejeitar ou aguardar]&#10;    F1[Recarga a taxa r] --&gt; B1[Balde até B]&#10;    B1 --&gt; D1&#10;  end&#10;  subgraph LB[Leaky Bucket como shaper]&#10;    I2[Requisições] --&gt; Q2[Fila limitada C]&#10;    Q2 --&gt; O2[Saída a taxa d]&#10;    Q2 --&gt;|cheia| R2[Rejeitar excesso]&#10;  end</pre></details></figure>

<a name="rl-comparacao"></a>

## 4. Comparar pelo comportamento que o sistema precisa

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Comparação entre Token Bucket e Leaky Bucket"><table><thead><tr><th scope="col">Critério</th><th scope="col">Token Bucket</th><th scope="col">Leaky Bucket como shaper</th><th scope="col">Leaky Bucket como policer</th></tr></thead><tbody><tr><td>Rajada após ociosidade</td><td>Permitida até o crédito acumulado.</td><td>Absorvida em fila e liberada gradualmente.</td><td>Permitida somente dentro da capacidade modelada.</td></tr><tr><td>Taxa de saída</td><td>Pode ser irregular.</td><td>Busca uma drenagem regular.</td><td>Não exige fila nem saída regular.</td></tr><tr><td>Latência</td><td>Baixa ao admitir; rejeição quando falta crédito.</td><td>Pode crescer proporcionalmente à fila.</td><td>Baixa ao decidir; excesso é rejeitado ou marcado.</td></tr><tr><td>Estado mínimo</td><td>Tokens e instante da última atualização.</td><td>Fila, capacidade e ritmo de drenagem.</td><td>Nível virtual e instante da última atualização.</td></tr><tr><td>Bom encaixe</td><td>APIs que aceitam pequenas rajadas dentro de uma cota média.</td><td>Trabalho assíncrono em que suavizar a saída vale a espera.</td><td>Policiamento simples com limite de rajada.</td></tr></tbody></table></div>

Não há vencedor universal. Para uma API síncrona em que usuários podem clicar várias vezes em poucos milissegundos, Token Bucket costuma representar melhor uma cota com tolerância a rajadas. Para um despachante assíncrono que alimenta uma dependência a ritmo previsível, uma fila drenada pode ser a propriedade desejada. Para uma borda que não pode esperar, policie e rejeite cedo.

Uma heurística prática é começar pelas garantias: **o cliente pode esperar?** Se não, evite transformar limitação em fila oculta. **Rajadas curtas são legítimas?** Se sim, dê crédito explícito e dimensionado. **A dependência exige ritmo suave?** Se sim, faça o shaping fora do caminho síncrono ou com prazo de espera claramente limitado.

<a name="rl-distribuido"></a>

## 5. O algoritmo cabe em poucas linhas; o estado distribuído não

Um limitador precisa primeiro definir a chave: usuário, chave de API, IP, organização, rota, região ou combinação delas. A escolha muda justiça e cardinalidade. Limitar por IP pode penalizar centenas de usuários atrás de NAT; limitar por token individual pode permitir que uma organização contorne uma cota agregada criando mais credenciais.

Em uma única instância, estado local é barato. Em `N` réplicas independentes, porém, dar a cada uma o limite completo pode multiplicar a admissão por aproximadamente `N`. Dividir a cota por `N` reduz esse erro, mas fica impreciso com balanceamento desigual e autoscaling.

Um estado central ou particionado fornece uma visão mais consistente, à custa de uma chamada adicional e de uma nova dependência no caminho crítico. Sistemas como Redis são usados para isso porque uma operação atômica pode recalcular crédito e descontá-lo sem corrida entre clientes. A documentação do [Redis sobre rate limiting com Lua](<https://redis.io/learn/develop/java/spring/rate-limiting/fixed-window/reactive-lua/>) ilustra por que decisão e atualização precisam ser atômicas.

Para Token Bucket distribuído, use relógio monotônico dentro de cada autoridade do estado e limite o efeito de deltas anormais. Relógio de parede pode saltar para frente ou para trás por sincronização. Também defina a política de falha: <span lang="en-US">fail-open</span> preserva disponibilidade quando o limitador cai, mas perde proteção; <span lang="en-US">fail-closed</span> preserva a cota, mas transforma a indisponibilidade do limitador em indisponibilidade da API.

Quando uma cota global é aproximada por limites locais, explicite o erro aceitável. Para proteção contra abuso, alguns excessos temporários podem ser toleráveis. Para faturamento ou contrato estrito, a decisão pode exigir uma autoridade central e trilha de auditoria. Rate limiter e contador financeiro não precisam ser o mesmo componente.

<a name="rl-http"></a>

## 6. O contrato HTTP precisa dizer que o cliente deve desacelerar

O [RFC 6585](<https://www.rfc-editor.org/rfc/rfc6585#section-4>) define `429 Too Many Requests` para indicar que o usuário enviou requisições demais em determinado período. A resposta pode incluir `Retry-After`. O RFC não escolhe a identidade contada nem o algoritmo de limitação: isso continua sendo política da aplicação.

<div class="code-block"><pre><code>HTTP/1.1 429 Too Many Requests&#10;Retry-After: 2&#10;Content-Type: application/json&#10;&#10;{&quot;error&quot;:&quot;rate_limit_exceeded&quot;,&quot;retry_after_seconds&quot;:2}</code></pre></div>

Clientes devem tratar a rejeição como sinal de controle, não como convite para repetir imediatamente. Quando muitos clientes recebem a mesma janela de reabertura, um pequeno <span lang="en-US">jitter</span> evita que todos retornem no mesmo instante. O artigo do projeto sobre [retries, backoff e jitter](<article.html?slug=retries-backoff-jitter>) aprofunda essa interação.

Há trabalho de padronização para campos que anunciam políticas e disponibilidade de quota. Em 2 de outubro de 2026, [RateLimit header fields for HTTP](<https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/>) continua sendo um Internet-Draft, não um RFC final; portanto, trate a versão implementada e a interoperabilidade como parte explícita do contrato.

<a name="rl-operacao"></a>

## 7. Falhas comuns são quase sempre erros de orçamento

**Balde grande demais.** Uma taxa de 500/s com capacidade 20.000 permite um pico que pode consumir pools e conexões antes que a média faça efeito. Dimensione o burst com testes de concorrência e custo por operação.

**Uma unidade para custos diferentes.** Uma leitura em cache e uma exportação pesada não deveriam necessariamente custar um token. Use pesos quando a diferença for estável e mensurável, ou separe classes de tráfego.

**Janela fixa confundida com balde.** Um contador de 100 por segundo pode aceitar 100 chamadas no fim de uma janela e mais 100 no início da seguinte. O pico de fronteira é uma propriedade do algoritmo, não um bug aleatório.

**Fila sem deadline.** Shaping com fila infinita apenas desloca a falha para latência e memória. Limite capacidade e tempo de espera; descarte trabalho que não pode mais cumprir seu prazo.

**Limite global apenas nominal.** Réplicas com contadores isolados podem exceder a cota agregada. Meça a soma efetivamente admitida e teste eventos de autoscaling, failover e partições.

**Retries ignorados.** Uma rejeição que dispara repetição agressiva aumenta a taxa oferecida. Monitore tentativas por operação lógica, não apenas requests recebidos.

As métricas mínimas são taxa oferecida, taxa admitida, rejeições por chave e motivo, tokens disponíveis ou ocupação de fila, tempo de espera, custo do caminho do limitador e cardinalidade de chaves. Para um limitador remoto, meça também latência e erro da própria consulta de admissão.

<h2>8. Três cenários numéricos</h2>

**API pública.** Com `r = 20/s` e `B = 40`, um cliente ocioso pode executar 40 chamadas imediatamente. Depois de gastar o crédito, dez novas chamadas exigem cerca de 500 ms para que dez tokens sejam repostos, caso a política escolha esperar. Se o contrato for síncrono e o prazo menor que isso, rejeitar é mais correto.

**Worker assíncrono.** Uma fila recebe 300 jobs de uma vez, mas a dependência deve receber no máximo 30/s. Um leaky bucket como shaper com drenagem de 30/s leva aproximadamente 10 s para escoar o lote, além do tempo de serviço. Isso é aceitável se o SLO do job comporta a espera.

**Dez réplicas.** Dez pods com limite local de 100/s cada não implementam automaticamente um limite global de 100/s; no pior alinhamento podem admitir perto de 1.000/s. Uma cota global exige coordenação ou uma aproximação explicitamente dimensionada.

<h2>9. Experimentos para fixar o conceito</h2>

1. Implemente em memória um Token Bucket com `r = 5/s` e `B = 10`. Envie 10 operações no instante zero, mais 5 após 500 ms e registre quais passam. Explique o resultado pelo crédito acumulado.
2. Modele uma fila de capacidade 20 drenando 4 itens/s. Injete 12 itens de uma vez e calcule a espera do último. Depois reduza o deadline para 1 s e determine quantos itens ainda têm valor.
3. Simule quatro réplicas com contadores locais e balanceamento desigual de 70%, 10%, 10%, 10%. Compare o limite efetivo com uma autoridade central e descreva o erro de cada estratégia.

<h2>10. Resumo mental e perguntas de revisão</h2>

<div class="article-callout"><p><strong>Mapa mental:</strong> taxa sustentada responde quanto trabalho pode continuar entrando; capacidade de burst responde quanto crédito pode ser usado de uma vez; fila responde quanto excesso pode esperar. Token Bucket guarda crédito. Leaky Bucket como shaper guarda trabalho e drena. Em sistemas distribuídos, a pergunta decisiva passa a ser onde vive a autoridade do limite.</p></div>

- Por que dois limitadores de 100 req/s podem produzir picos de concorrência diferentes?
- Como `B` altera o envelope `r × Δt + B`?
- Quando uma fila de shaping piora o sistema em vez de protegê-lo?
- Por que limites locais não equivalem automaticamente a uma cota global?
- Que política de falha faz sentido se o armazenamento do limitador estiver indisponível?

<a name="rl-fontes"></a>

## 11. Fontes e leituras

- [RFC 3290 — An Informal Management Model for Diffserv Routers](<https://www.rfc-editor.org/rfc/rfc3290>), especialmente o apêndice sobre token e leaky buckets.
- [RFC 2697 — A Single Rate Three Color Marker](<https://www.rfc-editor.org/rfc/rfc2697>) e [RFC 2698 — A Two Rate Three Color Marker](<https://www.rfc-editor.org/rfc/rfc2698>), exemplos clássicos de medição baseada em token buckets.
- [RFC 6585, seção 4 — 429 Too Many Requests](<https://www.rfc-editor.org/rfc/rfc6585#section-4>).
- [Envoy — Local rate limit](<https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/local_rate_limit_filter>).
- [AWS EC2 — API throttling](<https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-throttling.html>).
- [Redis — atomicidade em rate limiting com Lua](<https://redis.io/learn/develop/java/spring/rate-limiting/fixed-window/reactive-lua/>).
- [Linux tc-tbf(8) — Token Bucket Filter](<https://man7.org/linux/man-pages/man8/tc-tbf.8.html>).
- [IETF HTTPAPI — RateLimit header fields for HTTP](<https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/>), Internet-Draft consultado em 2 de outubro de 2026.
