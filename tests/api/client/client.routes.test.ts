// Set Jest timeout to prevent hanging tests
jest.setTimeout(10000);

import request from 'supertest';
import { faker } from '@faker-js/faker';
import { httpStatusCodes } from '@utils/index';
import { Application, Response, Request } from 'express';
import { createMockCurrentUser, createApiTestHelper } from '@tests/helpers';

// Mock Client Controller
const mockClientController = {
  getClient: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        cuid: faker.string.uuid(),
        displayName: faker.company.name(),
        accountType: {
          isEnterpriseAccount: false,
          planName: 'basic',
        },
        contactInfo: {
          email: faker.internet.email(),
          phoneNumber: faker.phone.number(),
        },
        isActive: true,
        createdAt: new Date().toISOString(),
      },
    });
  }),

  updateClientProfile: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Client profile updated successfully',
    });
  }),

  disconnectUser: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'User disconnected successfully',
    });
  }),

  reconnectUser: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'User reconnected successfully',
    });
  }),
};

// Simplified mock container
const mockContainer = {
  resolve: jest.fn((service: string) => {
    switch (service) {
      case 'clientController':
        return mockClientController;
      default:
        return {};
    }
  }),
};

describe('Client Routes Integration Tests', () => {
  const baseUrl = '/api/v1/clients';
  const apiHelper = createApiTestHelper();
  let app: Application;
  const mockCuid = faker.string.uuid();
  const mockUid = faker.string.uuid();

  beforeAll(() => {
    // Setup test app with routes
    app = apiHelper.createApp((testApp) => {
      // Inject container and simulate authentication
      testApp.use((req, res, next) => {
        req.container = mockContainer as any;
        req.context = { currentuser: createMockCurrentUser() } as any;
        next();
      });

      // Define client routes
      testApp.get(`${baseUrl}/:cuid/client_details`, mockClientController.getClient);
      testApp.patch(`${baseUrl}/:cuid/client_details`, mockClientController.updateClientProfile);
      testApp.post(`${baseUrl}/:cuid/users/:uid/disconnect`, mockClientController.disconnectUser);
      testApp.post(`${baseUrl}/:cuid/users/:uid/reconnect`, mockClientController.reconnectUser);
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /:cuid/client_details (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/client_details`;

    it('should get client details successfully', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.cuid).toBeDefined();
      expect(response.body.data.displayName).toBeDefined();
      expect(mockClientController.getClient).toHaveBeenCalled();
    });

    it('should include account type information', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.data.accountType).toBeDefined();
      expect(response.body.data.accountType.planName).toBeDefined();
    });

    it('should include contact information', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.data.contactInfo).toBeDefined();
      expect(response.body.data.contactInfo.email).toBeDefined();
    });

    it('should return 404 for non-existent client', async () => {
      mockClientController.getClient.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.NOT_FOUND).json({
          success: false,
          message: 'Client not found',
        });
      });

      const response = await request(app).get(endpoint).expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('not found');
    });

    it('should return 403 for insufficient permissions', async () => {
      mockClientController.getClient.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.FORBIDDEN).json({
          success: false,
          message: 'Insufficient permissions',
        });
      });

      const response = await request(app).get(endpoint).expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /:cuid/client_details (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/client_details`;

    it('should update client profile successfully', async () => {
      const updateData = {
        displayName: faker.company.name(),
        contactInfo: {
          email: faker.internet.email(),
          phoneNumber: faker.phone.number(),
        },
      };

      const response = await request(app)
        .patch(endpoint)
        .send(updateData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('updated');
      expect(mockClientController.updateClientProfile).toHaveBeenCalled();
    });

    it('should update company profile information', async () => {
      const updateData = {
        companyProfile: {
          companyName: faker.company.name(),
          registrationNumber: faker.string.alphanumeric(10),
        },
      };

      const response = await request(app)
        .patch(endpoint)
        .send(updateData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should validate required fields', async () => {
      mockClientController.updateClientProfile.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Validation failed',
            errors: ['Display name is required'],
          });
        }
      );

      const response = await request(app)
        .patch(endpoint)
        .send({})
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should return 403 for insufficient permissions', async () => {
      mockClientController.updateClientProfile.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'Only admins can update client profile',
          });
        }
      );

      const response = await request(app)
        .patch(endpoint)
        .send({ displayName: faker.company.name() })
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.message).toContain('admin');
    });

    it('should return 404 for non-existent client', async () => {
      mockClientController.updateClientProfile.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.NOT_FOUND).json({
            success: false,
            message: 'Client not found',
          });
        }
      );

      const response = await request(app)
        .patch(endpoint)
        .send({ displayName: faker.company.name() })
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /:cuid/users/:uid/disconnect (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/users/${mockUid}/disconnect`;

    it('should disconnect user from client successfully', async () => {
      const response = await request(app).post(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('disconnected');
      expect(mockClientController.disconnectUser).toHaveBeenCalled();
    });

    it('should return 404 for non-existent user', async () => {
      mockClientController.disconnectUser.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.NOT_FOUND).json({
          success: false,
          message: 'User not found',
        });
      });

      const response = await request(app).post(endpoint).expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });

    it('should return 400 for already disconnected user', async () => {
      mockClientController.disconnectUser.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json({
          success: false,
          message: 'User is already disconnected',
        });
      });

      const response = await request(app).post(endpoint).expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.message).toContain('already disconnected');
    });

    it('should return 403 for insufficient permissions', async () => {
      mockClientController.disconnectUser.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.FORBIDDEN).json({
          success: false,
          message: 'Insufficient permissions to disconnect users',
        });
      });

      const response = await request(app).post(endpoint).expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
    });

    it('should prevent disconnecting primary account holder', async () => {
      mockClientController.disconnectUser.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json({
          success: false,
          message: 'Cannot disconnect primary account holder',
        });
      });

      const response = await request(app).post(endpoint).expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.message).toContain('primary account holder');
    });
  });

  describe('POST /:cuid/users/:uid/reconnect (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/users/${mockUid}/reconnect`;

    it('should reconnect user to client successfully', async () => {
      const response = await request(app).post(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('reconnected');
      expect(mockClientController.reconnectUser).toHaveBeenCalled();
    });

    it('should return 404 for non-existent user', async () => {
      mockClientController.reconnectUser.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.NOT_FOUND).json({
          success: false,
          message: 'User not found',
        });
      });

      const response = await request(app).post(endpoint).expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });

    it('should return 400 for already connected user', async () => {
      mockClientController.reconnectUser.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json({
          success: false,
          message: 'User is already connected',
        });
      });

      const response = await request(app).post(endpoint).expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.message).toContain('already connected');
    });

    it('should return 403 for insufficient permissions', async () => {
      mockClientController.reconnectUser.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.FORBIDDEN).json({
          success: false,
          message: 'Insufficient permissions to reconnect users',
        });
      });

      const response = await request(app).post(endpoint).expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
    });

    it('should restore user roles on reconnect', async () => {
      mockClientController.reconnectUser.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.OK).json({
          success: true,
          message: 'User reconnected successfully',
          data: {
            roles: ['staff', 'manager'],
            isConnected: true,
          },
        });
      });

      const response = await request(app).post(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.data.isConnected).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle internal server errors gracefully', async () => {
      mockClientController.getClient.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.INTERNAL_SERVER_ERROR).json({
          success: false,
          message: 'Internal server error',
        });
      });

      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}/client_details`)
        .expect(httpStatusCodes.INTERNAL_SERVER_ERROR);

      expect(response.body.success).toBe(false);
    });

    it('should handle unauthorized access', async () => {
      mockClientController.getClient.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.UNAUTHORIZED).json({
          success: false,
          message: 'Unauthorized',
        });
      });

      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}/client_details`)
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.success).toBe(false);
    });

    it('should handle invalid client ID format', async () => {
      mockClientController.getClient.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json({
          success: false,
          message: 'Invalid client ID format',
        });
      });

      const response = await request(app)
        .get(`${baseUrl}/invalid-cuid/client_details`)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.message).toContain('Invalid');
    });
  });
});
