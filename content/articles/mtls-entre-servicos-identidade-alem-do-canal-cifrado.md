---
'slug': 'mtls-entre-servicos-identidade-alem-do-canal-cifrado'
'language': 'pt-BR'
'title': 'mTLS entre serviços: identidade além do canal cifrado'
'category': 'Segurança · Redes · Sistemas distribuídos'
'date': '2 de outubro de 2026'
'publishedAt': '2026-10-02'
'read': '17 min de leitura'
'image': 'assets/mtls-entre-servicos-identidade-alem-do-canal-cifrado/mtls-entre-servicos-identidade-alem-do-canal-cifrado-cover.jpg'
'alt': 'Aquarela de uma técnica e um responsável em lados opostos de uma única porta blindada fechada, conferindo os crachás com foto um do outro através do visor de vidro reforçado; duas elipses pretas tracejadas destacam as credenciais.'
'dek': 'Criptografia protege bytes em trânsito; mTLS só vira identidade de serviço quando certificados, nomes, confiança, rotação e autorização formam um contrato coerente.'
'excerpt': 'Um guia do handshake ao workload identity: X.509, SAN, trust anchors, SPIFFE, rotação, proxies, autorização e falhas comuns de mTLS entre serviços.'
'speechMarkup':
  'title':
    - 'text': 'mTLS'
      'lang': 'en-US'
    - 'text': ' entre serviços: identidade além do canal cifrado'
      'lang': 'pt-BR'
'tags':
  - 'redes'
  - 'seguranca'
  - 'sistemas-distribuidos'
---

No corredor entre dois laboratórios, uma técnica para diante de uma porta blindada fechada, mostra seu crachá pelo visor de vidro reforçado e pergunta se a barreira física já basta para confiar em quem está do outro lado; o responsável apresenta o próprio crachá, e cada um confere a foto e a identificação do outro antes de liberar a passagem. Ela percebe que a porta protege a conversa, mas a confiança exige uma checagem nos dois sentidos: ela precisa saber quem a recebe, e ele precisa saber quem está entrando. Entre serviços, <span lang="en-US">mutual TLS</span> faz essa segunda parte: além de cifrar o canal, cada ponta apresenta uma identidade criptográfica que a outra precisa validar antes de confiar na conexão.

**mTLS**, abreviação de <span lang="en-US">mutual TLS</span>, é TLS com autenticação por certificado nos dois sentidos. Em TLS convencional para a Web, o cliente normalmente autentica o servidor e o servidor não exige um certificado do cliente. Em mTLS, o servidor também solicita e valida um certificado apresentado pelo cliente. O resultado é um canal cifrado em que ambos os peers provaram posse de uma chave privada associada a um certificado aceito pela outra ponta.

<div class="article-callout"><p><strong>A distinção central:</strong> criptografia responde quem consegue ler os bytes; autenticação responde qual identidade criptográfica está do outro lado; autorização responde o que essa identidade pode fazer. mTLS resolve a segunda pergunta apenas quando o certificado é transformado em uma identidade útil e verificada contra o destino correto. Ele não substitui política de acesso.</p></div>

<h2>1. TLS cifrado não implica identidade mútua</h2>

O protocolo TLS protege confidencialidade e integridade do tráfego e autentica as partes conforme o modo negociado. No fluxo mais comum de HTTPS, o servidor envia seu certificado, prova que possui a chave privada correspondente e o cliente valida a cadeia e a identidade esperada do servidor. O cliente, por sua vez, pode permanecer anônimo do ponto de vista do TLS e autenticar-se depois com senha, cookie, token ou outro mecanismo de aplicação.

