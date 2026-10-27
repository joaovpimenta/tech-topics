---
slug: "github-governance-as-code"
language: "pt-BR"
title: "GitHub como sistema de gestão: Projects, Issues e governança como código"
category: "Engenharia de Software · Governança"
date: "18 de setembro de 2026"
publishedAt: "2026-09-18"
read: "24 min de leitura"
image: "assets/github-governance-as-code/github-governance-as-code-cover.jpg"
alt: "Cena editorial em aquarela com uma mesa central distribuindo pastas padronizadas para estações de trabalho, representando governança central aplicada a vários repositórios."
dek: "Como transformar Issues, Projects, templates e Actions em um sistema de gestão multi-repositório que converge para padrões sem depender de manutenção manual."
speechMarkup: {"title":[{"text":"GitHub como sistema de gestão: ","lang":"pt-BR"},{"text":"Projects","lang":"en-US"},{"text":", ","lang":"pt-BR"},{"text":"Issues","lang":"en-US"},{"text":" e governança como código","lang":"pt-BR"}],"dek":[{"text":"Como transformar ","lang":"pt-BR"},{"text":"Issues","lang":"en-US"},{"text":", ","lang":"pt-BR"},{"text":"Projects","lang":"en-US"},{"text":", ","lang":"pt-BR"},{"text":"templates","lang":"en-US"},{"text":" e ","lang":"pt-BR"},{"text":"Actions","lang":"en-US"},{"text":" em um sistema de gestão multi-repositório que converge para padrões sem depender de manutenção manual.","lang":"pt-BR"}]}
excerpt: "Um guia para governança como código no GitHub: taxonomia, Issue Forms, reusable workflows, reconciler, Projects, dependências, retrofit histórico e enforcement progressivo."
tags: ["engenharia-de-software","seguranca","arquitetura"]
---
Imagine uma rede de restaurantes com várias unidades, cada uma usando um cardápio, um sistema de pedidos e regras diferentes. Mesmo que todas pertençam à mesma empresa, fica difícil comparar resultados e manter uma operação coerente. No GitHub, <span lang="en-US">Projects</span>, <span lang="en-US">Issues</span>, <span lang="en-US">templates</span>, <span lang="en-US">labels</span> e <span lang="en-US">Actions</span> cumprem esse papel: são os mecanismos que organizam o trabalho. Tratar essa estrutura como código é como manter um manual operacional versionado, capaz de orientar todas as unidades e corrigir automaticamente quando alguma começa a se afastar do padrão.

<div class='fgs-guide'>

Uma saída é tratar gerenciamento de trabalho como um problema de arquitetura: definir um <span lang="en-US">desired state</span>, separar fontes de verdade por dimensão, reagir a eventos quando possível e usar um <span lang="en-US">reconciler</span> periódico para corrigir <span lang="en-US">drift</span>. O resultado é uma forma de **governança como código**: padrões versionados, automação idempotente e intervenção humana concentrada apenas onde há ambiguidade ou decisão de negócio.

<nav class='fgs-toc' aria-label='Neste artigo'><strong>Neste guia</strong><ul><li><a href='#gh-problema'>Do quadro ao sistema de gestão</a></li><li><a href='#gh-modelo'>Control plane e desired state</a></li><li><a href='#gh-taxonomia'>Taxonomia e fontes de verdade</a></li><li><a href='#gh-captura'>Issue Forms e captura estruturada</a></li><li><a href='#gh-reuso'>.github e reusable workflows</a></li><li><a href='#gh-reconciler'>Eventos, reconciler e idempotência</a></li><li><a href='#gh-project'>Project como visão materializada</a></li><li><a href='#gh-relacoes'>Dependências e hierarquia</a></li><li><a href='#gh-retrofit'>Retrofit do histórico</a></li><li><a href='#gh-enforcement'>Enforcement progressivo</a></li><li><a href='#gh-operacao'>Operação, segurança e anti-padrões</a></li><li><a href='#gh-revisao'>Resumo e exercícios</a></li><li><a href='#gh-fontes'>Fontes</a></li></ul></nav>

<h2 id='gh-problema'>1. O problema: um Project não é, sozinho, um sistema de gestão</h2>

GitHub <span lang="en-US">Projects</span> é flexível: permite múltiplas <span lang="en-US">views</span>, layouts de tabela, board e roadmap, filtros e campos customizados. A [documentação de <span lang="en-US">views</span>](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project) descreve justamente essa ideia de observar o mesmo conjunto de itens por ângulos diferentes. Mas flexibilidade cria uma pergunta de governança: **quem garante que os itens chegam com metadados comparáveis?**

