// Set Jest timeout to prevent hanging tests
jest.setTimeout(10000);

import request from 'supertest';
import { faker } from '@faker-js/faker';
import { httpStatusCodes } from '@utils/index';
import { SMSMessageType, SMSStatus } from '@interfaces/index';
import { NextFunction, Application, Response, Request } from 'express';
import {
  createMockCurrentUser,
  createApiTestHelper,
} from '@tests/helpers/factories/property.factories';

// ---------------------------------------------------------------------------
// Mock User Controller — SMS-related methods
// ---------------------------------------------------------------------------
const mockUserController = {
  sendPhoneOTP: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'OTP sent successfully',
      data: { remaining: 95 },
    });
  }),

  verifyPhoneOTP: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Phone number verified',
      data: {
        verified: true,
        verifiedPhone: '+14155551234',
        verifiedAt: new Date().toISOString(),
      },
    });
  }),

  updateSMSConsent: jest.fn((req: Request, res: Response) => {
    const consent = req.body.consent;
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: consent ? 'SMS consent granted' : 'SMS consent revoked',
      data: {
        consented: consent,
        consentedAt: consent ? new Date().toISOString() : null,
        revokedAt: consent ? null : new Date().toISOString(),
      },
    });
  }),
};

// ---------------------------------------------------------------------------
// Mock Subscription Controller — SMS-related methods
// ---------------------------------------------------------------------------
const mockSubscriptionController = {
  getSMSQuota: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        used: 15,
        limit: 100,
        remaining: 85,
        percentUsed: 15,
        enabled: true,
        resetDate: new Date().toISOString(),
      },
    });
  }),

  getSMSLogs: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: [
        {
          smsuid: faker.string.uuid(),
          messageType: SMSMessageType.OTP,
          recipientPhone: '+14155551234',
          status: SMSStatus.DELIVERED,
          sentAt: new Date().toISOString(),
        },
      ],
      pagination: {
        total: 1,
        page: 1,
        pages: 1,
        limit: 20,
      },
    });
  }),
};

// ---------------------------------------------------------------------------
// Mock container
// ---------------------------------------------------------------------------
const mockContainer = {
  resolve: jest.fn((service: string) => {
    switch (service) {
      case 'subscriptionController':
        return mockSubscriptionController;
      case 'userController':
        return mockUserController;
      default:
        return {};
    }
  }),
};

