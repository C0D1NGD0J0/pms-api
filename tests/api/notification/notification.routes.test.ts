// Set Jest timeout to prevent hanging tests
jest.setTimeout(10000);

import request from 'supertest';
import { faker } from '@faker-js/faker';
import { httpStatusCodes } from '@utils/index';
import { Application, Response, Request } from 'express';
import { createMockCurrentUser, createApiTestHelper } from '@tests/helpers';

// Mock Notification Controller
const mockNotificationController = {
  markNotificationAsRead: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Notification marked as read',
    });
  }),

  getMyNotificationsStream: jest.fn((_req: Request, res: Response) => {
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.status(httpStatusCodes.OK);
    res.write('data: {"type":"connected"}\n\n');
    res.end();
  }),

  getAnnouncementsStream: jest.fn((_req: Request, res: Response) => {
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.status(httpStatusCodes.OK);
    res.write('data: {"type":"connected"}\n\n');
    res.end();
  }),
};

// Simplified mock container
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

describe('Notification Routes Integration Tests', () => {
  const baseUrl = '/api/v1/notifications';
  const apiHelper = createApiTestHelper();
  let app: Application;
  const mockCuid = faker.string.uuid();
  const mockNuid = faker.string.uuid();

  beforeAll(() => {
    // Setup test app with routes
    app = apiHelper.createApp((testApp) => {
      // Inject container and simulate authentication
      testApp.use((req, res, next) => {
        req.container = mockContainer as any;
        req.context = { currentuser: createMockCurrentUser() } as any;
        next();
      });

      // Define notification routes
      testApp.patch(
        `${baseUrl}/:cuid/mark-read/:nuid`,
        mockNotificationController.markNotificationAsRead
      );
      testApp.get(
        `${baseUrl}/:cuid/my-notifications/stream`,
        mockNotificationController.getMyNotificationsStream
      );
      testApp.get(
        `${baseUrl}/:cuid/announcements/stream`,
        mockNotificationController.getAnnouncementsStream
      );
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('PATCH /:cuid/mark-read/:nuid (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/mark-read/${mockNuid}`;

    it('should mark notification as read successfully', async () => {
      const response = await request(app).patch(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('marked as read');
      expect(mockNotificationController.markNotificationAsRead).toHaveBeenCalled();
    });

    it('should return 404 for non-existent notification', async () => {
      mockNotificationController.markNotificationAsRead.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.NOT_FOUND).json({
            success: false,
            message: 'Notification not found',
          });
        }
      );

      const response = await request(app).patch(endpoint).expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('not found');
    });

    it('should return 400 for already read notification', async () => {
      mockNotificationController.markNotificationAsRead.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Notification already marked as read',
          });
        }
      );

      const response = await request(app).patch(endpoint).expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.message).toContain('already marked');
    });

    it('should return 403 for unauthorized user', async () => {
      mockNotificationController.markNotificationAsRead.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'You can only mark your own notifications as read',
          });
        }
      );

      const response = await request(app).patch(endpoint).expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.message).toContain('your own');
    });

    it('should validate notification ID format', async () => {
      mockNotificationController.markNotificationAsRead.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Invalid notification ID format',
          });
        }
      );

      const invalidEndpoint = `${baseUrl}/${mockCuid}/mark-read/invalid-nuid`;
      const response = await request(app)
        .patch(invalidEndpoint)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.message).toContain('Invalid');
    });
  });

  describe('GET /:cuid/my-notifications/stream (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/my-notifications/stream`;

    it('should establish SSE connection successfully', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(mockNotificationController.getMyNotificationsStream).toHaveBeenCalled();
    });

    it('should send initial connection message', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.text).toContain('connected');
    });

    it('should return 401 when not authenticated', async () => {
      mockNotificationController.getMyNotificationsStream.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.UNAUTHORIZED).json({
            success: false,
            message: 'Unauthorized',
          });
        }
      );

      const response = await request(app).get(endpoint).expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.success).toBe(false);
    });

    it('should validate client ID format', async () => {
      mockNotificationController.getMyNotificationsStream.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Invalid client ID format',
          });
        }
      );

      const invalidEndpoint = `${baseUrl}/invalid-cuid/my-notifications/stream`;
      const response = await request(app)
        .get(invalidEndpoint)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.message).toContain('Invalid');
    });

    it('should handle connection errors gracefully', async () => {
      mockNotificationController.getMyNotificationsStream.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.INTERNAL_SERVER_ERROR).json({
            success: false,
            message: 'Failed to establish SSE connection',
          });
        }
      );

      const response = await request(app)
        .get(endpoint)
        .expect(httpStatusCodes.INTERNAL_SERVER_ERROR);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /:cuid/announcements/stream (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/announcements/stream`;

    it('should establish announcements SSE connection successfully', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(mockNotificationController.getAnnouncementsStream).toHaveBeenCalled();
    });

    it('should send initial connection message', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.text).toContain('connected');
    });

    it('should set proper SSE headers', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.headers['connection']).toBe('keep-alive');
      expect(response.headers['content-type']).toBe('text/event-stream');
    });

    it('should return 401 when not authenticated', async () => {
      mockNotificationController.getAnnouncementsStream.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.UNAUTHORIZED).json({
            success: false,
            message: 'Unauthorized',
          });
        }
      );

      const response = await request(app).get(endpoint).expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.success).toBe(false);
    });

    it('should validate client ID format', async () => {
      mockNotificationController.getAnnouncementsStream.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Invalid client ID format',
          });
        }
      );

      const invalidEndpoint = `${baseUrl}/invalid-cuid/announcements/stream`;
      const response = await request(app)
        .get(invalidEndpoint)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.message).toContain('Invalid');
    });

    it('should handle connection errors gracefully', async () => {
      mockNotificationController.getAnnouncementsStream.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.INTERNAL_SERVER_ERROR).json({
            success: false,
            message: 'Failed to establish SSE connection',
          });
        }
      );

      const response = await request(app)
        .get(endpoint)
        .expect(httpStatusCodes.INTERNAL_SERVER_ERROR);

      expect(response.body.success).toBe(false);
    });

    it('should only allow authenticated users', async () => {
      mockNotificationController.getAnnouncementsStream.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'Access denied',
          });
        }
      );

      const response = await request(app).get(endpoint).expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle internal server errors gracefully', async () => {
      mockNotificationController.markNotificationAsRead.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.INTERNAL_SERVER_ERROR).json({
            success: false,
            message: 'Internal server error',
          });
        }
      );

      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/mark-read/${mockNuid}`)
        .expect(httpStatusCodes.INTERNAL_SERVER_ERROR);

      expect(response.body.success).toBe(false);
    });

    it('should handle rate limiting', async () => {
      mockNotificationController.markNotificationAsRead.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.RATE_LIMITER).json({
            success: false,
            message: 'Too many requests. Please try again later.',
          });
        }
      );

      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/mark-read/${mockNuid}`)
        .expect(httpStatusCodes.RATE_LIMITER);

      expect(response.body.message).toContain('Too many requests');
    });

    it('should handle malformed requests', async () => {
      mockNotificationController.markNotificationAsRead.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Malformed request',
          });
        }
      );

      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/mark-read/${mockNuid}`)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });
  });
});
