# Framework: backend

Considere somente dimensões relevantes ao tema e explicite quando uma delas não se aplica.

- Qual é o contrato da API e como compatibilidade é preservada?
- Onde validação, autorização, idempotência e deduplicação ocorrem?
- Que estado pertence a request, processo, cache, fila ou banco?
- Como concorrência, timeout, retry, backpressure e cancelamento interagem?
- Que limites protegem dependências e isolam recursos compartilhados?
- Como erros são classificados, expostos e correlacionados entre serviços?
- Como rollout, rollback, migração e configuração são executados com segurança?
- Quais custos de latência, throughput e operação orientam a escolha?