// ===========================================================================
// Test Suite: SMS User Routes (verify-phone, confirm-otp, sms-consent)
// ===========================================================================
describe('SMS User Routes', () => {
  const baseUrl = '/api/v1/users';
  const apiHelper = createApiTestHelper();
  let app: Application;
  const mockCuid = faker.string.uuid();

  beforeAll(() => {
    app = apiHelper.createApp((testApp: Application) => {
      // Inject container + simulate authenticated context
      testApp.use((req: Request, _res: Response, next: NextFunction) => {
        req.container = mockContainer as any;
        req.context = { currentuser: createMockCurrentUser() } as any;
        next();
      });

      // Register SMS user routes — mirrors app/routes/users.routes.ts
      testApp.post(
        `${baseUrl}/:cuid/verify-phone`,
        mockUserController.sendPhoneOTP
      );
      testApp.post(
        `${baseUrl}/:cuid/confirm-otp`,
        mockUserController.verifyPhoneOTP
      );
      testApp.patch(
        `${baseUrl}/:cuid/sms-consent`,
        mockUserController.updateSMSConsent
      );
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // POST /:cuid/verify-phone
  // -------------------------------------------------------------------------
  describe('POST /:cuid/verify-phone', () => {
    const endpoint = `${baseUrl}/${mockCuid}/verify-phone`;

    it('should send OTP successfully with valid E.164 phone number', async () => {
      const response = await request(app)
        .post(endpoint)
        .send({ phoneNumber: '+14155551234' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('OTP');
      expect(response.body.data).toHaveProperty('remaining');
      expect(mockUserController.sendPhoneOTP).toHaveBeenCalledTimes(1);
    });

    it('should accept international E.164 phone numbers', async () => {
      const response = await request(app)
        .post(endpoint)
        .send({ phoneNumber: '+447911123456' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(mockUserController.sendPhoneOTP).toHaveBeenCalledTimes(1);
    });

    it('should return 400 when phoneNumber is missing', async () => {
      mockUserController.sendPhoneOTP.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'phoneNumber is required',
          });
        }
      );

      const response = await request(app)
        .post(endpoint)
        .send({})
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
      expect(mockUserController.sendPhoneOTP).toHaveBeenCalledTimes(1);
    });

    it('should return 400 when phoneNumber is not E.164 format', async () => {
      mockUserController.sendPhoneOTP.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Must be E.164 format (e.g., +14155551234)',
          });
        }
      );

      const response = await request(app)
        .post(endpoint)
        .send({ phoneNumber: '4155551234' })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('E.164');
    });

    it('should handle rate limit exceeded', async () => {
      mockUserController.sendPhoneOTP.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.RATE_LIMITER).json({
            success: false,
            message: 'Too many OTP requests, please try again later',
          });
        }
      );

      const response = await request(app)
        .post(endpoint)
        .send({ phoneNumber: '+14155551234' })
        .expect(httpStatusCodes.RATE_LIMITER);

      expect(response.body.success).toBe(false);
    });

    it('should handle quota exceeded error', async () => {
      mockUserController.sendPhoneOTP.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'SMS quota exceeded for this billing period',
          });
        }
      );

      const response = await request(app)
        .post(endpoint)
        .send({ phoneNumber: '+14155551234' })
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('quota');
    });
  });

  // -------------------------------------------------------------------------
  // POST /:cuid/confirm-otp
  // -------------------------------------------------------------------------
  describe('POST /:cuid/confirm-otp', () => {
    const endpoint = `${baseUrl}/${mockCuid}/confirm-otp`;

    it('should verify OTP successfully with valid phone and 6-digit code', async () => {
      const response = await request(app)
        .post(endpoint)
        .send({ phoneNumber: '+14155551234', otp: '123456' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('verified', true);
      expect(response.body.data).toHaveProperty('verifiedPhone');
      expect(response.body.data).toHaveProperty('verifiedAt');
      expect(mockUserController.verifyPhoneOTP).toHaveBeenCalledTimes(1);
    });

    it('should return 400 when otp is missing', async () => {
      mockUserController.verifyPhoneOTP.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'otp is required',
          });
        }
      );

      const response = await request(app)
        .post(endpoint)
        .send({ phoneNumber: '+14155551234' })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
      expect(mockUserController.verifyPhoneOTP).toHaveBeenCalledTimes(1);
    });

    it('should return 400 when otp is not exactly 6 digits', async () => {
      mockUserController.verifyPhoneOTP.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'OTP must be 6 digits',
          });
        }
      );

      const response = await request(app)
        .post(endpoint)
        .send({ phoneNumber: '+14155551234', otp: '12345' })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('6 digits');
    });

    it('should return 400 when phoneNumber is invalid E.164', async () => {
      mockUserController.verifyPhoneOTP.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Must be E.164 format',
          });
        }
      );

      const response = await request(app)
        .post(endpoint)
        .send({ phoneNumber: '555-1234', otp: '123456' })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('E.164');
    });

    it('should return 400 when both phoneNumber and otp are missing', async () => {
      mockUserController.verifyPhoneOTP.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'phoneNumber and otp are required',
          });
        }
      );

      const response = await request(app)
        .post(endpoint)
        .send({})
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
      expect(mockUserController.verifyPhoneOTP).toHaveBeenCalledTimes(1);
    });

    it('should handle expired OTP error', async () => {
      mockUserController.verifyPhoneOTP.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'OTP has expired or is invalid',
          });
        }
      );

      const response = await request(app)
        .post(endpoint)
        .send({ phoneNumber: '+14155551234', otp: '999999' })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('expired');
    });

    it('should handle too many failed verification attempts', async () => {
      mockUserController.verifyPhoneOTP.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.RATE_LIMITER).json({
            success: false,
            message: 'Too many failed attempts, request a new OTP',
          });
        }
      );

      const response = await request(app)
        .post(endpoint)
        .send({ phoneNumber: '+14155551234', otp: '000000' })
        .expect(httpStatusCodes.RATE_LIMITER);

      expect(response.body.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /:cuid/sms-consent
  // -------------------------------------------------------------------------
  describe('PATCH /:cuid/sms-consent', () => {
    const endpoint = `${baseUrl}/${mockCuid}/sms-consent`;

    it('should grant SMS consent when consent is true', async () => {
      const response = await request(app)
        .patch(endpoint)
        .send({ consent: true })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('granted');
      expect(response.body.data.consented).toBe(true);
      expect(response.body.data.consentedAt).toBeDefined();
      expect(mockUserController.updateSMSConsent).toHaveBeenCalledTimes(1);
    });

    it('should revoke SMS consent when consent is false', async () => {
      const response = await request(app)
        .patch(endpoint)
        .send({ consent: false })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('revoked');
      expect(response.body.data.consented).toBe(false);
      expect(response.body.data.revokedAt).toBeDefined();
      expect(mockUserController.updateSMSConsent).toHaveBeenCalledTimes(1);
    });

    it('should return 400 when consent field is missing', async () => {
      mockUserController.updateSMSConsent.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'consent is required',
          });
        }
      );

      const response = await request(app)
        .patch(endpoint)
        .send({})
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
      expect(mockUserController.updateSMSConsent).toHaveBeenCalledTimes(1);
    });

    it('should return 400 when consent is not a boolean', async () => {
      mockUserController.updateSMSConsent.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'consent must be a boolean',
          });
        }
      );

      const response = await request(app)
        .patch(endpoint)
        .send({ consent: 'yes' })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should handle unverified phone error', async () => {
      mockUserController.updateSMSConsent.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Phone number must be verified before granting SMS consent',
          });
        }
      );

      const response = await request(app)
        .patch(endpoint)
        .send({ consent: true })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('verified');
    });
  });

  // -------------------------------------------------------------------------
  // Authentication tests
  // -------------------------------------------------------------------------
  describe('Authentication', () => {
    let unauthenticatedApp: Application;

    beforeAll(() => {
      unauthenticatedApp = apiHelper.createApp((testApp: Application) => {
        // No context injected — simulates unauthenticated request
        testApp.post(`${baseUrl}/:cuid/verify-phone`, (_req: Request, res: Response) => {
          res.status(httpStatusCodes.UNAUTHORIZED).json({
            success: false,
            message: 'Authentication required',
          });
        });
        testApp.post(`${baseUrl}/:cuid/confirm-otp`, (_req: Request, res: Response) => {
          res.status(httpStatusCodes.UNAUTHORIZED).json({
            success: false,
            message: 'Authentication required',
          });
        });
        testApp.patch(`${baseUrl}/:cuid/sms-consent`, (_req: Request, res: Response) => {
          res.status(httpStatusCodes.UNAUTHORIZED).json({
            success: false,
            message: 'Authentication required',
          });
        });
      });
    });

    it('should return 401 for verify-phone without auth cookie', async () => {
      const response = await request(unauthenticatedApp)
        .post(`${baseUrl}/${mockCuid}/verify-phone`)
        .send({ phoneNumber: '+14155551234' })
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Authentication');
    });

    it('should return 401 for confirm-otp without auth cookie', async () => {
      const response = await request(unauthenticatedApp)
        .post(`${baseUrl}/${mockCuid}/confirm-otp`)
        .send({ phoneNumber: '+14155551234', otp: '123456' })
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.success).toBe(false);
    });

    it('should return 401 for sms-consent without auth cookie', async () => {
      const response = await request(unauthenticatedApp)
        .patch(`${baseUrl}/${mockCuid}/sms-consent`)
        .send({ consent: true })
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Cross-tenant (wrong cuid) tests
  // -------------------------------------------------------------------------
  describe('Cross-tenant access', () => {
    it('should return 403 when cuid does not match user client', async () => {
      mockUserController.sendPhoneOTP.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'Unauthorized access to this client',
          });
        }
      );

      const wrongCuid = faker.string.uuid();
      const response = await request(app)
        .post(`${baseUrl}/${wrongCuid}/verify-phone`)
        .send({ phoneNumber: '+14155551234' })
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------
  describe('Error Handling', () => {
    it('should handle internal server errors gracefully', async () => {
      mockUserController.sendPhoneOTP.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.INTERNAL_SERVER_ERROR).json({
            success: false,
            message: 'Internal server error',
          });
        }
      );

      const response = await request(app)
        .post(`${baseUrl}/${mockCuid}/verify-phone`)
        .send({ phoneNumber: '+14155551234' })
        .expect(httpStatusCodes.INTERNAL_SERVER_ERROR);

      expect(response.body.success).toBe(false);
    });
  });
});

