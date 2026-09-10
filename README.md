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

- Swagger: `http://localhost:3000/docs` quando a aplicação está em execução;
- Collection: `docs/postman/oficina-api.postman_collection.json`;
- Testes: `docs/testes.md`;
- RFCs e ADRs: `docs/architecture/README.md`.
- Diagrama central dos quatro repositórios e deploy:
  `docs/architecture/README.md#mapa-de-responsabilidades-dos-repositórios`.
- Deploy imutável: `docs/deploy-api.md`.

Não há infraestrutura Kind ou Kubernetes local neste repositório. Em
homologação, somente o proxy Kong expõe a API; em produção o Service permanece
interno até que exista uma decisão posterior de domínio e gateway público.

## CI

O [workflow CI](https://github.com/JoaoGW/soat-api/actions/workflows/ci.yml)
valida Prisma, lint, build, testes unitários com cobertura e testes e2e contra
PostgreSQL em todo push ou pull request para `main` e `development`. Ele também
renderiza os manifests Kustomize e verifica Ingress, HPA, PDB e ausência de
tags `latest`.

O workflow de deploy publica somente `ghcr.io/joaogw/soat-api:<SHA_DO_COMMIT>`.
Os jobs de homologação e produção só executam se a variável protegida do
ambiente `TF_APPLY_ENABLED` estiver como `true`; por padrão, ela permanece
desligada para preservar o crédito Azure.
