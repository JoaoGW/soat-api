# Testes da soat-api

Este documento descreve como validar a API e qual comportamento cada suíte
cobre. Os testes e2e usam PostgreSQL real; a aplicação não usa um banco em
memória nos ambientes de execução ou integração.

## Pré-requisitos

- Node.js 20 ou superior e dependências instaladas com `npm ci`;
- Docker em execução para os testes e2e;
- uma cópia local de `.env.test.example` como `.env.test`, configurada para o
  PostgreSQL de teste na porta `5433`.

O banco de teste é isolado do banco de desenvolvimento. Nunca use uma URL de
produção em `.env.test`. A CI injeta as variáveis de teste e não versiona esse
arquivo local.

## Preparação do banco e2e

```bash
docker compose -f docker-compose.test.yml up -d
DATABASE_URL="postgresql://test_user:test_password@localhost:5433/oficina_test_db" npx prisma migrate deploy
```

Após os testes, encerre o container quando não for mais necessário:

```bash
docker compose -f docker-compose.test.yml down
```

## Comandos

| Objetivo | Comando |
|---|---|
| Validar estilo sem alterar arquivos | `npm run lint` |
| Corrigir estilo explicitamente | `npm run lint:fix` |
| Testes unitários e de casos de uso | `npm run test` |
| Cobertura de domínio e aplicação | `npm run test:cov` |
| Testes e2e contra PostgreSQL | `npm run test:e2e` |
| Validar schema Prisma | `npx prisma validate` |
| Aplicar migrations pendentes | `npx prisma migrate deploy` |

## Cobertura da suíte

- **Domínio e casos de uso:** validações de CPF/CNPJ, dinheiro, estoque,
  transições de status, orçamento e regras de cliente, veículo, peça e serviço.
- **Integração/e2e:** autenticação JWT administrativa, CRUDs, fluxo completo da
  OS, consulta pública, webhooks, paginação e relatório.
- **Persistência da Fase 3:** PostgreSQL real, chaves estrangeiras, rejeição de
  referências inexistentes, criação de `HistoricoStatusOS`, ausência de eventos
  duplicados quando o status não muda, bloqueio de alteração/exclusão do
  histórico, rollback transacional e cálculo do relatório por etapa.

## Critérios de aceite da Fase 1

1. A aplicação inicia conectada ao PostgreSQL configurado em `DATABASE_URL`.
2. Uma OS não pode apontar para cliente, veículo, peça ou serviço inexistente.
3. Toda criação de OS registra `RECEBIDA`; cada transição válida registra um
   único evento de histórico na mesma transação da persistência da OS.
4. O relatório administrativo exige JWT e preserva `mediaEmMinutos` e
   `totalOSConsideradas`, além de retornar as métricas de diagnóstico, execução
   e finalização.
5. `npm run lint` apenas reporta problemas; ele não reescreve código.
6. O histórico de status é append-only também no PostgreSQL: `UPDATE` e
   `DELETE` são bloqueados por trigger.

## Segurança da migration

A migration da Fase 3 é aditiva e não apaga nem corrige dados automaticamente.
Se existirem documentos duplicados, não normalizados (CPF de 11 dígitos ou
CNPJ de 14 dígitos, somente números), tipo incompatível ou referências órfãs,
o deploy deve ser interrompido para correção manual antes de aplicar as novas
restrições.
