import { appRequest } from '@tests/utils';

describe('Server status', () => {
  it('should return 200 on health check', async () => {
    const response = await appRequest.get('/api/v1/healthcheck');
    expect(response.status).toBe(200);
  });
});
