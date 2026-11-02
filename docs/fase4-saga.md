# Saga OS — implementação parcial

`ReceiveChargeEvent` registra eventos de cobrança na inbox e verifica se o
identificador, filial, OS e dados correspondem à operação e ao comando já
persistidos. Para cobrança criada, com a Saga na etapa esperada e orçamento
correspondente, a atualização da Saga, o resultado da operação e a inbox são
confirmados na mesma transação. Eventos fora de ordem e eventos de falha ficam
pendentes. A reaplicação paginada de cobranças, pagamentos e confirmações de fila é executada por um agendador
opcional, desativado por padrão.

Os consumidores de eventos de cobrança e pagamento validam JSON Schema e confirmam mensagens
somente após a gravação da inbox. O consumidor do broker está ligado ao processo, mas é desativado por padrão.
Ele roteia cobrança, pagamento e confirmação de fila; outros eventos são
devolvidos e podem chegar à DLQ após as tentativas. É necessário completar
os handlers, validar identidade por produtor, compensações e testes reais antes
de habilitá-lo; o módulo ainda não está pronto para tráfego.

`npm run test:os-integration` exige `DATABASE_URL` apontando para PostgreSQL
local com nome terminado em `_test`, após `npm run db:migrate:deploy` no banco
OS dedicado. Nunca executar a migration da Fase 4 sobre o banco legado.

O recebimento de `execution.work-enqueued.v1` valida o comando e avança
`FILA_PENDENTE` para `NA_FILA` com inbox e operação na mesma transação.
Eventos recebidos fora de ordem também podem ser reaplicados; não são aplicados
enquanto a Saga está compensando.

O agendador exige `ENABLE_SAGA_REPLAY=true` e `SAGA_DATABASE_URL` para o
banco dedicado da Fase 4. Ele percorre as páginas pendentes e reinicia a
varredura a cada 60 segundos. Não habilitar antes de configurar e validar os
fluxos no ambiente isolado.

Pagamento confirmado fica pendente até associar cobrança, orçamento e reserva
confirmada à mesma Saga. Quando os pré-requisitos existem, a Saga, operação e
comando `execution.enqueue-work.v1` são gravados atomicamente. Pagamento
tardio ou order divergente exige reconciliação. A execução ainda não consome
esse comando no runtime.

O recebimento exige `ENABLE_SAGA_EVENT_CONSUMER=true`, `SAGA_DATABASE_URL`,
namespace, topic, subscription e identidade de workload. Sua ativação exige
também a validação do isolamento entre produtores no broker.