Se cada repositório inventa <span lang="en-US">labels</span>, <span lang="en-US">templates</span> e estados por conta própria, um Project central apenas concentra inconsistências. “Bug” pode ser `bug`, `type:bug`, `defect` ou não existir. “Backend” pode aparecer como <span lang="en-US">label</span>, texto livre ou nome de componente. Prioridade pode estar no título de uma issue e, em outra, em um campo do Project.

<div class='signal-grid'>

<section class='signal-card'>

<h3>Captura</h3>

Como o trabalho entra? <span lang="en-US">Issue Form</span>, CLI, API, automação ou issue antiga.

</section>

<section class='signal-card'>

<h3>Classificação</h3>

Como diferentes repositórios usam o mesmo vocabulário sem copiar regras manualmente.

</section>

<section class='signal-card'>

<h3>Planejamento</h3>

Como Status e Priority permanecem úteis sem duplicar a mesma verdade em <span lang="en-US">labels</span>.

</section>

<section class='signal-card'>

<h3>Convergência</h3>

Como o sistema volta ao padrão depois de edição manual, falha de automação ou legado.

</section>

</div>

A arquitetura adequada precisa resolver os quatro problemas. O quadro é apenas uma das interfaces.

<h2 id='gh-modelo'>2. O modelo mental: <span lang="en-US">control plane</span>, <span lang="en-US">data plane</span> e <span lang="en-US">desired state</span></h2>

Um desenho útil é importar uma distinção comum de sistemas distribuídos. O <span lang="en-US">control plane</span> contém a política e decide o estado desejado. Os repositórios e o Project são o plano onde o trabalho real acontece. Um <span lang="en-US">reconciler</span> compara os dois e corrige diferenças.

<!-- tech-topics:mermaid {"label":"Arquitetura de governança como código: controlador, repositórios e Project central."} -->

```mermaid
flowchart LR
  C[Controlador] --> A[Repositório A]
  C --> B[Repositório B]
  C --> N[Repositório N]
  A --> P[Project central]
  B --> P
  N --> P
  R[Reconciler periódico] --> C
```

<figcaption>Arquitetura conceitual: lógica centralizada, gatilhos pequenos nos repositórios e um Project que agrega o estado de planejamento.</figcaption>

<details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">flowchart LR
  C[Controlador] --&gt; A[Repositório A]
  C --&gt; B[Repositório B]
  C --&gt; N[Repositório N]
  A --&gt; P[Project central]
  B --&gt; P
  N --&gt; P
  R[Reconciler periódico] --&gt; C</pre></details>

O repositório controlador pode versionar uma política como:

<div class='code-block'><pre><code>{
  "type": ["Epic", "Feature", "Bug", "Task", "Tech Debt", "Research"],
  "area": ["Frontend", "Backend", "Design System", "Mobile", "Infra", "Docs", "Security"],
  "priority": ["P0", "P1", "P2", "P3"],
  "status": ["Inbox", "Ready", "In Progress", "Review", "Blocked", "Done"]
}</code></pre></div>

A vantagem não é o JSON em si. É a propriedade de **declarar intenção antes de declarar procedimento**. Scripts deixam de dizer “crie esta <span lang="en-US">label</span> neste repositório específico” e passam a dizer “todo repositório governado deve convergir para esta taxonomia”. Isso elimina cadastro manual e transforma novos repositórios em um caso normal de descoberta.

<div class='article-callout'><strong>Regra arquitetural:</strong> a política deve responder “qual estado queremos?”. A automação responde “como convergir o estado atual para ele?”. Misturar essas duas perguntas produz scripts difíceis de auditar e de migrar.</div>

<h2 id='gh-taxonomia'>3. Separe classificação, planejamento, identidade e relações</h2>

Um dos maiores ganhos vem de não usar <span lang="en-US">labels</span> para tudo. <span lang="en-US">Labels</span> são excelentes para classificação local e busca dentro do repositório. Campos de Project são melhores para planejamento transversal. Metadados derivados não precisam ser perguntados ao usuário. E relações entre <span lang="en-US">issues</span> devem usar recursos nativos quando existem.

<!-- tech-topics:mermaid {"label":"Separação entre classificação, planejamento, identidade derivada e relações."} -->

```mermaid
flowchart LR
  I[Issue] --> C[Classificação]
  I --> P[Planejamento]
  I --> D[Identidade derivada]
  I --> R[Relações]
  C --> Q{Uma fonte de verdade}
  P --> Q
  D --> Q
  R --> Q
```

