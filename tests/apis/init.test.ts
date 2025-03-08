import request from 'supertest';

import { app } from '../setup';

describe('Server status', () => {
  it('should return 200 on health check', async () => {
    const response = await request(app).get('/api/v1/healthcheck');
    expect(response.status).toBe(200);
  });
});
