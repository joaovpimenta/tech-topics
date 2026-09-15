# Text-to-speech e conteúdo multilíngue

## Objetivo

Os artigos são escritos em português brasileiro, mas frequentemente contêm termos técnicos em inglês. O conteúdo deve carregar informação semântica suficiente para que o mecanismo de text-to-speech possa alternar pronúncia e voz quando necessário, sem depender de heurísticas frágeis no runtime.

## Regra principal

O idioma padrão do artigo é `pt-BR`.

Quando uma palavra ou expressão deve ser pronunciada em inglês, marque-a explicitamente com `lang="en-US"`.

Exemplos:

```html
<span lang="en-US">backoff</span>
<span lang="en-US">full jitter</span>
<span lang="en-US">retry budget</span>
<span lang="en-US">load shedding</span>
<span lang="en-US">leader election</span>
```

Em contexto:

```html
<p>
  Uma política de <span lang="en-US">retry budget</span> limita a quantidade
  de repetições aceitas durante um incidente.
</p>
```

## Quando marcar

Marque `lang="en-US"` quando:

- o termo ou expressão permanecer em inglês no texto;
- a pronúncia inglesa for a forma natural ou predominante no contexto técnico;
- uma pronúncia portuguesa provavelmente degradaria a compreensão.

A marcação deve ser semântica. Não mantenha uma lista fechada de palavras como única regra: novos termos técnicos podem aparecer a qualquer momento.

## Quando não marcar

Não marque automaticamente:

- palavras já incorporadas de forma natural ao português quando a pronúncia inglesa não trouxer benefício;
- nomes próprios cuja pronúncia não seja resolvida apenas pela troca de idioma;
- URLs;
- blocos de código;
- fórmulas;
- identificadores de programas ou APIs quando uma leitura literal seria pior do que o tratamento específico do léxico.

Evite envolver frases inteiras em `lang="en-US"` quando apenas um termo curto estiver em inglês.

## Siglas, abreviações e pronúncias especiais

Troca de idioma e pronúncia excepcional são problemas diferentes.

Use `lang` para mudança de idioma. Use o léxico do projeto para termos que precisam de uma forma de fala específica, como siglas, métricas ou nomes cuja pronúncia padrão dos sintetizadores seja inadequada.

O léxico global deve ficar em `content/tts-lexicon.json` quando existir. Exemplos de candidatos:

- `HTTP` → leitura letra a letra em português;
- `SRE` → leitura letra a letra em português;
- `p99` → “p noventa e nove”;
- nomes de tecnologias cuja pronúncia precise ser estabilizada entre navegadores.

Não adicione ao léxico palavras comuns que podem ser tratadas corretamente apenas com `lang="en-US"`.

## Código e conteúdo não narrativo

Por padrão, o TTS não deve narrar:

- `<pre>` e `<code>` como prosa contínua;
- índices de navegação;
- controles interativos;
- simuladores;
- conteúdo puramente decorativo.

Quando um trecho de código precisar ser explicado, faça essa explicação em prosa no artigo em vez de depender da leitura literal do código.

## Responsabilidade do autor do artigo

Quem gera ou edita o artigo deve inserir a marcação `lang` correta no próprio `bodyHtml`. Não dependa de detecção automática de idioma no navegador para corrigir o conteúdo depois.

Antes de publicar, revise expressões técnicas inglesas relevantes e confirme que as mudanças de idioma estão marcadas de maneira consistente.

## Runtime

O player de TTS deve, quando suportado:

1. herdar `pt-BR` como idioma padrão;
2. respeitar elementos descendentes com atributo `lang`;
3. criar segmentos de fala preservando fronteiras de idioma;
4. selecionar preferencialmente uma voz compatível com o idioma de cada segmento;
5. usar fallback apropriado quando não houver uma voz exata instalada;
6. preservar controles de pausar, continuar e parar;
7. evitar perder marcação semântica convertendo todo o artigo antecipadamente para um único `textContent`.

Esta seção define o comportamento esperado do runtime, mas alterações no player compartilhado devem ser feitas como tarefa técnica específica, não incidentalmente durante a criação de um artigo.
