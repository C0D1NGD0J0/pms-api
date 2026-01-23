import { Types } from 'mongoose';
import { Subscription } from '@models/index';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { BadRequestError } from '@shared/customErrors';
import { SubscriptionService } from '@services/subscription/subscription.service';
import {
  disconnectTestDatabase,
  clearTestDatabase,
  setupTestDatabase,
} from '@tests/helpers';

describe('SubscriptionService Integration Tests', () => {
  let subscriptionService: SubscriptionService;
  let subscriptionDAO: SubscriptionDAO;
  let mockStripeService: any;

  beforeAll(async () => {
    await setupTestDatabase();

    subscriptionDAO = new SubscriptionDAO();

    // Mock Stripe service to avoid real API calls
    mockStripeService = {
      getProductsWithPrices: jest.fn().mockResolvedValue(
        new Map([
          ['portfolio', {
            monthly: { priceId: 'price_portfolio_monthly', amount: 9900 },
            annual: { priceId: 'price_portfolio_annual', amount: 7920 }
          }],
          ['essential', {
            monthly: { priceId: 'price_essential_monthly', amount: 0 },
            annual: { priceId: 'price_essential_annual', amount: 0 }
          }],
          ['growth', {
            monthly: { priceId: 'price_growth_monthly', amount: 2900 },
            annual: { priceId: 'price_growth_annual', amount: 2320 }
          }],
        ])
      ),
      getProductPrice: jest.fn().mockImplementation((priceId: string) => {
        if (priceId.includes('annual')) {
          return Promise.resolve({ unit_amount: 34800 });
        }
        return Promise.resolve({ unit_amount: 6500 });
      }),
      createCheckoutSession: jest.fn().mockResolvedValue({
        sessionId: 'cs_test_123',
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123',
      }),
    };

    subscriptionService = new SubscriptionService({
      subscriptionDAO,
      stripeService: mockStripeService,
    });
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  beforeEach(async () => {
    await clearTestDatabase();
    jest.clearAllMocks();
  });

  describe('getSubscriptionPlans', () => {
    it('should return all plans with pricing from Stripe', async () => {
      const result = await subscriptionService.getSubscriptionPlans();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);

      const personalPlan = result.data.find((p) => p.planName === 'essential');
      expect(personalPlan).toBeDefined();
      expect(personalPlan?.pricing.monthly.priceInCents).toBe(0);
      expect(personalPlan?.pricing.monthly.displayPrice).toBe('$0');

      const growthPlan = result.data.find((p) => p.planName === 'growth');
      expect(growthPlan).toBeDefined();
      expect(growthPlan?.pricing.monthly.priceInCents).toBe(2900);
      expect(growthPlan?.pricing.monthly.displayPrice).toBe('$29');
    });

    it('should calculate annual pricing with 20% discount', async () => {
      const result = await subscriptionService.getSubscriptionPlans();

      const growthPlan = result.data.find((p) => p.planName === 'growth');
      expect(growthPlan?.pricing.annual.priceInCents).toBe(2320);
      expect(growthPlan?.pricing.annual.savingsPercent).toBe(20);
    });

    it('should fallback to config prices when Stripe fails', async () => {
      mockStripeService.getProductsWithPrices.mockRejectedValueOnce(
        new Error('Stripe API error')
      );

      const result = await subscriptionService.getSubscriptionPlans();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);

      // Should still return plans with config prices
      const growthPlan = result.data.find((p) => p.planName === 'growth');
      expect(growthPlan).toBeDefined();
      expect(growthPlan?.pricing.monthly.priceInCents).toBe(2900);
    });

    it('should include plan metadata and features', async () => {
      const result = await subscriptionService.getSubscriptionPlans();

      const growthPlan = result.data.find((p) => p.planName === 'growth');
      expect(growthPlan?.name).toBe('Growth');
      expect(growthPlan?.description).toBe('For growing property managers');
      expect(growthPlan?.isFeatured).toBe(true);
      expect(growthPlan?.featuredBadge).toBe('Most Popular');
      expect(growthPlan?.limits.maxProperties).toBe(15);
      expect(growthPlan?.seatPricing.includedSeats).toBe(10);
      expect(growthPlan?.featureList).toContain('Up to 15 properties');
    });
  });

  describe('DAO Integration', () => {
    it('should create subscription in database', async () => {
      const clientId = new Types.ObjectId();

      const subscription = await Subscription.create({
        cuid: 'test-cuid',
        suid: 'test-suid',
        client: clientId,
        planName: 'essential',
        status: 'active',
        paymentGateway: {
          customerId: 'none',
          provider: 'none',
          planId: 'none',
        },
        totalMonthlyPrice: 0,
        currentSeats: 1,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
        currentProperties: 0,
        currentUnits: 0,
      });

      expect(subscription._id).toBeDefined();
      expect(subscription.planName).toBe('essential');

      // Verify it's in the database
      const found = await Subscription.findById(subscription._id);
      expect(found).not.toBeNull();
      expect(found?.planName).toBe('essential');
    });

    it('should update seat count using DAO', async () => {
      const clientId = new Types.ObjectId();

      const subscription = await Subscription.create({
        cuid: 'test-cuid-2',
        suid: 'test-suid-2',
        client: clientId,
        planName: 'growth',
        status: 'active',
        paymentGateway: {
          customerId: 'cus_stripe123',
          provider: 'stripe',
          planId: 'price_starter',
        },
        totalMonthlyPrice: 2900,
        currentSeats: 10,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
        currentProperties: 0,
        currentUnits: 0,
      });

      // Increment seats
      await subscriptionDAO.updateSeatCount(clientId, 5);

      const updated = await Subscription.findById(subscription._id);
      expect(updated?.currentSeats).toBe(15);
    });

    it('should update property count using DAO', async () => {
      const clientId = new Types.ObjectId();

      const subscription = await Subscription.create({
        cuid: 'test-cuid-3',
        suid: 'test-suid-3',
        client: clientId,
        planName: 'growth',
        status: 'active',
        paymentGateway: {
          customerId: 'cus_stripe456',
          provider: 'stripe',
          planId: 'price_starter',
        },
        totalMonthlyPrice: 2900,
        currentSeats: 10,
        currentProperties: 5,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
        currentUnits: 0,
      });

      // Increment properties
      await subscriptionDAO.updatePropertyCount(clientId, 3);

      const updated = await Subscription.findById(subscription._id);
      expect(updated?.currentProperties).toBe(8);

      // Decrement properties
      await subscriptionDAO.updatePropertyCount(clientId, -2);

      const updated2 = await Subscription.findById(subscription._id);
      expect(updated2?.currentProperties).toBe(6);
    });
  });

  describe('Subscription Date and Pricing Logic', () => {
    it('should create free essential subscription with undefined endDate', async () => {
      const subscription = await Subscription.create({
        cuid: 'test-free',
        suid: 'suid-free',
        client: new Types.ObjectId(),
        planName: 'growth',
        status: 'active',
        paymentGateway: {
          customerId: 'none',
          provider: 'none',
          planId: 'plan_starter',
        },
        totalMonthlyPrice: 0,
        currentSeats: 1,
        startDate: new Date(),
        endDate: undefined,
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
        currentProperties: 0,
        currentUnits: 0,
      });

      expect(subscription.endDate).toBeUndefined();
      expect(subscription.planName).toBe('growth');
    });

    it('should require endDate for active paid subscription', async () => {
      await expect(
        Subscription.create({
          cuid: 'test-paid',
          suid: 'suid-paid',
          client: new Types.ObjectId(),
          planName: 'growth',
          status: 'active',
          paymentGateway: {
            customerId: 'cus_123',
            provider: 'stripe',
            planId: 'price_growth',
          },
          totalMonthlyPrice: 2900,
          currentSeats: 5,
          startDate: new Date(),
          endDate: undefined,
          additionalSeatsCount: 0,
          additionalSeatsCost: 0,
          currentProperties: 0,
          currentUnits: 0,
        })
      ).rejects.toThrow();
    });

    it('should allow pending paid subscription without endDate', async () => {
      const subscription = await Subscription.create({
        cuid: 'test-pending',
        suid: 'suid-pending',
        client: new Types.ObjectId(),
        planName: 'essential',
        status: 'pending_payment',
        paymentGateway: {
          customerId: 'none',
          provider: 'stripe',
          planId: 'price_basic',
        },
        totalMonthlyPrice: 6500,
        currentSeats: 5,
        startDate: new Date(),
        endDate: undefined,
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
        currentProperties: 0,
        currentUnits: 0,
      });

      expect(subscription.endDate).toBeUndefined();
      expect(subscription.status).toBe('pending_payment');
    });

    it('should calculate monthly equivalent for annual billing', async () => {
      mockStripeService.getProductPrice.mockResolvedValueOnce({ unit_amount: 34800 });

      const subscription = await Subscription.create({
        cuid: 'test-annual',
        suid: 'suid-annual',
        client: new Types.ObjectId(),
        planName: 'essential',
        status: 'pending_payment',
        paymentGateway: {
          customerId: 'none',
          provider: 'stripe',
          planId: 'price_annual_123',
        },
        totalMonthlyPrice: 2900,
        billingInterval: 'annual',
        currentSeats: 5,
        startDate: new Date(),
        endDate: undefined,
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
        currentProperties: 0,
        currentUnits: 0,
      });

      expect(subscription.totalMonthlyPrice).toBe(2900);
      expect(subscription.billingInterval).toBe('annual');
    });
  });

  describe('Subscription Access Control (Lightweight)', () => {
    it('should return access control for active subscription', async () => {
      const client = new Types.ObjectId();
      await Subscription.create({
        cuid: 'client-active',
        suid: 'suid-active',
        client,
        planName: 'essential',
        status: 'active',
        paymentGateway: {
          customerId: 'cus_123',
          provider: 'stripe',
          planId: 'price_basic',
        },
        totalMonthlyPrice: 6500,
        billingInterval: 'monthly',
        currentSeats: 3,
        currentProperties: 5,
        currentUnits: 20,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
      });

      const result = await subscriptionService.getSubscriptionAccessControl('client-active', 'super-admin');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.plan.name).toBe('essential');
      expect(result.data?.plan.status).toBe('active');
      expect(result.data?.plan.billingInterval).toBe('monthly');
      expect(result.data?.features).toBeDefined();
      expect(result.data?.features.eSignature).toBe(true);
      expect(result.data?.paymentFlow.requiresPayment).toBe(false);
      expect(result.data?.paymentFlow.reason).toBeNull();
    });

    it('should return requiresPayment=true for super-admin with pending_payment status', async () => {
      const client = new Types.ObjectId();
      const pendingDowngradeAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

      await Subscription.create({
        cuid: 'client-pending',
        suid: 'suid-pending',
        client,
        planName: 'portfolio',
        status: 'pending_payment',
        paymentGateway: {
          customerId: '',
          provider: 'stripe',
          planId: 'price_professional',
        },
        totalMonthlyPrice: 9900,
        billingInterval: 'monthly',
        currentSeats: 1,
        currentProperties: 0,
        currentUnits: 0,
        startDate: new Date(),
        endDate: undefined,
        pendingDowngradeAt,
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
      });

      const result = await subscriptionService.getSubscriptionAccessControl('client-pending', 'super-admin');

      expect(result.success).toBe(true);
      expect(result.data?.paymentFlow.requiresPayment).toBe(true);
      expect(result.data?.paymentFlow.reason).toBe('pending_signup');
      expect(result.data?.paymentFlow.daysUntilDowngrade).toBe(2);
    });

    it('should NOT show payment requirements for regular admin', async () => {
      const client = new Types.ObjectId();
      const pendingDowngradeAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

      await Subscription.create({
        cuid: 'client-admin',
        suid: 'suid-admin',
        client,
        planName: 'portfolio',
        status: 'pending_payment',
        paymentGateway: {
          customerId: '',
          provider: 'stripe',
          planId: 'price_professional',
        },
        totalMonthlyPrice: 9900,
        billingInterval: 'monthly',
        currentSeats: 1,
        currentProperties: 0,
        currentUnits: 0,
        startDate: new Date(),
        endDate: undefined,
        pendingDowngradeAt,
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
      });

      const result = await subscriptionService.getSubscriptionAccessControl('client-admin', 'admin');

      expect(result.success).toBe(true);
      expect(result.data?.paymentFlow.requiresPayment).toBe(false); // Regular admin should NOT see payment requirements
      expect(result.data?.paymentFlow.reason).toBeNull();
    });

    it('should return grace_period reason for super-admin when < 24 hours until downgrade', async () => {
      const client = new Types.ObjectId();
      const pendingDowngradeAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

      await Subscription.create({
        cuid: 'client-grace',
        suid: 'suid-grace',
        client,
        planName: 'essential',
        status: 'pending_payment',
        paymentGateway: {
          customerId: '',
          provider: 'stripe',
          planId: 'price_basic',
        },
        totalMonthlyPrice: 6500,
        billingInterval: 'monthly',
        currentSeats: 1,
        currentProperties: 0,
        currentUnits: 0,
        startDate: new Date(),
        endDate: undefined,
        pendingDowngradeAt,
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
      });

      const result = await subscriptionService.getSubscriptionAccessControl('client-grace', 'super-admin');

      expect(result.success).toBe(true);
      expect(result.data?.paymentFlow.requiresPayment).toBe(true);
      expect(result.data?.paymentFlow.reason).toBe('grace_period');
      expect(result.data?.paymentFlow.daysUntilDowngrade).toBeLessThanOrEqual(1);
    });

    it('should return expired reason for super-admin when endDate has passed', async () => {
      const client = new Types.ObjectId();
      const expiredDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

      await Subscription.create({
        cuid: 'client-expired',
        suid: 'suid-expired',
        client,
        planName: 'essential',
        status: 'active',
        paymentGateway: {
          customerId: 'cus_expired',
          provider: 'stripe',
          planId: 'price_basic',
        },
        totalMonthlyPrice: 6500,
        billingInterval: 'monthly',
        currentSeats: 5,
        currentProperties: 10,
        currentUnits: 50,
        startDate: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
        endDate: expiredDate,
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
      });

      const result = await subscriptionService.getSubscriptionAccessControl('client-expired', 'super-admin');

      expect(result.success).toBe(true);
      expect(result.data?.paymentFlow.requiresPayment).toBe(true);
      expect(result.data?.paymentFlow.reason).toBe('expired');
    });

    it('should not require payment for free essential plan', async () => {
      const client = new Types.ObjectId();

      await Subscription.create({
        cuid: 'client-starter',
        suid: 'suid-starter',
        client,
        planName: 'growth',
        status: 'active',
        paymentGateway: {
          customerId: 'none',
          provider: 'none',
          planId: 'plan_starter',
        },
        totalMonthlyPrice: 0,
        billingInterval: 'monthly',
        currentSeats: 1,
        currentProperties: 2,
        currentUnits: 5,
        startDate: new Date(),
        endDate: undefined,
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
      });

      const result = await subscriptionService.getSubscriptionAccessControl('client-starter', 'super-admin');

      expect(result.success).toBe(true);
      expect(result.data?.plan.name).toBe('growth');
      expect(result.data?.paymentFlow.requiresPayment).toBe(false);
    });
  });

  describe('Subscription Plan Usage (Detailed)', () => {
    it('should return plan usage with limits and counts', async () => {
      const client = new Types.ObjectId();
      await Subscription.create({
        cuid: 'client-usage',
        suid: 'suid-usage',
        client,
        planName: 'essential',
        status: 'active',
        paymentGateway: {
          customerId: 'cus_usage',
          provider: 'stripe',
          planId: 'price_basic',
        },
        totalMonthlyPrice: 6500,
        billingInterval: 'monthly',
        currentSeats: 3,
        currentProperties: 5,
        currentUnits: 20,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
      });

      const ctx = {
        request: { params: { cuid: 'client-usage' } },
      } as any;

      const result = await subscriptionService.getSubscriptionPlanUsage(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.plan.name).toBe('essential');
      expect(result.data?.usage.properties).toBe(5);
      expect(result.data?.usage.units).toBe(20);
      expect(result.data?.usage.seats).toBe(3);
      expect(result.data?.limits.properties).toBe(15);
      expect(result.data?.limits.units).toBe(100);
      expect(result.data?.isLimitReached.properties).toBe(false);
      expect(result.data?.isLimitReached.units).toBe(false);
      expect(result.data?.isLimitReached.seats).toBe(false);
    });

    it('should correctly identify when limits are reached', async () => {
      const client = new Types.ObjectId();
      await Subscription.create({
        cuid: 'client-limits',
        suid: 'suid-limits',
        client,
        planName: 'essential',
        status: 'active',
        paymentGateway: {
          customerId: 'cus_limits',
          provider: 'stripe',
          planId: 'price_basic',
        },
        totalMonthlyPrice: 6500,
        billingInterval: 'monthly',
        currentSeats: 10,
        currentProperties: 15,
        currentUnits: 100,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        additionalSeatsCount: 5,
        additionalSeatsCost: 2500,
      });

      const ctx = {
        request: { params: { cuid: 'client-limits' } },
      } as any;

      const result = await subscriptionService.getSubscriptionPlanUsage(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.isLimitReached.properties).toBe(true);
      expect(result.data?.isLimitReached.units).toBe(true);
      expect(result.data?.isLimitReached.seats).toBe(true);
    });
  });

  describe('initSubscriptionPayment', () => {
    it('should create checkout session for pending_payment subscription', async () => {
      const client = new Types.ObjectId();
      const subscription = await Subscription.create({
        cuid: 'client-payment',
        suid: 'suid-payment',
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

      const ctx = {
        currentuser: {
          sub: new Types.ObjectId().toString(),
          email: 'owner@example.com',
          client: {
            cuid: 'client-payment',
            role: 'super-admin',
          },
        },
      } as any;

      const result = await subscriptionService.initSubscriptionPayment(ctx, {
        successUrl: 'https://app.example.com/success',
        cancelUrl: 'https://app.example.com/cancel',
      });

      expect(result.success).toBe(true);
      expect(result.data?.sessionId).toBe('cs_test_123');
      expect(result.data?.checkoutUrl).toBe('https://checkout.stripe.com/c/pay/cs_test_123');
      expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith({
        subscriptionId: subscription._id.toString(),
        email: 'owner@example.com',
        priceId: 'price_professional_monthly',
        successUrl: 'https://app.example.com/success',
        cancelUrl: 'https://app.example.com/cancel',
      });
    });

    it('should use annual price for annual billing interval', async () => {
      const client = new Types.ObjectId();
      const _subscription = await Subscription.create({
        cuid: 'client-annual',
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

      const ctx = {
        currentuser: {
          sub: new Types.ObjectId().toString(),
          email: 'owner@example.com',
          client: {
            cuid: 'client-annual',
            role: 'super-admin',
          },
        },
      } as any;

      await subscriptionService.initSubscriptionPayment(ctx, {
        successUrl: 'https://app.example.com/success',
        cancelUrl: 'https://app.example.com/cancel',
      });

      expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          priceId: 'price_professional_annual',
        })
      );
    });

    it('should throw error when subscription is not in pending_payment status', async () => {
      const client = new Types.ObjectId();
      await Subscription.create({
        cuid: 'client-active',
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

      const ctx = {
        currentuser: {
          sub: new Types.ObjectId().toString(),
          email: 'owner@example.com',
          client: {
            cuid: 'client-active',
            role: 'super-admin',
          },
        },
      } as any;

      await expect(
        subscriptionService.initSubscriptionPayment(ctx, {
          successUrl: 'https://app.example.com/success',
          cancelUrl: 'https://app.example.com/cancel',
        })
      ).rejects.toThrow(BadRequestError);
    });

    it('should throw error when subscription does not exist', async () => {
      const ctx = {
        currentuser: {
          sub: new Types.ObjectId().toString(),
          email: 'owner@example.com',
          client: {
            cuid: 'non-existent',
            role: 'super-admin',
          },
        },
      } as any;

      await expect(
        subscriptionService.initSubscriptionPayment(ctx, {
          successUrl: 'https://app.example.com/success',
          cancelUrl: 'https://app.example.com/cancel',
        })
      ).rejects.toThrow();
    });
  });
});
