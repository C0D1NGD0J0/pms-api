import request from 'supertest';
import { Types } from 'mongoose';
import cookieParser from 'cookie-parser';
import { Subscription } from '@models/index';
import express, { Application } from 'express';
import { httpStatusCodes } from '@utils/constants';
import { clearTestDatabase } from '@tests/helpers';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { ROLES } from '@shared/constants/roles.constants';
import { setupAllExternalMocks } from '@tests/setup/externalMocks';
import { beforeEach, beforeAll, describe, expect, it } from '@jest/globals';
import { SubscriptionController } from '@controllers/SubscriptionController';
import { SubscriptionService } from '@services/subscription/subscription.service';

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
    setupAllExternalMocks();

    const subscriptionDAO = new SubscriptionDAO();

    mockStripeService = {
      createCheckoutSession: jest.fn().mockResolvedValue({
        sessionId: 'cs_test_123',
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123',
      }),
      getProductsWithPrices: jest.fn().mockResolvedValue(
        new Map([
          [
            'portfolio',
            {
              monthly: {
                priceId: 'price_portfolio_monthly',
                amount: 14999,
                lookUpKey: 'portfolio_monthly',
              },
              annual: {
                priceId: 'price_portfolio_annual',
                amount: 144000,
                lookUpKey: 'portfolio_annual',
              },
            },
          ],
          [
            'essential',
            {
              monthly: {
                priceId: 'price_essential_monthly',
                amount: 0,
                lookUpKey: 'essential_monthly',
              },
              annual: {
                priceId: 'price_essential_annual',
                amount: 0,
                lookUpKey: 'essential_annual',
              },
            },
          ],
          [
            'growth',
            {
              monthly: {
                priceId: 'price_growth_monthly',
                amount: 7999,
                lookUpKey: 'growth_monthly',
              },
              annual: {
                priceId: 'price_growth_annual',
                amount: 76800,
                lookUpKey: 'growth_annual',
              },
            },
          ],
        ])
      ),
    };

    const subscriptionService = new SubscriptionService({
      subscriptionDAO,
      paymentGatewayService: mockStripeService,
      emitterService: {} as any,
      sseService: {} as any,
      clientDAO: {} as any,
      authCache: {} as any,
      userDAO: {} as any,
      propertyDAO: {} as any,
      propertyUnitDAO: {} as any,
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

    app.get('/api/v1/subscriptions/plans', async (req, res) => {
      await subscriptionController.getSubscriptionPlans(req as any, res);
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

  describe('POST /subscriptions/:cuid/init-subscription-payment', () => {
    it('should create checkout session for super-admin with pending_payment subscription', async () => {
      const client = new Types.ObjectId();
      await Subscription.create({
        cuid: superAdminUser.cuid,
        suid: 'suid-test',
        client,
        planName: 'portfolio',
        status: 'pending_payment',
        billing: {
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
        .set(
          'x-test-context',
          JSON.stringify(mockContext(ROLES.SUPER_ADMIN, superAdminUser.cuid, superAdminUser.email))
        )
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
        billing: {
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
        billing: {
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
        billing: {
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
        billing: {
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

  describe('GET /subscriptions/plans - getSubscriptionPlans', () => {
    it('should return all subscription plans with correct structure', async () => {
      const response = await request(app)
        .get('/api/v1/subscriptions/plans')
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBe(3);

      const plan = response.body.data[0];
      expect(plan).toHaveProperty('planName');
      expect(plan).toHaveProperty('name');
      expect(plan).toHaveProperty('description');
      expect(plan).toHaveProperty('pricing');
      expect(plan).toHaveProperty('seatPricing');
      expect(plan).toHaveProperty('limits');
      expect(plan).toHaveProperty('featureList');
    });

    it('should return pricing with both monthly and annual options', async () => {
      const response = await request(app)
        .get('/api/v1/subscriptions/plans')
        .expect(httpStatusCodes.OK);

      const plan = response.body.data.find((p: any) => p.planName === 'growth');
      expect(plan).toBeDefined();
      expect(plan.pricing).toHaveProperty('monthly');
      expect(plan.pricing).toHaveProperty('annual');

      // Verify monthly pricing structure
      expect(plan.pricing.monthly).toMatchObject({
        priceId: expect.any(String),
        priceInCents: expect.any(Number),
        displayPrice: expect.any(String),
      });

      // Verify annual pricing structure
      expect(plan.pricing.annual).toMatchObject({
        priceId: expect.any(String),
        priceInCents: expect.any(Number),
        displayPrice: expect.any(String),
        savingsPercent: expect.any(Number),
        savingsDisplay: expect.any(String),
      });
    });

    it('should return subscription prices NOT seat prices in pricing object', async () => {
      const response = await request(app)
        .get('/api/v1/subscriptions/plans')
        .expect(httpStatusCodes.OK);

      const growthPlan = response.body.data.find((p: any) => p.planName === 'growth');
      const portfolioPlan = response.body.data.find((p: any) => p.planName === 'portfolio');

      // Growth subscription pricing should be $79.99/month (NOT $7.99 seat price)
      expect(growthPlan.pricing.monthly.priceInCents).toBe(7999);
      expect(growthPlan.pricing.annual.priceInCents).toBe(76800);

      // Portfolio subscription pricing should be $149.99/month (NOT $5.99 seat price)
      expect(portfolioPlan.pricing.monthly.priceInCents).toBe(14999);
      expect(portfolioPlan.pricing.annual.priceInCents).toBe(144000);
    });

    it('should return seat pricing separately in seatPricing object', async () => {
      const response = await request(app)
        .get('/api/v1/subscriptions/plans')
        .expect(httpStatusCodes.OK);

      const growthPlan = response.body.data.find((p: any) => p.planName === 'growth');
      const portfolioPlan = response.body.data.find((p: any) => p.planName === 'portfolio');

      // Growth seat pricing structure
      expect(growthPlan.seatPricing).toMatchObject({
        includedSeats: expect.any(Number),
        additionalSeatPriceCents: expect.any(Number),
        maxAdditionalSeats: expect.any(Number),
        lookUpKey: expect.any(String),
      });

      // Growth seats should be $7.99/month
      expect(growthPlan.seatPricing.additionalSeatPriceCents).toBe(799);

      // Portfolio seats should be $5.99/month
      expect(portfolioPlan.seatPricing.additionalSeatPriceCents).toBe(599);
    });

    it('should include Stripe pricing data when available', async () => {
      const response = await request(app)
        .get('/api/v1/subscriptions/plans')
        .expect(httpStatusCodes.OK);

      const growthPlan = response.body.data.find((p: any) => p.planName === 'growth');

      // Should use Stripe prices from mock
      expect(growthPlan.pricing.monthly.priceInCents).toBe(7999);
      expect(growthPlan.pricing.monthly.priceId).toBe('price_growth_monthly');
      expect(growthPlan.pricing.monthly.lookUpKey).toBe('growth_monthly');
    });

    it('should return all three plans: essential, growth, portfolio', async () => {
      const response = await request(app)
        .get('/api/v1/subscriptions/plans')
        .expect(httpStatusCodes.OK);

      const planNames = response.body.data.map((p: any) => p.planName);
      expect(planNames).toContain('essential');
      expect(planNames).toContain('growth');
      expect(planNames).toContain('portfolio');
    });

    it('should format prices as currency strings', async () => {
      const response = await request(app)
        .get('/api/v1/subscriptions/plans')
        .expect(httpStatusCodes.OK);

      const plan = response.body.data.find((p: any) => p.planName === 'growth');
      expect(plan.pricing.monthly.displayPrice).toMatch(/^\$\d+\.\d{2}$/);
      expect(plan.pricing.annual.displayPrice).toMatch(/^\$\d+\.\d{2}$/);
    });
  });
});