// ===========================================================================
// Test Suite: SMS Subscription Routes (sms-quota, sms-logs)
// ===========================================================================
describe('SMS Subscription Routes', () => {
  const baseUrl = '/api/v1/subscriptions';
  const apiHelper = createApiTestHelper();
  let app: Application;
  let unauthenticatedApp: Application;
  const mockCuid = faker.string.uuid();

  // Mock Subscription Controller for this suite
  const suiteSubscriptionController = {
    getSMSQuota: jest.fn((_req: Request, res: Response) => {
      res.status(httpStatusCodes.OK).json({
        success: true,
        data: {
          used: 15,
          limit: 100,
          remaining: 85,
          percentUsed: 15,
          enabled: true,
          resetDate: new Date().toISOString(),
        },
      });
    }),

    getSMSLogs: jest.fn((_req: Request, res: Response) => {
      res.status(httpStatusCodes.OK).json({
        success: true,
        data: [
          {
            smsuid: faker.string.uuid(),
            messageType: SMSMessageType.OTP,
            recipientPhone: '+14155551234',
            status: SMSStatus.DELIVERED,
            sentAt: new Date().toISOString(),
          },
        ],
        pagination: {
          total: 1,
          page: 1,
          pages: 1,
          limit: 20,
        },
      });
    }),
  };

  const suiteContainer = {
    resolve: jest.fn((service: string) => {
      if (service === 'subscriptionController') {
        return suiteSubscriptionController;
      }
      return {};
    }),
  };

  beforeAll(() => {
    // Authenticated app
    app = apiHelper.createApp((testApp: Application) => {
      testApp.use((req: Request, _res: Response, next: NextFunction) => {
        req.container = suiteContainer as any;
        req.context = { currentuser: createMockCurrentUser() } as any;
        next();
      });

      testApp.get(
        `${baseUrl}/:cuid/sms-quota`,
        suiteSubscriptionController.getSMSQuota
      );
      testApp.get(
        `${baseUrl}/:cuid/sms-logs`,
        suiteSubscriptionController.getSMSLogs
      );
    });

    // Unauthenticated app
    unauthenticatedApp = apiHelper.createApp((testApp: Application) => {
      testApp.get(`${baseUrl}/:cuid/sms-quota`, (_req: Request, res: Response) => {
        res.status(httpStatusCodes.UNAUTHORIZED).json({
          success: false,
          message: 'Authentication required',
        });
      });
      testApp.get(`${baseUrl}/:cuid/sms-logs`, (_req: Request, res: Response) => {
        res.status(httpStatusCodes.UNAUTHORIZED).json({
          success: false,
          message: 'Authentication required',
        });
      });
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // GET /:cuid/sms-quota
  // -------------------------------------------------------------------------
  describe('GET /:cuid/sms-quota', () => {
    const endpoint = `${baseUrl}/${mockCuid}/sms-quota`;

    it('should return SMS quota status successfully', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('used');
      expect(response.body.data).toHaveProperty('limit');
      expect(response.body.data).toHaveProperty('remaining');
      expect(response.body.data).toHaveProperty('percentUsed');
      expect(response.body.data).toHaveProperty('enabled');
      expect(response.body.data).toHaveProperty('resetDate');
      expect(suiteSubscriptionController.getSMSQuota).toHaveBeenCalledTimes(1);
    });

    it('should return numeric quota values', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      const { data } = response.body;
      expect(typeof data.used).toBe('number');
      expect(typeof data.limit).toBe('number');
      expect(typeof data.remaining).toBe('number');
      expect(typeof data.percentUsed).toBe('number');
      expect(data.remaining).toBe(data.limit - data.used);
    });

    it('should return 401 without authentication', async () => {
      const response = await request(unauthenticatedApp)
        .get(endpoint)
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Authentication');
    });

    it('should return 403 when user lacks BILLING READ permission', async () => {
      suiteSubscriptionController.getSMSQuota.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'Insufficient permissions',
          });
        }
      );

      const response = await request(app).get(endpoint).expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('permissions');
    });

    it('should return 403 when SMS feature is not enabled', async () => {
      suiteSubscriptionController.getSMSQuota.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'SMS feature is not enabled for this plan',
          });
        }
      );

      const response = await request(app).get(endpoint).expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('SMS');
    });

    it('should return 403 when non-super-admin tries to access quota', async () => {
      suiteSubscriptionController.getSMSQuota.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'Only account owner can view SMS quota',
          });
        }
      );

      const response = await request(app).get(endpoint).expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('account owner');
    });
  });

  // -------------------------------------------------------------------------
  // GET /:cuid/sms-logs
  // -------------------------------------------------------------------------
  describe('GET /:cuid/sms-logs', () => {
    const endpoint = `${baseUrl}/${mockCuid}/sms-logs`;

    it('should return SMS logs successfully', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.pagination).toBeDefined();
      expect(suiteSubscriptionController.getSMSLogs).toHaveBeenCalledTimes(1);
    });

    it('should return logs with correct structure', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      const log = response.body.data[0];
      expect(log).toHaveProperty('smsuid');
      expect(log).toHaveProperty('messageType');
      expect(log).toHaveProperty('recipientPhone');
      expect(log).toHaveProperty('status');
      expect(log).toHaveProperty('sentAt');
    });

    it('should return pagination metadata', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.pagination).toHaveProperty('total');
      expect(response.body.pagination).toHaveProperty('page');
      expect(response.body.pagination).toHaveProperty('pages');
      expect(response.body.pagination).toHaveProperty('limit');
    });

    it('should accept messageType filter query parameter', async () => {
      const response = await request(app)
        .get(endpoint)
        .query({ messageType: SMSMessageType.OTP })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(suiteSubscriptionController.getSMSLogs).toHaveBeenCalledTimes(1);
    });

    it('should accept status filter query parameter', async () => {
      const response = await request(app)
        .get(endpoint)
        .query({ status: SMSStatus.DELIVERED })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(suiteSubscriptionController.getSMSLogs).toHaveBeenCalledTimes(1);
    });

    it('should accept pagination query parameters', async () => {
      const response = await request(app)
        .get(endpoint)
        .query({ page: 2, limit: 50 })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(suiteSubscriptionController.getSMSLogs).toHaveBeenCalledTimes(1);
    });

    it('should return 401 without authentication', async () => {
      const response = await request(unauthenticatedApp)
        .get(endpoint)
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.success).toBe(false);
    });

    it('should return 403 when user lacks BILLING READ permission', async () => {
      suiteSubscriptionController.getSMSLogs.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'Insufficient permissions',
          });
        }
      );

      const response = await request(app).get(endpoint).expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('permissions');
    });

    it('should return 403 when non-super-admin tries to access logs', async () => {
      suiteSubscriptionController.getSMSLogs.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'Only account owner can view SMS logs',
          });
        }
      );

      const response = await request(app).get(endpoint).expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('account owner');
    });

    it('should return 403 when SMS feature is not enabled', async () => {
      suiteSubscriptionController.getSMSLogs.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'SMS feature is not enabled for this plan',
          });
        }
      );

      const response = await request(app).get(endpoint).expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('SMS');
    });

    it('should handle empty logs response', async () => {
      suiteSubscriptionController.getSMSLogs.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.OK).json({
            success: true,
            data: [],
            pagination: { total: 0, page: 1, pages: 0, limit: 20 },
          });
        }
      );

      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
      expect(response.body.pagination.total).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Cross-tenant access
  // -------------------------------------------------------------------------
  describe('Cross-tenant access', () => {
    it('should return 403 for sms-quota when cuid does not match', async () => {
      suiteSubscriptionController.getSMSQuota.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'Unauthorized access',
          });
        }
      );

      const wrongCuid = faker.string.uuid();
      const response = await request(app)
        .get(`${baseUrl}/${wrongCuid}/sms-quota`)
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
    });

    it('should return 403 for sms-logs when cuid does not match', async () => {
      suiteSubscriptionController.getSMSLogs.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'Unauthorized access',
          });
        }
      );

      const wrongCuid = faker.string.uuid();
      const response = await request(app)
        .get(`${baseUrl}/${wrongCuid}/sms-logs`)
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------
  describe('Error Handling', () => {
    it('should handle internal server errors for sms-quota', async () => {
      suiteSubscriptionController.getSMSQuota.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.INTERNAL_SERVER_ERROR).json({
            success: false,
            message: 'Internal server error',
          });
        }
      );

      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}/sms-quota`)
        .expect(httpStatusCodes.INTERNAL_SERVER_ERROR);

      expect(response.body.success).toBe(false);
    });

    it('should handle internal server errors for sms-logs', async () => {
      suiteSubscriptionController.getSMSLogs.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.INTERNAL_SERVER_ERROR).json({
            success: false,
            message: 'Internal server error',
          });
        }
      );

      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}/sms-logs`)
        .expect(httpStatusCodes.INTERNAL_SERVER_ERROR);

      expect(response.body.success).toBe(false);
    });
  });
});
