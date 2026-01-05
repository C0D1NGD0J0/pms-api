import type { JestConfigWithTsJest } from 'ts-jest';

const config: JestConfigWithTsJest = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  verbose: true,
  clearMocks: true,
  coverageReporters: ['text-summary', 'lcov'],
  coverageProvider: 'v8',
  coverageThreshold: {
    global: {
      branches: 1,
      functions: 1,
      lines: 1,
      statements: 1,
    },
  },
  moduleFileExtensions: ['js', 'ts', 'json', 'node'],
  roots: ['<rootDir>/tests/'],
  testMatch: ['**/tests/**/*.test.[jt]s?(x)', '**/tests/*.test.[jt]s?(x)'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  testEnvironmentOptions: {
    node: true,
  },
  forceExit: true,
  detectOpenHandles: true,
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup/jest.setup.ts'],
  testTimeout: 30000,
  maxWorkers: 1,
  workerIdleMemoryLimit: '512MB',
  moduleNameMapper: {
    '@controllers/(.*)': '<rootDir>/app/controllers/$1',
    '@interfaces/(.*)': '<rootDir>/app/interfaces/$1',
    '@models/(.*)': '<rootDir>/app/models/$1',
    '@database/(.*)': '<rootDir>/app/database/$1',
    '@di/(.*)': '<rootDir>/app/di/$1',
    '@routes/(.*)': '<rootDir>/app/routes/$1',
    '@caching/(.*)': '<rootDir>/app/caching/$1',
    '@queues/(.*)': '<rootDir>/app/queues/$1',
    '@workers/(.*)': '<rootDir>/app/workers/$1',
    '@sockets/(.*)': '<rootDir>/app/sockets/$1',
    '@utils/(.*)': '<rootDir>/app/utils/$1',
    '@mailer/(.*)': '<rootDir>/app/mailer/$1',
    '@dao/(.*)': '<rootDir>/app/dao/$1',
    '@shared/(.*)': '<rootDir>/app/shared/$1',
    '@services/(.*)': '<rootDir>/app/services/$1',
    '@tests/(.*)': '<rootDir>/tests/$1',
    '@root/(.*)': '<rootDir>/$1',
    '@/(.*)': '<rootDir>/app/$1',
  },
};

export default config;
