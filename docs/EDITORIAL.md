# Diretrizes editoriais

## Escopo

A cada novo artigo, pesquise, produza e publique conteúdo em português brasileiro sobre Engenharia de Software, com foco especial em arquitetura de sistemas, sistemas distribuídos, confiabilidade, observabilidade e resiliência.

Exemplos de temas possíveis incluem Circuit Breaker, Four Golden Signals, Bulkhead, Backpressure, Idempotência, Consistent Hashing, CQRS, Event Sourcing, Sagas, Rate Limiting, Load Shedding, CAP, filas, consenso, observabilidade, resiliência e sistemas distribuídos. A lista é ilustrativa, não exaustiva.

## Escolha do assunto

Antes de escolher o tema:

1. leia todos os artigos existentes em `content/articles/`;
2. compare títulos, slugs e conteúdo;
3. evite repetição, inclusive sinônimos, equivalentes semânticos e variações superficiais do mesmo conceito;
4. se houver um assunto fornecido para a execução, utilize-o apenas se ainda não tiver sido coberto;
5. caso contrário, escolha um novo tema relevante dentro do escopo editorial.

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
- escreva como uma conversa curta, com pelo menos duas falas ou turnos de interlocução; uma pergunta ou observação pode aparecer entre aspas e a resposta deve seguir em prosa;
- use aspas com parcimônia, preferindo um único bloco curto de fala; não envolva cada frase nem a explicação inteira do parágrafo em aspas;
- não use travessão para marcar as falas;
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

Toda a direção de estilo para capas e ilustrações conceituais, incluindo o template base do prompt de geração, está em `docs/VISUAL_STYLE.md`. Antes de gerar qualquer imagem, siga esse documento.

A aquarela editorial é um requisito permanente, não um adjetivo opcional do prompt: toda capa e toda ilustração conceitual deve parecer uma pintura real em aquarela sobre papel texturizado. Paleta suave, filtros de textura, transparências ou um arquivo SVG não são suficientes se o resultado parecer vetor flat, formas geométricas ou composição digital limpa. Rejeite e regenere qualquer imagem que não preserve essa aparência.

Mermaid é o padrão para diagramas, fluxos, sequências, estados, relações e gráficos técnicos compatíveis. Não crie nem versione SVG para diagramas. HTML e CSS continuam permitidos para fórmulas, simuladores e interfaces de apoio; SVG fica reservado ao favicon e aos ícones compartilhados.

Diagramas, gráficos, fórmulas e outros elementos que exigem precisão também devem obedecer às regras técnicas e de acessibilidade definidas em `docs/VISUAL_STYLE.md` e `docs/ARTICLE_FORMAT.md`.


## Padrão técnico para diagramas

Todo visual técnico novo deve começar como código Mermaid dentro do `bodyHtml`, usar o tema **Floresta semântica** e conter legenda, descrição acessível e fallback do código. Antes de publicar, confirme que não há referência a SVG de diagrama, que o fluxo ou dado essencial também está explicado em texto e que o diagrama permanece legível em telas pequenas.
