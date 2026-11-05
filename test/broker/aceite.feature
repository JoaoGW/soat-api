# language: pt
Funcionalidade: Aceite distribuído da oficina pelo broker
  Os casos de uso e consumidores dos três serviços usam bancos de teste,
  um broker emulado e um provedor de pagamento simulado.

  Esquema do Cenário: Jornada e falhas entre os serviços
    Dado que os serviços e seus bancos locais de teste estão configurados
    Quando executo o cenário distribuído "<caso>" pelo broker
    Então a execução confirma "<evidencia>"

    Exemplos:
      | caso              | evidencia                                      |
      | happy             | reparo e entrega concluídos                   |
      | charge-timeout    | order simulada recuperada sem nova criação     |
      | compensate        | reembolso simulado e liberação de estoque     |
      | refund-timeout    | liberação sem novo pedido                     |
      | late-payment      | execução cercada                              |
      | no-stock          | ausência de cobrança                          |
      | started           | sem reembolso ou liberação automáticos        |
      | started-completed | entrega autorizada sem reembolso              |
