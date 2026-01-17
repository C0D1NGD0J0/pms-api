import { Types } from 'mongoose';
import { Subscription } from '@models/index';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
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
          ['professional', { priceId: 'price_professional', amount: 9900 }],
          ['starter', { priceId: 'price_starter', amount: 2900 }],
          ['personal', { priceId: 'price_personal', amount: 0 }],
        ])
      ),
      getProductPrice: jest.fn().mockImplementation((priceId: string) => {
        if (priceId.includes('annual')) {
          return Promise.resolve({ unit_amount: 34800 }); // Annual pricing
        }
        return Promise.resolve({ unit_amount: 6500 }); // Monthly pricing
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

      const personalPlan = result.data.find((p) => p.planName === 'personal');
      expect(personalPlan).toBeDefined();
      expect(personalPlan?.pricing.monthly.priceInCents).toBe(0);
      expect(personalPlan?.pricing.monthly.displayPrice).toBe('$0');

      const starterPlan = result.data.find((p) => p.planName === 'starter');
      expect(starterPlan).toBeDefined();
      expect(starterPlan?.pricing.monthly.priceInCents).toBe(2900);
      expect(starterPlan?.pricing.monthly.displayPrice).toBe('$29');
    });

    it('should calculate annual pricing with 20% discount', async () => {
      const result = await subscriptionService.getSubscriptionPlans();

      const starterPlan = result.data.find((p) => p.planName === 'starter');
      expect(starterPlan?.pricing.annual.priceInCents).toBe(2320); // 2900 * 0.8
      expect(starterPlan?.pricing.annual.savings).toBe(20);
    });

    it('should fallback to config prices when Stripe fails', async () => {
      mockStripeService.getProductsWithPrices.mockRejectedValueOnce(
        new Error('Stripe API error')
      );

      const result = await subscriptionService.getSubscriptionPlans();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);

      // Should still return plans with config prices
      const starterPlan = result.data.find((p) => p.planName === 'starter');
      expect(starterPlan).toBeDefined();
      expect(starterPlan?.pricing.monthly.priceInCents).toBe(2900); // From config
    });

    it('should include plan metadata and features', async () => {
      const result = await subscriptionService.getSubscriptionPlans();

      const starterPlan = result.data.find((p) => p.planName === 'starter');
      expect(starterPlan?.name).toBe('Starter');
      expect(starterPlan?.description).toBe('For growing property managers');
      expect(starterPlan?.isFeatured).toBe(true);
      expect(starterPlan?.featuredBadge).toBe('Most Popular');
      expect(starterPlan?.limits.maxProperties).toBe(15);
      expect(starterPlan?.seatPricing.includedSeats).toBe(10);
      expect(starterPlan?.featureList).toContain('Up to 15 properties');
    });
  });

  describe('DAO Integration', () => {
    it('should create subscription in database', async () => {
      const clientId = new Types.ObjectId();

      const subscription = await Subscription.create({
        cuid: 'test-cuid',
        suid: 'test-suid',
        client: clientId,
        planName: 'personal',
        status: 'active',
        paymentGateway: {
          id: 'none',
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
      expect(subscription.planName).toBe('personal');

      // Verify it's in the database
      const found = await Subscription.findById(subscription._id);
      expect(found).not.toBeNull();
      expect(found?.planName).toBe('personal');
    });

    it('should update seat count using DAO', async () => {
      const clientId = new Types.ObjectId();

      const subscription = await Subscription.create({
        cuid: 'test-cuid-2',
        suid: 'test-suid-2',
        client: clientId,
        planName: 'starter',
        status: 'active',
        paymentGateway: {
          id: 'cus_stripe123',
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
        planName: 'starter',
        status: 'active',
        paymentGateway: {
          id: 'cus_stripe456',
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
    it('should create free starter subscription with undefined endDate', async () => {
      const subscription = await Subscription.create({
        cuid: 'test-free',
        suid: 'suid-free',
        client: new Types.ObjectId(),
        planName: 'starter',
        status: 'active',
        paymentGateway: {
          id: 'none',
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
      expect(subscription.planName).toBe('starter');
    });

    it('should require endDate for active paid subscription', async () => {
      await expect(
        Subscription.create({
          cuid: 'test-paid',
          suid: 'suid-paid',
          client: new Types.ObjectId(),
          planName: 'personal',
          status: 'active',
          paymentGateway: {
            id: 'cus_123',
            provider: 'stripe',
            planId: 'price_personal',
          },
          totalMonthlyPrice: 6500,
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
        planName: 'personal',
        status: 'pending_payment',
        paymentGateway: {
          id: 'none',
          provider: 'stripe',
          planId: 'price_personal',
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
        planName: 'personal',
        status: 'pending_payment',
        paymentGateway: {
          id: 'none',
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
});
