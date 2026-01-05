import { IRequestContext } from '@interfaces/index';

/**
 * Create a mock request context for integration tests
 * This helper provides a strongly-typed mock context that satisfies the IRequestContext interface
 *
 * @param user - The user object to create context for
 * @param cuid - The client ID
 * @returns A partial IRequestContext that can be used with `as any` type assertion
 */
export const mockRequestContext = (user: any, cuid: string): Partial<IRequestContext> => {
  return {
    currentuser: {
      sub: user._id.toString(),
      uid: user.uid,
      email: user.email,
      activecuid: cuid,
      client: {
        cuid,
        role: user.cuids?.find((c: any) => c.cuid === cuid)?.roles[0] || 'staff',
      },
    },
    request: {
      params: { cuid },
      url: '/test',
      method: 'GET',
      path: '/test',
      query: {},
    },
    requestId: 'test-request-id',
    userAgent: 'Jest Test Runner',
    langSetting: 'en',
    timing: {
      start: Date.now(),
    },
  } as any;
};

/**
 * Create a mock request context for unauthenticated requests
 * Useful for testing public endpoints like invitation validation
 */
export const mockUnauthenticatedContext = (): Partial<IRequestContext> => {
  return {
    currentuser: null,
    request: {
      params: {},
      url: '/test',
      method: 'GET',
      path: '/test',
      query: {},
    },
    requestId: 'test-request-id',
    userAgent: 'Jest Test Runner',
    langSetting: 'en',
    timing: {
      start: Date.now(),
    },
  } as any;
};
