import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const base = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    JWT_SECRET: 'test-secret-with-at-least-32-characters',
    JWT_EXPIRES_IN: '1d',
    JWT_CLIENT_SECRET: 'test-client-secret-with-at-least-32-characters',
    JWT_CLIENT_ISSUER: 'soat-auth-function',
    JWT_CLIENT_AUDIENCE: 'soat-api',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD_HASH: '$2b$10$abcdefghijklmnopqrstuv',
    MAIL_HOST: 'smtp.test.local',
    MAIL_PORT: '587',
    MAIL_USER: 'user',
    MAIL_PASS: 'pass',
    MAIL_FROM: 'oficina@example.com',
    WEBHOOK_SECRET: 'test-webhook-secret-with-at-least-32-characters',
    APP_URL: 'http://localhost:3000',
  };

  it('exige a chave do New Relic com observabilidade fora do ambiente local', () => {
    expect(() =>
      validateEnv({ ...base, OBSERVABILITY_ENABLED: 'true' }),
    ).toThrow('NEW_RELIC_LICENSE_KEY');
    expect(
      validateEnv({
        ...base,
        OBSERVABILITY_ENABLED: 'true',
        NEW_RELIC_LICENSE_KEY: 'key',
      }).NEW_RELIC_LICENSE_KEY,
    ).toBe('key');
  });

  it('dispensa a chave quando a telemetria vai ao Collector do kind', () => {
    const env = validateEnv({
      ...base,
      OBSERVABILITY_ENABLED: 'true',
      ALLOW_LOCAL_EMULATORS: 'true',
    });
    expect(env.ALLOW_LOCAL_EMULATORS).toBe('true');
    expect(env.NEW_RELIC_LICENSE_KEY).toBeUndefined();
  });
});
