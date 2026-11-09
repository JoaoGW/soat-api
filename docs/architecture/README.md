# Decisões de arquitetura - Fases 3 a 7

Este diretório preserva a trilha de decisão arquitetural da Fase 3 do Tech
Challenge. Ele separa dois artefatos com finalidades distintas:

- **RFC (Request for Comments):** registra contexto, alternativas e critérios
  que foram avaliados antes da escolha técnica;
- **ADR (Architecture Decision Record):** registra uma decisão que passa a
  orientar a implementação e suas consequências.

Os RFCs registram alternativas avaliadas; os ADRs registram decisões tomadas.
O estado operacional abaixo distingue explicitamente o que está comprovado em
homologação do que permanece interno em produção.

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

## Topologia operacional comprovada em homologação

```mermaid
flowchart TB
    CLIENTE[Cliente autenticado\nJWT CPF]
    GH[GitHub Actions\nOIDC sem client secret]
    AKS[AKS compartilhado\nAzure RBAC + Workload Identity]
    KONG[Kong público\nnamespace kong]
    FUNCTION[Function CPF\nPOST /auth/cpf]
    HML[Namespace hml\nAPI 1 réplica]
    PROD[Namespace prod\nplanejado, interno]
    OBS[Namespace observability\nnr-k8s-otel-collector]
    NR[New Relic Free\ntraces, métricas e logs]
    KV[Azure Key Vault\nRBAC]
    PGHML[PostgreSQL hml\nprivado + TLS]
    PGPROD[PostgreSQL prod\nplanejado, privado + TLS]

    CLIENTE --> KONG
    KONG -->|POST /auth/cpf, exato| FUNCTION
    KONG -->|demais rotas hml| HML
    FUNCTION --> CLIENTE
    GH -->|imagem GHCR por SHA| AKS
    GH --> PGHML
    GH -. promoção futura .-> PGPROD
    KONG --> AKS
    AKS --> HML
    AKS -. namespace interno .-> PROD
    AKS --> OBS
    HML -->|CSI + Workload Identity| KV
    PROD -. CSI + Workload Identity .-> KV
    HML --> PGHML
    PROD -.-> PGPROD
    HML -->|OTLP/HTTP| NR
    FUNCTION -->|OTLP/HTTP| NR
    OBS -->|métricas Kubernetes| NR
```

Em HML estão comprovados: Function de CPF, rota exata `/auth/cpf` no Kong,
API NestJS por imagem GHCR identificada pelo SHA do commit, PostgreSQL privado,
Key Vault, traces, logs, métricas, coletor Kubernetes, dashboard e monitores
de saúde. As travas de `apply` foram restauradas para desligadas após os
deploys controlados.

Produção tem namespace, banco e fluxo de promoção documentados como alvo, mas
não é tratada aqui como evidência operacional: não há Deployment da API nem
gateway público comprovados. HPA, PDB e ao menos duas réplicas serão aplicados
junto do Deployment produtivo; não são evidência operacional de HML.

A observabilidade da Fase 6 usa OpenTelemetry e New Relic Free. O coletor
`nr-k8s-otel-collector` cobre nós, CPU, memória, pods, eventos e
`kube-state-metrics`; API e Function enviam traces, logs e métricas de negócio
por OTLP/HTTP. A coleta de logs de containers permanece desabilitada para
evitar duplicidade. Não são usados Prometheus, Grafana, Azure Monitor ou
mudanças no `soat-postgres-infra` nesta fase.

O nó atual do AKS usa SKU `Standard_D2as_v6`, com autoscaling entre um e dois
nós. O cluster continua em tier Free, com Azure CNI Overlay, OIDC issuer,
Workload Identity e Azure RBAC.

## Sequências principais

### Autenticação CPF e consumo pelo cliente

```mermaid
sequenceDiagram
    participant C as Cliente
    participant K as Kong HML
    participant F as Function CPF
    participant DB as PostgreSQL HML
    participant A as soat-api

    C->>K: POST /auth/cpf (CPF)
    K->>F: encaminha rota exata e aplica rate limit
    F->>F: valida formato e dígitos verificadores
    F->>DB: consulta cliente ativo
    DB-->>F: cliente autorizado
    F-->>C: JWT cliente (sub=clienteId, role=cliente)
    C->>K: GET /cliente/ordens-servico/:id (Bearer JWT cliente)
    K->>A: encaminha para Service HML
    A->>DB: busca OS e compara clienteId com sub
    DB-->>A: OS do próprio cliente
    A-->>C: 200; OS de terceiro retorna 403
```

### Fluxo administrativo de ordem de serviço

```mermaid
sequenceDiagram
    participant A as Administrador
    participant API as soat-api
    participant DB as PostgreSQL
    participant H as HistoricoStatusOS

    A->>API: rota administrativa com JWT_ADMIN
    API->>DB: cria ou atualiza ordem e itens
    API->>H: registra transição de status na mesma transação
    DB-->>API: commit
    API-->>A: resposta administrativa ou relatório protegido
```

O JWT administrativo (`JWT_ADMIN`) e o JWT de cliente (`JWT_CLIENTE`) têm
segredos, issuer/audience e guards separados. O webhook assinado de e-mail é
um fluxo distinto e não representa autenticação de cliente.

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

## Modelo de dados

O [modelo ER e a justificativa formal do PostgreSQL](modelo-er-postgresql.md)
derivam diretamente de `prisma/schema.prisma`. A escolha do banco está ligada
ao [RFC-002](rfcs/RFC-002-banco-gerenciado.md) e à
[ADR-003](adrs/ADR-003-postgresql-gerenciado.md).

## Premissas de custo e segurança

A assinatura utilizada é uma Azure Free Account com crédito promocional. Não é
permitido convertê-la para Paga Pelo Uso nem assumir cobrança no cartão. Antes
de criar recursos de computação, banco ou observabilidade, o `terraform plan`
e a página de preços devem ser revisados para confirmar que o recurso cabe no
crédito remanescente. A destruição dos recursos temporários após a coleta das
evidências faz parte do plano de entrega.
