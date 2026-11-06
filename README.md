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

A Saga processa emissão e decisão do orçamento, gera reserva a partir das peças
no snapshot e prepara cobrança após confirmação da reserva. A cobrança exige
`MERCADO_PAGO_EXTERNAL_POS_ID`; sem ele, a confirmação da reserva fica na
inbox até nova avaliação. A recusa antes de pagamento envia cancelamento para
Execution e conclui após confirmação de que o trabalho não começou. Existe
acionamento administrativo de compensação em
`POST /fase4/ordens-servico/:sagaId/compensar`, protegido por JWT e desativado
até `ENABLE_FASE4_COMPENSATION=true`. Se há pagamento confirmado, a Saga aguarda
cancelamento, reembolso e liberação das peças; situações financeiras incertas
vão para reconciliação. A implementação ainda requer tratamento das demais
falhas e validação distribuída com broker e provedor antes da ativação.

`npm run test:broker-diagnosis-billing` é um teste parcial que entrega o
comando assinado de orçamento pelo emulador Service Bus e verifica reentrega e
idempotência em Billing. Exige builds e bancos locais de teste como acima,
`SERVICE_BUS_TEST_CONNECTION_STRING` do emulador local e a fila
`bdd.billing.commands`. Os arquivos de configuração estão em `test/broker`.
O compose exige que o operador leia e aceite os termos de licença do emulador
Service Bus e do SQL Server antes de iniciar os containers. Esse teste cobre
somente OS → broker → Billing: não substitui o BDD completo dos três serviços.

As falhas definitivas de geração de orçamento, reserva e cobrança expirada
antes do envio são verificadas contra o comando original e iniciam cancelamento;
resultado de orçamento já existente requer reconciliação. A revisão de prazos é
opcional (`ENABLE_SAGA_DEADLINE_REVIEW=true`), a cada 60 segundos, e registra
reconciliação sem presumir que pagamento ou execução foram revertidos. Falhas
que ainda não possuem evento ou recuperação operacional continuam pendentes.

`npm run test:broker-three-services` executa oito cenários descritos em
`test/broker/jornada.feature` com filas e tópico do emulador Service Bus,
PostgreSQL local e emulador Cosmos: reparo concluído, falha após pagamento com
compensação, timeouts após cobrança ou reembolso, pagamento tardio, estoque insuficiente e
falha após início do reparo. O provedor de
pagamento é simulado; os
consumidores e casos de uso dos serviços são carregados no mesmo processo do
teste. `npm run test:broker-independent-processes` executa a jornada até a
entrega com três processos separados. Servidores Nest, Kubernetes, identidade
Azure e Mercado Pago real não são validados por essas execuções. Consulte
[`test/broker/README.md`](test/broker/README.md) para preparar e executar.

`npm run test:bdd-distributed` inclui cenários que inicializam os workers Nest
de produção em três processos separados, usando broker e bancos emulados; o
webhook e o provedor de pagamento usam fixtures. Alguns cenários exercitam as
ações da jornada pelas APIs HTTP reais; identidade Azure e o comportamento
real da nuvem não são validados localmente. O cenário de trace usa exportador e
extrator HTTP de teste e confere os spans ligados pelo broker; não substitui a
validação da instrumentação automática e do coletor no ambiente implantado.
`npm run test:coverage-messaging` aplica adicionalmente o mínimo de 80% à
mensageria do OS; `npm run test:coverage-saga` aplica o mesmo limite à
infraestrutura da Saga usando integração com PostgreSQL de teste. São medições
separadas e não incluem todos os demais adapters ou controladores do OS.
Para a cobertura total, o CI executa `npm run test:coverage-full`, combinando
unitários, integração da Saga e testes HTTP, inclusive o legado ainda ativo.
O comando exige dois bancos locais distintos, já migrados, nas variáveis
`FULL_LEGACY_TEST_DATABASE_URL` e `FULL_SAGA_TEST_DATABASE_URL`; ambos devem
terminar em `_test`. O relatório e o gate exigem 80% em cada métrica. As
execuções e os relatórios por SHA ficam no [CI do OS](https://github.com/JoaoGW/soat-api/actions/workflows/ci.yml).
O CI também executa `npm run quality:sonarjs`, com regras selecionadas do
analisador SonarJS para erros lógicos e segurança. É um gate estático local;
ele não representa a análise integral nem o painel do SonarQube.

O lockfile atualiza dependências compatíveis do Nest e do transporte HTTP. O
Multer é temporariamente fixado em 2.5.0 por override, pois a versão do Nest
fixa uma versão anterior; um teste HTTP cobre a compatibilidade básica do
interceptor com filtro assíncrono. Retire o override quando o Nest incorporar
uma versão corrigida e repita os testes. O CLI Prisma 6, usado nas migrations,
ainda possui alertas transitivos de alta severidade e requer atualização
compatível antes da liberação final.

Os cadastros no banco novo usam `ENABLE_FASE4_REGISTRY=true` e
`SAGA_DATABASE_URL`: `/fase4/clientes` e `/fase4/veiculos` oferecem criação,
consulta, listagem paginada, atualização e desativação lógica com JWT
administrativo. A integração de CPF fica em
`/fase4/internal/clientes/validar-cpf`, com bearer exclusivo. Para a Function,
o `OS_INTERNAL_BASE_URL` pode incluir o prefixo HTTPS `/fase4`; a troca de rota
e a validação de identidade continuam sendo parte do cutover.
Com a mesma configuração, `GET /fase4/ordens-servico` e as consultas por ID,
histórico e Saga são administrativas; `/fase4/cliente/ordens-servico` oferece
listagem, detalhe e histórico restritos ao cliente autenticado. O relatório
`GET /fase4/relatorios/tempo-medio-execucao` calcula os tempos com os dados e
histórico do banco novo. Estas rotas coexistem com as legadas até o cutover.
`GET /fase4/ordens-servico/fila-operacional` preserva a ordenação por prioridade
e antiguidade, com filtros por filial e status antes da paginação.

A entrega administrativa é habilitada por `ENABLE_FASE4_DELIVERY=true` em
`POST /fase4/ordens-servico/:osId/entregar`. A recuperação auditada de uma
publicação esgotada é habilitada por `ENABLE_FASE4_RECOVERY=true` em
`POST /fase4/ordens-servico/:sagaId/comandos/:messageId/reprocessar`, com corpo
`{"reason":"BROKER_RESTORED"}`. Ambas exigem JWT administrativo e o banco da
Saga; aplique as migrations próprias do OS antes de habilitá-las. Consulte o
[procedimento operacional](docs/operacao-fase4.md).

Para pagamento tardio já confirmado em uma Saga em reconciliação, a rota
administrativa `POST /fase4/ordens-servico/:sagaId/reconciliar-pagamento`,
habilitada por `ENABLE_FASE4_RECOVERY=true`, inicia uma cerca de execução com
auditoria; o reembolso depende da confirmação de cancelamento por Execution.
Para reparo físico concluído durante reconciliação, a rota administrativa
`POST /fase4/ordens-servico/:sagaId/reconciliar-reparo` exige evidências
consistentes de pagamento, fila, início e conclusão e ausência de compensação.
