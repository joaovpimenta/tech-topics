# Tech Topics

Este repositório mantém o site Tech Topics e seus artigos.

Para manutenção, workflows, fila ou ferramentas locais, comece com `node scripts/doctor.mjs --json` e consulte somente o ramo pertinente em [docs/agents/README.md](docs/agents/README.md). O vocabulário editorial está em [CONTEXT.md](CONTEXT.md).

Ao criar um artigo, não carregue toda a documentação no contexto por padrão. Use `node scripts/compose-article-brief.mjs --list` para ver as tasks, os frameworks e o catálogo compacto dos temas publicados. Leia artigos completos somente quando o catálogo indicar possível sobreposição. Depois de escolher um tema inédito, componha o brief mínimo com uma task e de um a três frameworks do registry. Esse brief é o contrato ativo de escrita e inclui apenas as lentes selecionadas.

Consulte os documentos detalhados somente na etapa em que forem necessários:

1. `docs/EDITORIAL.md` para escopo, pesquisa e revisão humana;
2. `node scripts/compose-cover-brief.mjs` antes de gerar ou revisar a capa; consulte `docs/VISUAL_STYLE.md` integralmente se houver dúvida ou alteração de estilo;
3. `docs/ARTICLE_FORMAT.md` ao investigar formato ou renderização;
4. `docs/TTS.md` para decisões de pronúncia e marcação multilíngue;
5. `docs/PUBLISHING.md` antes de concluir e publicar.

`generation/` contém instruções compactas para o modelo; `docs/` explica as políticas; scripts de lint e testes garantem invariantes objetivas. Não copie a mesma regra entre camadas. Quando uma regra objetiva mudar, altere primeiro sua validação e depois a documentação humana correspondente.

## Princípios

- Escreva os artigos em português brasileiro.
- Não substitua, remova nem edite artigos existentes durante a criação de um novo artigo, salvo instrução explícita.
- Evite temas já cobertos, inclusive equivalentes semânticos, sinônimos e variações superficiais.
- Preserve compatibilidade com GitHub Pages, o layout editorial e a identidade visual existentes.
- O conteúdo deve ser tecnicamente rigoroso, didático e fundamentado em fontes confiáveis.
- Antes de gerar capas ou ilustrações conceituais, use o brief visual extraído de `docs/VISUAL_STYLE.md` por `scripts/compose-cover-brief.mjs`.
- Toda capa e toda ilustração conceitual deve ser uma pintura em aquarela editorial visível, seguindo integralmente o style anchor de `docs/VISUAL_STYLE.md`. Essa é uma regra permanente: o formato do arquivo, filtros ou formas planas não transformam uma arte vetorial em aquarela.
- Use JPG raster para capas e ilustrações conceituais. Use blocos Mermaid para diagramas técnicos e gráficos estruturais. Reserve SVG para favicon e ícones compartilhados; não crie ou versione SVGs de diagramas.
- Inclua diagramas quando esclarecerem uma relação técnica. Se houver Mermaid, forneça legenda, descrição acessível e fallback; não acrescente diagramas apenas para satisfazer o lint.
- Siga as regras de acessibilidade, composição visual e text-to-speech documentadas.
- Não declare recursos, interações, imagens, simuladores ou arquivos que não existam de fato.
- Não altere o carregador compartilhado ou a arquitetura comum do site sem instrução explícita quando a tarefa for apenas criar um artigo.

## Áudio público e TTS — decisões e segurança

Para tarefas sobre Kokoro, comece em [docs/KOKORO_ACTIONS.md](docs/KOKORO_ACTIONS.md) e consulte somente o ADR correspondente: [0001 — prosódia e codecs](docs/adr/0001-kokoro-dora-prosody-and-encoding.md), [0002 — execução e skips](docs/adr/0002-kokoro-execution-cost-and-parallelism.md) ou [0003 — player e capítulos](docs/adr/0003-unified-article-audio-and-chapter-synchronization.md). Separe o áudio **publicado**, a síntese local privada de pré-commit e a Web Speech API do navegador.

- A narração pública mantém **somente `pf_dora`** e a fonemização PT-BR/EN-US. A decisão editorial é **Equilibrado 1.00** para futuras gerações; conferir a PR técnica #58 antes de presumir sua incorporação à `main`.
- A divisão acústica é **interna ao parágrafo**, com contagem dos tokens reais após G2P (alvo ~300, máximo 350; também proteger a string fonética contra repartição interna na biblioteca). Nunca transformar chunks técnicos em falsos capítulos.
- `trim=True` explícito, pausa de 25 ms nos cortes internos; **`continuous=False`**, a não ser que haja prova de duração no ONNX e teste de qualidade, conforme ADR 0001.
- O formato de novas gerações usa MP3 mono 24 kHz com `loudnorm` atual; a PR #58 já integrou **128 kbps** à `main`. Comparar codecs usando **o mesmo WAV**, sem invocar novamente Kokoro por bitrate.
- Não disparar `publish` para artigos com Release existente sem autorização explícita de substituição. Alterações no site não regeneram texto/áudio; PRs rodam testes rápidos, sem inferência pesada. `preview`, `review` e `compare` são executados manualmente e não publicam Releases.
- Cada job usa **uma instância Kokoro e quatro threads**, sem profiling ou amostragem de CPU/RSS. Não executar várias instâncias no mesmo runner.
- O código do player unificado (PR #53) está na `main`: clique, destaque e scroll por bloco dependem dos capítulos correspondentes; validar a experiência no navegador antes de declarar QA visual concluído.
- Nenhuma alteração deve ser mesclada sem autorização humana explícita. Validação automatizada não substitui **escuta auditiva** nem confirma integridade de Releases.

## Execução

- Liste tasks, frameworks e temas publicados com `node scripts/compose-article-brief.mjs --list`.
- Gere o brief em stdout e use somente os módulos selecionados; não concatene a pasta `generation/` inteira nem persista o brief no repositório.
- Se houver um assunto explícito para a execução, use-o apenas se ainda não tiver sido coberto conforme `docs/EDITORIAL.md`.
- Na tarefa agendada de publicação, consuma apenas a última seleção válida da [fila editorial](docs/TOPIC_QUEUE.md). Caso não haja uma seleção inédita, informe o impedimento sem escolher outra pauta. Na execução manual sem seleção, escolha um novo tema relevante dentro do escopo editorial.
- Trate o repositório como fonte de verdade para formato, build, validação e publicação.
- Antes de concluir, execute as verificações obrigatórias definidas em `docs/PUBLISHING.md`.
- Uma tarefa só está concluída quando as validações obrigatórias passaram e o estado da publicação foi verificado.


## Validação automatizada

A qualidade estrutural dos artigos é validada por `scripts/lint-articles.mjs` e pelos testes do projeto. A workflow `Validate Tech Topics` roda em Pull Requests; na `main`, o job de validação da workflow do GitHub Pages roda antes do deploy. Não considere um artigo pronto enquanto a validação não passar. Regras subjetivas, como rigor factual, qualidade da metáfora e aparência de aquarela, continuam exigindo revisão editorial ou visual humana.
