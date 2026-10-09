jest.setTimeout(10000);

import request from 'supertest';
import { faker } from '@faker-js/faker';
import { httpStatusCodes } from '@utils/index';
import { Application, Response, Request } from 'express';
import { createMockCurrentUser, createApiTestHelper } from '@tests/helpers';
import { SearchValidations, validateRequest } from '@shared/validations/index';

const mockSearchController = {
  globalSearch: jest.fn((req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        results: [
          { type: 'property', id: 'PID1', title: 'Maple Court', subtitle: '1 Maple St' },
          {
            type: 'lease',
            id: 'LUID1',
            title: 'LS-001',
            subtitle: '1 Maple St',
            status: 'active',
          },
        ],
        receivedQuery: req.query.q,
      },
    });
  }),
};

const mockContainer = {
  cradle: { emitterService: { emit: jest.fn() } },
  resolve: jest.fn((service: string) => {
    if (service === 'searchController') return mockSearchController;
    return {};
  }),
};

describe('Search Routes', () => {
  const baseUrl = '/api/v1/search';
  const apiHelper = createApiTestHelper();
  let app: Application;
  const mockCuid = faker.string.uuid();

  beforeAll(() => {
    app = apiHelper.createApp((testApp: Application) => {
      testApp.use((req: Request, _res: Response, next: any) => {
        req.container = mockContainer as any;
        req.context = { currentuser: createMockCurrentUser() } as any;
        next();
      });

      testApp.get(
        `${baseUrl}/:cuid`,
        validateRequest({ query: SearchValidations.globalSearchQuery }),
        mockSearchController.globalSearch
      );
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /:cuid', () => {
    it('should return 200 with a flat results list', async () => {
      const res = await request(app)
        .get(`${baseUrl}/${mockCuid}`)
        .query({ q: 'maple' })
        .expect(httpStatusCodes.OK);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.results)).toBe(true);
      expect(res.body.data.results[0]).toEqual(
        expect.objectContaining({ type: 'property', id: 'PID1', title: 'Maple Court' })
      );
      expect(mockSearchController.globalSearch).toHaveBeenCalledTimes(1);
    });

    it('should trim the search term before it reaches the controller', async () => {
      const res = await request(app)
        .get(`${baseUrl}/${mockCuid}`)
        .query({ q: '  maple  ' })
        .expect(httpStatusCodes.OK);

      expect(res.body.data.receivedQuery).toBe('maple');
    });

    it('should reject a search term shorter than 2 characters', async () => {
      const res = await request(app)
        .get(`${baseUrl}/${mockCuid}`)
        .query({ q: ' a ' })
        .expect(httpStatusCodes.UNPROCESSABLE);

      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].path).toBe('q');
      expect(mockSearchController.globalSearch).not.toHaveBeenCalled();
    });

    it('should reject a missing search term', async () => {
      await request(app).get(`${baseUrl}/${mockCuid}`).expect(httpStatusCodes.UNPROCESSABLE);

      expect(mockSearchController.globalSearch).not.toHaveBeenCalled();
    });

    it('should reject a search term longer than 100 characters', async () => {
      await request(app)
        .get(`${baseUrl}/${mockCuid}`)
        .query({ q: 'a'.repeat(101) })
        .expect(httpStatusCodes.UNPROCESSABLE);

      expect(mockSearchController.globalSearch).not.toHaveBeenCalled();
    });
  });
});
