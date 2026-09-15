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

## Composição visual

Os artigos devem ser visualmente ricos quando isso melhorar a compreensão. Planeje os visuais junto com o texto e prefira recursos que expliquem relações difíceis de entender somente por prosa.

Não imponha uma quantidade artificial de imagens ou diagramas e não use recursos visuais apenas para preencher espaço.

Toda a direção de estilo para capas e ilustrações conceituais, incluindo o template base do prompt de geração, está em `docs/VISUAL_STYLE.md`. Antes de gerar qualquer imagem, siga esse documento.

Diagramas, gráficos, fórmulas e outros elementos que exigem precisão também devem obedecer às regras técnicas e de acessibilidade definidas em `docs/VISUAL_STYLE.md` e `docs/ARTICLE_FORMAT.md`.
