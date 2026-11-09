# ADR 0001 — Fronteiras dos serviços e Saga da OS

## Decisão

OS é dono de clientes, veículos, histórico, projeção e orquestração. Billing
é dono de orçamentos versionados, cobranças, pagamentos e reembolsos.
Execution é dono do catálogo técnico, estoque por filial, diagnóstico, fila e
reparo. Cada serviço acessa apenas seu banco: PostgreSQL separado para OS e
Billing e Cosmos DB for NoSQL para Execution. A infraestrutura compartilhada
não altera a propriedade dos dados.

A Saga é orquestrada pelo OS porque ele detém o ciclo de vida da ordem e pode
expor o andamento e suas pendências. Mensagens pelo Service Bus ligam os
participantes; operações, inbox e outbox devem ser transacionais localmente.
O agregado e sua versão pertencem ao produtor da mensagem, sem contador global.

O fluxo aprovado reserva peças e confirma o pagamento antes de liberar a fila.
Falhas reversíveis exigem confirmação de cancelamento do trabalho, estorno e
liberação aplicáveis. Resultado incerto exige reconciliação; trabalho físico
iniciado não pode ser desfeito por exclusão de registros. Fatos fora de ordem
devem permanecer pendentes para reavaliação.

## Alternativa considerada

A coreografia, com cada serviço reagindo aos eventos dos demais, evitaria um
coordenador, mas distribuiria a regra de pagamento antes do reparo e a ordem
das compensações por três repositórios. Sem um dono do estado, prazos vencidos
e resultados financeiros incertos ficariam sem um ponto único de reconciliação.

## Estado

Aceita e implementada. A máquina de estados, inbox/outbox, comandos, eventos e
compensações estão integrados entre OS, Billing e Execution e são exercitados
pelo BDD distribuído com broker e bancos emulados. A validação com Service Bus,
Cosmos DB e Mercado Pago reais depende do ambiente de aceite.
