# soat-api

API NestJS do Sistema Integrado de Oficina. Este repositório concentra a
aplicação, migrations Prisma, testes automatizados, Dockerfile e a documentação
arquitetural central da Fase 3.

## Stack

- Node.js 20, TypeScript e NestJS;
- PostgreSQL e Prisma;
- JWT, Swagger, Jest e Docker.

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

Configure as variáveis descritas em `.env.example`. Para testes, use
`.env.test` e nunca a URL de um banco de produção.

## Entrega e arquitetura

- Swagger: `http://localhost:3000/docs` quando a aplicação está em execução;
- Collection: `docs/postman/oficina-api.postman_collection.json`;
- Testes: `docs/testes.md`;
- RFCs e ADRs: `docs/architecture/README.md`.

O deploy Azure, o gateway e a publicação de imagens serão implementados nas
próximas fases. Não há infraestrutura Kind, Kubernetes local ou CD neste
repositório.

## CI

O workflow valida Prisma, lint, build, testes unitários com cobertura e testes
e2e contra PostgreSQL em todo push ou pull request para `main` e `development`.
