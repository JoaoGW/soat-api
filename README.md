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

## Variáveis

Configure as variáveis descritas em `.env.example`. Para testes locais, copie
`.env.test.example` para `.env.test`; esse arquivo local é ignorado pelo Git e
nunca deve conter uma URL ou segredo de produção.

## Entrega e arquitetura

- Swagger: `http://localhost:3000/docs` quando a aplicação está em execução;
- Collection: `docs/postman/oficina-api.postman_collection.json`;
- Testes: `docs/testes.md`;
- RFCs e ADRs: `docs/architecture/README.md`.
- Diagrama central dos quatro repositórios:
  `docs/architecture/README.md#mapa-de-responsabilidades-dos-repositórios`.

O deploy Azure, o gateway e a publicação de imagens serão implementados nas
próximas fases. Não há infraestrutura Kind, Kubernetes local ou CD neste
repositório.

## CI

O [workflow CI](https://github.com/JoaoGW/soat-api/actions/workflows/ci.yml)
valida Prisma, lint, build, testes unitários com cobertura e testes e2e contra
PostgreSQL em todo push ou pull request para `main` e `development`.
