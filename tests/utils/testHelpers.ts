import { v4 as uuidv4 } from 'uuid';

import { createMockResponse, createMockRequest } from './mockHelpers';

/**
 * Test data factories for consistent test data generation
 */
export const TestDataFactory = {
  createUser: (overrides: any = {}) => ({
    _id: uuidv4(),
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    displayName: 'testuser',
    phoneNumber: '+12345678901',
    location: 'New York',
    isActive: true,
    ...overrides,
  }),

  createClient: (overrides: any = {}) => ({
    _id: uuidv4(),
    cid: uuidv4(),
    displayName: 'Test Client',
    accountType: {
      planId: 'basic',
      planName: 'Basic Plan',
      isCorporate: false,
      isEnterpriseAccount: false,
    },
    ...overrides,
  }),

  createProfile: (overrides: any = {}) => ({
    _id: uuidv4(),
    userId: uuidv4(),
    firstName: 'Test',
    lastName: 'User',
    displayName: 'testuser',
    ...overrides,
  }),

  createSignupData: (overrides: any = {}) => ({
    email: 'test@example.com',
    password: 'Password123!',
    firstName: 'Test',
    lastName: 'User',
    displayName: 'testuser',
    phoneNumber: '+12345678901',
    location: 'New York',
    lang: 'en',
    timeZone: 'America/New_York',
    accountType: {
      planId: 'basic',
      planName: 'Basic Plan',
      isCorporate: false,
      isEnterpriseAccount: false,
    },
    ...overrides,
  }),

  createLoginData: (overrides: any = {}) => ({
    email: 'test@example.com',
    password: 'Password123!',
    ...overrides,
  }),

  createTokens: (overrides: any = {}) => ({
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    rememberMe: false,
    activeAccount: {
      csub: uuidv4(),
      displayName: 'Test User',
    },
    accounts: [],
    ...overrides,
  }),

  createProperty: (overrides: any = {}) => ({
    _id: uuidv4(),
    pid: uuidv4(),
    cid: uuidv4(),
    name: 'Test Property',
    address: {
      street: '123 Test St',
      city: 'Test City',
      state: 'TS',
      postCode: '12345',
      country: 'Test Country',
      fullAddress: '123 Test St, Test City, TS 12345',
    },
    propertyType: 'house',
    status: 'available',
    managedBy: uuidv4(),
    createdBy: uuidv4(),
    ...overrides,
  }),

  createPropertyUnit: (overrides: any = {}) => ({
    _id: uuidv4(),
    puid: uuidv4(),
    unitNumber: '101',
    propertyId: uuidv4(),
    cid: uuidv4(),
    unitType: 'apartment',
    status: 'available',
    fees: {
      currency: 'USD',
      rentAmount: 1200,
      securityDeposit: 1200,
    },
    specifications: {
      totalArea: 800,
      rooms: 2,
      bathrooms: 1,
      maxOccupants: 4,
    },
    createdBy: uuidv4(),
    ...overrides,
  }),

  createGenericDocument: (overrides: any = {}) => ({
    _id: uuidv4(),
    name: 'Test Document',
    value: 100,
    isActive: true,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),
};

/**
 * HTTP test helpers
 */
export const HttpTestHelpers = {
  createAuthRequest: (userData: any = {}, overrides: any = {}) => {
    return createMockRequest({
      context: { currentuser: TestDataFactory.createUser(userData) },
      ...overrides,
    });
  },

  createUnauthenticatedRequest: (overrides: any = {}) => {
    return createMockRequest({
      context: { currentuser: null },
      ...overrides,
    });
  },

  createRequestWithBody: (body: any, overrides: any = {}) => {
    return createMockRequest({
      body,
      ...overrides,
    });
  },

  createRequestWithQuery: (query: any, overrides: any = {}) => {
    return createMockRequest({
      query,
      ...overrides,
    });
  },

  createRequestWithParams: (params: any, overrides: any = {}) => {
    return createMockRequest({
      params,
      ...overrides,
    });
  },
};

/**
 * Assertion helpers for common test scenarios
 */
export const AssertionHelpers = {
  expectSuccessResponse: (response: any, expectedData?: any) => {
    expect(response.status).toHaveBeenCalledWith(200);
    if (expectedData) {
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          ...expectedData,
        })
      );
    } else {
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    }
  },

  expectErrorResponse: (response: any, statusCode: number, message?: string) => {
    expect(response.status).toHaveBeenCalledWith(statusCode);
    if (message) {
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message,
        })
      );
    } else {
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
        })
      );
    }
  },

  expectServiceCalledWith: (mockService: any, method: string, expectedArgs: any[]) => {
    expect(mockService[method]).toHaveBeenCalledWith(...expectedArgs);
  },

  expectCookiesSet: (response: any, accessToken: string, refreshToken: string) => {
    expect(response.cookie).toHaveBeenCalledWith(
      expect.stringContaining('accessToken'),
      expect.stringContaining(accessToken),
      expect.any(Object)
    );
    expect(response.cookie).toHaveBeenCalledWith(
      expect.stringContaining('refreshToken'),
      expect.stringContaining(refreshToken),
      expect.any(Object)
    );
  },

  expectCookiesCleared: (response: any) => {
    expect(response.clearCookie).toHaveBeenCalledWith(
      expect.stringContaining('accessToken'),
      expect.any(Object)
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      expect.stringContaining('refreshToken'),
      expect.any(Object)
    );
  },
};

/**
 * Test suite utilities
 */
export const TestSuiteHelpers = {
  setupMockResponse: () => createMockResponse(),

  setupMockRequest: (overrides: any = {}) => createMockRequest(overrides),

  expectAsyncError: async (asyncFn: () => Promise<any>, expectedError?: any) => {
    try {
      await asyncFn();
      fail('Expected function to throw an error');
    } catch (error) {
      if (expectedError) {
        expect(error).toEqual(expectedError);
      }
      return error;
    }
  },
};
