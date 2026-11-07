# Este cenário cobre um recorte entre serviços, não o BDD de ponta a ponta.
Funcionalidade: Envio de diagnóstico do OS para Billing pelo broker
  Cenário: Mensagem repetida gera um único orçamento
    Dado um diagnóstico concluído com preço de referência em centavos
    Quando o comando de orçamento assinado é publicado duas vezes no broker
    E Billing recebe, valida e confirma as mensagens
    Então existe um único orçamento com o valor do diagnóstico
    E existe um único evento de orçamento emitido
