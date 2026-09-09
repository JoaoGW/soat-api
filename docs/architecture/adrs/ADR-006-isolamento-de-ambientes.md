# ADR-006 - Isolar homologação e produção por namespace e identidade

- **Status:** Aceito
- **Data:** 2026-09-09

## Contexto

O requisito pede deploy automático de homologação e produção. A assinatura
gratuita impõe economia, mas não justifica mistura de configuração, segredos ou
dados entre ambientes.

## Decisão

Quando o AKS estiver provisionado, usar namespaces distintos `hml`, `prod`,
`kong` e `observability`, com configurações, identidades e bancos lógicos por
ambiente. A branch de homologação fará deploy em `hml`; `main`/`master`, em
`prod`, somente por pipeline aprovado.

## Consequências

- O compartilhamento eventual do cluster reduz custo, mas não elimina
  isolamento lógico;
- segredos, variáveis e dados de homologação não são reutilizados em produção;
- o plano Terraform e os manifestos precisam parametrizar ambiente e imagem
  imutável por SHA, nunca `latest`.
