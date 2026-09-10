import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().min(1),
  JWT_CLIENT_SECRET: z.string().min(32),
  JWT_CLIENT_ISSUER: z.string().min(1),
  JWT_CLIENT_AUDIENCE: z.string().min(1),
  ADMIN_USERNAME: z.string().min(3).max(100),
  ADMIN_PASSWORD_HASH: z.string().min(20),
  MAIL_HOST: z.string().min(1),
  MAIL_PORT: z.string().min(1),
  MAIL_USER: z.string().min(1),
  MAIL_PASS: z.string().min(1),
  MAIL_FROM: z.string().min(1),
  WEBHOOK_SECRET: z.string().min(32),
  WEBHOOK_TOKEN_EXPIRES_IN: z.string().min(1).default('24h'),
  APP_URL: z.string().url(),
  OBSERVABILITY_ENABLED: z.enum(['true', 'false']).default('false'),
  OTEL_SERVICE_NAME: z.string().min(1).default('soat-api'),
  OTEL_SERVICE_VERSION: z.string().min(1).default('local'),
  NEW_RELIC_LICENSE_KEY: z.string().min(1).optional(),
});

export function validateEnv(config: Record<string, unknown>) {
  const parsed = envSchema.safeParse(config);

  if (!parsed.success) {
    throw new Error(`Invalid environment variables: ${parsed.error.message}`);
  }

  if (
    parsed.data.OBSERVABILITY_ENABLED === 'true' &&
    !parsed.data.NEW_RELIC_LICENSE_KEY
  ) {
    throw new Error(
      'NEW_RELIC_LICENSE_KEY é obrigatória quando OBSERVABILITY_ENABLED=true',
    );
  }

  return parsed.data;
}
