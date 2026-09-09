# RFC-002 - Escolha do banco de dados gerenciado

- **Status:** Aceito com restrição de custo
- **Data:** 2026-09-09
- **Decisores:** equipe do projeto

## Contexto

O domínio já utiliza PostgreSQL com Prisma. A Fase 3 pede banco gerenciado e
justificativa formal do modelo relacional. O banco deve suportar integridade
referencial entre cliente, veículo, ordem de serviço, itens, serviços, peças e
o histórico de status, além de acesso seguro a partir do Kubernetes.

## Critérios

- Compatibilidade com PostgreSQL e Prisma, reduzindo risco de migração;
- transações e chaves estrangeiras para preservar as regras de negócio;
- TLS, backup e acesso privado;
- administração separada do cluster Kubernetes;
- possibilidade de operar no crédito disponível, sem Paga Pelo Uso.

## Alternativas avaliadas

| Alternativa | Avaliação |
|---|---|
| Azure Database for PostgreSQL - Flexible Server | Mantém compatibilidade, oferece backups, TLS e rede privada; separa o ciclo de vida do banco do AKS. |
| PostgreSQL em Pod/PVC no AKS | Útil somente para desenvolvimento local; aumenta responsabilidade operacional e não atende à exigência de banco gerenciado. |
| Azure SQL / MySQL | São bancos gerenciados válidos, mas exigiriam mudança de dialeto, migração e validação adicional no Prisma. |

## Decisão

Usar **Azure Database for PostgreSQL - Flexible Server** como banco gerenciado
alvo. A configuração planejada exige TLS, backup, acesso por rede privada e
bancos/usuários lógicos separados por ambiente. A alta disponibilidade será
habilitada somente se o SKU, a região e o crédito remanescente a permitirem;
ela não será ativada implicitamente.

## Consequências

- O banco deixa de ser um Deployment no AKS nos ambientes cloud;
- credenciais serão entregues via Key Vault e workload identity, nunca em
  manifesto Git ou variável fixa de pipeline;
- migrations Prisma serão executadas por etapa controlada do deploy;
- o Terraform do banco viverá em repositório próprio e terá state isolado;
- se o custo estimado não couber no crédito, o provisionamento será interrompido
  antes do `apply`; não haverá conversão automática da assinatura.
