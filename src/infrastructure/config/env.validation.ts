import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().min(1),
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
});

export function validateEnv(config: Record<string, unknown>) {
  const parsed = envSchema.safeParse(config);

  if (!parsed.success) {
    throw new Error(`Invalid environment variables: ${parsed.error.message}`);
  }

  return parsed.data;
}
