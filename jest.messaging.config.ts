import type { Config } from 'jest';
import base from './jest.config';

// Medição adicional: não substitui a cobertura do domínio e da aplicação.
const config: Config = {
  ...base,
  collectCoverageFrom: [
    'src/infrastructure/service-bus/**/*.ts',
    'src/infrastructure/messaging/**/*.ts',
    '!src/**/*.spec.ts',
  ],
  coverageDirectory: 'coverage/messaging',
};
export default config;
