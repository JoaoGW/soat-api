module.exports = {
  ...require('./jest.os.integration.cjs'),
  collectCoverage: true,
  collectCoverageFrom: ['src/infrastructure/saga/**/*.ts', '!src/**/*.spec.ts'],
  coverageDirectory: 'coverage/saga',
  coverageThreshold: { global: { statements: 80, branches: 80, functions: 80, lines: 80 } },
};
