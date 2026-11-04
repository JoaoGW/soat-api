# Recuperação operacional da Saga

O prazo esgotado, falha de transporte e falha financeira são situações
distintas. Preserve `sagaId`, `operationId`, `messageId`, estado e horários;
evite registrar dados pessoais, tokens, QR ou payloads financeiros nos chamados.
Consulte logs, outbox, inbox, DLQ e estado de cada serviço antes de agir.

## Publicação esgotada no OS

Após restaurar o broker, identifique a mensagem em `Outbox` com `status=FAILED`
e a operação correspondente em `SagaOperation`. Confira o estado atual da Saga
e o motivo da falha. Um administrador pode chamar a rota de reprocessamento
documentada no README. A operação registra ator, motivo, Saga e mensagem em
`SagaRecoveryAudit` na mesma transação e rearma o **mesmo** `messageId` e
`operationId`. O comando precisa corresponder à etapa atual, a operação deve
continuar pendente e a Saga não pode exigir atenção. Duas chamadas concorrentes
não geram duas recuperações. A publicação pode já ter chegado ao destinatário;
acompanhe a deduplicação e o fato de resposta, sem criar outro comando.

O procedimento não rearma mensagens `SENT`, não corrige DLQ nem altera Saga em
reconciliação. Não altere manualmente status, identificadores ou payloads para
contornar essas verificações. Para outros serviços, use seus procedimentos e
confirme suas garantias de deduplicação antes de reenviar mensagens.

## Prazo esgotado ou situação incerta

Com `ENABLE_SAGA_DEADLINE_REVIEW=true`, a revisão marca a Saga como
`RECONCILIACAO_NECESSARIA`; prazo vencido não prova cancelamento, não autoriza
liberação da reserva nem reembolso. Identifique o último fato autenticado e
compare as operações e eventos entre OS, Billing e Execution. Consulte o
estado canônico no Mercado Pago quando houver cobrança ou reembolso, e a tarefa
e a reserva no Execution. Preserve a pendência e abra incidente quando houver
divergência ou trabalho físico já iniciado. A retomada segura de uma Saga em
reconciliação ainda requer ferramenta específica e validação das evidências;
não há retorno automático ao fluxo neste procedimento.

## DLQ e mensagens fora de ordem

Revise motivo, versão de contrato, assinatura, produtor, IDs e causa do erro.
Mensagens incompatíveis ou não autenticadas não devem ser reenviadas como se
fossem válidas. Corrija configuração ou consumidor e só então reenvie a mensagem
original quando a origem e a segurança da operação forem comprovadas. Eventos
aceitos fora de ordem permanecem na inbox e podem ser reaplicados pelo worker
`ENABLE_SAGA_REPLAY=true`; acompanhe pendências e erros. A DLQ não é recuperada
automaticamente por esta implementação.

## Entrega

A entrega administrativa é idempotente e exige Saga concluída, OS finalizada,
pagamento aplicado correspondente, ausência de alerta e de operação de
reembolso. Ela grava histórico append-only. Se qualquer pré-condição falhar,
investigue o estado e mantenha o veículo retido até a situação ser resolvida.
