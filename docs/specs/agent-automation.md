# Organização e automação para agentes

## Problema

O fluxo obrigatório falha em checkouts Windows com CRLF, o deploy empacota a raiz do repositório, a consulta da fila editorial exige reconstruir regras e o preparo/cache do TTS local exige trabalho manual. A revisão arquitetural de 02/10/2026 foi aprovada integralmente em 05/10/2026.

## Resultado e histórias

1. Como agente, quero um diagnóstico estruturado do ambiente e um mapa curto de comandos para iniciar tarefas sem carregar toda a documentação.
2. Como autor no Windows ou Linux, quero compor os mesmos briefs independentemente das quebras de linha.
3. Como mantenedor, quero validar o mesmo fluxo localmente e na CI, com a versão de Node declarada num único lugar.
4. Como publicador, quero um pacote contendo apenas os arquivos públicos necessários, preservando URLs relativas, artigos, assets e PWA.
5. Como agente editorial, quero consultar seleção vigente, elegíveis e impedimentos em JSON, sem publicar comentários.
6. Como automação, quero usar as mesmas regras de estado da fila e demonstrar que reexecuções não duplicam uma seleção pendente.
7. Como autor, quero preparar e diagnosticar o TTS local e reutilizar áudio somente quando corresponde ao conteúdo staged e à configuração de narração.

## Decisões de implementação

- Preservar o site estático, o layout, os artigos existentes e a separação entre generation/ e docs/.
- Aproveitar a extração local do contrato de artigos e a validação local da fila, preservando seu comportamento e acrescentando cobertura.
- Manter um comando único de validação; distinguir empacotamento público de precache.
- Consulta da fila não escreve no GitHub. Paginação e transporte ficam num adapter; decisões de fila permanecem testáveis com fixtures.
- Normalizar LF/CRLF na leitura dos briefs; declarar Node e compartilhar o valor entre workflows e ferramentas locais.
- Manter a política atual de TTS obrigatório no pre-commit. Preparação e diagnóstico são explícitos; a voz permanece local. Dependências pesadas não são instaladas durante a validação do site.
- Registrar validade de áudio por conteúdo narrado, voz, configuração e versão do gerador; rejeitar áudio inválido e metadata incompatível.
- Organizar navegação por tipo de trabalho, com pointers em AGENTS.md e documentação operacional sob demanda.

## Grafo de execução

- Portabilidade e preparação: independente.
- Empacotamento: independente; integra-se à CI após a validação.
- Estado editorial: independente.
- Narração local: independente.
- Integração/revisão: depende das quatro frentes.

## Validação e aceite

- Briefs LF e CRLF equivalentes; suite completa em Windows e Linux na CI.
- Pacote testado com fixtures: referências presentes, paths preservados, tooling excluído.
- Estado editorial: autores não autorizados, paginação, registry inválido, pending/empty, consulta sem POST e reexecução sem seleção duplicada.
- TTS: conteúdo staged, invalidação por texto/voz/configuração, WAV truncado e proteção dos arquivos locais, sem síntese real nos testes rápidos.
- Comando obrigatório de validação passa; revisão do diff confirma preservação dos artigos e mudanças locais anteriores.
- Estado remoto de CI/publicação é informado com precisão; alteração local não equivale a deploy concluído.

## Fora do escopo

Novos artigos, mudança visual, migração para framework de frontend, áudio publicado, troca de provedor TTS, curadoria gerada automaticamente sem revisão editorial e remoção da issue que mantém a fila.

## Estado

Implementação integrada em `agent/architecture-automation`, sobre `main` atualizada (61fdff7).

- Diagnóstico JSON e navegação operacional; Node/Python declarados e CI Windows/Linux.
- Briefs de artigo e capa equivalentes em LF/CRLF; regressões cobertas pelo compositor real.
- Pacote público `dist/` com 63 arquivos na integração; 7 testes de referências, exclusões e segurança. Ícones de instalação e favicons incluídos no precache, independentemente do conjunto público.
- Consulta paginada da fila verificada contra o GitHub em modo somente leitura; seleção pendente preservada.
- TTS preparado localmente, mantendo hook obrigatório; 19 testes rápidos sem síntese. Proteção de hooks herdados corrigida na revisão.
- Validação completa passou após integrar os 16 artigos atuais e 52 diagramas; o reparo de URLs do CQRS já estava na main e foi preservado integralmente.
- Revisões independentes de Standards e Spec identificaram dois ajustes, ambos corrigidos e testados.

A síntese real continua dependendo da escolha de uma amostra WAV local: o diagnóstico encontrou bibliotecas disponíveis e hook ativo, mas nenhuma voz configurada. Qualidade da voz e revisão editorial/visual não são substituídas pelos testes. O status de CI remoto e publicação deve ser verificado no PR/deploy; validação local não publica alterações.
