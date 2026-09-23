# Diretrizes editoriais

## Brief de geração

Para escrever um artigo novo, comece pelo compositor seletivo descrito em `generation/README.md`. Ele combina um contrato autoral compacto, uma task e somente os frameworks de domínio relevantes. Não carregue todos os módulos nem replique estas diretrizes em um prompt específico do tema.

Esta documentação continua sendo a referência humana para escopo, pesquisa e revisão. O conteúdo que exige decisão do modelo durante a escrita fica em `generation/editorial/AUTHORING.md`; invariantes objetivas pertencem ao lint e aos testes.

## Escopo

A cada novo artigo, pesquise, produza e publique conteúdo em português brasileiro sobre Engenharia de Software, com foco especial em arquitetura de sistemas, sistemas distribuídos, confiabilidade, observabilidade e resiliência.

Exemplos de temas possíveis incluem Circuit Breaker, Four Golden Signals, Bulkhead, Backpressure, Idempotência, Consistent Hashing, CQRS, Event Sourcing, Sagas, Rate Limiting, Load Shedding, CAP, filas, consenso, observabilidade, resiliência e sistemas distribuídos. A lista é ilustrativa, não exaustiva.

## Escolha do assunto

Antes de escolher o tema:

1. consulte o catálogo compacto de títulos, slugs e resumos emitido por `node scripts/compose-article-brief.mjs --list`;
2. leia o conteúdo completo apenas dos artigos com possível sobreposição ao tema candidato;
3. compare títulos, resumos e, nos casos ambíguos, o conteúdo; evite sinônimos, equivalentes semânticos e variações superficiais;
4. se houver um assunto fornecido para a execução, utilize-o apenas se ainda não tiver sido coberto;
5. na tarefa agendada, use exclusivamente a seleção ativa em `docs/TOPIC_QUEUE.md`; em execução manual sem seleção, escolha um novo tema relevante dentro do escopo editorial.

O catálogo reduz a leitura inicial, mas não substitui o julgamento editorial. A verificação automática de duplicatas exatas no compositor também não detecta equivalência semântica.

## Pesquisa e rigor

Pesquise fontes atuais e confiáveis na web antes de escrever. Priorize:

- documentação oficial;
- papers originais;
- artigos acadêmicos;
- RFCs;
- livros reconhecidos;
- publicações de autores ou organizações relevantes.

Diferencie claramente:

- fatos históricos;
- definições formais;
- interpretações modernas;
- hipóteses ou exemplos meramente ilustrativos.

Não invente autores, datas, citações, fontes, números ou resultados.

Inclua links de referência dentro do artigo próximos às afirmações que sustentam e uma seção final de fontes. Fontes secundárias reconhecidas podem complementar fontes primárias.

## Profundidade e estrutura

O artigo deve ser didático e tecnicamente rigoroso, começando do zero e avançando até nível intermediário ou avançado.

Inclua, quando aplicável:

- motivação e problema resolvido;
- origem e contexto histórico;
- teoria e princípios fundamentais;
- matemática relevante, fórmulas, intuição e exemplos numéricos;
- arquitetura e funcionamento passo a passo;
- exemplos práticos e cenários de falha;
- trade-offs, limitações, anti-padrões e quando não usar;
- relações com conceitos correlatos;
- principais autores, pesquisadores ou organizações associados;
- livros, papers, RFCs, documentação oficial e referências clássicas.

Termine com:

- um resumo mental do conceito;
- perguntas de revisão;
- dois ou três exercícios ou experimentos executáveis localmente ou mentalmente.

Não prometa simuladores, gráficos, exemplos ou recursos que não estejam realmente presentes.

## Primeiro parágrafo obrigatório: diálogo-metáfora

Todo artigo novo deve começar, dentro do campo bodyHtml, com um único parágrafo introdutório em formato de diálogo-metáfora. Esse parágrafo é obrigatório e deve seguir estas regras:

