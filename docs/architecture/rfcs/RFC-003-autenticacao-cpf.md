# RFC-003 - Autenticação de cliente por CPF

- **Status:** Aceito
- **Data:** 2026-09-09
- **Decisores:** equipe do projeto

## Contexto

A Fase 3 pede uma Function Serverless que valide o CPF, consulte a existência e
o status do cliente e devolva um JWT para uso das APIs protegidas. A solução
precisa preservar o fluxo administrativo existente, que usa autenticação
própria, e impedir que um cliente acesse ordens de serviço de outro cliente.

## Critérios

- Validar CPF de verdade, incluindo os dígitos verificadores pelo algoritmo
  mod 11, antes da consulta ao banco;
- não expor se a falha ocorreu porque o CPF é inválido, inexistente ou inativo;
- emitir token de curta duração, com emissor, audiência, expiração e papel;
- separar a identidade de cliente da identidade administrativa;
- permitir validação pelo gateway e pela API.

## Alternativas avaliadas

| Alternativa | Avaliação |
|---|---|
| Function dedicada + JWT | Atende diretamente ao requisito serverless e permite uma superfície de autenticação pequena e protegida. |
| Login administrativo reaproveitado | Não representa a autenticação de cliente por CPF e mistura privilégios. |
| Consulta pública por código de acompanhamento | Serve ao caso público existente, mas não prova identidade nem permite autorização por propriedade. |

## Decisão

Criar `POST /auth/cpf` em uma Azure Function, exposta pelo Kong. A Function
normaliza o CPF, valida seus dígitos verificadores, consulta `Cliente.documento`
e `Cliente.ativo` e, quando aprovado, emite JWT de cliente com `sub` igual ao
identificador interno do cliente, `role=client`, `iss`, `aud`, `iat` e `exp`.

Falhas de CPF inválido, inexistente ou inativo devem retornar a mesma resposta
de autenticação negada. O Kong aplicará rate limiting nessa rota. A API principal
validará a assinatura, emissor, audiência e papel do token e comparará o `sub`
com o `clienteId` da OS antes de permitir consulta ou decisão de orçamento.

## Consequências

- Os JWTs administrativos permanecem separados e exigem `role=admin` nas
  rotas administrativas, como o relatório;
- nenhuma rota de cliente pode confiar apenas no identificador enviado na URL;
- logs não podem conter CPF integral, token ou segredo;
- Swagger e os testes precisam demonstrar sucesso, ausência de token, papel
  incorreto e tentativa de acesso à OS de outro cliente.
