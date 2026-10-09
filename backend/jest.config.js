/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest'],
  },
  // A real PostgreSQL (Testcontainers, or TEST_DATABASE_URL) — see tests/setup/globalSetup.ts.
  globalSetup: '<rootDir>/tests/setup/globalSetup.ts',
  globalTeardown: '<rootDir>/tests/setup/globalTeardown.ts',
  testTimeout: 30_000,
  // Every worker gets its own database; more than a handful just contend for the one server.
  maxWorkers: 4,
};
