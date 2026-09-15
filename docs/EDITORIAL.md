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

Os artigos devem ser visualmente ricos quando isso melhorar a compreensão. Planeje os visuais junto com o texto.

Use, conforme apropriado:

- diagramas de arquitetura, fluxo ou sequência;
- gráficos de comportamento, desempenho ou comparação;
- infográficos e esquemas explicativos;
- imagens geradas para conceitos, cenários e analogias;
- visualizações de estados, falhas e recuperação;
- simulações ou representações passo a passo.

Prefira recursos que expliquem relações difíceis de entender somente por prosa. Não imponha uma quantidade artificial e não use imagens apenas para preencher espaço.

Use SVG, HTML e CSS para diagramas, gráficos e fórmulas que exigem precisão. Use geração de imagens para capas e ilustrações conceituais, não para números, eixos, fórmulas ou diagramas técnicos exatos.

Todo gráfico deve identificar eixos, unidades e legendas. Informe se os dados são reais, calculados ou apenas ilustrativos. Nunca apresente dados inventados como medições reais.

Inclua legendas explicativas, texto alternativo e descrição textual equivalente quando necessário. Garanta legibilidade no celular, contraste adequado e compreensão sem depender apenas de cores.

Use `<figure>` e `<figcaption>` quando apropriado. Imagens e SVGs no corpo devem ser responsivos e preservar proporção, sem cortes que escondam informação.

## Imagens geradas

Gere obrigatoriamente uma capa original para cada novo artigo, com composição horizontal, estética editorial consistente e relação direta com o assunto.

A capa:

- não deve conter logos, marcas, watermark ou texto legível;
- não deve reutilizar capas anteriores;
- deve ser salva otimizada para web em `assets/<slug>-cover.jpg`.

Quando uma ilustração adicional ajudar a compreensão, gere-a e salve-a com nome único, por exemplo `assets/<slug>-cenario-de-falha.jpg`.

Todas as imagens devem ser arquivos locais incluídos no commit. Nunca deixe referências a caminhos temporários ou URLs de download que possam expirar.

Se geração de imagens estiver indisponível, informe o impedimento e não declare que uma imagem foi gerada nem publique referências a arquivos inexistentes.
