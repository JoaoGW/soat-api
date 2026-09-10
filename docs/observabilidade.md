# Observabilidade

## Sinais e segurança

A API envia traces, métricas e logs OpenTelemetry diretamente ao New Relic por OTLP/HTTP. A chave `NEW_RELIC_LICENSE_KEY` permanece no Key Vault e nunca é versionada. Consultas PostgreSQL, URL completa e query string são substituídas por `[redacted]` antes da exportação. Corpos, CPF, documentos, tokens, senhas e cookies não são registrados.

Todo log JSON contém ambiente, serviço, versão, rota, status, duração, `X-Correlation-ID`, trace e span quando disponíveis.

## Métricas

- `soat.ordens_servico.criadas`, `soat.ordens_servico.transicoes` e `soat.ordens_servico.tempo_etapa`;
- `soat.http.requisicoes`, `soat.http.erros` e `soat.http.duracao`;
- `soat.ordens_servico.erros` e `soat.integracoes.erros`.

O tempo de etapa é emitido somente após confirmação da transação da OS. As etapas são diagnóstico, execução e finalização.

## Operação New Relic

Criar o dashboard `SOAT | Operação Fase 6` com volume diário de OS, médias por etapa, latência p95, erros, autenticação CPF, integração, recursos Kubernetes e disponibilidade. Criar monitores Ping de cinco minutos para `/health` da API em hml e da Function. Alertar por e-mail para indisponibilidade, p95 acima de 1s, erros, saturação de CPU/memória acima de 80% e réplicas abaixo do mínimo.

O plano deve permanecer New Relic Free, sem cartão. Para remover a integração, excluir os monitores e alertas no New Relic, executar o workflow protegido de observabilidade com destroy após as evidências e remover a chave do Key Vault.

## Variáveis e ativação

| Variável | Uso |
| --- | --- |
| `OBSERVABILITY_ENABLED` | Habilita a exportação somente com o valor `true`. Em desenvolvimento local, permanece desabilitada por padrão. |
| `NEW_RELIC_LICENSE_KEY` | Chave obtida exclusivamente pelo Key Vault; nunca deve ser incluída em `.env`, logs ou Git. |
| `OTEL_SERVICE_NAME` | Identifica o serviço; o padrão é `soat-api`. |
| `OTEL_SERVICE_VERSION` | SHA do commit implantado. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Endpoint OTLP/HTTP; o padrão é `https://otlp.nr-data.net:4318`. |

Antes de ativar, crie o segredo `new-relic-license-key` no Key Vault existente. O CSI monta a chave como variável da API; não há `Secret` Kubernetes ou credencial de nuvem versionados.

## Consultas NRQL do painel

Use o filtro `deployment.environment.name = '<ambiente>'` em cada widget e ajuste nomes de métricas conforme o sinal recebido.

```nrql
FROM Metric SELECT sum(soat.ordens_servico.criadas) TIMESERIES 1 day
FROM Metric SELECT average(soat.ordens_servico.tempo_etapa) FACET etapa
FROM Metric SELECT percentile(soat.http.duracao, 95), sum(soat.http.erros) TIMESERIES
FROM Metric SELECT sum(soat.integracoes.erros), sum(soat.ordens_servico.erros) TIMESERIES
FROM Metric SELECT sum(soat.auth.tentativas) FACET resultado TIMESERIES
```

Os widgets de CPU, memória, pods e eventos devem usar as entidades Kubernetes coletadas pelo chart `nr-k8s-otel-collector`. O painel só deve ser criado ou validado depois que foundation, AKS e a stack `observability` estiverem implantados com a trava de custo aprovada.
