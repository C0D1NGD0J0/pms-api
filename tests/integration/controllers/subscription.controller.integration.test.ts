import request from 'supertest';
import { Types } from 'mongoose';
import cookieParser from 'cookie-parser';
import { Subscription } from '@models/index';
import express, { Application } from 'express';
import { httpStatusCodes } from '@utils/constants';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { ROLES } from '@shared/constants/roles.constants';
import { setupAllExternalMocks } from '@tests/setup/externalMocks';
import { SubscriptionController } from '@controllers/SubscriptionController';
import { SubscriptionService } from '@services/subscription/subscription.service';
import { beforeEach, beforeAll, afterAll, describe, expect, it } from '@jest/globals';
import { disconnectTestDatabase, setupTestDatabase, clearTestDatabase } from '@tests/helpers';

describe('SubscriptionController Integration Tests', () => {
  let app: Application;
  let subscriptionController: SubscriptionController;
  let mockStripeService: any;
  let superAdminUser: any;
  let regularAdminUser: any;

  const mockContext = (role: string, cuid: string, email: string) => ({
    currentuser: {
      sub: new Types.ObjectId().toString(),
      uid: `uid-${role}`,
      email,
      activecuid: cuid,
      client: {
        cuid,
        role,
      },
    },
  });

  beforeAll(async () => {
    await setupTestDatabase();
    setupAllExternalMocks();

    const subscriptionDAO = new SubscriptionDAO();

    mockStripeService = {
      createCheckoutSession: jest.fn().mockResolvedValue({
        sessionId: 'cs_test_123',
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123',
      }),
      getProductsWithPrices: jest.fn().mockResolvedValue(
        new Map([
          ['portfolio', { priceId: 'price_professional', amount: 9900 }],
          ['growth', { priceId: 'price_starter', amount: 2900 }],
          ['essential', { priceId: 'price_basic', amount: 0 }],
        ])
      ),
    };

    const subscriptionService = new SubscriptionService({
      subscriptionDAO,
      stripeService: mockStripeService,
    });

    subscriptionController = new SubscriptionController({ subscriptionService });

    // Setup Express app
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use((req, res, next) => {
      req.container = {} as any;
      next();
    });

    // Setup routes
    app.post('/api/v1/subscriptions/:cuid/init-subscription-payment', async (req, res) => {
      await subscriptionController.initSubscriptionPayment(req as any, res);
    });
  });

  beforeEach(async () => {
    await clearTestDatabase();
    jest.clearAllMocks();

    superAdminUser = {
      role: ROLES.SUPER_ADMIN,
      email: 'superadmin@example.com',
      cuid: 'client-super',
    };

    regularAdminUser = {
      role: ROLES.ADMIN,
      email: 'admin@example.com',
      cuid: 'client-admin',
    };
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  describe('POST /subscriptions/:cuid/init-subscription-payment', () => {
    it('should create checkout session for super-admin with pending_payment subscription', async () => {
      const client = new Types.ObjectId();
      await Subscription.create({
        cuid: superAdminUser.cuid,
        suid: 'suid-test',
        client,
        planName: 'portfolio',
        status: 'pending_payment',
        paymentGateway: {
          customerId: '',
          provider: 'stripe',
          planId: 'price_professional_monthly',
        },
        totalMonthlyPrice: 9900,
        billingInterval: 'monthly',
        currentSeats: 1,
        currentProperties: 0,
        currentUnits: 0,
        startDate: new Date(),
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
      });

      const _response = await request(app)
        .post(`/api/v1/subscriptions/${superAdminUser.cuid}/init-subscription-payment`)
        .set('x-test-context', JSON.stringify(mockContext(ROLES.SUPER_ADMIN, superAdminUser.cuid, superAdminUser.email)))
        .send({
          successUrl: 'https://app.example.com/success',
          cancelUrl: 'https://app.example.com/cancel',
        });

      // Manually set context since middleware isn't running in test
      const req = {
        context: mockContext(ROLES.SUPER_ADMIN, superAdminUser.cuid, superAdminUser.email),
        params: { cuid: superAdminUser.cuid },
        body: {
          successUrl: 'https://app.example.com/success',
          cancelUrl: 'https://app.example.com/cancel',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await subscriptionController.initSubscriptionPayment(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            sessionId: 'cs_test_123',
            checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123',
          }),
        })
      );
    });

    it('should return 403 for regular admin trying to initiate payment', async () => {
      const client = new Types.ObjectId();
      await Subscription.create({
        cuid: regularAdminUser.cuid,
        suid: 'suid-admin',
        client,
        planName: 'portfolio',
        status: 'pending_payment',
        paymentGateway: {
          customerId: '',
          provider: 'stripe',
          planId: 'price_professional_monthly',
        },
        totalMonthlyPrice: 9900,
        billingInterval: 'monthly',
        currentSeats: 1,
        currentProperties: 0,
        currentUnits: 0,
        startDate: new Date(),
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
      });

      const req = {
        context: mockContext(ROLES.ADMIN, regularAdminUser.cuid, regularAdminUser.email),
        params: { cuid: regularAdminUser.cuid },
        body: {
          successUrl: 'https://app.example.com/success',
          cancelUrl: 'https://app.example.com/cancel',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await expect(
        subscriptionController.initSubscriptionPayment(req as any, res as any)
      ).rejects.toThrow('Only account owner can manage billing');
    });

    it('should return 401 for user trying to access different client subscription', async () => {
      const client = new Types.ObjectId();
      await Subscription.create({
        cuid: 'different-client',
        suid: 'suid-diff',
        client,
        planName: 'portfolio',
        status: 'pending_payment',
        paymentGateway: {
          customerId: '',
          provider: 'stripe',
          planId: 'price_professional_monthly',
        },
        totalMonthlyPrice: 9900,
        billingInterval: 'monthly',
        currentSeats: 1,
        currentProperties: 0,
        currentUnits: 0,
        startDate: new Date(),
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
      });

      const req = {
        context: mockContext(ROLES.SUPER_ADMIN, superAdminUser.cuid, superAdminUser.email),
        params: { cuid: 'different-client' },
        body: {
          successUrl: 'https://app.example.com/success',
          cancelUrl: 'https://app.example.com/cancel',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await expect(
        subscriptionController.initSubscriptionPayment(req as any, res as any)
      ).rejects.toThrow('Unauthorized access');
    });

    it('should return 400 when subscription is not in pending_payment status', async () => {
      const client = new Types.ObjectId();
      await Subscription.create({
        cuid: superAdminUser.cuid,
        suid: 'suid-active',
        client,
        planName: 'portfolio',
        status: 'active',
        paymentGateway: {
          customerId: 'cus_123',
          provider: 'stripe',
          planId: 'price_professional_monthly',
        },
        totalMonthlyPrice: 9900,
        billingInterval: 'monthly',
        currentSeats: 1,
        currentProperties: 0,
        currentUnits: 0,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
      });

      const req = {
        context: mockContext(ROLES.SUPER_ADMIN, superAdminUser.cuid, superAdminUser.email),
        params: { cuid: superAdminUser.cuid },
        body: {
          successUrl: 'https://app.example.com/success',
          cancelUrl: 'https://app.example.com/cancel',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await expect(
        subscriptionController.initSubscriptionPayment(req as any, res as any)
      ).rejects.toThrow('Payment already completed or subscription not in pending state');
    });

    it('should use annual price for annual billing interval', async () => {
      const client = new Types.ObjectId();
      await Subscription.create({
        cuid: superAdminUser.cuid,
        suid: 'suid-annual',
        client,
        planName: 'portfolio',
        status: 'pending_payment',
        paymentGateway: {
          customerId: '',
          provider: 'stripe',
          planId: 'price_professional_annual',
        },
        totalMonthlyPrice: 9900,
        billingInterval: 'annual',
        currentSeats: 1,
        currentProperties: 0,
        currentUnits: 0,
        startDate: new Date(),
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
      });

      const req = {
        context: mockContext(ROLES.SUPER_ADMIN, superAdminUser.cuid, superAdminUser.email),
        params: { cuid: superAdminUser.cuid },
        body: {
          successUrl: 'https://app.example.com/success',
          cancelUrl: 'https://app.example.com/cancel',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await subscriptionController.initSubscriptionPayment(req as any, res as any);

      expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          priceId: 'price_professional_annual',
        })
      );
    });
  });
});
