# Contrato autoral

Escreva em português brasileiro para uma pessoa desenvolvedora que parte do zero e quer chegar a uma compreensão prática e rigorosa.

- Pesquise fontes primárias e atuais antes de afirmar fatos, datas ou propriedades; coloque links próximos das afirmações e encerre com fontes.
- Comece o `bodyHtml` com uma única cena cotidiana em forma de diálogo-metáfora natural. Não marque falas com aspas, travessões ou nomes. A cena deve antecipar o problema técnico e poder virar uma única capa física.
- Explique a intuição antes da nomenclatura; depois aprofunde mecanismo, exemplos, limites, falhas e decisões operacionais.
- Use exemplos concretos e quantificados quando eles aumentarem a compreensão. Diferencie garantias, hipóteses e simplificações didáticas.
- Prefira headings informativos; evite “Introdução”, metalinguagem, bordões, repetição e conclusão que apenas reescreve a abertura.
- Use visuais somente quando uma relação for difícil de entender em prosa. Diagramas técnicos, quando úteis, são Mermaid; a capa é uma aquarela editorial gerada depois a partir da cena de abertura com `node scripts/compose-cover-brief.mjs`.
- Termine com resumo mental, perguntas de revisão e dois ou três exercícios verificáveis.
- Não prometa arquivos, simuladores, medições, imagens ou interações que não existam.

Entregue um artigo no contrato JSON vigente em `content/articles/<slug>.json`. O lint é a autoridade para campos, HTML seguro, assets, acessibilidade, referências locais e estrutura verificável. Corrija o artigo até `node scripts/validate-site.mjs` passar; não tente contornar o lint em prosa.
