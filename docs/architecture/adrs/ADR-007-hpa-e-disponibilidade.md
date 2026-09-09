# ADR-007 - Escalar a API com HPA e proteger disponibilidade

- **Status:** Aceito
- **Data:** 2026-09-09

## Contexto

A aplicação executará em Kubernetes e deve demonstrar escalabilidade,
disponibilidade e monitoramento de CPU e memória.

## Decisão

Configurar a API com ao menos duas réplicas no ambiente de produção, requests e
limits explícitos, `readinessProbe`, `livenessProbe`, PodDisruptionBudget e HPA
baseado em CPU e memória. O monitoramento de Kubernetes será feito por uma
integração própria de Kubernetes (New Relic ou Prometheus com exporters), além
da instrumentação OpenTelemetry da API e da Function.

## Consequências

- HPA depende de métricas disponíveis no cluster;
- observabilidade precisa coletar CPU, memória e quantidade de pods, não apenas
  traces da aplicação;
- capacidade e número de nós devem ser revisados contra a cota e o crédito
  antes de criar o AKS.