- apresente uma situação cotidiana, física e observável que funcione como alegoria para o conceito técnico;
- escreva como uma conversa curta, com pelo menos dois movimentos de interlocução, incorporando pergunta, reação ou contraponto diretamente à prosa;
- não use aspas, travessão ou identificadores para marcar as falas; o diálogo deve ser percebido pelo ritmo da situação e pela resposta ao problema apresentado;
- não há uma abertura fixa: “Sabe quando” pode ser usado, mas não é obrigatório;
- depois da cena, conecte explicitamente a situação ao conceito do artigo e antecipe o problema que será explicado;
- preserve nomes técnicos consagrados em inglês quando essa for a forma correta, sem traduzi-los artificialmente, como em “Four Golden Signals”;
- mantenha a abertura em um único elemento <p>, antes de qualquer outro parágrafo, heading, figura ou bloco técnico;
- faça a rolagem horizontal acontecer apenas dentro de tabelas, blocos de código, fórmulas ou diagramas que precisem dela; nunca dependa de overflow horizontal no documento inteiro;
- evite começar com uma definição abstrata, uma lista de termos ou uma descrição genérica do tema.

A metáfora deve ser específica o suficiente para orientar também a capa. Depois de escrever o primeiro parágrafo, extraia dele o cenário físico, os personagens ou objetos, a ação central e a relação visual que precisam aparecer no banner. Se a cena não puder ser representada visualmente, reescreva o parágrafo antes de gerar a imagem.

## Composição visual

Os artigos devem ser visualmente ricos quando isso melhorar a compreensão. Planeje os visuais junto com o texto e prefira recursos que expliquem relações difíceis de entender somente por prosa.

Não imponha uma quantidade artificial de imagens ou diagramas e não use recursos visuais apenas para preencher espaço.

Toda a direção de estilo para capas e ilustrações conceituais, incluindo o template base do prompt de geração, está em `docs/VISUAL_STYLE.md`. Na criação rotineira da capa, use `node scripts/compose-cover-brief.mjs`, que extrai daquele documento as partes necessárias; consulte o texto integral se houver dúvida visual.

A aquarela editorial é um requisito permanente, não um adjetivo opcional do prompt: toda capa e toda ilustração conceitual deve parecer uma pintura real em aquarela sobre papel texturizado. Paleta suave, filtros de textura, transparências ou um arquivo SVG não são suficientes se o resultado parecer vetor flat, formas geométricas ou composição digital limpa. Rejeite e regenere qualquer imagem que não preserve essa aparência.

Mermaid é o padrão quando diagramas, fluxos, sequências, estados, relações ou gráficos técnicos ajudarem a explicar o tema. Não crie nem versione SVG para diagramas. HTML e CSS continuam permitidos para fórmulas, simuladores e interfaces de apoio; SVG fica reservado ao favicon e aos ícones compartilhados.

Diagramas, gráficos, fórmulas e outros elementos que exigem precisão também devem obedecer às regras técnicas e de acessibilidade definidas em `docs/VISUAL_STYLE.md` e `docs/ARTICLE_FORMAT.md`.


## Padrão técnico para diagramas

Quando um visual técnico for um diagrama compatível com Mermaid, escreva sua fonte dentro do `bodyHtml`, use o tema **Floresta semântica** e inclua legenda, descrição acessível e fallback do código. Antes de publicar, confirme que não há referência a SVG de diagrama, que o fluxo ou dado essencial também está explicado em texto e que o diagrama permanece legível em telas pequenas. Não imponha um diagrama quando ele não melhorar a compreensão.


## Regras automatizadas

As regras objetivas deste documento devem ser refletidas em `scripts/lint-articles.mjs` e executadas pela workflow de validação. O lint deve bloquear publicação quando houver contrato JSON incompleto, slug inconsistente, capa ausente ou incorreta, asset local inexistente, HTML inseguro, abertura fora do formato, tabela sem rolagem local, diagrama Mermaid sem fallback, referência fragmentada ou URL proibida.

A qualidade da pesquisa, a ausência de repetição semântica, a qualidade da metáfora, a relação entre metáfora e capa e a aparência de pintura em aquarela não são reduzíveis a uma expressão regular confiável; continuam como revisão editorial ou visual explícita.