<figcaption>Uma taxonomia sustentável minimiza duplicação: cada dimensão tem uma fonte de verdade clara.</figcaption>

<details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">flowchart LR
  I[Issue] --&gt; C[Classificação]
  I --&gt; P[Planejamento]
  I --&gt; D[Identidade derivada]
  I --&gt; R[Relações]
  C --&gt; Q{Uma fonte de verdade}
  P --&gt; Q
  D --&gt; Q
  R --&gt; Q</pre></details>

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Tabela rolável horizontalmente"><table><thead><tr><th>Dimensão</th><th>Fonte de verdade sugerida</th><th>Exemplo</th></tr></thead><tbody>
<tr><td>Type</td><td><span lang="en-US">Issue Form</span> → <span lang="en-US">label</span> gerenciada → espelho no Project</td><td><code>type:bug</code></td></tr>
<tr><td>Area</td><td><span lang="en-US">Issue Form</span> <span lang="en-US">multi-select</span> → uma ou mais <span lang="en-US">labels</span> → espelho no Project</td><td><code>area:backend</code>, <code>area:security</code></td></tr>
<tr><td>Priority</td><td>Campo do Project</td><td>P0, P1, P2, P3</td></tr>
<tr><td>Status</td><td>Campo do Project</td><td>Inbox, Ready, In Progress, Review, Blocked, Done</td></tr>
<tr><td>Organization</td><td>Derivada do <span lang="en-US">owner</span> do repositório</td><td><code>acme</code></td></tr>
<tr><td>Product</td><td>Derivada do repositório</td><td><code>acme/payments</code></td></tr>
<tr><td><span lang="en-US">Repository</span></td><td>Campo nativo</td><td><code>acme/payments</code></td></tr>
<tr><td>Dependência</td><td>Relação nativa de issue</td><td><span lang='en-US'>blocked by</span> / <span lang='en-US'>blocking</span></td></tr>
</tbody></table></div>

