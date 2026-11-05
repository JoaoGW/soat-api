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

  Cenário: Retomada após reiniciar o processo OS
    Dado que os serviços e seus bancos locais de teste estão configurados
    Quando reinicio o processo OS durante a Saga com workers Nest
    Então a execução confirma "Saga retomada após reinício do processo OS"
