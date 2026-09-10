# Decisões de arquitetura - Fases 3 a 6

Este diretório preserva a trilha de decisão arquitetural da Fase 3 do Tech
Challenge. Ele separa dois artefatos com finalidades distintas:

- **RFC (Request for Comments):** registra contexto, alternativas e critérios
  que foram avaliados antes da escolha técnica;
- **ADR (Architecture Decision Record):** registra uma decisão que passa a
  orientar a implementação e suas consequências.

Os documentos descrevem a arquitetura-alvo. A existência de uma decisão não
significa que o recurso correspondente já esteja provisionado na nuvem.

## Mapa de responsabilidades dos repositórios

```mermaid
flowchart LR
    API[soat-api\nAPI NestJS, JWT de cliente e deploy Kustomize]
    AUTH[soat-auth-function\nAutenticação CPF e JWT de cliente]
    AKS[soat-aks-infra\nAKS, VNet, Kong, CSI e Key Vault]
    PG[soat-postgres-infra\nPostgreSQL gerenciado e rede privada]
    OBS[New Relic Free\nOTel e métricas Kubernetes]

    AUTH --> API
    API --> PG
    AKS --> API
    AKS --> AUTH
    AKS --> PG
    AKS --> OBS
```

## Topologia implementada até a Fase 6

```mermaid
flowchart TB
    CLIENTE[Cliente autenticado\nJWT CPF]
    GH[GitHub Actions\nOIDC sem client secret]
    AKS[AKS compartilhado\nAzure RBAC + Workload Identity]
    KONG[Kong público\nnamespace kong]
    FUNCTION[Function CPF\nPOST /auth/cpf]
    HML[Namespace hml\nAPI 1 réplica]
    PROD[Namespace prod\nAPI 2+ réplicas, interno]
    OBS[Namespace observability\nnr-k8s-otel-collector]
    NR[New Relic Free\ntraces, métricas e logs]
    KV[Azure Key Vault\nRBAC]
    PGHML[PostgreSQL hml\nprivado + TLS]
    PGPROD[PostgreSQL prod\nprivado + TLS]

    CLIENTE --> KONG
    KONG -->|POST /auth/cpf, exato| FUNCTION
    KONG -->|demais rotas hml| HML
    FUNCTION --> CLIENTE
    GH -->|imagem GHCR por SHA| AKS
    GH --> PGHML
    GH --> PGPROD
    KONG --> AKS
    AKS --> HML
    AKS --> PROD
    AKS --> OBS
    HML -->|CSI + Workload Identity| KV
    PROD -->|CSI + Workload Identity| KV
    HML --> PGHML
    PROD --> PGPROD
    HML -->|OTLP/HTTP| NR
    FUNCTION -->|OTLP/HTTP| NR
    OBS -->|métricas Kubernetes| NR
```

O Terraform mantém `apply` bloqueado por trava de custo até a conferência de
crédito, SKU e quota. A Function, o gateway de autenticação, o Deployment da
API, HPA e PDB estão descritos nos repositórios correspondentes, mas não serão
aplicados enquanto a trava estiver desligada. A observabilidade ativa pertence
à Fase 6 e também permanece sem apply enquanto a trava estiver desligada.

A observabilidade da Fase 6 usa OpenTelemetry e New Relic Free. O coletor
`nr-k8s-otel-collector` cobre nós, CPU, memória, pods, eventos e
`kube-state-metrics`; API e Function enviam traces, logs e métricas de negócio
por OTLP/HTTP. A coleta de logs de containers permanece desabilitada para
evitar duplicidade. Não são usados Prometheus, Grafana, Azure Monitor ou
mudanças no `soat-postgres-infra` nesta fase.

## RFCs

| RFC | Tema | Situação |
|---|---|---|
| [RFC-001](rfcs/RFC-001-plataforma-cloud.md) | Plataforma cloud | Aceito |
| [RFC-002](rfcs/RFC-002-banco-gerenciado.md) | Banco de dados gerenciado | Aceito com restrição de custo |
| [RFC-003](rfcs/RFC-003-autenticacao-cpf.md) | Autenticação de cliente por CPF | Aceito |

## ADRs

| ADR | Decisão | Situação |
|---|---|---|
| [ADR-001](adrs/ADR-001-azure-e-terraform.md) | Azure, grupos de recursos e Terraform | Aceito |
| [ADR-002](adrs/ADR-002-kong-api-gateway.md) | Kong como API Gateway | Aceito |
| [ADR-003](adrs/ADR-003-postgresql-gerenciado.md) | PostgreSQL gerenciado e modelo relacional | Aceito com restrição de custo |
| [ADR-004](adrs/ADR-004-jwt-por-cpf.md) | JWT de cliente emitido por Function | Aceito |
| [ADR-005](adrs/ADR-005-historico-status-os.md) | Histórico append-only de status da OS | Aceito |
| [ADR-006](adrs/ADR-006-isolamento-de-ambientes.md) | Isolamento de homologação e produção | Aceito |
| [ADR-007](adrs/ADR-007-hpa-e-disponibilidade.md) | HPA e disponibilidade da API | Aceito |

## Premissas de custo e segurança

A assinatura utilizada é uma Azure Free Account com crédito promocional. Não é
permitido convertê-la para Paga Pelo Uso nem assumir cobrança no cartão. Antes
de criar recursos de computação, banco ou observabilidade, o `terraform plan`
e a página de preços devem ser revisados para confirmar que o recurso cabe no
crédito remanescente. A destruição dos recursos temporários após a coleta das
evidências faz parte do plano de entrega.