GitHub <span lang="en-US">Projects</span> suporta campos customizados; a referência GraphQL atual inclui <span lang="en-US">single select</span> e <span lang="en-US">multi-select</span>, inclusive criação e atualização de opções. Isso permite modelar Type como seleção única e Area como seleção múltipla sem transformar o Project em uma cópia literal das <span lang="en-US">labels</span>. Veja a [referência GraphQL de <span lang="en-US">Projects</span>](https://docs.github.com/en/graphql/reference/projects).

Priority é um bom exemplo do que **não** deve ser inferido por automação. Um repositório pode indicar produto, organização e área técnica; não pode deduzir valor de negócio com segurança. Automatizar Priority cria uma falsa aparência de objetividade.

<h2 id='gh-captura'>4. Capture estrutura na origem com <span lang="en-US">Issue Forms</span></h2>

O melhor momento para obter Type e Area é a criação da issue. GitHub <span lang="en-US">Issue Forms</span> usa YAML em `.github/ISSUE_TEMPLATE` e oferece campos como dropdown, textarea, checkboxes e upload. As respostas são convertidas em Markdown no corpo da issue. A [documentação de <span lang="en-US">Issue Forms</span>](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms) também permite <span lang="en-US">labels</span> padrão, assignees, tipo nativo e <span lang="en-US">Projects</span>.

<div class='code-block'><pre><code>name: Work item
description: Create a standardized work item
body:
  - type: dropdown
    id: type
    attributes:
      label: Type
      options:
        - Epic
        - Feature
        - Bug
        - Task
        - Tech Debt
        - Research
&#10;  - type: dropdown
    id: areas
    attributes:
      label: Areas
      multiple: true
      options:
        - Frontend
        - Backend
        - Design System
        - Mobile
        - Infra
        - Docs
        - Security</code></pre></div>

Há duas sutilezas importantes. Primeiro: <span lang="en-US">labels</span> configuradas no formulário só são aplicadas se já existirem no repositório; a própria documentação registra essa condição. Segundo: o schema de forms continua documentado como <span lang="en-US">public preview</span>, e certas validações `required` são documentadas como restritas a repositórios públicos. Portanto, o formulário é uma excelente camada de orientação, mas não deve ser a única camada de enforcement para ambientes privados.

O <span lang="en-US">reconciler</span> resolve isso: ele lê o corpo gerado pelo formulário, normaliza <span lang="en-US">labels</span> e marca `policy:needs-triage` quando o metadado está ausente ou ambíguo. Assim, uma criação por CLI ou API não quebra o modelo.

<h2 id='gh-reuso'>5. Reuse o padrão sem copiar a lógica</h2>

<h3>Defaults por <span lang="en-US">owner</span> com o repositório .github</h3>

GitHub possui um mecanismo nativo para arquivos comunitários padrão. Um repositório público chamado `.github` no <span lang="en-US">owner</span> pode fornecer <span lang="en-US">templates</span> para repositórios desse mesmo <span lang="en-US">owner</span> que não possuam sua própria versão. A [documentação de default community health files](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file) esclarece também a precedência: <span lang="en-US">templates</span> locais sobrescrevem defaults do <span lang="en-US">owner</span>.

Isso é útil como fallback, mas não é enforcement total. Se um repositório cria seu próprio <span lang="en-US">template</span>, ele deixa de usar o default. Em uma governança mais rígida, o controlador pode distribuir arquivos gerenciados diretamente para cada repositório e preservar o `.github` do <span lang="en-US">owner</span> como bootstrap para repos novos.

<h3><span lang="en-US">Reusable workflows</span>: lógica central, gatilho local</h3>

Eventos de Issue acontecem no repositório onde a Issue existe. Portanto, um repositório central não recebe automaticamente o evento `issues` dos demais. A solução é instalar um caller mínimo em cada repositório:

<div class='code-block'><pre><code>name: Governance
&#10;on:
  issues:
    types: [opened, edited, reopened, labeled, unlabeled]
&#10;jobs:
  reconcile:
    uses: owner/controller/.github/workflows/governance-event.yml@main</code></pre></div>

A lógica fica em um <span lang="en-US">reusable workflow</span>. A [documentação de reuso de workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations) descreve esse modelo e suas regras de acesso. Um detalhe de segurança importante: permissões não podem ser elevadas ao longo da cadeia; um workflow chamado não consegue obter mais permissões do que foram concedidas pelo caller.

Para ambientes mais críticos, prefira referenciar uma versão ou SHA estável em vez de `@main`. Isso troca atualização instantânea por reprodutibilidade e reduz o risco de uma mudança central afetar todos os repositórios de uma vez.

<h2 id='gh-reconciler'>6. Eventos para velocidade; <span lang="en-US">reconciler</span> para convergência</h2>

Uma governança robusta usa os dois mecanismos.

<div class='signal-grid'>

<section class='signal-card'>

<h3><span lang="en-US">Event-driven</span></h3>

Issue criada ou editada dispara correção quase imediata do metadado.

</section>

<section class='signal-card'>

<h3><span lang="en-US">Reconciler</span></h3>

Executa periodicamente, descobre repos e corrige <span lang="en-US">drift</span>, falhas anteriores e objetos antigos.

</section>

<section class='signal-card'>

<h3><span lang="en-US">Dry run</span></h3>

Compara estado sem escrever. É a fronteira segura antes de expandir escopo.

</section>

</div>

O <span lang="en-US">reconciler</span> deve ser **idempotente**: executar duas vezes produz o mesmo estado final. Isso implica comparar antes de escrever, não depender de erro de “já existe” como mecanismo de controle e limitar a propriedade da automação a namespaces claramente gerenciados.

Por exemplo, a automação pode ser dona de `type:*`, `area:*` e `policy:*`, mas não deve apagar <span lang="en-US">labels</span> específicas como `customer-x` ou `release-2026-09`. A política precisa declarar quais partes do repositório pertencem ao controlador.

<h3>Qual a frequência do <span lang="en-US">scheduler</span>?</h3>

Se o <span lang="en-US">reconciler</span> roda a cada `T` horas e um <span lang="en-US">drift</span> pode acontecer uniformemente entre duas execuções, a latência de detecção `L` fica, em um modelo ideal, entre zero e `T`:

<div class='code-block'><pre><code>0 ≤ L ≤ T
E[L] = T / 2</code></pre></div>

Com `T = 2h`, a detecção média seria aproximadamente 1 hora, assumindo execução pontual e <span lang="en-US">drift</span> uniforme. Isso parece lento se o <span lang="en-US">scheduler</span> for o mecanismo principal; é perfeitamente aceitável quando eventos já fazem o caminho rápido e o <span lang="en-US">scheduler</span> existe como rede de segurança.

<div class='article-callout'><strong>Princípio:</strong> o <span lang="en-US">scheduler</span> não precisa ser frequente o bastante para dar sensação de tempo real. Ele precisa ser frequente o bastante para limitar a duração do <span lang="en-US">drift</span> que escapou do caminho orientado a eventos.</div>

<h2 id='gh-project'>7. Trate o Project como uma visão materializada do trabalho</h2>

O Project não precisa duplicar tudo que existe na Issue. Ele pode funcionar como uma **visão materializada de planejamento**: agrega itens de muitos repositórios e adiciona campos que só fazem sentido no nível transversal.

A API oficial permite administrar <span lang="en-US">Projects</span> via GraphQL, inclusive descobrir projeto e campos, adicionar itens e atualizar valores. A [documentação de automação de <span lang="en-US">Projects</span> pela API](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects) registra os escopos de autenticação necessários para leitura e escrita.

Uma reconciliação típica pode aplicar:

<div class='code-block'><pre><code>Organization = repository.owner
Product      = repository.nameWithOwner
Type         = label type:*
Area         = labels area:*
Priority     = decisão humana
Status       = decisão humana + transições objetivas</code></pre></div>

Transições automáticas de Status devem ser conservadoras. Fechar uma Issue ou fazer merge de um PR é uma evidência objetiva de conclusão; o próprio GitHub <span lang="en-US">Projects</span> possui automações embutidas que podem mover itens fechados ou merged para Done, e algumas vêm habilitadas por padrão. Veja [Using the built-in automations](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-built-in-automations).

Já mover automaticamente uma issue para “In Progress” porque recebeu um comentário é uma inferência frágil. Um modelo saudável automatiza fatos e deixa intenção de planejamento para humanos.

<h3><span lang="en-US">Views</span> como consultas salvas</h3>

Uma única coleção pode produzir várias interfaces:

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Tabela rolável horizontalmente"><table><thead><tr><th>View</th><th>Estrutura</th><th>Pergunta respondida</th></tr></thead><tbody>
<tr><td>Command Center</td><td>Board por Status, agrupado por Organization</td><td>Onde está o trabalho ativo?</td></tr>
<tr><td>By <span lang="en-US">Repository</span></td><td>Table agrupada por <span lang="en-US">Repository</span></td><td>Qual repo concentra demanda?</td></tr>
<tr><td>Now</td><td>Ready + In Progress + Review + Blocked</td><td>O que merece atenção agora?</td></tr>
<tr><td>Triage</td><td><code>policy:needs-triage</code></td><td>O que a automação não conseguiu decidir?</td></tr>
<tr><td><span lang="en-US">Pull Requests</span></td><td>PRs abertos</td><td>Onde há trabalho aguardando integração?</td></tr>
<tr><td>Recently Done</td><td>Done, ordenado por atualização</td><td>O que terminou recentemente?</td></tr>
</tbody></table></div>

<h2 id='gh-relacoes'>8. Dependência não é hierarquia</h2>

GitHub hoje oferece dois relacionamentos úteis que resolvem problemas diferentes.

**Issue dependencies** representam ordem lógica: uma Issue está <span lang="en-US">blocked by</span> outra ou está <span lang="en-US">blocking</span> trabalho posterior. A [documentação de dependências](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies) mostra suporte pela interface e pelo GitHub CLI, inclusive na criação da Issue.

**Sub-<span lang="en-US">issues</span>** representam decomposição. Uma Epic pode conter features ou tasks mesmo quando elas podem avançar em paralelo. A [documentação de sub-<span lang="en-US">issues</span>](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues) permite hierarquias aninhadas e relacionamentos entre repositórios.

<div class='article-callout'><strong>Teste mental:</strong> se B não pode começar antes de A terminar, a relação é dependência. Se B é uma parte de A, a relação é hierarquia. Uma mesma issue pode participar dos dois modelos.</div>

Evite inventar <span lang="en-US">labels</span> como `depends-on-123`. Elas não têm integridade referencial e exigem manter manualmente os dois lados da relação.

<h2 id='gh-retrofit'>9. O padrão futuro deve conseguir reorganizar o passado</h2>

Governança só funciona de verdade quando o histórico deixa de ser uma exceção permanente. Um <span lang="en-US">retrofit</span> deve varrer <span lang="en-US">Issues</span> e PRs abertos e fechados, interpretar o que já existe e convergir para a taxonomia atual.

<!-- tech-topics:mermaid {"label":"Retrofit histórico: leitura, classificação segura, triagem, normalização e Project."} -->

```mermaid
flowchart LR
  H[Histórico] --> L[Leitura]
  L --> K{Classificação segura?}
  K -->|sim| N[Normalização]
  K -->|ambíguo| T[Triagem]
  T --> N
  N --> P[Project]
```

<figcaption><span lang="en-US">Retrofit</span> seguro: o objetivo é convergir o histórico sem inventar intenção que não está documentada.</figcaption>

<details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">flowchart LR
  H[Histórico] --&gt; L[Leitura]
  L --&gt; K{Classificação segura?}
  K --&gt;|sim| N[Normalização]
  K --&gt;|ambíguo| T[Triagem]
  T --&gt; N
  N --&gt; P[Project]</pre></details>

A migração pode usar evidências em ordem de confiança:

1.  <span lang="en-US">labels</span> já equivalentes ao padrão atual;
2.  campos estruturados de um <span lang="en-US">Issue Form</span> antigo;
3.  tipo nativo ou metadado explícito;
4.  referências canônicas de dependência no body;
5.  heurísticas de texto apenas quando há confiança muito alta e a regra é auditável.

Quando não houver evidência suficiente, a resposta correta é `policy:needs-triage`. Não classificar é melhor que classificar errado com aparência de certeza.

<h3><span lang="en-US">Closed</span> também importa</h3>

Itens fechados são parte do histórico arquitetural: explicam por que uma decisão existe, alimentam busca, métricas e relações entre trabalho antigo e novo. Um <span lang="en-US">retrofit</span> que só trata open mantém dois dialetos de metadados para sempre.

A escrita do body, porém, merece uma política separada. Reformatar metadados é reversível e estruturado; reescrever prosa histórica pode apagar contexto. Uma estratégia prudente normaliza <span lang="en-US">labels</span>, relações e campos primeiro e só depois define uma migração textual explícita.

<h2 id='gh-enforcement'>10. Enforcement progressivo: guiar, corrigir, observar, bloquear</h2>

O erro comum é começar pelo bloqueio. Isso transforma governança em obstáculo antes de provar que as regras representam o trabalho real.

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Tabela rolável horizontalmente"><table><thead><tr><th>Nível</th><th>Mecanismo</th><th>Exemplo</th></tr></thead><tbody>
<tr><td>Guide</td><td><span lang="en-US">Issue Form</span>, PR <span lang="en-US">template</span></td><td>Pedir Type e Areas na criação</td></tr>
<tr><td>Auto-fix</td><td>Workflow/<span lang="en-US">reconciler</span></td><td>Criar <span lang="en-US">label</span> ausente, preencher Organization</td></tr>
<tr><td>Report</td><td>Triage e métricas de <span lang="en-US">drift</span></td><td>Marcar metadata ambígua</td></tr>
<tr><td>Enforce</td><td>Ruleset / required check</td><td>Impedir merge quando política crítica falha</td></tr>
</tbody></table></div>

GitHub rulesets podem exigir <span lang="en-US">status checks</span> antes do merge. A [documentação de regras disponíveis](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) explica que todos os checks exigidos precisam passar antes da integração.

Um check de governança pode validar, por exemplo, que o PR referencia uma Issue, que essa Issue pertence ao Project, que não há múltiplos Types e que metadata obrigatória não está em estado ambíguo. Mas isso só deve se tornar obrigatório depois que o check demonstrar baixa taxa de falso positivo.

Priority não é um bom requisito de criação: trabalho pode entrar no Inbox sem prioridade e ser classificado depois. O ponto de enforcement deve refletir risco. Para metadados administrativos, triagem é suficiente; para merge em branch protegida, um check pode ser apropriado.

<h2 id='gh-operacao'>11. Operação: logs agregados, permissões mínimas e escopo seguro</h2>

Automação transversal tem alcance grande. Isso torna segurança operacional parte da arquitetura.

- **Descoberta dinâmica:** liste repositórios acessíveis e filtre por <span lang="en-US">owner</span> e permissão, em vez de manter uma lista manual.
- **Escopo de escrita menor que escopo de leitura:** ler um repositório como colaborador não implica que a governança deva instalar arquivos nele.
- **Logs sanitizados:** em um controlador público, evite nomes de repositórios privados, títulos e bodies de <span lang="en-US">Issues</span> e respostas brutas da API.
- **Secrets centralizados:** use o token cross-repo apenas no controlador. Workflows locais podem operar com o `GITHUB_TOKEN` do próprio repositório quando a ação é local.
- **<span lang="en-US">Dry run</span> por padrão em mudanças de política:** primeiro conte o que mudaria; depois aplique.

Em escala maior, um GitHub App é normalmente mais apropriado que um PAT clássico porque permissões e instalações podem ser delimitadas por organização e repositório. Para um protótipo pessoal, um token pode ser suficiente, desde que o escopo e a exposição de logs sejam controlados.

<h3>O que medir no próprio sistema de governança</h3>

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Tabela rolável horizontalmente"><table><thead><tr><th>Contador</th><th>Por que importa</th></tr></thead><tbody>
<tr><td>repos discovered / governed</td><td>Mostra expansão ou redução inesperada de escopo.</td></tr>
<tr><td><span lang="en-US">labels</span> created / updated</td><td>Quantifica <span lang="en-US">drift</span> de taxonomia.</td></tr>
<tr><td>callers/<span lang="en-US">templates</span> installed</td><td>Revela cobertura do enforcement.</td></tr>
<tr><td><span lang="en-US">issues</span> normalized</td><td>Mostra volume real de correção.</td></tr>
<tr><td>needs-triage</td><td>Mede a parcela que exige decisão humana.</td></tr>
<tr><td>errors</td><td>Detecta perda de permissão, SSO, rate limit ou mudança de API.</td></tr>
</tbody></table></div>

<h2>12. Anti-padrões</h2>

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Tabela rolável horizontalmente"><table><thead><tr><th>Anti-padrão</th><th>Consequência</th></tr></thead><tbody>
<tr><td>Uma Action completa copiada em cada repo</td><td><span lang="en-US">Drift</span> de versões e correções repetidas.</td></tr>
<tr><td>Lista manual de repositórios</td><td>Novo repo nasce fora da governança.</td></tr>
<tr><td><span lang="en-US">Labels</span> para Status, Priority, Organization e Product ao mesmo tempo</td><td>Duplicação e conflitos entre fontes de verdade.</td></tr>
<tr><td><span lang="en-US">Scheduler</span> como única automação</td><td>Latência desnecessária e mais chamadas à API.</td></tr>
<tr><td>Evento sem <span lang="en-US">reconciler</span></td><td>Falhas transitórias e edições manuais podem deixar <span lang="en-US">drift</span> permanente.</td></tr>
<tr><td>Automação que “adivinha” prioridade</td><td>Decisão de negócio disfarçada de regra técnica.</td></tr>
<tr><td>Apagar <span lang="en-US">labels</span> que não pertencem à governança</td><td>O controlador invade vocabulário local legítimo.</td></tr>
<tr><td><span lang="en-US">Retrofit</span> somente de <span lang="en-US">issues</span> abertas</td><td>O histórico continua em outro dialeto.</td></tr>
<tr><td>Hard enforcement desde o primeiro dia</td><td>Falso positivo vira bloqueio de entrega.</td></tr>
</tbody></table></div>

<h2>13. Quando esse modelo é exagero</h2>

Um único repositório pequeno, com uma equipe estável e poucas <span lang="en-US">Issues</span>, talvez não precise de <span lang="en-US">reconciler</span>, Project central ou taxonomia multi-repo. Um <span lang="en-US">Issue Form</span> simples e algumas <span lang="en-US">labels</span> podem ser suficientes.

O modelo começa a pagar seu custo quando existem vários repositórios, múltiplos <span lang="en-US">owners</span>, necessidade de visão agregada, automações compartilhadas ou histórico relevante. O objetivo não é “automatizar porque é possível”; é reduzir o custo marginal de manter consistência.

Também há um ponto de transição organizacional. Se a governança passar a decidir permissões, compliance e controles de produção em muitas organizações, vale separar o controlador pessoal em um repositório administrado institucionalmente e substituir credenciais pessoais por GitHub Apps e políticas de organização.

<h2 id='gh-revisao'>14. Resumo mental</h2>

<div class='article-callout'><strong>Modelo em uma frase:</strong> capture metadados estruturados na origem, derive o que for determinístico, mantenha planejamento no Project, reaja a eventos, reconcilie <span lang="en-US">drift</span> e só bloqueie quando a regra já estiver madura.</div>

<div class='code-block'><pre><code>POLÍTICA
  ↓
Issue Form / template
  ↓
evento local ───────────────┐
  ↓                         │
normalização                │
  ↓                         │
Issue + labels              │
  ↓                         │
Project central             │
                            │
reconciler periódico ───────┘
  ↓
corrige drift + retrofit + triage</code></pre></div>

<h2>Perguntas de revisão</h2>

1.  Por que um Project central não resolve sozinho divergência de taxonomia entre repositórios?
2.  Qual a diferença entre fonte de verdade e espelho de um metadado?
3.  Por que Organization e Product são bons candidatos a derivação automática?
4.  Quando uma relação deve ser <span lang="en-US">blocked by</span> e quando deve ser uma <span lang="en-US">sub-issue</span>?
5.  Qual problema o <span lang="en-US">reconciler</span> resolve que um workflow orientado a evento não resolve?
6.  Por que Priority deveria permanecer manual em muitos sistemas?
7.  Qual o risco de fazer <span lang="en-US">retrofit</span> reescrevendo o body das <span lang="en-US">issues</span> antigas?
8.  Em que momento um check de governança deve virar requisito de merge?

<h2>Experimentos</h2>

<h3>1. Modele sua taxonomia</h3>

Escolha cinco dimensões usadas hoje em seus repositórios. Para cada uma, escreva uma única fonte de verdade e marque se ela é fornecida por humano, derivada ou observada de um evento. Se uma dimensão tiver duas fontes de verdade, explique como conflitos são resolvidos.

<h3>2. Calcule a janela de <span lang="en-US">drift</span></h3>

Considere um <span lang="en-US">reconciler</span> a cada 3 horas. Sob a hipótese simplificada de <span lang="en-US">drift</span> uniforme, calcule a latência média de detecção. Depois adicione um caminho orientado a evento com 95% de sucesso e discuta por que o <span lang="en-US">scheduler</span> ainda é necessário.

<h3>3. Faça um <span lang="en-US">retrofit</span> em <span lang="en-US">dry run</span></h3>

Em um repositório de teste, liste <span lang="en-US">Issues</span> abertas e fechadas, classifique quais poderiam ser migradas com regra determinística e quais exigiriam `needs-triage`. Compare o resultado com uma abordagem que tenta inferir tudo a partir do título.

<h2 id='gh-fontes'>15. Fontes e leituras</h2>

Fontes consultadas em 18 de setembro de 2026. Diagramas e exemplos de taxonomia são materiais didáticos próprios; adapte nomes, campos e enforcement ao risco do seu ambiente.

<ol class='fgs-references'>
<li>GitHub Docs — <a href='https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects'>Learning about <span lang="en-US">Projects</span></a>. Visão geral do modelo de planejamento e acompanhamento.</li>
<li>GitHub Docs — <a href='https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project'>Customizing <span lang="en-US">views</span> in your project</a>. Layouts, filtros e múltiplas <span lang="en-US">views</span> sobre os mesmos itens.</li>
<li>GitHub Docs — <a href='https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields'>Understanding fields</a>. Campos customizados e metadados de <span lang="en-US">Projects</span>.</li>
<li>GitHub GraphQL Reference — <a href='https://docs.github.com/en/graphql/reference/projects'><span lang="en-US">Projects</span></a>. Tipos ProjectV2, campos single-select e <span lang="en-US">multi-select</span> e inputs de mutação.</li>
<li>GitHub Docs — <a href='https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects'>Using the API to manage <span lang="en-US">Projects</span></a>. Autenticação e automação por GraphQL.</li>
<li>GitHub Docs — <a href='https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-built-in-automations'>Using the built-in automations</a>. Transições automáticas e auto-add/archive.</li>
<li>GitHub Docs — <a href='https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms'>Syntax for <span lang="en-US">issue forms</span></a> e <a href='https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema'>form schema</a>. Estrutura YAML, <span lang="en-US">labels</span> e validações.</li>
<li>GitHub Docs — <a href='https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file'>Creating a default community health file</a>. Repositório <code>.github</code>, escopo por <span lang="en-US">owner</span> e precedência dos arquivos locais.</li>
<li>GitHub Docs — <a href='https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations'>Reusing workflow configurations</a>. <span lang="en-US">Reusable workflows</span>, regras de acesso e permissões.</li>
<li>GitHub Docs — <a href='https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies'>Creating issue dependencies</a>. Relações <span lang="en-US">blocking</span> e <span lang="en-US">blocked by</span>.</li>
<li>GitHub Docs — <a href='https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues'>Adding sub-<span lang="en-US">issues</span></a>. Hierarquia e decomposição de trabalho.</li>
<li>GitHub Docs — <a href='https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets'>Available rules for rulesets</a>. Required <span lang="en-US">status checks</span> e enforcement antes do merge.</li>
</ol>

<a href="index.html#recent-posts" class="article-back">← Todos os artigos</a>

</div>
