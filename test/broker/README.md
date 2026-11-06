# Cenários distribuídos locais

O arquivo `jornada.feature` documenta os cenários; o executor é o script
JavaScript `scripts/integration/broker-three-services.cjs`, que usa os casos de
uso, consumidores, outboxes e contratos de produção dos três repositórios.
Todos os comandos e eventos atravessam filas ou tópico do emulador Service Bus.
As assinaturas Ed25519 são geradas para o teste e verificadas na recepção. Os
casos de uso são instanciados no mesmo processo, sem servidores HTTP; apenas a
fronteira do Mercado Pago é simulada. O teste não prova isolamento entre
workloads reais, infraestrutura Azure ou segurança do Cosmos.

`aceite.feature` é executável pelo Cucumber via `npm run test:bdd-distributed`.
Cada exemplo invoca um cenário correspondente do script e falha se o processo
ou qualquer verificação falhar. A execução é sequencial e exige as variáveis e
emuladores abaixo; ela não ignora ambientes ausentes. O webhook do provedor é
preparado por fixture e o Mercado Pago é simulado, como nos demais testes locais.

`npm run test:broker-independent-processes` inicia três processos Node isolados
para OS, Billing e Execution. Cada processo recebe somente sua própria chave
privada e, quando aplicável, a URL de seu banco. Os consumidores e despachantes
de produção usam o broker local; ações do operador são acionadas por IPC no
teste. O cenário chega à entrega. O teste não inicia os servidores Nest nem os
workers de produção com identidade Azure e não demonstra isolamento de rede ou
credenciais no Kubernetes.

Com `SOAT_TEST_PRODUCTION_WORKERS=1`, o mesmo executor inicia os workers Nest
de produção nos três processos. Um adaptador exclusivo do teste redireciona os
clientes Azure para os emuladores locais e substitui o cliente Mercado Pago por
fixture; as validações, assinatura, roteamento, ACK, outbox e ciclo Nest usam
as classes de produção. O BDD executa essa modalidade na jornada completa, na
falha de estoque, no reembolso após pagamento e na retomada depois de reiniciar
o processo OS. Esse modo não comprova identidade de workload nem o
comportamento dos serviços Azure.

Os cenários HTTP inicializam os três `AppModule` reais em processos separados e
chamam abertura, diagnóstico, aprovação, reparo, entrega e compensação com
JWTs sintéticos. O provedor de pagamento e webhook continuam simulados. O
cenário de interrupção encerra abruptamente o processo OS e publica a aprovação
no broker antes de reiniciá-lo.
Há ainda cenários que encerram Billing ou Execution com `SIGKILL`, aguardam
a publicação do comando correspondente enquanto o serviço está indisponível e
retomam a jornada após reiniciá-lo. Eles não substituem testes de interrupção
em todos os pontos possíveis da transação ou do ACK.

O cenário de propagação W3C envia contextos HTTP distintos para abertura e
diagnóstico, verifica que o contexto durável da abertura chega aos consumidores
dos três serviços e confere os spans pai correspondentes. Um SDK e um middleware
de teste coletam spans e extraem o cabeçalho HTTP; portanto, o teste não valida
a instrumentação HTTP automática de produção, a Function ou um coletor remoto.

O cenário de evidência divergente altera o registro no banco descartável depois
da verificação da assinatura, simulando corrupção antes do reembolso. Ele
verifica o evento assinado de Billing passando pelo broker, a reconciliação da
Saga, a reserva preservada e a ausência de chamada ao provedor simulado.

O workflow manual `BDD distribuído local` aceita SHAs completos de Billing e
Execution, registra os três commits e falha quando a credencial de leitura
`CROSS_REPO_READ_TOKEN` ou o aceite dos emuladores estiverem ausentes. Como os
outros repositórios são privados, a execução no GitHub depende dessa credencial;
o workflow não é check automático de PR. Os testes locais não provam deploy ou
identidades reais na nuvem.

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
npm run test:bdd-distributed
npm run test:broker-independent-processes
npm run test:broker-recover-dlq
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
