# ADR 0002 — Separar build editorial, deploy e publicação de áudio

- **Estado:** Aceito (comportamento já existente na `main` após a PR #54)
- **Data:** 2026-10-22
- **Referências:** [handoff #56](https://github.com/joaovpimenta/tech-topics/issues/56), [PR #54](https://github.com/joaovpimenta/tech-topics/pull/54), [ADR 0001](0001-kokoro-dora-prosody-and-encoding.md)

## Contexto

O Tech Topics publica artigos JSON no GitHub Pages e seus MP3s em Releases
`tts-<slug>`. O rebuild de CSS/JS/site **não implica** que o texto editorial
ou o áudio tenham mudado. Sintetizar novamente após qualquer push desperdiça
CPU do GitHub Actions e poderia substituir áudio previamente aprovado.

Uma execução real de Bulkhead em `profile` ([run #39823281725](https://github.com/joaovpimenta/tech-topics/actions/runs/39823281725))
registrou 4 CPUs efetivas, média 99,6% e CPU p90 99,8%, RAM RSS
~960 MiB e 628 segundos de síntese para ~1563 segundos de áudio.
Não há evidência de CPU ociosa que justifique dois processos de 4 threads.

## Decisão

1. Continuar fazendo deploy do Pages para atualizações de site e artigos.
   O build lê os JSONs existentes; **não reescreve texto editorial**.
2. Selecionar novo tema automaticamente apenas quando um novo
   `content/articles/<slug>.json` for adicionado, e não após qualquer deploy.
   Eventos manuais autorizados continuam possíveis.
3. Acionar o workflow Kokoro automaticamente apenas para artigos adicionados.
   Antes de iniciar o job caro, consultar Release `tts-<slug>`; se já
   existir, **skip**. Revalidar a ausência no início do job para reduzir
   chances de execução concorrente.
4. `preview`, `compare` e `profile` são modos manuais de diagnóstico
   e não criam/substituem Release. `publish` cria Release quando ausente;
   só pode substituir um MP3 com autorização explícita
   `replace_existing=true`.
5. Manter **uma sessão Kokoro FP32 com quatro threads** como padrão.
   Qualquer teste 2×2 deve ser um experimento separado com mesmo artigo,
   qualidade equivalente e medição de tempo total + RSS; não considerar
   2×4 ou três workers por padrão.
6. Gerar comparações de bitrate a partir **do mesmo WAV normalizado**;
   uma comparação de codec não deve disparar uma nova inferência de voz.

## Consequências

- Alterações no player, CSS, HTML, docs ou workflows podem fazer deploy,
  mas não desperdiçam sintetização editorial.
- A publicação continua reprodutível e conservadora com Releases históricas.
- O perfil de CPU não comprova que 2×2 seria pior em todos os cenários,
  apenas não justifica mudar o default.
- Ainda é possível pedir uma regeneração manual quando o áudio precisar de
  novos capítulos, pronúncia ou preset — isso deve ser uma decisão explícita.

## Verificações

- `tools/tts/test_article_selection.py` confirma detecção de JSON novo.
- `tools/tts/test_cpu_profile.py` valida o resumo de CPU/memória.
- `.github/workflows/pages.yml`, `.github/workflows/select-next-topic.yml`
  e `.github/workflows/kokoro-audio.yml` concentram os gatilhos.
- Sem substituir `tts-bulkhead` para verificar build ou codecs.
