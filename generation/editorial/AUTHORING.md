# Contrato autoral

Escreva em português brasileiro para uma pessoa desenvolvedora que parte do zero e quer chegar a uma compreensão prática e rigorosa.

- Pesquise fontes primárias e atuais antes de afirmar fatos, datas ou propriedades; coloque links próximos das afirmações e encerre com fontes.
- Comece o corpo do artigo com uma única cena cotidiana em forma de diálogo-metáfora natural. Não marque falas com aspas, travessões ou nomes. A cena deve antecipar o problema técnico e poder virar uma única capa física.
- Explique a intuição antes da nomenclatura; depois aprofunde mecanismo, exemplos, limites, falhas e decisões operacionais.
- Use exemplos concretos e quantificados quando eles aumentarem a compreensão. Diferencie garantias, hipóteses e simplificações didáticas.
- Prefira headings informativos; evite “Introdução”, metalinguagem, bordões, repetição e conclusão que apenas reescreve a abertura.
- Use visuais somente quando uma relação for difícil de entender em prosa. Diagramas técnicos, quando úteis, são Mermaid; a capa é uma aquarela editorial gerada depois a partir da cena de abertura com `node scripts/compose-cover-brief.mjs`.
- Termine com resumo mental, perguntas de revisão e dois ou três exercícios verificáveis.
- Não prometa arquivos, simuladores, medições, imagens ou interações que não existam.
- Antes de marcar expressões inglesas ou siglas, consulte [docs/TTS.md](../../docs/TTS.md) e o léxico indicado ali. Aplique a classificação e a precedência de pronúncia a título, subtítulo e corpo; preserve a grafia visível e use o fallback de soletração para siglas sem decisão editorial.
- **Código inline essencial à prosa:** `<code>` não é narrado por padrão. Se omiti-lo tornar a frase incompleta ou alterar o sentido, preserve a expressão visível e forneça sua fala natural com `data-tts-say`; por exemplo, `<code lang="en-US" data-tts-say="try catch">try/catch</code>`. Não marque cada identificador mecanicamente. Blocos `<pre>` nunca são narrados; explique em prosa o que o leitor precisa aprender.
- **Setas e símbolos no texto narrável:** decida o significado **em cada ocorrência**, incluindo `→`, `←`, `↑` e `↓`. Se o símbolo transmitir fluxo, ordem, retorno, crescimento, queda, transformação ou implicação, mantenha-o visível e envolva **somente o símbolo** em `<span data-tts-say="...">…</span>` com uma expressão contextual: `Banco <span data-tts-say="para o">→</span> broker`, `latência <span data-tts-say="aumenta">↑</span>` ou `erros <span data-tts-say="diminuem">↓</span>`. Escolha também entre “retorna para”, “resulta em” e “implica” conforme a relação. Não narre “seta para a direita/esquerda” por padrão, não traduza símbolos globalmente e não anote setas decorativas, de navegação ou pertencentes a código/diagramas ignorados pelo TTS.
- **Revisão de acessibilidade TTS antes de entregar:** releia como fala contínua títulos, cartões, legendas e parágrafos; verifique que termos inline essenciais e setas com significado tenham aliases naturais e que o HTML visível continue idêntico. Consulte os exemplos e exceções de [docs/TTS.md](../../docs/TTS.md#código-e-conteúdo-não-narrativo).

Entregue um arquivo `content/articles/<slug>.md` baseado em `generation/templates/article.md`, com tags canônicas de `generation/taxonomy/tags.json`. O build público compila fontes Markdown e JSON legadas diretamente para HTML. Use Markdown como fonte para artigos novos; mantenha intactos os JSONs existentes até a etapa de conversão autorizada e não gere JSON intermediário.

O compilador compartilhado valida metadados, catálogo e estrutura Markdown. `node scripts/validate-site.mjs` valida o corpus misto e constrói um preview `html-v1` temporário e descartável; `node scripts/build-site.mjs` monta o pacote de produção em `dist/`. Não declare publicação concluída sem verificar o deploy e a experiência no navegador. Não tente contornar os gates em prosa.
