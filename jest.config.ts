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
  testMatch: [
    '**/tests/**/*.test.[jt]s?(x)',
    '**/tests/*.test.[jt]s?(x)',
    '**/tests/unit/**/*.test.[jt]s?(x)',
    '**/tests/utils/**/*.test.[jt]s?(x)',
    '**/tests/api/**/*.test.[jt]s?(x)',
  ],
  // Transpile only — type-checking every file on load made each suite ~7s and pushed CI past its
  // 20-min limit. Types are still enforced by `tsc` (pre-push hook and the CI TypeScript job).
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { isolatedModules: true }],
    // ESM-only packages (below) compiled to CommonJS for Jest; Node 22 loads them natively
    '^.+\\.js$': [
      'babel-jest',
      {
        babelrc: false,
        configFile: false,
        presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
      },
    ],
  },
  // sanitize-html >= 2.18 depends on the ESM-only htmlparser2 family
  transformIgnorePatterns: [
    '/node_modules/(?!(sanitize-html/node_modules/)?(htmlparser2|domhandler|domutils|dom-serializer|domelementtype|entities)/)',
  ],
  testEnvironmentOptions: {
    node: true,
  },
  forceExit: false,
  detectOpenHandles: false,
  testPathIgnorePatterns: ['<rootDir>/tests/integration/'],
  setupFiles: ['<rootDir>/tests/setup/testEnv.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup/jest.setup.ts'],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  testTimeout: 30000,
  maxWorkers: '50%',
  workerIdleMemoryLimit: '512MB',
  moduleNameMapper: {
    // ESM-only since v25; tests never drive a real browser (see the stub)
    '^puppeteer$': '<rootDir>/tests/setup/puppeteerStub.ts',
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
    '@branding/(.*)': '<rootDir>/app/branding/$1',
    '@dao/(.*)': '<rootDir>/app/dao/$1',
    '@shared/(.*)': '<rootDir>/app/shared/$1',
    '@services/(.*)': '<rootDir>/app/services/$1',
    '@tests/(.*)': '<rootDir>/tests/$1',
    '@root/(.*)': '<rootDir>/$1',
    '@/(.*)': '<rootDir>/app/$1',
  },
};

export default config;
