# ADR 0006 — Barra de áudio contextual no artigo

- Data: 2026-10-23
- Status: proposta em Pull Request

## Contexto

A página de artigo exibiu até agora um botão grande “Ouvir artigo”, abrindo um player fixo junto à borda inferior. Em leitura no começo do artigo, a área do cabeçalho fica subutilizada e o dock aparece mesmo quando ainda há espaço para controles próximos ao título.

## Decisão

1. Substituir o botão grande por uma **barra de áudio embutida** no cabeçalho do artigo, com play/pause, tempo decorrido, barra de progresso, duração e velocidade (quando houver largura). A barra já aparece antes da reprodução, sem forçar autoplay.
2. Preservar **um único elemento `<audio>`, um único estado de reprodução e os capítulos existentes** em `audio.js`. Barra embutida e dock flutuante são duas interfaces de controle da mesma sessão, e não players independentes.
3. Observar a visibilidade do contêiner da barra por `IntersectionObserver`. Enquanto o usuário vê a barra, manter o dock oculto. Depois de iniciar a sessão, ao sair da região da barra, mostrar o **dock inferior atual**. Ao voltar, ocultá-lo. O dock permanece acessível quando a reprodução está pausada e sua sessão ainda não foi encerrada.
4. A mesma regra deve funcionar para MP3 e para voz do dispositivo. Preservar atalhos, velocidade, capítulos, Media Session, destaque e integridade do áudio; não gerar nem substituir arquivos MP3.
5. Colocar botões minimalistas de favorito e compartilhar ao lado da barra. Compartilhar continua usando a Web Share API com fallback de cópia de link; o favorito usa a **mesma chave `tech-topics:favorites:v1`** da página inicial. Não criar backend, contador público nem filtro adicional.
6. Preservar uso acessível por teclado, estados `aria-pressed`, foco, nomes dos controles e preferência por movimento reduzido. O layout compacto deve adaptar a barra e seus botões a celulares.

## Verificações

- Iniciar áudio na barra sem exibir o dock enquanto ela está visível.
- Ao descer, mostrar o dock na parte inferior **sem reiniciar áudio, trocar a fonte, perder tempo ou alterar velocidade**.
- Ao voltar à barra, ocultar o dock; ao fechar a sessão, manter ambos inativos.
- Permitir play/pause, busca e troca de velocidade no ponto em que o usuário está.
- Confirmar favorito persistido no mesmo navegador e compartilhamento nativo/cópia do link.
- Validar modo de voz do dispositivo, capítulos, scroll, modo mobile e ausência de autoplay.
- A referência visual final da barra pode orientar ajustes de espaçamento e ícones sem mudar este contrato funcional.

## Revisão de interface — 2026-10-23

- A top bar de artigo e home têm a mesma hierarquia (Tech Topics, pesquisa e GitHub com estrelas). A pesquisa dentro do artigo encaminha para `index.html?q=...`, onde é resolvida pelo catálogo leve. O carregamento das estrelas fica em `header.js`, compartilhado e com cache local.
- A barra de áudio embutida deve ser branca, sem caixa verde/borda de contêiner. O botão play/pause circular usa o verde do site; velocidade permanece visível **inclusive em telas estreitas**. Os controles de trecho anterior/próximo aparecem quando houver capítulos; dock flutuante e barra compartilham a mesma sessão.
