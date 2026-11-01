# Saga OS — implementação parcial

`ReceiveChargeEvent` registra eventos de cobrança na inbox e verifica se o
identificador, filial, OS e dados correspondem à operação e ao comando já
persistidos. Para cobrança criada, com a Saga na etapa esperada e orçamento
correspondente, a atualização da Saga, o resultado da operação e a inbox são
confirmados na mesma transação. Eventos fora de ordem e eventos de falha ficam
pendentes. A reaplicação atualmente precisa ser acionada pelo chamador.

O chamador deve validar JSON Schema e a identidade do transporte antes de usar
o serviço. O consumer do broker, o agendador de reavaliação, compensações e
outras transições persistentes ainda não estão implementados. Este módulo não
está conectado ao runtime legado e não está pronto para receber tráfego.

`npm run test:os-integration` exige `DATABASE_URL` apontando para PostgreSQL
local com nome terminado em `_test`, após `npm run db:migrate:deploy` no banco
OS dedicado. Nunca executar a migration da Fase 4 sobre o banco legado.
