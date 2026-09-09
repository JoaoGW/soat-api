# ADR-005 - Manter histórico append-only de status da OS

- **Status:** Aceito
- **Data:** 2026-09-09

## Contexto

O relatório de tempo médio por Diagnóstico, Execução e Finalização exige saber
quando cada etapa começou e terminou de modo auditável.

## Decisão

Criar `HistoricoStatusOS` como registro append-only. Toda transição válida de
status da OS deverá inserir um evento de histórico na mesma transação que
atualiza o status atual.

## Consequências

- O status atual permanece simples para consulta operacional;
- relatórios calcularão tempos a partir dos eventos persistidos;
- falha em gravar o histórico cancela a transição para evitar inconsistência;
- o histórico pode servir de evidência de auditoria e de base para dashboards.
