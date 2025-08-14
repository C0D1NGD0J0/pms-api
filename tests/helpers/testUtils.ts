import supertest from 'supertest';
import { faker } from '@faker-js/faker';
import { Response, Request } from 'express';

export const createMockRequest = (overrides: any = {}): Partial<Request> => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  cookies: {},
  session: {},
  method: 'GET',
  url: '/',
  path: '/',
  user: undefined,
  ...overrides,
});

export const createMockResponse = (): Partial<Response> => {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
    locals: {},
  };
  return res;
};

export const createMockNext = () => jest.fn();

export const expectValidObjectId = (value: any) => {
  expect(value).toMatch(/^[0-9a-fA-F]{24}$/);
};

export const expectValidEmail = (value: any) => {
  expect(value).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
};

export const expectValidJWT = (value: any) => {
  expect(value).toMatch(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/);
};

export const createTestUser = () => ({
  _id: faker.database.mongodbObjectId(),
  email: faker.internet.email(),
  password: faker.internet.password(),
  isActive: true,
  isEmailVerified: true,
});

export const createAuthenticatedRequest = (user: any = createTestUser()) => ({
  ...createMockRequest(),
  user,
  headers: {
    authorization: `Bearer ${faker.string.alphanumeric(50)}`,
  },
});

export const waitFor = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const createApiTestSuite = (app: any) => {
  const request = supertest(app);

  return {
    get: (url: string) => request.get(url),
    post: (url: string) => request.post(url),
    put: (url: string) => request.put(url),
    patch: (url: string) => request.patch(url),
    delete: (url: string) => request.delete(url),
    withAuth: (token: string) => ({
      get: (url: string) => request.get(url).set('Authorization', `Bearer ${token}`),
      post: (url: string) => request.post(url).set('Authorization', `Bearer ${token}`),
      put: (url: string) => request.put(url).set('Authorization', `Bearer ${token}`),
      patch: (url: string) => request.patch(url).set('Authorization', `Bearer ${token}`),
      delete: (url: string) => request.delete(url).set('Authorization', `Bearer ${token}`),
    }),
  };
};

export const assertError = (error: any, expectedCode: string, expectedMessage?: string) => {
  expect(error).toBeDefined();
  expect(error.code).toBe(expectedCode);
  if (expectedMessage) {
    expect(error.message).toContain(expectedMessage);
  }
};

export const assertSuccess = (result: any, expectedData?: any) => {
  expect(result).toBeDefined();
  expect(result.success).toBe(true);
  if (expectedData) {
    expect(result.data).toMatchObject(expectedData);
  }
};

export const cleanupDatabase = async () => {
  return;
};

export const seedTestData = async () => {
  return;
};

export const mockConsole = () => {
  const originalConsole = { ...console };

  beforeEach(() => {
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
    console.info = jest.fn();
  });

  afterEach(() => {
    Object.assign(console, originalConsole);
  });
};

export const mockDateNow = (date: Date) => {
  const mockNow = jest.spyOn(Date, 'now').mockReturnValue(date.getTime());
  return () => mockNow.mockRestore();
};

export const createMockMulterFile = (overrides: any = {}) => ({
  fieldname: 'file',
  originalname: faker.system.fileName(),
  encoding: '7bit',
  mimetype: 'image/jpeg',
  size: faker.number.int({ min: 1000, max: 100000 }),
  buffer: Buffer.from('mock file content'),
  destination: '/tmp/uploads',
  filename: faker.system.fileName(),
  path: `/tmp/uploads/${faker.system.fileName()}`,
  ...overrides,
});