No TLS 1.3, descrito pela [RFC 8446](<https://www.rfc-editor.org/rfc/rfc8446>), o servidor que deseja autenticar o cliente por certificado envia uma mensagem `CertificateRequest`. O cliente responde com seu certificado e com `CertificateVerify`, uma assinatura calculada com sua chave privada sobre o contexto do handshake. Essa assinatura é a prova de posse: copiar apenas o certificado público não basta para se passar pelo cliente.

A mudança parece pequena no diagrama, mas altera o modelo operacional. O servidor deixa de confiar apenas em uma credencial de aplicação e passa a depender também de uma PKI: quem emite certificados, que identidades podem ser emitidas, que raízes são confiáveis, quanto tempo os certificados duram, como são renovados e como uma credencial comprometida deixa de ser aceita.

<figure class="mermaid-figure"><div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="Comparação entre um handshake TLS com autenticação apenas do servidor e um handshake mTLS em que o servidor também solicita e valida o certificado do cliente."><pre class="mermaid-source">sequenceDiagram&#10;  participant C as Serviço cliente&#10;  participant S as Serviço servidor&#10;  C-&gt;&gt;S: ClientHello&#10;  S-&gt;&gt;C: ServerHello + Certificate&#10;  S-&gt;&gt;C: CertificateRequest&#10;  C-&gt;&gt;S: Certificate&#10;  C-&gt;&gt;S: CertificateVerify&#10;  Note over C,S: Ambos validam cadeia, identidade e prova de posse&#10;  C-&gt;&gt;S: Dados de aplicação cifrados&#10;  S-&gt;&gt;C: Dados de aplicação cifrados</pre></div><figcaption>Fluxo conceitual de mTLS em TLS 1.3. Mensagens intermediárias foram omitidas para destacar a autenticação por certificado; a RFC 8446 define o handshake completo.</figcaption><details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">sequenceDiagram&#10;  participant C as Serviço cliente&#10;  participant S as Serviço servidor&#10;  C-&gt;&gt;S: ClientHello&#10;  S-&gt;&gt;C: ServerHello + Certificate&#10;  S-&gt;&gt;C: CertificateRequest&#10;  C-&gt;&gt;S: Certificate&#10;  C-&gt;&gt;S: CertificateVerify&#10;  Note over C,S: Ambos validam cadeia, identidade e prova de posse&#10;  C-&gt;&gt;S: Dados de aplicação cifrados&#10;  S-&gt;&gt;C: Dados de aplicação cifrados</pre></details></figure>

<h2>2. O certificado precisa responder qual serviço é este</h2>

Um certificado X.509 não é apenas uma chave pública assinada. Ele contém um conjunto de nomes e restrições que dizem a quem aquela chave foi vinculada, quem fez a vinculação e em que condições ela pode ser aceita. A [RFC 5280](<https://www.rfc-editor.org/rfc/rfc5280>) define a validação de caminhos de certificação e descreve o vínculo entre nomes de sujeito ou <span lang="en-US">Subject Alternative Name</span> e a chave pública sob uma âncora de confiança.

Para identidade de serviço, quatro verificações são diferentes e todas importam:

1. **Cadeia:** o certificado folha precisa encadear até uma CA que a ponta decidiu confiar.
2. **Validade e uso:** datas, extensões e usos de chave precisam ser compatíveis com autenticação TLS.
3. **Prova de posse:** a ponta precisa provar que possui a chave privada correspondente ao certificado.
4. **Nome esperado:** a identidade contida no certificado precisa ser exatamente uma identidade válida para o serviço ou cliente que se pretendia alcançar.

O quarto item é onde muitos desenhos param cedo demais. Aceitar qualquer certificado assinado pela CA corporativa apenas prova pertencimento a um universo amplo. Se a mesma CA emite certificados para pagamentos, busca, homologação e ferramentas administrativas, uma validação que só verifica a cadeia pode permitir que uma identidade legítima para outro propósito se apresente ao serviço errado.

<div class="article-callout"><p><strong>Certificado válido não significa serviço autorizado.</strong> A cadeia responde se uma autoridade confiável emitiu aquela credencial. O nome e a política respondem se a credencial representa o peer que esta conexão deveria aceitar.</p></div>

<h2>3. SAN é identidade; DNS e IP são localização</h2>

Em arquiteturas de serviços, localização e identidade mudam em ritmos diferentes. Um pod ganha outro IP, uma réplica muda de nó, um balanceador redistribui tráfego e o nome DNS continua apontando para um conjunto de instâncias. Nenhum desses fatos deveria exigir que a autorização passe a tratar cada IP efêmero como uma identidade de segurança.

A extensão <span lang="en-US">Subject Alternative Name</span>, ou SAN, permite carregar nomes associados à chave. Para servidores Web, a forma típica é um DNS SAN. Para workloads, uma opção é um URI que represente uma identidade lógica. A especificação [X.509-SVID do SPIFFE](<https://spiffe.io/docs/latest/spiffe-specs/x509-svid/>) codifica exatamente um SPIFFE ID como URI SAN, por exemplo:

<pre class="code-block"><code>spiffe://prod.exemplo.com/ns/pagamentos/sa/checkout</code></pre>

Nesse modelo, `prod.exemplo.com` é o <span lang="en-US">trust domain</span> e o restante do URI identifica o workload segundo a convenção da organização. O [SPIFFE ID](<https://spiffe.io/docs/latest/spiffe-specs/spiffe-id/>) é um nome lógico: ele não precisa conter endereço IP, hostname do pod nem nome da máquina. A identidade pode sobreviver a rescheduling e autoscaling desde que a infraestrutura consiga atestar que a nova instância realmente pertence ao workload que recebe aquele ID.

Essa separação reduz um acoplamento perigoso. Descoberta de serviço decide *onde* abrir a conexão; validação de identidade decide *quem* deve responder naquele destino. Em uma chamada para o serviço de estoque, resolver `estoque.svc` para um IP não deveria bastar. O cliente precisa verificar que o certificado recebido representa uma identidade autorizada a executar estoque.

<figure class="mermaid-figure"><div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="A descoberta resolve o endereço do serviço, enquanto a validação mTLS verifica separadamente a identidade apresentada no certificado contra a identidade esperada."><pre class="mermaid-source">flowchart LR&#10;  A[Cliente: checkout] -- resolve destino --&gt; D[DNS ou service discovery]&#10;  D -- endereço atual --&gt; B[Endpoint de estoque]&#10;  B -- certificado com identidade --&gt; A&#10;  A -- valida cadeia + SAN + política --&gt; T[Trust bundle e mapa de identidades]&#10;  T -- identidade esperada --&gt; A</pre></div><figcaption>Descoberta e identidade são planos diferentes. O endereço leva ao endpoint; o certificado precisa provar que esse endpoint é uma identidade aceitável para o serviço pretendido.</figcaption><details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">flowchart LR&#10;  A[Cliente: checkout] -- resolve destino --&gt; D[DNS ou service discovery]&#10;  D -- endereço atual --&gt; B[Endpoint de estoque]&#10;  B -- certificado com identidade --&gt; A&#10;  A -- valida cadeia + SAN + política --&gt; T[Trust bundle e mapa de identidades]&#10;  T -- identidade esperada --&gt; A</pre></details></figure>

<h2>4. Trust anchor define o universo que pode provar identidades</h2>

A confiança de X.509 começa em uma ou mais âncoras, normalmente chaves públicas de CAs raiz. A validação de caminho da RFC 5280 verifica se o certificado folha pode ser ligado a uma dessas âncoras por uma cadeia válida. Portanto, distribuir o <span lang="en-US">trust bundle</span> é uma decisão de segurança tão importante quanto distribuir os certificados folha.

Uma CA excessivamente abrangente aumenta o raio de explosão. Se produção e homologação compartilham a mesma raiz e os validadores aceitam qualquer identidade dessa raiz, uma emissão indevida em homologação pode ganhar valor em produção. O conceito de <span lang="en-US">trust domain</span> do [SPIFFE](<https://spiffe.io/docs/latest/spiffe/concepts/>) torna essa fronteira explícita: um domínio de confiança representa um espaço de identidades sustentado por uma autoridade emissora. Domínios diferentes podem ser isolados ou federados deliberadamente.

Isso sugere uma regra prática: desenhe confiança como grafo, não como um arquivo PEM global copiado para todo lugar. Para cada workload, responda quais domínios ele aceita, quais identidades dentro desses domínios podem agir como peers e por que uma federação é necessária. Uma raiz presente no disco mas não necessária para nenhuma relação concreta é superfície de confiança sem benefício.

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Tabela rolável comparando decisões de confiança em mTLS"><table><thead><tr><th>Decisão</th><th>Pergunta correta</th><th>Falha comum</th></tr></thead><tbody>
<tr><td>CA raiz</td><td>Quem pode emitir identidades que este workload aceita?</td><td>Confiar na CA corporativa inteira por conveniência</td></tr>
<tr><td>SAN / SPIFFE ID</td><td>Qual peer específico deveria estar aqui?</td><td>Validar a cadeia e ignorar o nome</td></tr>
<tr><td>Federação</td><td>Que outro domínio precisa ser aceito e para quais chamadas?</td><td>Mesclar ambientes sem limite de namespace</td></tr>
<tr><td>Autorização</td><td>O que esta identidade autenticada pode fazer?</td><td>Tratar autenticação como permissão irrestrita</td></tr>
</tbody></table></div>

<h2>5. Autenticação mútua não é autorização mútua</h2>

Depois do handshake, o servidor pode saber que a conexão veio de `spiffe://prod.exemplo.com/ns/checkout/sa/api`. Esse fato ainda não responde se checkout pode chamar `POST /estoque/reservas`, ler dados administrativos ou abrir uma conexão de manutenção. A autorização deve consumir a identidade autenticada e aplicar uma política separada.

A documentação de segurança do [Istio](<https://istio.io/latest/docs/concepts/security/>) explicita essa separação: autenticação peer identifica a origem da conexão e as políticas de autorização decidem o acesso. As boas práticas do projeto também alertam que mTLS sozinho autentica, mas não concede uma política fina de autorização a todos os certificados válidos.

Em um mesh, uma política possível é exigir mTLS estrito e depois permitir somente uma identidade específica. O exemplo abaixo é ilustrativo; nomes de namespace e service account precisam refletir o ambiente real:

<pre class="code-block"><code>apiVersion: security.istio.io/v1&#10;kind: PeerAuthentication&#10;metadata:&#10;  name: estoque-mtls&#10;  namespace: estoque&#10;spec:&#10;  mtls:&#10;    mode: STRICT&#10;---&#10;apiVersion: security.istio.io/v1&#10;kind: AuthorizationPolicy&#10;metadata:&#10;  name: permitir-checkout&#10;  namespace: estoque&#10;spec:&#10;  rules:&#10;  - from:&#10;    - source:&#10;        principals:&#10;        - cluster.local/ns/checkout/sa/api</code></pre>

A primeira política fecha a porta para conexões plaintext. A segunda restringe quem, entre as identidades autenticadas, pode entrar. Em ambientes sem service mesh, a mesma ideia precisa aparecer no servidor ou no proxy: extrair a identidade do certificado validado e compará-la com uma política de acesso explícita.

<h2>6. A identidade precisa nascer sem um segredo estático inicial</h2>

Há um problema circular na automação de certificados: para pedir uma credencial, o workload precisa primeiro provar quem é. Colocar no container uma chave privada longa ou um token compartilhado apenas empurra o segredo para trás e cria outra credencial difícil de rotacionar.

Sistemas de <span lang="en-US">workload identity</span> resolvem o bootstrap usando sinais da plataforma. O [SPIFFE Workload API](<https://spiffe.io/docs/latest/spiffe-specs/spiffe_workload_api/>) entrega X.509-SVIDs e bundles de confiança ao processo local; implementações como SPIRE podem atestar o workload usando propriedades do nó e do processo em vez de exigir que a aplicação carregue um segredo estático próprio.

Em Kubernetes, um emissor pode vincular identidade a namespace, service account e atributos do pod. Em VMs, a atestação pode usar identidade da instância, metadados do provedor ou outros mecanismos protegidos. O ponto arquitetural não é a tecnologia específica: a CA só deve emitir a identidade depois que algum componente confiável relacionar a instância em execução ao nome lógico que ela está autorizada a possuir.

Essa etapa é parte da superfície de segurança. Se um atacante consegue alterar os atributos usados na atestação ou convencer o emissor a conceder a identidade de pagamentos a um workload de teste, o handshake mTLS seguinte será criptograficamente perfeito e semanticamente errado.

<h2>7. Certificados curtos mudam revogação por expiração rápida</h2>

Certificados têm validade finita. A RFC 5280 também define mecanismos de revogação baseados em CRL, mas ambientes de workload frequentemente preferem credenciais curtas com renovação automática para reduzir a dependência de consultas de revogação em cada conexão. O SPIFFE, por exemplo, trabalha com SVIDs de curta duração e entrega atualizações pela Workload API.

Credencial curta não elimina revogação; ela muda o mecanismo dominante de contenção. Se uma chave é comprometida, o limite de exposição não é simplesmente o TTL nominal. Como aproximação operacional:

<pre class="code-block"><code>janela_residual ≈ validade_restante_do_certificado&#10;                + atraso_de_propagacao_de_trust_e_politica</code></pre>

Essa fórmula é um modelo de engenharia, não uma garantia do protocolo. Uma política de revogação imediata, CRLs, atualização de bundle ou bloqueio de identidade pode reduzir a janela. Falhas de distribuição podem aumentá-la. O que importa é medir o pior caso que a arquitetura realmente consegue impor.

Rotação também precisa ocorrer antes da expiração e sem interromper conexões. O agente ou biblioteca deve receber o novo certificado, começar a usá-lo em novos handshakes e manter confiança suficiente para uma transição segura de intermediárias ou raízes. O [Istio](<https://istio.io/latest/docs/concepts/security/>), por exemplo, documenta geração e rotação automatizada de chaves e certificados pelos agentes junto ao plano de controle.

Dois testes são essenciais: desligar temporariamente o emissor para observar o comportamento quando a renovação falha e rotacionar uma CA intermediária ou raiz em ambiente controlado. Uma implantação que só foi testada com certificados sempre válidos ainda não testou sua PKI.

<h2>8. O ponto onde TLS termina define onde a identidade continua confiável</h2>

mTLS autentica os peers da conexão TLS. Se a conexão termina em um load balancer, ingress, sidecar ou proxy ambient, a identidade criptográfica foi verificada naquele componente. A aplicação atrás dele pode receber outra conexão local e já não participa do handshake original.

Isso não é necessariamente um problema. Um sidecar pode ser o ponto de aplicação de política e a comunicação local pode estar protegida por isolamento do pod. Mas a fronteira precisa ser explícita: a aplicação está confiando no proxy para representar corretamente a identidade do peer.

O erro perigoso é transportar identidade em um header que qualquer cliente externo também pode enviar. Cabeçalhos como `X-Forwarded-Client-Cert` só têm valor quando um proxy confiável remove valores recebidos de origens não confiáveis e injeta um novo valor derivado do certificado que ele próprio validou. Caso contrário, a identidade saiu de uma prova criptográfica para uma string controlável pelo chamador.

Em cada salto, pergunte:

- quem terminou TLS;
- quem validou o certificado;
- como a identidade foi passada ao próximo componente;
- por que o próximo componente confia nesse transporte de identidade;
- se existe um caminho alternativo que contorna o proxy.

<figure class="mermaid-figure"><div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="Uma conexão mTLS termina no proxy do servidor; dali para a aplicação, a identidade depende da confiança local no proxy e do mecanismo usado para propagá-la."><pre class="mermaid-source">flowchart LR&#10;  C -- mTLS --&gt; P[Proxy servidor]&#10;  P -- identidade validada --&gt; Z[Política de autorização]&#10;  Z -- permitido --&gt; A[Aplicação]&#10;  P -. conexão local .-&gt; A&#10;  X[Cliente não confiável] -. header forjado .-&gt; P</pre></div><figcaption>A identidade é criptograficamente forte até o ponto de terminação TLS. Depois dele, qualquer propagação precisa de uma fronteira local confiável e de proteção contra valores forjados.</figcaption><details class="mermaid-fallback"><summary>Ver o código Mermaid</summary><pre class="code-block">flowchart LR&#10;  C -- mTLS --&gt; P[Proxy servidor]&#10;  P -- identidade validada --&gt; Z[Política de autorização]&#10;  Z -- permitido --&gt; A[Aplicação]&#10;  P -. conexão local .-&gt; A&#10;  X[Cliente não confiável] -. header forjado .-&gt; P</pre></details></figure>

<h2>9. Conexões longas criam uma diferença entre identidade no handshake e identidade agora</h2>

O certificado é validado quando a conexão TLS é estabelecida. Se uma conexão HTTP/2, gRPC ou banco de dados permanece aberta por muito tempo, ela pode continuar viva depois que a credencial usada no handshake expirou ou depois que a política mudou, dependendo da implementação. Rotacionar o arquivo de certificado não retroativamente reautentica uma sessão já estabelecida.

Por isso, o tempo de vida das conexões precisa ser compatível com o tempo de reação esperado a comprometimentos e mudanças de política. Em alguns sistemas, limitar idade máxima da conexão força handshakes periódicos. Em outros, o proxy consegue encerrar conexões quando recebe uma atualização de política. Não assuma esse comportamento: teste a implementação escolhida.

O mesmo vale para pools. Uma aplicação que renova certificados corretamente, mas mantém um pool de conexões indefinidamente, pode produzir a ilusão de que a nova identidade já está em uso quando nenhum novo handshake aconteceu. Telemetria útil separa conexões abertas, handshakes novos e versão do certificado em uso.

<h2>10. Modos de falha que parecem segurança funcionando</h2>

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Tabela rolável de modos de falha em mTLS"><table><thead><tr><th>Falha</th><th>Por que passa despercebida</th><th>Controle</th></tr></thead><tbody>
<tr><td>Servidor aceita plaintext e mTLS</td><td>Os clientes modernos usam mTLS, mas existe caminho de downgrade</td><td>Migrar e depois exigir modo estrito; testar portas diretamente</td></tr>
<tr><td>Validação apenas da CA</td><td>O handshake é verde para qualquer certificado interno</td><td>Validar SAN/identidade esperada e autorização</td></tr>
<tr><td>Certificado compartilhado por vários serviços</td><td>Operação parece simples</td><td>Emitir identidade por workload ou papel; reduzir raio de explosão</td></tr>
<tr><td>Mesmo trust bundle em prod e teste</td><td>Menos arquivos para distribuir</td><td>Separar domínios de confiança e federar explicitamente</td></tr>
<tr><td>Header de identidade aceito da rede</td><td>A aplicação vê uma string plausível</td><td>Sanitizar no proxy e bloquear acesso que o contorne</td></tr>
<tr><td>Rotação não testada</td><td>Certificados atuais ainda são válidos</td><td>Ensaiar expiração, indisponibilidade do emissor e troca de CA</td></tr>
<tr><td>Relógios divergentes</td><td>A cadeia parece correta</td><td>Monitorar sincronização de tempo e alertar sobre erros de validade</td></tr>
<tr><td>Política autoriza toda identidade autenticada</td><td>mTLS é confundido com controle de acesso</td><td>Políticas de mínimo privilégio por principal e operação</td></tr>
</tbody></table></div>

<h2>11. Um desenho de produção em sete passos</h2>

1. **Nomeie workloads, não máquinas.** Defina uma identidade estável para cada papel de serviço e evite usar IP como principal de autorização.
2. **Defina fronteiras de confiança.** Separe ambientes e organizações quando uma emissão em um lado não deveria ser automaticamente aceita no outro.
3. **Automatize bootstrap e emissão.** Faça a infraestrutura atestar a instância antes de emitir a credencial; não distribua a mesma chave privada em imagens ou secrets estáticos.
4. **Valide cadeia e identidade esperada.** O cliente precisa verificar o servidor correto; o servidor precisa verificar a identidade do cliente, não apenas a CA.
5. **Conecte identidade à autorização.** Políticas devem usar o principal autenticado e o princípio de menor privilégio.
6. **Rotacione sem depender de reinício manual.** Certificado e trust bundle precisam atualizar em runtime, com observabilidade sobre expiração e falha de renovação.
7. **Teste bypass e terminação.** Verifique que não existe porta plaintext, rota direta, header forjável ou proxy alternativo que pule a política.

Esse fluxo também facilita adoção incremental. Em vez de ativar mTLS em todo o ambiente e torcer para que todos os clientes estejam prontos, observe primeiro quais caminhos ainda usam plaintext, migre os emissores e consumidores, valide identidade e autorização, então feche o modo permissivo. A documentação de [migração mTLS do Istio](<https://istio.io/latest/docs/tasks/security/authentication/mtls-migration/>) usa exatamente a ideia de transição de `PERMISSIVE` para `STRICT`.

<h2>12. Diagnóstico: descubra qual das quatro camadas falhou</h2>

Erros de mTLS ficam mais fáceis de investigar quando o diagnóstico separa transporte, PKI, identidade e autorização.

<div class="article-table-scroll" tabindex="0" role="region" aria-label="Tabela rolável de diagnóstico de falhas mTLS"><table><thead><tr><th>Camada</th><th>Sintoma típico</th><th>Perguntas</th></tr></thead><tbody>
<tr><td>Transporte</td><td>Timeout, reset, protocolo incompatível</td><td>A porta fala TLS? Há proxy ou LB no caminho? SNI e ALPN estão corretos?</td></tr>
<tr><td>PKI</td><td>Unknown CA, certificado expirado, cadeia inválida</td><td>Qual bundle foi carregado? A intermediária está presente? Os relógios concordam?</td></tr>
<tr><td>Identidade</td><td>Nome/SAN não corresponde ao destino ou principal esperado</td><td>Qual SAN o peer apresentou? Qual nome o cliente pretendia alcançar?</td></tr>
<tr><td>Autorização</td><td>Handshake passa, requisição recebe 403/deny</td><td>Qual principal foi extraído? Qual regra permitiu ou negou?</td></tr>
</tbody></table></div>

Ferramentas como `openssl s_client` ajudam a inspecionar cadeia e handshake, mas a investigação não termina quando o certificado é exibido. É preciso comparar o SAN com a identidade esperada e verificar a política aplicada. Em meshes, a telemetria do proxy deve expor principal de origem, versão do certificado e motivo de negação sem registrar chaves privadas ou material sensível.

<h2>13. Quando mTLS é a escolha certa</h2>

mTLS é especialmente útil quando existem chamadas máquina-a-máquina em rede não confiável, quando cada workload precisa de uma identidade forte e quando a infraestrutura consegue automatizar emissão e rotação. Ele combina bem com service meshes, proxies de identidade e APIs internas que precisam distinguir callers sem distribuir segredos compartilhados.

Também há custos. PKI exige autoridade emissora, distribuição de confiança, renovação, observabilidade, resposta a comprometimento e disciplina de nomes. Para integrações externas esporádicas, um gateway com TLS comum e autenticação de aplicação pode ser operacionalmente mais simples. Para autenticação de usuário final, certificados de workload não substituem identidade humana e contexto de sessão. Para autorização por operação, mTLS fornece o principal, mas não a decisão completa.

A escolha não deve ser motivada apenas por tornar tudo criptografado. HTTPS já cifra muito tráfego. O motivo para mTLS é precisar que a camada de transporte entregue uma identidade autenticada dos dois lados e estar disposto a operar o ciclo de vida necessário para que essa identidade continue correta.

<h2>14. Resumo mental</h2>

Pense em mTLS como uma porta blindada com crachá dos dois lados. A porta protege a conversa; os crachás provam identidades; a lista de acesso decide quem entra. X.509 fornece a credencial e a cadeia de confiança, SAN ou SPIFFE ID fornece o nome lógico, o handshake prova posse da chave, a autorização transforma o principal em permissão e a rotação limita por quanto tempo uma credencial continua útil.

Se faltar qualquer elo, a propriedade muda: sem validação de nome você sabe apenas que o peer pertence a alguma CA; sem autorização qualquer identidade válida pode ter acesso demais; sem rotação a chave comprometida vive por tempo excessivo; sem uma fronteira clara no proxy a identidade pode virar apenas um header; sem modo estrito ainda pode existir um caminho plaintext.

<h2>15. Perguntas de revisão</h2>

1. Qual é a diferença entre validar a cadeia de um certificado e validar a identidade esperada do serviço?
2. Por que um endereço IP de pod é uma localização ruim para servir como principal de autorização?
3. O que um <span lang="en-US">trust domain</span> separa e por que produção e homologação podem merecer domínios diferentes?
4. Por que mTLS autentica um caller sem decidir automaticamente o que ele pode fazer?
5. Quando TLS termina em um sidecar, o que a aplicação precisa confiar para usar a identidade do peer?
6. Por que trocar o certificado em disco não reautentica necessariamente conexões longas já abertas?

<h2>16. Exercícios</h2>

1. **Mapa de confiança:** desenhe três serviços do seu sistema. Para cada chamada, anote identidade do cliente, identidade esperada do servidor, CA/trust domain e regra de autorização. Marque qualquer relação em que a política seja apenas qualquer certificado da CA.
2. **Falha de rotação:** em um ambiente local ou de teste, reduza a validade de um certificado, interrompa temporariamente o emissor e observe quando surgem alertas, quando novos handshakes falham e se conexões existentes continuam vivas.
3. **Teste de bypass:** identifique o componente que termina mTLS e tente alcançar a aplicação por uma rota que não passe por ele. Se existir, explique que mecanismo impede um caller de forjar a identidade propagada.

<h2>Fontes</h2>

- [RFC 8446 — The Transport Layer Security (TLS) Protocol Version 1.3](<https://www.rfc-editor.org/rfc/rfc8446>), IETF, 2018.
- [RFC 5280 — Internet X.509 Public Key Infrastructure Certificate and CRL Profile](<https://www.rfc-editor.org/rfc/rfc5280>), IETF, 2008.
- [SPIFFE Identity and Verifiable Identity Document](<https://spiffe.io/docs/latest/spiffe-specs/spiffe-id/>).
- [SPIFFE X.509-SVID Specification](<https://spiffe.io/docs/latest/spiffe-specs/x509-svid/>).
- [SPIFFE Workload API Specification](<https://spiffe.io/docs/latest/spiffe-specs/spiffe_workload_api/>).
- [SPIFFE Trust Domain and Bundle Specification](<https://spiffe.io/docs/latest/spiffe-specs/spiffe_trust_domain_and_bundle/>).
- [Istio Security Concepts](<https://istio.io/latest/docs/concepts/security/>).
- [Istio Security Best Practices](<https://istio.io/latest/docs/ops/best-practices/security/>).
- [Istio Mutual TLS Migration](<https://istio.io/latest/docs/tasks/security/authentication/mtls-migration/>).
