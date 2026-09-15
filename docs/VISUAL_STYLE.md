# Direção visual do Tech Topics

Este documento é a fonte de verdade para a geração de capas e ilustrações conceituais do Tech Topics.

Antes de gerar qualquer imagem para um artigo, leia este arquivo por completo. Regras permanentes de estilo visual devem ser alteradas aqui, e não duplicadas em prompts de tarefas agendadas.

## Global visual language

A identidade visual deve permanecer coerente entre artigos sem transformar todas as capas em variações da mesma composição.

### Parâmetros editáveis de estilo

Use esta seção para definir ou alterar a direção visual global do projeto.

- **Estilo base:** a definir.
- **Tratamento:** a definir.
- **Paleta predominante:** a definir.
- **Iluminação:** a definir.
- **Contraste:** a definir.
- **Textura e materiais:** a definir.
- **Profundidade / perspectiva:** a definir.
- **Densidade visual:** a definir.
- **Uso de pessoas:** a definir.
- **Preferência entre cenas físicas e abstrações:** a definir.

Enquanto esses parâmetros não forem definidos de forma mais específica, preserve a estética editorial já existente nas capas do projeto e priorize uma representação clara do conceito técnico do artigo.

### Princípios obrigatórios

- A imagem deve ter relação direta com o assunto do artigo.
- Prefira uma metáfora visual ou representação conceitual que ajude a compreender a ideia central.
- Evite imagens genéricas de tecnologia sem relação concreta com o tema.
- Não use texto legível dentro da imagem.
- Não use logos, marcas ou watermarks.
- Não reutilize capas anteriores.
- Não apresente números, fórmulas, gráficos ou diagramas técnicos exatos por geração de imagem.
- Não represente como medição real aquilo que for meramente ilustrativo.
- Preserve clareza visual em tamanhos reduzidos e em telas de celular.

Evite clichês visuais genéricos como código flutuando, circuitos aleatórios, cérebros digitais, hologramas ou interfaces futuristas quando eles não explicarem de forma direta o conceito tratado.

## Capas

Cada novo artigo deve ter uma capa original.

Requisitos:

- composição horizontal;
- relação direta com o conceito central do artigo;
- estética editorial coerente com o Tech Topics;
- sem texto legível;
- sem logos, marcas ou watermarks;
- sem reaproveitar capas anteriores;
- salvar uma versão otimizada para web em `assets/<slug>-cover.jpg`;
- o arquivo deve estar presente no commit que publica o artigo.

A capa deve funcionar como uma síntese visual do conceito, não como um diagrama técnico.

## Cover image prompt template

Use este template como base para o prompt de geração de capa. Preencha os campos específicos do artigo sem alterar as regras permanentes acima.

```text
Crie uma imagem editorial horizontal para um artigo técnico do Tech Topics sobre:

{{TOPIC}}

Conceito central a representar:
{{CORE_CONCEPT}}

Metáfora ou cena sugerida, quando útil:
{{VISUAL_METAPHOR}}

A imagem deve representar o conceito de forma visualmente clara, tecnicamente coerente e editorialmente consistente com o Tech Topics.

Direção visual global:
- siga os parâmetros definidos em "Global visual language" deste documento;
- use poucos elementos principais e uma composição legível em miniatura;
- mantenha relação direta entre a cena e o conceito técnico;
- evite decoração genérica de tecnologia.

Restrições obrigatórias:
- sem texto legível;
- sem logos;
- sem marcas;
- sem watermark;
- sem infográficos;
- sem diagramas técnicos exatos;
- sem números, eixos ou fórmulas que precisem ser precisos.
```

O gerador pode adaptar composição, objetos e metáfora ao assunto do artigo, mas não deve substituir ou ignorar a direção visual global definida neste arquivo.

## Ilustrações conceituais no corpo

Use geração de imagens quando uma cena, analogia ou representação conceitual ajudar a explicar algo que seria difícil de transmitir apenas por prosa.

Exemplos adequados:

- cenário de falha;
- metáfora física de contenção, fluxo, isolamento ou recuperação;
- comparação conceitual entre estados;
- cena explicativa sem exigência de precisão métrica.

Salve cada ilustração como arquivo local com nome único, por exemplo:

`assets/<slug>-cenario-de-falha.jpg`

Todas as imagens devem estar incluídas no commit. Não use caminhos temporários nem URLs que possam expirar.

## Diagramas, gráficos e fórmulas

Não use geração de imagens para elementos que exigem precisão.

Use SVG, HTML e CSS para:

- diagramas de arquitetura;
- diagramas de fluxo ou sequência;
- gráficos com eixos;
- visualizações quantitativas;
- fórmulas;
- estados e transições;
- comparações que dependam de valores exatos.

Todo gráfico deve identificar eixos, unidades e legendas. Informe se os dados são reais, calculados ou meramente ilustrativos. Nunca apresente dados inventados como medições reais.

## Acessibilidade e composição

- Use `<figure>` e `<figcaption>` quando apropriado.
- Forneça texto alternativo descritivo.
- Inclua descrição textual equivalente quando o visual contiver informação importante que não esteja presente no texto.
- Garanta contraste suficiente e compreensão sem depender apenas de cores.
- Imagens e SVGs no corpo devem ser responsivos e preservar proporção sem cortes que escondam informação.

## Falha de geração

Se a geração de imagens estiver indisponível:

- informe o impedimento;
- não declare que uma imagem foi gerada;
- não publique referências a arquivos inexistentes;
- não substitua a imagem por uma URL temporária ou externa apenas para concluir a tarefa.

## Como alterar o estilo no futuro

Para mudar a direção visual das próximas publicações, edite primeiro os parâmetros de `Global visual language` neste arquivo.

Não é necessário alterar o prompt da tarefa agendada para mudanças permanentes de estilo. O prompt específico de cada artigo deve acrescentar apenas o tema, o conceito central e, quando útil, uma metáfora visual própria daquele artigo.
