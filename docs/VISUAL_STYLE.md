# Direção visual do Tech Topics

Este documento é a fonte de verdade para capas e ilustrações conceituais do Tech Topics.

A prioridade é **consistência com as capas já publicadas**, não apenas obedecer palavras como “aquarela” ou “editorial”. Antes de gerar uma nova capa, use as referências canônicas abaixo para calibrar composição, paleta, nível de detalhe e marcações.

## Referências canônicas

As capas abaixo definem o estilo visual atual do projeto:

- `assets/four-golden-signals-cover.svg`
- `assets/transactional-outbox-cover.svg`
- `assets/leases-e-fencing-tokens-cover.svg`
- `assets/quoruns-de-leitura-e-escrita-cover.svg`
- `assets/retries-backoff-jitter-cover.svg`

Ao criar uma nova capa, **inspecione pelo menos duas dessas referências antes de montar o prompt**. Copie a gramática visual, não a cena.

Essas referências são mais importantes do que descrições genéricas como “watercolor illustration”. Se houver conflito entre uma interpretação do prompt e a aparência dessas capas, siga as referências.

## O que caracteriza o estilo

### 1. Base pictórica

A imagem deve parecer uma **aquarela editorial contemporânea, gráfica e contida**, não uma pintura aquarelada detalhista.

Características obrigatórias:

- fundo de papel em branco quebrado quente;
- grandes manchas translúcidas e formas simples;
- pigmentos suaves e dessaturados;
- textura de papel perceptível, porém discreta;
- bordas levemente irregulares e macias;
- pouca microtextura;
- pouco contorno interno;
- objetos e pessoas reconhecíveis por massas, silhuetas e poucos detalhes;
- luz natural difusa;
- contraste baixo ou médio na pintura;
- atmosfera calma, limpa e silenciosa.

A aquarela deve parecer **editorial e arquitetônica**, não romântica, botânica, infantil ou expressionista.

### 2. Paleta canônica

Use predominantemente:

- papel / fundo: `#f5f1e8` e tons próximos;
- azul acinzentado: `#a5b9c0`, `#6e8e9b`;
- verde oliva suave: `#83936c`, `#6d8b76`;
- bege / madeira clara: `#c3a87d`, `#c2aa82`;
- ferrugem suave para pequenos acentos: `#b56d4f`, `#b47152`;
- cinza grafite para objetos estruturais: `#4f514e`.

Não use cores saturadas como protagonistas. Não use neon. Não use fundos escuros.

### 3. Composição

- banner horizontal panorâmico, aproximadamente **2.6:1**;
- uma única cena contínua;
- câmera em altura humana ou levemente elevada;
- composição simples e cinematográfica;
- bastante espaço negativo;
- 1 a 3 pessoas no máximo;
- 2 a 5 objetos conceitualmente importantes;
- detalhes ambientais apenas para situar a cena;
- elementos principais afastados das bordas para sobreviver a crop responsivo;
- leitura clara quando a imagem estiver pequena.

A cena deve parecer plausível mesmo sem conhecer o artigo.

### 4. Alegoria física

Explique tecnologia por uma situação física contemporânea, não por símbolos de tecnologia.

Boas famílias de metáfora:

- acesso e autorização;
- filas e espera;
- entrega e transporte;
- armazenamento e despacho;
- pessoas disputando ou compartilhando um recurso;
- arquivos, caixas, credenciais, portas, catracas, balcões, depósitos, bibliotecas, estações e centros logísticos;
- repetição, distância, ordem, seleção, bloqueio, passagem ou interseção visível no espaço.

A dinâmica física deve ser análoga ao mecanismo técnico.

### 5. Camada editorial preta

Depois da cena funcionar como pintura, aplique uma segunda linguagem visual, claramente separada da aquarela.

Use:

- traço preto quase puro;
- espessura visual forte e consistente;
- círculos ou elipses grandes feitos à mão;
- linhas e setas tracejadas;
- dashes relativamente longos e espaçados;
- no máximo **2 a 4 marcações principais**;
- pequenos traços radiais somente quando ajudam a chamar atenção para um ponto.

As marcações devem parecer feitas por um editor com caneta preta grossa sobre uma reprodução impressa da aquarela.

Não use texto nas marcações. Não use legendas, números ou labels.

## O que NÃO fazer

Evite explicitamente:

- colagem ou grade de várias cenas;
- painéis divididos;
- storyboard;
- infográfico;
- fluxograma;
- cards;
- diagramas técnicos disfarçados de ilustração;
- ícones de cloud, banco de dados, servidores ou redes;
- telas, dashboards ou interfaces como recurso explicativo principal;
- código flutuando;
- números binários;
- circuitos;
- cérebros digitais;
- hologramas;
- sci-fi;
- cyberpunk;
- neon;
- render 3D;
- aparência vetorial limpa demais;
- cartoon;
- ilustração infantil;
- line art dominante;
- hiper-realismo fotográfico;
- excesso de objetos decorativos;
- texto legível;
- título dentro da imagem;
- moldura;
- logos, marcas ou watermark.

Também evite “aquarela” com excesso de pinceladas, flores, manchas dramáticas, fundos muito artísticos ou textura pesada. O estilo do Tech Topics é mais próximo de uma **ilustração editorial arquitetônica minimalista em aquarela**.

## Processo obrigatório antes do prompt

Antes de pedir a geração da imagem, faça este trabalho fora do prompt:

1. Resuma o mecanismo técnico em uma frase.
2. Escolha uma alegoria física simples.
3. Defina um único instante observável da cena.
4. Identifique de 2 a 4 elementos que receberão marcação preta.
5. Defina uma relação visual principal: aproximação, sequência, interseção, bloqueio, passagem, espera ou despacho.
6. Inspecione pelo menos duas capas canônicas e confirme que a nova cena terá densidade e paleta semelhantes.

Não envie ao gerador um ensaio explicando o raciocínio. O prompt final deve ser curto, visual e concreto.

## Style anchor obrigatório

O trecho abaixo deve aparecer **quase literalmente** em todo prompt de capa. Ele é a âncora principal de consistência visual:

```text
Wide 2.6:1 editorial banner. Contemporary restrained watercolor on warm off-white textured paper, with large translucent washes, soft irregular edges, simplified realistic people and objects, low-to-medium detail, muted desaturated blue-gray, olive, beige and soft rust palette, diffuse natural daylight, generous negative space, calm modern architectural atmosphere. The scene must read as a single plausible real-world moment, not as an infographic.

Overlay exactly 2 to 4 bold hand-drawn black dashed editorial annotations on top of the finished watercolor: large dashed circles or ellipses around the key objects and, only when necessary, one thick dashed arrow connecting them. The black marks must look like an editor drew them later with a broad black pen and must be visually separate from the watercolor.

No readable text, no labels, no captions, no numbers, no collage, no multi-panel layout, no storyboard, no UI, no dashboard, no tech icons, no floating code, no circuit imagery, no neon, no sci-fi, no 3D render, no cartoon, no photorealism.
```

## Template de prompt de capa

Use este formato. Mantenha-o conciso.

```text
Create one wide editorial cover image for an article about [CONCEITO].

Scene: [UMA ÚNICA CENA FÍSICA E CONTEMPORÂNEA, EM 1–3 FRASES].

Narrative moment: [O INSTANTE EXATO EM QUE A RELAÇÃO ENTRE OS ELEMENTOS É VISÍVEL].

Key objects to emphasize: [2 A 4 ELEMENTOS].

Editorial annotation: [DIGA QUAIS ELEMENTOS RECEBEM CÍRCULO TRACEJADO E, SE NECESSÁRIO, QUAL ÚNICA RELAÇÃO RECEBE SETA TRACEJADA].

Wide 2.6:1 editorial banner. Contemporary restrained watercolor on warm off-white textured paper, with large translucent washes, soft irregular edges, simplified realistic people and objects, low-to-medium detail, muted desaturated blue-gray, olive, beige and soft rust palette, diffuse natural daylight, generous negative space, calm modern architectural atmosphere. The scene must read as a single plausible real-world moment, not as an infographic.

Overlay exactly 2 to 4 bold hand-drawn black dashed editorial annotations on top of the finished watercolor: large dashed circles or ellipses around the key objects and, only when necessary, one thick dashed arrow connecting them. The black marks must look like an editor drew them later with a broad black pen and must be visually separate from the watercolor.

No readable text, no labels, no captions, no numbers, no collage, no multi-panel layout, no storyboard, no UI, no dashboard, no tech icons, no floating code, no circuit imagery, no neon, no sci-fi, no 3D render, no cartoon, no photorealism.
```

## Exemplo calibrado

Para um artigo sobre fencing tokens:

