import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  setupFilesAfterEnv: ['<rootDir>/test/jest-e2e.setup.ts'],
  moduleFileExtensions: ['js', 'json', 'ts'],
};

export default config;
