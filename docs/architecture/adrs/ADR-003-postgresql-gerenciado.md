# ADR-003 - Usar PostgreSQL gerenciado e modelo relacional com integridade

- **Status:** Aceito com restrição de custo
- **Data:** 2026-09-09

## Contexto

O domínio requer consistência transacional entre OS, itens, estoque e mudanças
de status. O banco local em container não atende ao requisito de banco
gerenciado em cloud.

## Decisão

Usar Azure Database for PostgreSQL - Flexible Server. O modelo manterá chaves
estrangeiras entre cliente, veículo, OS, peças, serviços e itens da OS; CPF
normalizado terá unicidade; serão criados índices para CPF, código de
acompanhamento, cliente da OS e status. A tabela `HistoricoStatusOS` será
append-only e persistirá cada transição na mesma transação da OS.

## Consequências

- Consultas de relatório poderão calcular duração por etapa a partir do
  histórico, sem sobrescrever eventos passados;
- as regras de integridade não dependerão somente da API;
- TLS, backup e rede privada serão configurados no Terraform;
- a ativação de alta disponibilidade depende de confirmação explícita de custo
  e disponibilidade no crédito.