```text
Create one wide editorial cover image for an article about fencing tokens in distributed systems.

Scene: a calm modern glass building entrance. One person is using a current access card at a dark card reader beside a turnstile while another person waits behind holding an older card. The architecture is bright, sparse and contemporary, with a little greenery and no signage.

Narrative moment: the newer credential is being accepted at the reader while the older credential remains visibly behind and out of authority.

Key objects to emphasize: the older card, the newer card at the reader, and the reader itself.

Editorial annotation: one large black dashed circle around the older card, one around the reader/newer card, and one thick dashed curved arrow from the old-card area toward the reader. Add only a few short black emphasis strokes near the reader.

Wide 2.6:1 editorial banner. Contemporary restrained watercolor on warm off-white textured paper, with large translucent washes, soft irregular edges, simplified realistic people and objects, low-to-medium detail, muted desaturated blue-gray, olive, beige and soft rust palette, diffuse natural daylight, generous negative space, calm modern architectural atmosphere. The scene must read as a single plausible real-world moment, not as an infographic.

Overlay exactly 2 to 4 bold hand-drawn black dashed editorial annotations on top of the finished watercolor: large dashed circles or ellipses around the key objects and, only when necessary, one thick dashed arrow connecting them. The black marks must look like an editor drew them later with a broad black pen and must be visually separate from the watercolor.

No readable text, no labels, no captions, no numbers, no collage, no multi-panel layout, no storyboard, no UI, no dashboard, no tech icons, no floating code, no circuit imagery, no neon, no sci-fi, no 3D render, no cartoon, no photorealism.
```

## Critérios de aceitação da capa

Antes de publicar, rejeite a imagem se qualquer uma destas condições falhar:

- parece uma única cena cotidiana, não um infográfico;
- a pintura é clara, dessaturada e minimalista;
- há espaço negativo suficiente;
- os objetos principais são reconhecíveis sem excesso de detalhe;
- as marcações pretas são grossas, tracejadas e claramente sobrepostas à pintura;
- existem no máximo 2 a 4 highlights importantes;
- não existe texto legível nem estrutura de painel;
- a metáfora continua compreensível em tamanho reduzido;
- a imagem está visualmente próxima das capas canônicas do repositório.

Se a primeira geração não cumprir o estilo, **não tente corrigir adicionando mais parágrafos ao prompt**. Faça uma nova tentativa simplificando a cena e reforçando apenas o style anchor e as negativas.

Se duas tentativas continuarem fora da direção, use uma capa determinística baseada na mesma gramática visual das referências canônicas, em vez de publicar uma imagem inconsistente.

## Capas e arquivos

Cada artigo deve ter uma capa original, sem reaproveitar cenas anteriores.

Para geração raster, salve a versão web em:

`assets/<slug>-cover.jpg`

Se for necessário usar uma capa vetorial determinística para preservar o estilo, use:

`assets/<slug>-cover.svg`

O campo `image` do artigo deve apontar para o arquivo realmente publicado. Nunca referencie arquivo temporário ou URL externa que possa expirar.

## Ilustrações conceituais no corpo

Use a mesma linguagem visual quando uma cena ou analogia ajudar a explicar um conceito sem exigir precisão métrica.

Essas imagens podem ser mais simples que a capa, mas devem manter:

- paleta dessaturada;
- aquarela editorial contida;
- poucos elementos;
- marcações pretas somente quando acrescentarem explicação.

## Diagramas, gráficos e fórmulas

Não use geração de imagens para elementos que exigem precisão.

Use SVG, HTML e CSS para:

- diagramas de arquitetura;
- fluxos e sequências;
- gráficos com eixos;
- visualizações quantitativas;
- fórmulas;
- estados e transições;
- comparações dependentes de valores exatos.

Todo gráfico deve identificar eixos, unidades e legendas quando aplicável. Informe se os dados são reais, calculados ou ilustrativos.

## Acessibilidade

- forneça texto alternativo descritivo;
- use `<figure>` e `<figcaption>` quando apropriado;
- não dependa apenas de cor para transmitir informação;
- preserve legibilidade e proporção em telas pequenas;
- quando o visual carregar informação não repetida no texto, inclua descrição textual equivalente.

## Falha de geração

Se a geração de imagens estiver indisponível:

- não declare que a imagem foi gerada;
- não publique referência a arquivo inexistente;
- não use URL temporária como substituição;
- prefira uma capa determinística coerente com as referências canônicas.

## Como alterar o estilo no futuro

Mudanças permanentes devem começar neste arquivo.

Ao alterar a direção visual, atualize nesta ordem:

1. referências canônicas;
2. `O que caracteriza o estilo`;
3. `Style anchor obrigatório`;
4. template e critérios de aceitação.

Prompts específicos de artigos devem acrescentar apenas conceito, cena, momento narrativo e objetos destacados.