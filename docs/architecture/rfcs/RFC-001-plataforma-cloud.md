# RFC-001 - Escolha da plataforma cloud

- **Status:** Aceito
- **Data:** 2026-09-09
- **Decisores:** equipe do projeto

## Contexto

A Fase 3 exige uma Function Serverless, API Gateway, banco gerenciado,
Kubernetes escalável, infraestrutura como código, CI/CD e observabilidade. A
equipe dispõe de uma Azure Free Account recém-criada, com crédito promocional,
e não autoriza migração para Paga Pelo Uso ou qualquer cobrança no cartão.

## Requisitos e critérios

- Atender aos componentes obrigatórios em uma única plataforma, quando
  possível;
- permitir provisionamento reproduzível com Terraform e deploy via GitHub
  Actions usando OIDC, sem segredo de longa duração;
- manter os dados na região Brazil South quando o serviço escolhido estiver
  disponível;
- permitir exclusão completa dos recursos temporários após a demonstração;
- não depender de conversão da assinatura para Paga Pelo Uso.

## Alternativas avaliadas

| Alternativa | Vantagens | Limitações para este projeto |
|---|---|---|
| Azure | Assinatura e crédito já disponíveis; AKS, Functions, PostgreSQL, Key Vault e identidade integram-se ao Terraform. | O crédito é finito; alguns SKUs ou recursos de alta disponibilidade podem não caber nele. |
| AWS | Ecossistema amplo e serviços maduros para EKS, Lambda e RDS. | Exigiria conta, orçamento e controle de cobrança independentes; amplia o escopo. |
| Execução apenas local | Sem custo de nuvem para desenvolvimento. | Não demonstra deploy cloud, Function gerenciada, banco gerenciado e CI/CD de nuvem exigidos. |

## Decisão

Adotar **Azure** como plataforma-alvo, com recursos separados por grupos de
recursos e provisionamento em Terraform. O acesso de CI/CD será feito por
identidade federada OIDC do GitHub Actions. O estado remoto do Terraform ficará
em Storage Account privada e não será versionado no Git.

Foram preparados os grupos `rg-soat-platform`, `rg-soat-data` e
`rg-soat-auth`, além do armazenamento privado de estados Terraform. Esta RFC
não autoriza provisionar AKS, PostgreSQL, Functions ou qualquer serviço que
possa consumir crédito sem uma nova conferência de SKU, região, estimativa e
crédito remanescente.

## Consequências

- A arquitetura e a documentação passam a usar serviços Azure;
- os pipelines precisam usar OIDC e não credenciais persistentes de Azure;
- o ambiente precisa ter orçamento e alertas de consumo configurados;
- a demonstração deve ser curta e os recursos temporários devem ser destruídos
  após a coleta de evidências;
- se um componente obrigatório não estiver disponível dentro do crédito, a
  equipe deve registrar a limitação e escolher um fallback antes do `apply`.
