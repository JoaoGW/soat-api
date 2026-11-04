# Cenários distribuídos locais

O arquivo `jornada.feature` documenta os cenários; o executor é o script
JavaScript `scripts/integration/broker-three-services.cjs`, que usa os casos de
uso, consumidores, outboxes e contratos de produção dos três repositórios.
Todos os comandos e eventos atravessam filas ou tópico do emulador Service Bus.
As assinaturas Ed25519 são geradas para o teste e verificadas na recepção. Os
casos de uso são instanciados no mesmo processo, sem servidores HTTP; apenas a
fronteira do Mercado Pago é simulada. O teste não prova isolamento entre
workloads, infraestrutura Azure, segurança do Cosmos ou entrega do veículo.

Use Docker local, Node compatível e checkouts dos três repositórios. Leia e
aceite os termos do Service Bus Emulator e do SQL Server antes de configurar
`SOAT_TEST_ACCEPT_EULA=Y`. São necessárias portas locais 5672, 5300, 8081,
18080 e 55446 disponíveis. Os comandos abaixo não utilizam Azure.

```sh
export SOAT_TEST_ACCEPT_EULA=Y
export SOAT_TEST_MSSQL_PASSWORD='SoatLocalTest_2026!'
docker compose -f test/broker/compose.yaml up -d
docker run -d --name soat-cosmos-local-test -p 127.0.0.1:8081:8081 -p 127.0.0.1:18080:8080 mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:vnext-latest --enable-explorer false
docker run -d --name soat-bdd-postgres -p 127.0.0.1:55446:5432 -e POSTGRES_USER=soattest -e POSTGRES_PASSWORD=localtest postgres:16
```

Aguarde a disponibilidade dos serviços. Crie dois bancos descartáveis e rode
as migrations atuais, cada uma a partir do respectivo repositório. O script
recusa bancos que não sejam locais ou cujos nomes não terminem em `_test`.

```sh
docker exec soat-bdd-postgres createdb -U soattest os_bdd_test
docker exec soat-bdd-postgres createdb -U soattest billing_bdd_test
export OS_TEST_DATABASE_URL='postgresql://soattest:localtest@127.0.0.1:55446/os_bdd_test'
export BILLING_TEST_DATABASE_URL='postgresql://soattest:localtest@127.0.0.1:55446/billing_bdd_test'
export BILLING_REPO_DIR='/caminho/absoluto/soat-billing-service'
export EXECUTION_REPO_DIR='/caminho/absoluto/soat-execution-service'
DATABASE_URL="$OS_TEST_DATABASE_URL" npm run db:migrate:deploy
(cd "$BILLING_REPO_DIR" && DATABASE_URL="$BILLING_TEST_DATABASE_URL" npm run db:migrate:deploy)
npm run build
(cd "$BILLING_REPO_DIR" && npm run build)
(cd "$EXECUTION_REPO_DIR" && npm run build)
export COSMOS_TEST_ENDPOINT='http://127.0.0.1:8081'
export SERVICE_BUS_TEST_CONNECTION_STRING='Endpoint=sb://localhost/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;'
npm run test:broker-three-services
```

Instale as dependências dos três repositórios antes dos builds. Use uma instância
exclusiva do broker para o teste, pois ele consome as mensagens das filas e
assinaturas `bdd.*`. Não a compartilhe com outro teste simultâneo. Reinicie o
compose e use bancos recém-criados se uma execução for interrompida: mensagens
ou registros pendentes de uma execução anterior interferem nos despachantes.
Os dados criados no PostgreSQL permanecem nos bancos descartáveis; cada banco
Cosmos temporário é removido no final do cenário. Ao terminar, pare e remova
somente os containers criados para esse teste:

```sh
docker compose -f test/broker/compose.yaml down
docker rm -f soat-cosmos-local-test soat-bdd-postgres
```
