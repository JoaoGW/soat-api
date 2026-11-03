# soat-api

API NestJS do Sistema Integrado de Oficina. Este repositório concentra a
aplicação, migrations Prisma, testes automatizados, Dockerfile, manifests de
deploy e a documentação arquitetural central.

## Stack

- Node.js 20, TypeScript e NestJS;
- PostgreSQL e Prisma;
- JWT administrativo e JWT de cliente, Swagger, Jest e Docker;
- Kustomize, AKS, Kong, Key Vault e Workload Identity para o deploy Azure.

## Execução e validação local

```bash
npm ci
npx prisma generate
npm run build
npm run lint
npm run test:cov
docker compose -f docker-compose.test.yml up -d
npm run test:e2e
docker compose -f docker-compose.test.yml down
```

## Variáveis

Configure as variáveis descritas em `.env.example`. Para testes locais, copie
`.env.test.example` para `.env.test`; esse arquivo local é ignorado pelo Git e
nunca deve conter uma URL ou segredo de produção.

`JWT_SECRET` é exclusivo do login administrativo. `JWT_CLIENT_SECRET`,
`JWT_CLIENT_ISSUER=soat-auth-function` e `JWT_CLIENT_AUDIENCE=soat-api` são
exclusivos dos tokens emitidos pela Function de autenticação CPF. Os dois
fluxos não compartilham segredo nem guard.

## Entrega e arquitetura

- Swagger: `http://localhost:3000/docs` local e
  `http://20.226.244.207/docs` em HML;
- Collection: `docs/postman/oficina-api.postman_collection.json`;
- Testes: `docs/testes.md`;
- RFCs e ADRs: `docs/architecture/README.md`.
- Modelo ER e decisão de banco:
  `docs/architecture/modelo-er-postgresql.md`;
- Diagrama central dos quatro repositórios e deploy:
  `docs/architecture/README.md#mapa-de-responsabilidades-dos-repositórios`.
- Deploy imutável: `docs/deploy-api.md`.

Não há infraestrutura Kind ou Kubernetes local neste repositório. Em HML, a
API está implantada no AKS e somente o proxy Kong a expõe; a Function de CPF
atende `POST /auth/cpf`. A consulta pública por código de acompanhamento foi
substituída por `GET /cliente/ordens-servico/:id` e pelas ações autenticadas de
aprovar/recusar orçamento. Em produção, o Service permanece interno, sem URL
pública, até decisão posterior de domínio e gateway.

Use `JWT_ADMIN` nas rotas administrativas e `JWT_CLIENTE` apenas nas rotas de
cliente. A coleção mantém esses tokens separados nas variáveis `token` e
`clienteToken`; não inclua valores reais no arquivo.

## CI

O [workflow CI](https://github.com/JoaoGW/soat-api/actions/workflows/ci.yml)
valida Prisma, lint, build, testes unitários com cobertura e testes e2e contra
PostgreSQL em todo push ou pull request para `main` e `development`. Ele também
renderiza os manifests Kustomize e verifica Ingress, HPA, PDB e ausência de
tags `latest`.

O workflow de deploy publica somente `ghcr.io/joaogw/soat-api:<SHA_DO_COMMIT>`.
O deploy HML foi validado usando referência imutável por SHA. Os jobs de
homologação e produção só executam se a variável protegida do ambiente
`TF_APPLY_ENABLED` estiver como `true`; após a validação, ela foi restaurada
para `false` para preservar o crédito Azure.

## Integração local do diagnóstico com Billing

`npm run test:diagnosis-billing` aplica a conclusão de diagnóstico no OS e
entrega o comando gerado diretamente ao caso de uso de Billing; verifica preço,
total e idempotência em dois bancos PostgreSQL distintos. É necessário executar
builds de ambos os repositórios e migrations dos dois bancos, informar URLs de
bancos locais terminados em `_test` em `OS_TEST_DATABASE_URL` e
`BILLING_TEST_DATABASE_URL`, além do caminho absoluto do repositório Billing em
`BILLING_REPO_DIR`. O teste falha sem essas configurações. Ele não exercita o
broker, Cosmos, a Saga completa ou o Mercado Pago.

A mensageria da Fase 4 usa assinatura Ed25519 do JSON canônico (chaves de
objetos ordenadas, UTF-8, prefixo `soat-message-v1` e assinatura em base64 na
propriedade AMQP `signature`). Cada serviço possui uma chave privada própria;
os consumidores recebem somente as chaves públicas dos produtores. O OS usa
`OS_MESSAGE_PRIVATE_KEY`, `BILLING_MESSAGE_PUBLIC_KEY` e
`EXECUTION_MESSAGE_PUBLIC_KEY`. Os workers falham ao iniciar sem as chaves e
estão desativados por padrão. Não usar as mesmas chaves entre produtores.
Distribuir segredos por Key Vault e validar configuração/rotação antes de
habilitar o tráfego. A rota administrativa separada
`POST /fase4/ordens-servico` requer `ENABLE_FASE4_OPEN=true`,
`SAGA_DATABASE_URL`, JWT administrativo e `Idempotency-Key`. A outbox usa
`ENABLE_SAGA_COMMAND_PUBLISHER=true`, filas distintas para Billing e Execution
em `SERVICE_BUS_BILLING_QUEUE` e `SERVICE_BUS_EXECUTION_QUEUE`, identidade de
workload e a chave privada do OS. O fluxo permanece incompleto e não deve ser
ativado antes das transições e testes distribuídos.
