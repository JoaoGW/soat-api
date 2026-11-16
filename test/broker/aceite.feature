# language: pt
Funcionalidade: Aceite distribuído da oficina pelo broker
  Os casos de uso e consumidores dos três serviços usam bancos de teste,
  um broker emulado e um provedor de pagamento simulado.

  # Recorte OS -> broker -> Billing (antigo diagnostico-orcamento.feature).
  # Executado primeiro para encontrar a fila de comandos do Billing vazia.
  Cenário: Mensagem repetida de orçamento gera um único orçamento
    Dado que os serviços e seus bancos locais de teste estão configurados
    Quando publico duas vezes o comando de orçamento do diagnóstico pelo broker
    Então a execução confirma "OS → broker → Billing: mensagem e reentrega processadas"

  # Casos de scripts/integration/broker-three-services.cjs (antigo jornada.feature):
  # happy: ordem diagnosticada, aprovada e paga; trabalho enfileirado, iniciado
  #   e concluído; peças consumidas e entrega após a confirmação financeira.
  # charge-timeout: order criada no provedor com resposta perdida é recuperada
  #   pela consulta canônica, sem criar outra order.
  # compensate: falha após pagamento e antes do reparo; cancelamento confirmado
  #   por Execution, reembolso com evidência autenticada, liberação da reserva e
  #   evento repetido sem duplicar o reembolso.
  # refund-timeout: provedor efetiva o reembolso e perde a resposta; Billing
  #   confirma pelo estado canônico sem nova solicitação e a reserva é liberada.
  # late-payment: pagamento confirmado após expiração; recuperação administrativa
  #   cerca a execução, reembolsa e libera a reserva.
  # no-stock: Execution rejeita a reserva; Saga compensada sem cobrança.
  # started: compensação pedida após o início físico exige reconciliação, sem
  #   reembolso nem liberação automáticos.
  # started-completed: reparo concluído durante a reconciliação permite concluir
  #   a Saga e entregar, recusando evidências de compensação conflitantes.
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

  Cenário: Cancelamento financeiro sem pagamento entre OS e Billing
    Dado que os serviços e seus bancos locais de teste estão configurados
    Quando executo o cancelamento da cobrança sem pagamento pelo broker
    Então a execução confirma "OS e Billing trocaram cancelamento assinado pelo broker"

  Cenário: Cancelamento sem pagamento com workers Nest de produção
    Dado que os serviços e seus bancos locais de teste estão configurados
    Quando executo o cancelamento sem pagamento com os três workers Nest
    Então a execução confirma "Workers Nest cancelaram cobrança sem pagamento e liberaram reserva pelo broker"

  Cenário: Resposta perdida do cancelamento com workers Nest
    Dado que os serviços e seus bancos locais de teste estão configurados
    Quando o provedor cancela a cobrança e perde a resposta
    Então a execução confirma "Workers Nest cancelaram cobrança sem pagamento e liberaram reserva pelo broker"

  Cenário: Evidência divergente bloqueia cancelamento financeiro
    Dado que os serviços e seus bancos locais de teste estão configurados
    Quando a evidência do cancelamento financeiro é corrompida
    Então a execução confirma "Evidência divergente bloqueou cancelamento financeiro e preservou reserva pelo broker"

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

  Cenário: Retomada segura após resposta perdida do reembolso
    Dado que os serviços e seus bancos locais de teste estão configurados
    Quando o provedor efetiva o reembolso e perde a resposta
    Então a execução confirma "Timeout financeiro reconciliado sem repetir reembolso e com recuperação auditada"

  # Exige o ambiente kind (scripts/kind/ambiente.sh subir) e as versões de
  # Billing e Execution com execution.work-failed.v1. Executado por
  # npm run test:bdd-kind; o BDD do broker exclui a tag @kind.
  @kind
  Cenário: Falha na execução após pagamento estorna e cancela a OS
    Dado que o ambiente kind da Fase 4 está implantado
    Quando executo a jornada no kind com o cenário "falha-execucao"
    Então a execução confirma "Falha na execução compensada: estorno confirmado e OS cancelada"
