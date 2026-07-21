jest.setTimeout(10000);

import request from 'supertest';
import { faker } from '@faker-js/faker';
import { httpStatusCodes } from '@utils/index';
import { NextFunction, Application, Response, Request } from 'express';
import { createMockCurrentUser, createApiTestHelper } from '@tests/helpers';

const mockNotificationController = {
  subscribeToPushNotifications: jest.fn((req: Request, res: Response) => {
    const { subscription } = req.body;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        message: 'Invalid push subscription: requires endpoint and keys (p256dh, auth)',
      });
    }
    return res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Push subscription registered successfully.',
    });
  }),

  unsubscribeToPushNotifications: jest.fn((req: Request, res: Response) => {
    const { endpoint } = req.body;
    if (!endpoint) {
      return res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        message: 'Endpoint is required',
      });
    }
    return res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Push subscription removed',
    });
  }),
};

const mockContainer = {
  resolve: jest.fn((service: string) => {
    switch (service) {
      case 'notificationController':
        return mockNotificationController;
      default:
        return {};
    }
  }),
};

describe('Push Notification Routes', () => {
  const baseUrl = '/api/v1/notifications';
  const apiHelper = createApiTestHelper();
  let app: Application;
  const mockCuid = faker.string.uuid();

  beforeAll(() => {
    app = apiHelper.createApp((testApp: Application) => {
      testApp.use((req: Request, res: Response, next: NextFunction) => {
        req.container = mockContainer as any;
        req.context = { currentuser: createMockCurrentUser() } as any;
        next();
      });

      testApp.post(
        `${baseUrl}/:cuid/push/subscribe`,
        mockNotificationController.subscribeToPushNotifications as any
      );
      testApp.post(
        `${baseUrl}/:cuid/push/unsubscribe`,
        mockNotificationController.unsubscribeToPushNotifications as any
      );
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /:cuid/push/subscribe', () => {
    const endpoint = `${baseUrl}/${mockCuid}/push/subscribe`;
    const validBody = {
      subscription: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        keys: {
          p256dh: 'BNcR-base64-encoded-key',
          auth: 'tBH-base64-encoded-auth',
        },
      },
    };

    it('should return 200 with valid subscription', async () => {
      const response = await request(app).post(endpoint).send(validBody).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(mockNotificationController.subscribeToPushNotifications).toHaveBeenCalled();
    });

    it('should return 400 when endpoint is missing', async () => {
      const response = await request(app)
        .post(endpoint)
        .send({ subscription: { keys: { p256dh: 'key', auth: 'auth' } } })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should return 400 when keys.p256dh is missing', async () => {
      const response = await request(app)
        .post(endpoint)
        .send({
          subscription: {
            endpoint: 'https://push.service.com/test',
            keys: { auth: 'auth-only' },
          },
        })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should return 400 when keys.auth is missing', async () => {
      const response = await request(app)
        .post(endpoint)
        .send({
          subscription: {
            endpoint: 'https://push.service.com/test',
            keys: { p256dh: 'key-only' },
          },
        })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should return 400 when subscription is missing entirely', async () => {
      const response = await request(app)
        .post(endpoint)
        .send({})
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /:cuid/push/unsubscribe', () => {
    const endpoint = `${baseUrl}/${mockCuid}/push/unsubscribe`;

    it('should return 200 with valid endpoint', async () => {
      const response = await request(app)
        .post(endpoint)
        .send({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc123' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Push subscription removed');
    });

    it('should return 400 when endpoint is missing', async () => {
      const response = await request(app)
        .post(endpoint)
        .send({})
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Endpoint is required');
    });
  });
});
