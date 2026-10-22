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

Antes de selecionar, a Action confere `task` e cada ID de `frameworks` contra `generation/registry.json`. Candidatas com IDs desconhecidos são ignoradas e identificadas no log. Uma seleção pendente com IDs inválidos é tratada como impedimento e não é substituída automaticamente.

Se a seleção mais recente ainda não virou artigo, a Action não a altera; uma falha de publicação permite tentar de novo. Se já virou artigo, a Action escolhe outra pauta. Se a fila acabou, a Action informa o estado no log sem inventar uma pauta. Os eventos são serializados pela concorrência da workflow; reexecuções e deploys que não adicionam artigos não avançam uma seleção pendente.

A tarefa agendada de artigo lê o comentário de seleção mais recente, confirma que o slug não está publicado e escreve **exatamente um** artigo para essa pauta, seguindo o restante de `AGENTS.md`. Uma seleção ausente, já publicada ou editorialmente inviável deve ser informada como impedimento; não troque de tema por conta própria. Depois da publicação, verifique o Pages e a seleção subsequente. O agendamento do artigo continua a cada dois dias e não depende de a tarefa semanal ter ocorrido naquele intervalo.

## Consulta para agentes

Consulte o estado com `node scripts/select-next-topic.mjs --dry-run --json`. O comando lê todos os comentários paginados da issue #21 e os artigos locais, usa as mesmas regras da seleção automática e nunca publica comentários. Em uma consulta à fila publicada, use um checkout atualizado da `main`. O repositório público pode ser consultado sem token; `GITHUB_TOKEN` é opcional para limites de leitura autenticada. `GITHUB_REPOSITORY` e `TOPIC_QUEUE_ISSUE_NUMBER` permitem configurar outra fila explicitamente.

O JSON informa `status`, `selection` (última seleção válida em formato, inclusive quando bloqueada por registry), `eligible`, `invalidCandidates`, `problems` e `ignoredComments`. Os estados são `ready` (há candidatas), `pending` (seleção ainda não publicada), `empty` (fila esgotada) e `blocked` (contrato inválido; saída 1). A consulta não escolhe uma nova pauta. O comando sem `--dry-run` exige token, reconsulta a fila antes de escrever e retorna `selected` quando publica uma seleção. A concorrência da workflow continua necessária para serializar escritores: a API de comentários não oferece uma escrita condicional atômica.

Para diagnóstico offline, use `node scripts/select-next-topic.mjs --dry-run --json --fixture caminho.json`. A fixture contém `comments` (objetos de comentário do GitHub, com `id`, `body` e `user.login`), `published` (array de slugs), `repository` opcional e `registry` opcional com arrays `tasks` e `frameworks` de IDs. Sem registry explícito, o comando carrega o registry real do repositório. Fixtures exigem `--dry-run` e não acessam a API. Comentários de terceiros são ignorados; `github-actions[bot]` pode registrar seleção, mas não cadastrar candidatas.

O resumo da Action registra estado, seleção e contagens de candidatas e comentários ignorados. Falhas de transporte registram somente o status HTTP, sem corpo de resposta nem credenciais. O JSON detalha os IDs inválidos para corrigir a curadoria.

## Recuperação operacional

Se a fila acabou e um lote novo foi adicionado, o próprio comentário dispara a Action. Se a seleção não ocorreu apesar de candidatos disponíveis, execute `Select next Tech Topics article` via `workflow_dispatch` e verifique o log. Se a seleção ativa for inadequada, faça a curadoria editorial explicitamente na issue antes de corrigir o estado; não altere comentários históricos silenciosamente.
