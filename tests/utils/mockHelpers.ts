import { jest } from '@jest/globals';
import { Request, Response } from 'express';

/**
 * Creates a mock Express Request object with default properties
 */
export const createMockRequest = (overrides: Partial<Request> = {}): Partial<Request> => {
  const defaultRequest: Partial<Request> = {
    body: {},
    params: {},
    query: {},
    cookies: {},
    headers: {},
    context: { currentuser: null },
    ...overrides,
  };
  return defaultRequest;
};

/**
 * Creates a mock Express Response object with Jest mock functions
 */
export const createMockResponse = (): Partial<Response> => {
  const response: Partial<Response> = {
    status: jest.fn().mockReturnThis() as any,
    json: jest.fn().mockReturnThis() as any,
    send: jest.fn().mockReturnThis() as any,
    clearCookie: jest.fn().mockReturnThis() as any,
    cookie: jest.fn().mockReturnThis() as any,
  };
  return response;
};

/**
 * Type-safe mock creation utility
 */
export const createMock = <T extends object>(defaultImplementation?: Partial<T>): jest.Mocked<T> => {
  return jest.fn().mockImplementation(() => defaultImplementation) as jest.Mocked<T>;
};

/**
 * Creates a service mock with proper typing
 */
export const createServiceMock = <T extends Record<string, any>>(): jest.Mocked<T> => {
  const mock = {} as jest.Mocked<T>;
  
  // Create jest functions for each method that would exist on the service
  const serviceKeys = [
    'signup', 'login', 'accountActivation', 'sendActivationLink', 
    'forgotPassword', 'resetPassword', 'switchActiveAccount', 
    'getCurrentUser', 'logout', 'refreshToken'
  ];
  
  serviceKeys.forEach(key => {
    (mock as any)[key] = jest.fn();
  });
  
  return mock;
};

/**
 * Creates a deep mock of an object with all methods as Jest mocks
 */
export const createDeepMock = <T extends Record<string, any>>(
  obj: T,
  overrides: Partial<T> = {}
): jest.Mocked<T> => {
  const mock = {} as jest.Mocked<T>;
  
  for (const key in obj) {
    if (typeof obj[key] === 'function') {
      (mock as any)[key] = jest.fn();
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      mock[key] = createDeepMock(obj[key]);
    } else {
      (mock as any)[key] = obj[key];
    }
  }
  
  return { ...mock, ...overrides };
};

/**
 * Reset all mocks in an object
 */
export const resetMocks = <T extends Record<string, any>>(mockObj: T): void => {
  Object.values(mockObj).forEach((value) => {
    if (jest.isMockFunction(value)) {
      value.mockReset();
    } else if (typeof value === 'object' && value !== null) {
      resetMocks(value);
    }
  });
};

/**
 * Clear all mocks in an object
 */
export const clearMocks = <T extends Record<string, any>>(mockObj: T): void => {
  Object.values(mockObj).forEach((value) => {
    if (jest.isMockFunction(value)) {
      value.mockClear();
    } else if (typeof value === 'object' && value !== null) {
      clearMocks(value);
    }
  });
};