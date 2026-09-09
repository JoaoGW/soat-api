# ADR-002 - Usar Kong como API Gateway

- **Status:** Aceito
- **Data:** 2026-09-09

## Contexto

As APIs precisam de uma entrada única, roteamento entre a Function de
autenticação e a aplicação Kubernetes, além de políticas transversais.

## Decisão

Implantar Kong como API Gateway. O caminho `/auth/cpf` será roteado para a
Function externa. As demais rotas serão encaminhadas ao Service interno da API
no AKS. O gateway aplicará rate limit específico na autenticação e propagará
`X-Correlation-ID` para as dependências.

## Consequências

- A API não fica exposta diretamente como ponto de entrada público;
- políticas de borda ficam centralizadas no Kong;
- a autenticação/autorização de negócio continua obrigatória na API; o gateway
  não substitui a checagem de propriedade da OS.
