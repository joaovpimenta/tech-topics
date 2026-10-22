# Tracker de manutenção

Use GitHub Issues em `joaovpimenta/tech-topics`, via `gh` quando disponível. Descubra estado e comentários antes de implementar ou fechar uma issue. Issues fechadas são histórico, não backlog de execução.

`Fila editorial: pautas candidatas e próxima publicação` é estado operacional persistente; não é uma tarefa de implementação a ser encerrada. Seu protocolo está em [TOPIC_QUEUE.md](../TOPIC_QUEUE.md).

Para trabalhos de áudio extensos, crie uma issue **handoff** com decisões já aprovadas, links dos runs/artefatos, PRs abertas/mescladas, ADRs, riscos e checklist do que falta.

Handoff corrente da trilha de áudio Kokoro/player: [issue #61](https://github.com/joaovpimenta/tech-topics/issues/61). Consulte a issue e os ADRs antes de novos trabalhos; as PRs #53, #58 e #60 foram integradas à `main`. Atualize o checklist conforme o estado real dos testes e dos merges. Nunca declare concluído um teste auditivo sem escuta humana registrada; cite resultados mensuráveis separadamente. Antes de mesclar, confirme checks e autorização explícita, mesmo quando a issue contém uma decisão técnica.

Specs locais ficam em `docs/specs/`. Ao executar uma spec, registre resultado verificável, testes e limitações. Quando uma issue corresponder ao trabalho, vincule a spec e a mudança; feche somente quando seus critérios estiverem atendidos.

Em operações de escrita com `gh`, use `--body-file` para texto multiline. Não publique comentários ou dispare seleção real para testar código: use fixtures e consulta da fila.
