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

## Estado

Decisão inicial do projeto. A máquina de estados e os schemas presentes são
fundamentos locais; a Saga, os transportes e as compensações ainda não estão
integrados nem demonstrados em HML.
