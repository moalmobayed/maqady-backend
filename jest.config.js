// Two projects, run separately by `npm run test:unit` and `npm run test:integration`.
// Unit tests mock collaborators; integration tests use the real app and a real Postgres.
const transform = { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] };

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      roots: ['<rootDir>/test/unit'],
      testMatch: ['**/*.test.ts'],
      moduleFileExtensions: ['ts', 'js', 'json'],
      transform,
      clearMocks: true,
      restoreMocks: true,
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      roots: ['<rootDir>/test/integration'],
      testMatch: ['**/*.test.ts'],
      moduleFileExtensions: ['ts', 'js', 'json'],
      transform,
      globalSetup: '<rootDir>/test/support/integration-global-setup.ts',
      testTimeout: 30000,
      clearMocks: true,
      restoreMocks: true,
    },
  ],
};
