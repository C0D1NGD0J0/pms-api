import { appRequest } from '@tests/utils';
import { httpStatusCodes } from '@utils/index';

const _FRONTEND_URL = 'https://example.com';
const baseUrl = '/api/v1/auth';

describe('Auth API Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /auth/signup', () => {
    it('should successfully create a new user', async () => {
      const response = await appRequest.post(`${baseUrl}/signup`).send({});

      // Check response
      expect(response.status).toBe(httpStatusCodes.OK);
      expect(response.body.success).toBe(true);
      expect(response.body.msg).toContain('Account activation email has been sent');

      // Verify email was queued
    });
  });
});
