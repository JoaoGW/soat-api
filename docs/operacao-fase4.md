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

O procedimento não rearma mensagens `SENT` nem altera Saga em
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
divergência ou trabalho físico já iniciado. A exceção automatizada é o evento
autenticado `billing.quote-failed.v1` com `EXPIRED`, quando o prazo expirou,
o evento corresponde ao comando e não há orçamento, reservas, cobrança,
execução nem fatos conflitantes. Nesse caso a Saga inicia o cancelamento e
registra a evidência em auditoria. Outros casos em reconciliação ainda não
possuem retomada automatizada; não altere o estado manualmente.

No Billing, a reconciliação opcional de reembolso consulta a ordem canônica
quando a resposta do envio é incerta. Ela só confirma um reembolso integral e
único correspondente à ordem, pagamento, valor e moeda; não envia outro pedido
financeiro. Veja `ENABLE_MERCADO_PAGO_REFUND_RECONCILIATION` no README do
Billing. Os demais resultados financeiros incertos continuam em reconciliação.

Para uma cobrança de criação incerta, o Billing também pode usar uma
notificação autenticada pendente para consultar a order e relacioná-la à
intenção original. A opção `ENABLE_MERCADO_PAGO_CHARGE_RECONCILIATION` nunca
repete a criação da cobrança. Sem notificação com ID ou com dados divergentes,
ela mantém a pendência para análise; consulte o README do Billing.

Quando o pagamento tardio já tiver sido confirmado e a reserva e a cobrança
corresponderem às operações registradas, um administrador pode chamar
`POST /fase4/ordens-servico/:sagaId/reconciliar-pagamento` com o corpo
`{"reason":"LATE_PAYMENT"}` e `ENABLE_FASE4_RECOVERY=true`. O OS audita a
ação e envia cancelamento para cercar o trabalho; não reembolsa nem libera
estoque até receber a confirmação autenticada de que o reparo não começou.
Se Execution informar que o trabalho já começou, a Saga retorna à
reconciliação. Pagamento, reserva ou compensação conflitantes impedem a ação.

Se o reparo físico começou e posteriormente terminou, o administrador pode
chamar `POST /fase4/ordens-servico/:sagaId/reconciliar-reparo` com o corpo
`{"reason":"REPAIR_CONFIRMED"}`. O OS exige evidências autenticadas e
consistentes de início, conclusão, fila e pagamento, além de ausência de
operações de cancelamento, reembolso ou liberação. A ação audita a decisão,
encerra a Saga e registra o histórico físico; a entrega segue a verificação
administrativa própria. Se houver compensação ou evidência divergente, a
recuperação é recusada para análise operacional.

## DLQ e mensagens fora de ordem

Revise motivo, versão de contrato, assinatura, produtor, IDs e causa do erro.
Mensagens incompatíveis ou não autenticadas não devem ser reenviadas como se
fossem válidas. Corrija configuração ou consumidor e só então reenvie a mensagem
original quando a origem e a segurança da operação forem comprovadas. Eventos
aceitos fora de ordem permanecem na inbox e podem ser reaplicados pelo worker
`ENABLE_SAGA_REPLAY=true`; acompanhe pendências e erros.

Para a DLQ da assinatura de eventos do OS, o operador pode executar
`npm run ops:recover-saga-dlq` com `ENABLE_SAGA_DLQ_RECOVERY=true`, as mesmas
variáveis de banco, identidade e chaves públicas do consumidor da Saga e mais
`SAGA_DLQ_MESSAGE_ID`, `SAGA_DLQ_ACTOR` e `SAGA_DLQ_REASON`. A identidade de
workload precisa de permissão para receber da assinatura; o ator é informado
pelo ambiente de execução e deve ser correlacionado ao registro de acesso do
operador. Execute em ambiente controlado e registre o identificador do primeiro
evento disponível na DLQ: o comando recebe uma mensagem por vez e interrompe
sem confirmá-la se o identificador não corresponder. Não percorre nem altera as
demais mensagens.

O comando verifica assinatura do produtor, contrato, assunto e ID; registra a
tentativa em `SagaRecoveryAudit` antes de chamar o handler normal. Só confirma
a mensagem depois que o fato correspondente estiver persistido na inbox. A
auditoria registra tentativas, inclusive aquelas interrompidas; confira inbox e
estado da Saga para determinar o resultado. Uma interrupção após o commit pode
causar nova entrega, tratada pela deduplicação. Eventos inválidos não são
modificados nem confirmados. O teste local usa a DLQ de uma fila: a confirmação
da DLQ de assinatura de tópico falhou no emulador usado e precisa ser validada
no Service Bus real antes do uso operacional.

## Entrega

A entrega administrativa é idempotente e exige Saga concluída, OS finalizada,
pagamento aplicado correspondente, ausência de alerta e de operação de
reembolso. Ela grava histórico append-only. Se qualquer pré-condição falhar,
investigue o estado e mantenha o veículo retido até a situação ser resolvida.
