# Fila editorial agendada

A [issue #21](https://github.com/joaovpimenta/tech-topics/issues/21) é a fonte de verdade para pautas candidatas e para a próxima pauta agendada. Não crie diretórios vazios de artigo: a issue mantém o histórico sem misturar rascunhos com conteúdo publicado. Só o proprietário do repositório pode cadastrar pautas na fila; comentários de terceiros não são considerados pela Action.

## Curadoria semanal

A tarefa agendada de domingo consulta `AGENTS.md`, `docs/EDITORIAL.md`, `node scripts/compose-article-brief.mjs --list` e os comentários da issue. Ela publica **um comentário com exatamente cinco pautas** novas, distintas entre si, dos artigos publicados e das pautas já listadas. Cada pauta tem `slug` em minúsculas com hífens, `title`, `angle` (recorte editorial), `task` válida no registry e `frameworks` (de um a três IDs válidos). A pesquisa profunda, a abertura, a capa e os diagramas pertencem à execução do artigo.

Formato do comentário de curadoria (texto introdutório opcional):

````text
<!-- tech-topics:candidates:v1 -->
```json
{"topics":[{"slug":"exemplo-de-pauta","title":"Exemplo de pauta","angle":"Mecanismo e fronteiras a explicar","task":"explain-concept","frameworks":["backend"]}, ... mais quatro]}
```
````

Não edite comentários anteriores. Se a semana não permitir cinco pautas novas e defensáveis, reporte o impedimento sem preencher a fila com sinônimos artificiais.

## Seleção e consumo

`Select next Tech Topics article` roda depois do sucesso do workflow de Pages ou quando o proprietário adiciona um novo lote de pautas. Ele lê todos os comentários paginados e os arquivos `content/articles/*.json` da `main`, ignora comentários de terceiros e escolhe aleatoriamente **uma** pauta cujo slug ainda não foi publicado nem selecionado. O resultado vira um comentário próprio com `<!-- tech-topics:selected:v1 -->` e JSON contendo `slug`, `title`, `angle`, `task`, `frameworks` e `sourceCommentId`.

Se a seleção mais recente ainda não virou artigo, a Action não a altera; uma falha de publicação permite tentar de novo. Se já virou artigo, a Action escolhe outra pauta. Se a fila acabou, a Action informa o estado no log sem inventar uma pauta. Os eventos são serializados pela concorrência da workflow; reexecuções e deploys que não adicionam artigos não avançam uma seleção pendente.

A tarefa agendada de artigo lê o comentário de seleção mais recente, confirma que o slug não está publicado e escreve **exatamente um** artigo para essa pauta, seguindo o restante de `AGENTS.md`. Uma seleção ausente, já publicada ou editorialmente inviável deve ser informada como impedimento; não troque de tema por conta própria. Depois da publicação, verifique o Pages e a seleção subsequente. O agendamento do artigo continua a cada dois dias e não depende de a tarefa semanal ter ocorrido naquele intervalo.

## Recuperação

Se a fila acabou e um lote novo foi adicionado, o próprio comentário dispara a Action. Se a seleção não ocorreu apesar de candidatos disponíveis, execute `Select next Tech Topics article` via `workflow_dispatch` e verifique o log. Se a seleção ativa for inadequada, faça a curadoria editorial explicitamente na issue antes de corrigir o estado; não altere comentários históricos silenciosamente.
