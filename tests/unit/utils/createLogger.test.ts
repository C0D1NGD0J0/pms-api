import { envVariables } from '@shared/config';

// Capture the stream passed to bunyan.createLogger
let capturedConfig: any;
jest.mock('bunyan', () => {
  const actual = jest.requireActual('bunyan');
  return {
    ...actual,
    createLogger: jest.fn((config: any) => {
      capturedConfig = config;
      return {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        child: jest.fn(),
      };
    }),
  };
});

// Must re-import after mocking to get fresh module state
function loadCreateLogger() {
  // Clear module cache so createLogger re-evaluates stream logic
  const modulePath = require.resolve('@utils/helpers');
  delete require.cache[modulePath];
  // Also clear the internal logger cache by requiring fresh module
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@utils/helpers').createLogger;
}

describe('createLogger stream selection', () => {
  const originalEnv = { ...envVariables.SERVER };

  afterEach(() => {
    // Restore original env
    Object.assign(envVariables.SERVER, originalEnv);
    capturedConfig = undefined;
    jest.clearAllMocks();
  });

  it('uses raw customStream in development', () => {
    envVariables.SERVER.ENV = 'development';
    envVariables.SERVER.ENABLE_CONSOLE_LOGS = false;
    const createLogger = loadCreateLogger();
    createLogger('TestDev');

    expect(capturedConfig.streams[0].type).toBe('raw');
  });

  it('uses stdout stream in production (no ENABLE_CONSOLE_LOGS)', () => {
    envVariables.SERVER.ENV = 'production';
    envVariables.SERVER.ENABLE_CONSOLE_LOGS = false;
    const createLogger = loadCreateLogger();
    createLogger('TestProd');

    expect(capturedConfig.streams[0].type).toBe('stream');
    expect(capturedConfig.streams[0].stream).toBe(process.stdout);
  });

  it('uses raw customStream in production when ENABLE_CONSOLE_LOGS is true', () => {
    envVariables.SERVER.ENV = 'production';
    envVariables.SERVER.ENABLE_CONSOLE_LOGS = true;
    const createLogger = loadCreateLogger();
    createLogger('TestProdConsole');

    expect(capturedConfig.streams[0].type).toBe('raw');
  });

  it('respects LOG_LEVEL from envVariables', () => {
    envVariables.SERVER.ENV = 'development';
    envVariables.SERVER.LOG_LEVEL = 'debug';
    const createLogger = loadCreateLogger();
    createLogger('TestLevel');

    // Bunyan debug level = 20
    expect(capturedConfig.level).toBe(20);
  });

  it('defaults to INFO level when LOG_LEVEL is not set', () => {
    envVariables.SERVER.ENV = 'development';
    envVariables.SERVER.LOG_LEVEL = '';
    const createLogger = loadCreateLogger();
    createLogger('TestDefaultLevel');

    // Bunyan info level = 30
    expect(capturedConfig.level).toBe(30);
  });
});
