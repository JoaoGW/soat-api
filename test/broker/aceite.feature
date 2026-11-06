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

  Cenário: Jornada com três processos independentes
    Dado que os serviços e seus bancos locais de teste estão configurados
    Quando executo a jornada com três processos independentes pelo broker
    Então a execução confirma "Três processos independentes"

  Cenário: Jornada com workers Nest de produção independentes
    Dado que os serviços e seus bancos locais de teste estão configurados
    Quando executo os workers Nest de produção em três processos pelo broker
    Então a execução confirma "Workers Nest de produção iniciados nos três processos"

  Cenário: Estoque insuficiente com workers Nest de produção
    Dado que os serviços e seus bancos locais de teste estão configurados
    Quando executo a falha de estoque nos workers Nest pelo broker
    Então a execução confirma "workers compensaram pelo broker sem criar cobrança"

  Cenário: Compensação após pagamento com workers Nest de produção
    Dado que os serviços e seus bancos locais de teste estão configurados
    Quando executo a compensação após pagamento nos workers Nest pelo broker
    Então a execução confirma "reembolso simulado confirmado e reserva liberada pelo broker"

  Cenário: Retomada após interrupção abrupta do processo OS
    Dado que os serviços e seus bancos locais de teste estão configurados
    Quando reinicio o processo OS durante a Saga com workers Nest
    Então a execução confirma "Saga retomada após interrupção abrupta do processo OS"

  Esquema do Cenário: Retomada dos demais processos após interrupção abrupta
    Dado que os serviços e seus bancos locais de teste estão configurados
    Quando reinicio o processo "<servico>" com comando pendente no broker
    Então a execução confirma "Jornada retomada após interrupção abrupta do <servico>"

    Exemplos:
      | servico   |
      | Billing   |
      | Execution |

  Cenário: Jornada pelas APIs HTTP e broker
    Dado que os serviços e seus bancos locais de teste estão configurados
    Quando executo a jornada pelas APIs HTTP e workers dos três serviços
    Então a execução confirma "Jornada realizada pelas APIs HTTP autenticadas dos três serviços"

  Cenário: Compensação financeira pelas APIs HTTP e broker
    Dado que os serviços e seus bancos locais de teste estão configurados
    Quando executo a compensação após pagamento pelas APIs HTTP e broker
    Então a execução confirma "reembolso simulado confirmado e reserva liberada pelo broker"

  Cenário: Propagação de trace entre APIs e consumidores pelo broker
    Dado que os serviços e seus bancos locais de teste estão configurados
    Quando executo a jornada HTTP com rastreamento distribuído pelo broker
    Então a execução confirma "Contexto W3C propagado pelo broker entre os três serviços"

  Cenário: Evidência divergente impede reembolso e exige reconciliação
    Dado que os serviços e seus bancos locais de teste estão configurados
    Quando a evidência de cancelamento é corrompida antes do reembolso
    Então a execução confirma "Saga em reconciliação pelo broker sem reembolso ou liberação"
