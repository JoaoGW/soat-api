/**
 * Prazos locais da Saga para etapas que aguardam fatos de Execution sem prazo
 * contratual próprio. Valores ausentes ou inválidos usam o padrão para que um
 * erro de configuração não bloqueie a abertura da OS nem o consumo de eventos.
 */
export const SAGA_DEADLINE_DEFAULTS = {
  SAGA_DIAGNOSIS_DEADLINE_MINUTES: 1440,
  SAGA_QUEUE_DEADLINE_MINUTES: 4320,
  SAGA_EXECUTION_DEADLINE_MINUTES: 2880,
} as const;
export type SagaDeadline = keyof typeof SAGA_DEADLINE_DEFAULTS;
const MAX_MINUTES = 525600;

export function sagaDeadlineMinutes(
  name: SagaDeadline,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[name]?.trim();
  const value = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_MINUTES
    ? value
    : SAGA_DEADLINE_DEFAULTS[name];
}

export function sagaDeadlineAt(
  name: SagaDeadline,
  now: Date,
  env: NodeJS.ProcessEnv = process.env,
): Date {
  return new Date(now.getTime() + sagaDeadlineMinutes(name, env) * 60000);
}
