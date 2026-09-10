/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  // Temporal's test server + workflow bundling need generous timeouts.
  testTimeout: 60_000,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts'],
};
