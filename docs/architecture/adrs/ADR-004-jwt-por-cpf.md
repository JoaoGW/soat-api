# ADR-004 - Emitir JWT de cliente por CPF em Function Serverless

- **Status:** Aceito
- **Data:** 2026-09-09

## Contexto

Clientes precisam consumir suas próprias rotas protegidas sem reutilizar a
credencial administrativa.

## Decisão

Uma Azure Function validará CPF pelo algoritmo mod 11 e o status do cliente,
emitindo JWT de cliente de curta duração. O token terá identificador interno do
cliente em `sub`, papel `client`, emissor, audiência e expiração. A API exigirá
esse token e validará a propriedade do recurso antes de responder ou alterar a
OS.

## Consequências

- CPF inválido, inexistente e inativo recebem resposta indistinguível;
- tokens de cliente e administrador são separados por papel e validação;
- uma tentativa de acessar OS de outro cliente deve retornar negação;
- segredos de assinatura serão mantidos no Key Vault e não no código.
