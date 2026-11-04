# Especificação dos cenários executados por scripts/integration/broker-three-services.cjs.
# O executor é JavaScript, não um interpretador de Gherkin.
Funcionalidade: Jornada distribuída pela mensageria
  Cenário: Reparo concluído
    Dada uma ordem aberta e diagnosticada
    Quando o cliente aprova o orçamento e o pagamento é confirmado
    E o trabalho é enfileirado, iniciado e concluído
    Então a Saga é concluída e as peças são consumidas
    E o veículo pode ser entregue após a confirmação financeira

  Cenário: Falha após pagamento e antes do reparo
    Dada uma ordem paga com trabalho enfileirado
    Quando a Saga inicia a compensação
    Então o cancelamento é confirmado por Execution
    E Billing reembolsa após receber a evidência autenticada
    E Execution libera a reserva após confirmação do reembolso
    E a Saga é compensada sem duplicar o reembolso ao repetir o evento

  Cenário: Timeout após o provedor efetivar o reembolso
    Dado que o provedor realizou o reembolso e a resposta foi perdida
    Quando Billing consulta o estado canônico do provedor
    Então Billing confirma o reembolso sem enviar outra solicitação
    E a reserva é liberada após a confirmação pelo broker

  Cenário: Timeout após o provedor criar a cobrança
    Dada uma notificação registrada por fixture com o identificador da order
    Quando Billing consulta a order canônica e confirma sua referência e valor
    Então a cobrança é recuperada sem criar outra order
    E o pagamento e o reparo seguem pelo broker

  Cenário: Pagamento confirmado após expiração da Saga
    Dada uma Saga em reconciliação com pagamento tardio confirmado
    Quando o administrador inicia a recuperação
    Então Execution cerca e confirma o cancelamento do trabalho
    E o reembolso e a liberação da reserva são confirmados pelo broker

  Cenário: Estoque insuficiente
    Dado um orçamento aprovado sem estoque suficiente
    Quando Execution rejeita a reserva
    Então a Saga cancela o trabalho e é compensada
    E nenhuma cobrança é criada e o estoque permanece inalterado

  Cenário: Falha após o início físico do reparo
    Dado um reparo iniciado após pagamento
    Quando a compensação é solicitada
    Então a Saga exige reconciliação operacional
    E não ocorre reembolso nem liberação automática da reserva
