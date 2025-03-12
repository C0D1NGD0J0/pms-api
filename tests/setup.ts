import dotenv from 'dotenv';
import { Application } from 'express';
import { createLogger } from '@utils/index';
import { serverInstance } from '@root/server';
import { DatabaseService } from '@database/index';

dotenv.config({ path: '../.env' });

let app: Application;
let db: DatabaseService;

const log = createLogger('TestSetup');

beforeAll(async () => {
  log.info('Test setup started');
  const { server, dbInstance } = serverInstance;
  app = server;
  db = dbInstance;
});

beforeEach(async () => {
  // await db.clearTestDataRecords();
});

afterEach(() => {
  jest.clearAllMocks();
  jest.resetAllMocks();
  jest.resetModules();
});

afterAll(async () => {
  await db.disconnect('test');
  log.info('Test teardown completed');
});

export { app };
