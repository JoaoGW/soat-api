# Saga OS — implementação parcial

`ReceiveChargeEvent` registra eventos de cobrança na inbox e verifica se o
identificador, filial, OS e dados correspondem à operação e ao comando já
persistidos. Para cobrança criada, com a Saga na etapa esperada e orçamento
correspondente, a atualização da Saga, o resultado da operação e a inbox são
confirmados na mesma transação. Eventos fora de ordem e eventos de falha ficam
pendentes. A reaplicação paginada das cobranças criadas é executada por um agendador
opcional, desativado por padrão.

Os consumidores de eventos de cobrança e pagamento validam JSON Schema e confirmam mensagens
somente após a gravação da inbox. A autorização da identidade do transporte, o
roteamento dos demais eventos ainda precisam ser implementados. Os consumidores não estão ligados ao runtime. Compensações e outras
transições persistentes também faltam; o módulo não está pronto para tráfego.

`npm run test:os-integration` exige `DATABASE_URL` apontando para PostgreSQL
local com nome terminado em `_test`, após `npm run db:migrate:deploy` no banco
OS dedicado. Nunca executar a migration da Fase 4 sobre o banco legado.

O agendador exige `ENABLE_SAGA_REPLAY=true` e `SAGA_DATABASE_URL` para o
banco dedicado da Fase 4. Ele percorre as páginas pendentes e reinicia a
varredura a cada 60 segundos. Não habilitar antes de configurar e validar os
fluxos no ambiente isolado.

Pagamento confirmado fica pendente até associar cobrança, orçamento e reserva
confirmada à mesma Saga. Quando os pré-requisitos existem, a Saga, operação e
comando `execution.enqueue-work.v1` são gravados atomicamente. Pagamento
tardio ou order divergente exige reconciliação. A execução ainda não consome
esse comando.
