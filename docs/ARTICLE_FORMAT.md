# Formato técnico dos artigos

## Renderização

O site renderiza o campo `bodyHtml` dos artigos como HTML.

Scripts inseridos nesse campo não são executados. Portanto:

- use SVG, imagens e gráficos estáticos diretamente no conteúdo;
- utilize elementos nativos como `<details>` para interações simples;
- não insira `<script>`;
- não use handlers inline como `onclick`;
- não use URLs `javascript:`;
- não dependa de Mermaid, MathJax ou bibliotecas que não estejam instaladas;
- apresente simulações em estados ou etapas estáticas quando não houver suporte interativo;
- não anuncie interatividade sem testar seu funcionamento.

Se uma simulação exigir JavaScript adicional e o projeto não tiver suporte apropriado, registre a limitação. Não altere o carregador compartilhado apenas para acomodar um artigo sem instrução explícita.

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
  "image": "assets/<slug>-cover.jpg",
  "alt": "<descrição da capa>",
  "dek": "<subtítulo introdutório>",
  "excerpt": "<resumo curto para os cards>",
  "bodyHtml": "<artigo completo em HTML, incluindo visuais, referências e exercícios>"
}
```

Use a data real da execução. Não use rótulos permanentes como “hoje”.

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
- SVGs e gráficos devem ser legíveis em telas pequenas.
- Não dependa apenas de cor para transmitir significado.
- Quando um visual contiver informação essencial, forneça também uma explicação textual equivalente.
