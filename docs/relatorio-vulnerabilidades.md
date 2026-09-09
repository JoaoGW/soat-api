# Relatorio de Vulnerabilidades

## 1. Objetivo

Este relatorio apresenta a analise de vulnerabilidades do MVP do sistema da oficina mecanica, cobrindo dependencias Node.js e controles de seguranca aplicados na API.

## 2. Ferramentas utilizadas

- npm audit.
- Snyk.

## 3. Data da analise

- 2026-05-06.
- Atualizacao de procedimento: 2026-05-07.
- Execucao completa do Snyk: 2026-05-07.

## 4. Escopo analisado

- Dependencias de producao e desenvolvimento.
- Configuracao de autenticacao e autorizacao da API.
- Validacao global de payloads.
- Exposicao de dados em rotas publicas e administrativas.

## 5. Resultados do npm audit

Arquivo gerado: `reports/security/npm-audit.json` e `reports/security/npm-audit.txt`.

Status da execucao:
- Executado com sucesso.

Contagem de vulnerabilidades:
- Critical: 0.
- High: 11.
- Moderate: 18.
- Low: 5.

## 6. Resultados do Snyk

Arquivos gerados: `reports/security/snyk-report.json` e `reports/security/snyk-report.txt`.

Status da execucao:
- Executado com sucesso com autenticacao via `SNYK_TOKEN`.
- Resultado: 9 issues unicas encontradas em 14 caminhos vulneraveis.

Contagem por severidade (issues unicas):
- Critical: 1.
- High: 7.
- Medium: 1.
- Low: 0.

Procedimento oficial para scan completo:
- Definir `SNYK_TOKEN` no ambiente ou no arquivo `.env`.
- Executar `npm run security:snyk`.
- Evidencias geradas automaticamente em `reports/security/snyk-report.txt` e `reports/security/snyk-report.json`.

## 7. Vulnerabilidades encontradas

<!-- prettier-ignore-start -->
### npm audit
- Pacotes afetados: multiplos.
- Severidade: high/moderate/low.
- Resultado: 34 vulnerabilidades no total:
  - 0 critical.
  - 11 high.
  - 18 moderate.
  - 5 low.
- Mitigacao: corrigir com atualizacoes de dependencias e reexecutar audit.

### Snyk
- Pacotes afetados:
  - `@nestjs/core`.
  - `@nestjs/platform-express`.
  - `prisma`.
  - `effect`.
  - `path-to-regexp`.
  - `multer`.
  - `qs`.
- Severidade: critical/high/medium.
- Resultado: 9 issues unicas em 14 caminhos vulneraveis:
  - 1 critical.
  - 7 high.
  - 1 medium.
- Mitigacao recomendada:
  - `@nestjs/core` -> `11.1.18`.
  - `@nestjs/platform-express` -> `11.1.18`.
  - `prisma` -> `6.19.3`.
  - `qs` -> `>=6.14.2`.
<!-- prettier-ignore-end -->

## 8. Mitigacoes realizadas

- Implementado login administrativo com JWT (`POST /auth/login`).
- Rotas administrativas protegidas por `JwtAuthGuard` real (Passport + strategy JWT).
- Segredo JWT e configuracoes sensiveis movidos para `.env`.
- Validacao obrigatoria de variaveis com `@nestjs/config` + Zod.
- Senha administrativa armazenada como hash bcrypt (`ADMIN_PASSWORD_HASH`).
- `ValidationPipe` global com:
  - `whitelist: true`.
  - `forbidNonWhitelisted: true`.
  - `transform: true`.
- Swagger configurado com Bearer Auth para rotas administrativas.
- Rota publica sem JWT mantida com exposicao minima de dados.

## 9. Riscos aceitos

- Vulnerabilidades reportadas por `npm audit` ainda pendentes de tratativa (mitigacao/upgrade por pacote).
- Vulnerabilidades reportadas por `snyk test` ainda pendentes de tratativa (upgrade de dependencias diretas e transitivas).

## 10. Medidas preventivas aplicadas no projeto

- JWT nas rotas administrativas.
- Hash bcrypt para senha administrativa.
- Variaveis sensiveis em `.env`.
- `.env` fora do versionamento.
- Validacao global de payloads.
- Rejeicao de campos extras.
- Swagger com Bearer Auth.
- Rota publica com exposicao minima de dados.

## 11. Conclusao

O MVP recebeu controles essenciais de autenticacao, autorizacao e validacao de entrada. A superficie de ataque administrativa foi reduzida com JWT e restricao de payload. O `npm audit` foi executado e armazenado. O `snyk test` foi executado com sucesso e consolidou achados adicionais, com prioridade para o item critical em cadeia do `prisma` (via `effect`) e para os itens high em `multer` e `path-to-regexp`. O proximo passo e aplicar os upgrades mapeados, rerodar os scans e registrar a reducao de risco residual.
