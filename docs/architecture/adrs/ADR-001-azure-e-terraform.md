# ADR-001 - Usar Azure e Terraform com estado remoto privado

- **Status:** Aceito
- **Data:** 2026-09-09

## Contexto

A solução precisa de infraestrutura cloud reproduzível, com separação entre
plataforma, dados e autenticação.

## Decisão

Usar Azure como cloud-alvo e Terraform como única fonte de verdade da
infraestrutura cloud. Os recursos serão separados nos grupos
`rg-soat-platform`, `rg-soat-data` e `rg-soat-auth`. O estado remoto ficará em
Storage Account privada, em containers separados para API, AKS, banco e
Function. GitHub Actions acessará Azure via OIDC e identidade federada.

## Consequências

- Não serão armazenadas chaves de Azure de longa duração no GitHub;
- cada repositório de infraestrutura terá backend de state próprio;
- a criação de recursos com custo dependerá de revisão prévia do plano e do
  crédito, sem Paga Pelo Uso.
