# Formato técnico dos artigos

## Renderização

O site renderiza o campo `bodyHtml` dos artigos como HTML.

Scripts inseridos nesse campo não são executados. Portanto:

- use a estrutura `<figure class="mermaid-figure">` com `data-mermaid="true"` para diagramas;
- mantenha o código-fonte dentro de `<pre class="mermaid-source">`;
- use Mermaid para fluxos, sequências, estados, relações, cronogramas e gráficos compatíveis;
- não crie nem versione SVG para diagramas técnicos;
- não insira `<script>` no `bodyHtml`;
- não use handlers inline como `onclick`;
- não use URLs `javascript:`;
- mantenha uma legenda e uma descrição acessível para cada visual;
- preserve um fallback que permita consultar o código Mermaid quando a biblioteca não estiver disponível.


Se uma simulação exigir JavaScript adicional e o projeto não tiver suporte apropriado, registre a limitação. Não altere o carregador compartilhado apenas para acomodar um artigo sem instrução explícita.

## Diagramas Mermaid

Diagramas técnicos devem ser escritos como Mermaid e renderizados pelo carregador compartilhado do artigo. O tema obrigatório é **Floresta semântica**, definido em `mermaid-theme.js`.

Estrutura mínima:

```html
<figure class="mermaid-figure">
  <div class="mermaid-diagram" data-mermaid="true" data-mermaid-label="Descrição acessível">
    <pre class="mermaid-source">flowchart LR
  A[Origem] --> B[Destino]</pre>
  </div>
  <figcaption>Explique o que o leitor deve observar.</figcaption>
  <details class="mermaid-fallback">
    <summary>Ver o código Mermaid</summary>
    <pre class="code-block">flowchart LR
  A[Origem] --> B[Destino]</pre>
  </details>
</figure>
```

Não coloque SVG inline ou caminhos `.svg` no corpo dos artigos. SVG continua reservado aos ícones e ao favicon compartilhados. O diagrama deve ter uma explicação textual equivalente quando carregar informação essencial, e a legenda deve dizer se os valores são reais, calculados ou ilustrativos.

## Tabelas e rolagem em telas pequenas

Tabelas largas devem ficar dentro de um contêiner próprio de rolagem horizontal, sem transferir essa rolagem para a página inteira:

```html
<div class="article-table-scroll" tabindex="0" role="region" aria-label="Tabela rolável horizontalmente">
  <table>...</table>
</div>
```

O mesmo princípio vale para blocos de código, fórmulas e diagramas Mermaid: o componente pode rolar quando necessário, mas `html`, `body`, `.article-shell` e `.article-body` não devem criar scroll horizontal. Garanta que o conteúdo seja navegável por teclado e que o contêiner tenha uma descrição acessível.

## Contrato do artigo

Crie um slug único, em letras minúsculas e separado por hífens. O nome do arquivo deve corresponder exatamente ao slug:

`content/articles/<slug>.json`

Use este contrato:

```json
{
  "slug": "<slug>",
  "language": "pt-BR",
  "title": "<título>",
  "category": "<categoria>",
  "date": "<data de publicação legível>",
  "publishedAt": "YYYY-MM-DD",
  "read": "<tempo estimado de leitura>",
  "image": "assets/<slug>/<slug>-cover.jpg",
  "alt": "<descrição da capa>",
  "dek": "<subtítulo introdutório>",
  "excerpt": "<resumo curto para os cards>",
  "bodyHtml": "<artigo completo em HTML, incluindo visuais, referências e exercícios>"
}
```

### Regra visual da capa

O campo `image` deve apontar sempre para `assets/<slug>/<slug>-cover.jpg`, uma pintura em aquarela editorial visível sobre papel texturizado, conforme `docs/VISUAL_STYLE.md`. A palavra “aquarela” no prompt ou a aplicação de um filtro não basta: capas com aparência vetorial flat, formas geométricas, 3D ou fotográfica devem ser rejeitadas.

Não use SVG, HTML ou CSS como capa. Esses formatos ficam reservados a diagramas, gráficos, fórmulas e outros visuais técnicos que precisam de precisão. Ilustrações conceituais inseridas no corpo do artigo seguem a mesma exigência de aquarela da capa; apenas visuais técnicos de precisão ficam fora dela.

Use a data real da execução. Não use rótulos permanentes como “hoje”.

### Primeiro parágrafo introdutório

O campo bodyHtml deve começar com exatamente um elemento <p> que funcione como diálogo-metáfora. Ele deve apresentar uma cena cotidiana e observável em pelo menos dois turnos de conversa, que podem ser representados por uma pergunta curta entre aspas seguida de uma resposta narrativa em prosa. A cena deve conectar o cotidiano ao conceito técnico e servir como fonte narrativa para a capa do artigo. Não use travessão para marcar falas. Use aspas com parcimônia: prefira um único bloco curto de fala e não coloque cada frase, nem a explicação inteira, entre aspas. A expressão “Sabe quando” é opcional. Preserve nomes técnicos consagrados em inglês quando necessário.

As classes compartilhadas disponíveis incluem `signal-grid`, `signal-card`, `article-callout`, `code-block` e `article-back`.

Não altere manualmente `content/articles/index.json`. Não insira o novo artigo como conteúdo fixo em `index.html`, `app.js` ou `article.html`.

## Idioma e marcação semântica

O idioma padrão dos artigos é `pt-BR`.

Termos ou expressões mantidos em inglês e destinados a ser pronunciados em inglês devem ser marcados semanticamente no HTML com `lang="en-US"`, seguindo `docs/TTS.md`.

Exemplo:

```html
<p>
  O cliente aplica <span lang="en-US">exponential backoff</span>
  com <span lang="en-US">full jitter</span> antes de tentar novamente.
</p>
```

Não use essa marcação de forma indiscriminada; ela deve indicar uma mudança real de idioma/pronúncia.

## Acessibilidade dos visuais

- Toda imagem relevante deve ter `alt` adequado.
- Use `<figure>` e `<figcaption>` quando houver legenda ou contexto interpretativo.
- Diagramas Mermaid e gráficos devem ser legíveis em telas pequenas, com rolagem horizontal controlada quando necessário.
- Tabelas largas, blocos de código, fórmulas e diagramas devem rolar dentro do próprio componente; a página e o corpo do artigo não podem ganhar scroll horizontal.
- Não dependa apenas de cor para transmitir significado.
- Quando um visual contiver informação essencial, forneça também uma explicação textual equivalente.
