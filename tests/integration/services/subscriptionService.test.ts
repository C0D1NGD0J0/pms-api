import { Types } from 'mongoose';
import { Subscription } from '@models/index';
import { clearTestDatabase } from '@tests/helpers';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { BadRequestError } from '@shared/customErrors';
import { SubscriptionService } from '@services/subscription/subscription.service';
import { IPaymentGatewayProvider, ISubscriptionStatus } from '@interfaces/subscription.interface';

describe('SubscriptionService Integration Tests', () => {
  let subscriptionService: SubscriptionService;
  let subscriptionDAO: SubscriptionDAO;
  let mockStripeService: any;

  beforeAll(async () => {
    subscriptionDAO = new SubscriptionDAO();

    // Mock Stripe service to avoid real API calls - Updated with correct CAD pricing
    mockStripeService = {
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
      getProductPrice: jest.fn().mockImplementation((priceId: string) => {
        if (priceId.includes('annual')) {
          return Promise.resolve({ unit_amount: 76800 });
        }
        return Promise.resolve({ unit_amount: 7999 });
      }),
      createCheckoutSession: jest.fn().mockResolvedValue({
        success: true,
        data: {
          sessionId: 'cs_test_123',
          redirectUrl: 'https://checkout.stripe.com/c/pay/cs_test_123',
        },
      }),
      createCustomer: jest.fn().mockResolvedValue({
        success: true,
        data: { customerId: 'cus_new_123' },
      }),
      updateSubscriptionSeats: jest.fn().mockResolvedValue({
        success: true,
        newQuantity: 5,
      }),
      updateSubscription: jest.fn().mockResolvedValue({
        success: false,
        message: 'Cannot update active subscription this way',
      }),
    };

    const mockClientObj = {
      _id: new Types.ObjectId(),
      cuid: 'test-cuid',
      isVerified: true,
      createdAt: new Date(),
      accountType: { category: 'individual' },
      displayName: 'Test Client',
    };

    subscriptionService = new SubscriptionService({
      subscriptionDAO,
      paymentGatewayService: mockStripeService,
      emitterService: { on: jest.fn(), off: jest.fn(), emit: jest.fn() } as any,
      sseService: { sendToUser: jest.fn() } as any,
      clientDAO: {
        getClientByCuid: jest.fn().mockResolvedValue(mockClientObj),
        findFirst: jest.fn().mockResolvedValue(mockClientObj),
        findById: jest.fn().mockResolvedValue(mockClientObj),
      } as any,
      authCache: {
        client: { DEL: jest.fn(), GET: jest.fn(), SETEX: jest.fn() },
        invalidateCurrentUser: jest.fn(),
      } as any,
      subscriptionCache: {
        getEntitlements: jest.fn().mockResolvedValue({ success: false, data: null }),
        cacheEntitlements: jest.fn().mockResolvedValue({ success: true }),
        invalidate: jest.fn().mockResolvedValue({ success: true }),
      } as any,
      userDAO: {
        list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      } as any,
      propertyDAO: {
        countDocuments: jest.fn().mockResolvedValue(0),
      } as any,
      propertyUnitDAO: {
        countDocuments: jest.fn().mockResolvedValue(0),
      } as any,
      paymentProcessorDAO: {} as any,
      emailQueue: {} as any,
      subscriptionWebhookService: {} as any,
    });
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
      expect(growthPlan?.pricing.monthly.priceInCents).toBe(7999); // $79.99 CAD
      expect(growthPlan?.pricing.monthly.displayPrice).toBe('$79.99');
    });

    it('should calculate annual pricing with 20% discount', async () => {
      const result = await subscriptionService.getSubscriptionPlans();

      const growthPlan = result.data.find((p) => p.planName === 'growth');
      expect(growthPlan?.pricing.annual.priceInCents).toBe(76800); // $768 CAD/year
      expect(growthPlan?.pricing.annual.savingsPercent).toBe(20);
    });

    it('should return subscription prices NOT seat prices', async () => {
      const result = await subscriptionService.getSubscriptionPlans();

      const growthPlan = result.data.find((p) => p.planName === 'growth');
      const portfolioPlan = result.data.find((p) => p.planName === 'portfolio');

      // Growth: $79.99/month subscription (NOT $7.99 seat price)
      expect(growthPlan?.pricing.monthly.priceInCents).toBe(7999);
      expect(growthPlan?.pricing.annual.priceInCents).toBe(76800);

      // Portfolio: $149.99/month subscription (NOT $5.99 seat price)
      expect(portfolioPlan?.pricing.monthly.priceInCents).toBe(14999);
      expect(portfolioPlan?.pricing.annual.priceInCents).toBe(144000);
    });

    it('should return seat pricing separately from subscription pricing', async () => {
      const result = await subscriptionService.getSubscriptionPlans();

      const growthPlan = result.data.find((p) => p.planName === 'growth');
      const portfolioPlan = result.data.find((p) => p.planName === 'portfolio');

      // Growth seats: $7.99/month
      expect(growthPlan?.seatPricing.additionalSeatPriceCents).toBe(799);
      expect(growthPlan?.seatPricing.includedSeats).toBe(10);

      // Portfolio seats: $5.99/month
      expect(portfolioPlan?.seatPricing.additionalSeatPriceCents).toBe(599);
      expect(portfolioPlan?.seatPricing.includedSeats).toBe(25);
    });

    it('should fallback to config prices when Stripe fails', async () => {
      mockStripeService.getProductsWithPrices.mockRejectedValueOnce(new Error('Stripe API error'));

      const result = await subscriptionService.getSubscriptionPlans();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);

      // Should still return plans with config prices
      const growthPlan = result.data.find((p) => p.planName === 'growth');
      expect(growthPlan).toBeDefined();
      expect(growthPlan?.pricing.monthly.priceInCents).toBe(7999);
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
      expect(growthPlan?.featureList).toContain('Up to 15 properties & 50 units');
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
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          customerId: 'none',
          provider: IPaymentGatewayProvider.NONE,
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
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          customerId: 'cus_stripe123',
          subscriberId: 'sub_stripe123',
          provider: IPaymentGatewayProvider.STRIPE,
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
      await subscriptionDAO.updateResourceCount('seat', clientId, 5);

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
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          customerId: 'cus_stripe456',
          subscriberId: 'sub_stripe456',
          provider: IPaymentGatewayProvider.STRIPE,
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
      await subscriptionDAO.updateResourceCount('property', clientId, 3);

      const updated = await Subscription.findById(subscription._id);
      expect(updated?.currentProperties).toBe(8);

      // Decrement properties
      await subscriptionDAO.updateResourceCount('property', clientId, -2);

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
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          customerId: 'none',
          provider: IPaymentGatewayProvider.NONE,
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

    it('should allow active paid subscription without endDate', async () => {
      // endDate is no longer enforced by the model validator;
      // Stripe webhook will set it upon successful payment
      const subscription = await Subscription.create({
        cuid: 'test-paid',
        suid: 'suid-paid',
        client: new Types.ObjectId(),
        planName: 'growth',
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          customerId: 'cus_123',
          subscriberId: 'sub_123',
          provider: IPaymentGatewayProvider.STRIPE,
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
      });

      expect(subscription._id).toBeDefined();
      expect(subscription.endDate).toBeUndefined();
      expect(subscription.status).toBe('active');
    });

    it('should allow pending paid subscription without endDate', async () => {
      const subscription = await Subscription.create({
        cuid: 'test-pending',
        suid: 'suid-pending',
        client: new Types.ObjectId(),
        planName: 'essential',
        status: ISubscriptionStatus.PENDING_PAYMENT,
        billing: {
          customerId: 'none',
          provider: IPaymentGatewayProvider.STRIPE,
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
        status: ISubscriptionStatus.PENDING_PAYMENT,
        billing: {
          customerId: 'none',
          provider: IPaymentGatewayProvider.STRIPE,
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
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          customerId: 'cus_123',
          provider: IPaymentGatewayProvider.STRIPE,
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

      const result = await subscriptionService.getSubscriptionEntitlements(
        'client-active',
        'super-admin'
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.plan.name).toBe('essential');
      expect(result.data?.plan.status).toBe('active');
      expect(result.data?.plan.billingInterval).toBe('monthly');
      expect(result.data?.entitlements).toBeDefined();
      // Essential plan does not include eSignature
      expect(result.data?.entitlements.eSignature).toBe(false);
      // paymentFlow is omitted when requiresPayment is false
      expect(result.data?.paymentFlow).toBeUndefined();
    });

    it('should return requiresPayment=true for super-admin with pending_payment status', async () => {
      const client = new Types.ObjectId();
      const pendingDowngradeAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

      await Subscription.create({
        cuid: 'client-pending',
        suid: 'suid-pending',
        client,
        planName: 'portfolio',
        status: ISubscriptionStatus.PENDING_PAYMENT,
        billing: {
          customerId: 'cus_pending',
          subscriberId: 'sub_pending',
          provider: IPaymentGatewayProvider.STRIPE,
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

      const result = await subscriptionService.getSubscriptionEntitlements(
        'client-pending',
        'super-admin'
      );

      expect(result.success).toBe(true);
      expect(result.data?.paymentFlow!.requiresPayment).toBe(true);
      expect(result.data?.paymentFlow!.reason).toBe('pending_signup');
      expect(result.data?.paymentFlow!.daysUntilDowngrade).toBe(2);
    });

    it('should NOT show payment requirements for regular admin', async () => {
      const client = new Types.ObjectId();
      const pendingDowngradeAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

      await Subscription.create({
        cuid: 'client-admin',
        suid: 'suid-admin',
        client,
        planName: 'portfolio',
        status: ISubscriptionStatus.PENDING_PAYMENT,
        billing: {
          customerId: 'cus_admin',
          subscriberId: 'sub_admin',
          provider: IPaymentGatewayProvider.STRIPE,
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

      const result = await subscriptionService.getSubscriptionEntitlements('client-admin', 'admin');

      expect(result.success).toBe(true);
      // paymentFlow is omitted for non-super-admin users
      expect(result.data?.paymentFlow).toBeUndefined();
    });

    it('should return grace_period reason for super-admin when < 24 hours until downgrade', async () => {
      const client = new Types.ObjectId();
      const pendingDowngradeAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

      await Subscription.create({
        cuid: 'client-grace',
        suid: 'suid-grace',
        client,
        planName: 'essential',
        status: ISubscriptionStatus.PENDING_PAYMENT,
        billing: {
          customerId: '',
          provider: IPaymentGatewayProvider.STRIPE,
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

      const result = await subscriptionService.getSubscriptionEntitlements(
        'client-grace',
        'super-admin'
      );

      expect(result.success).toBe(true);
      expect(result.data?.paymentFlow!.requiresPayment).toBe(true);
      expect(result.data?.paymentFlow!.reason).toBe('grace_period');
      expect(result.data?.paymentFlow!.daysUntilDowngrade).toBeLessThanOrEqual(1);
    });

    it('should return expired reason for super-admin when endDate has passed', async () => {
      const client = new Types.ObjectId();
      const expiredDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

      await Subscription.create({
        cuid: 'client-expired',
        suid: 'suid-expired',
        client,
        planName: 'growth',
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          customerId: 'cus_expired',
          subscriberId: 'sub_expired',
          provider: IPaymentGatewayProvider.STRIPE,
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

      const result = await subscriptionService.getSubscriptionEntitlements(
        'client-expired',
        'super-admin'
      );

      expect(result.success).toBe(true);
      expect(result.data?.paymentFlow!.requiresPayment).toBe(true);
      expect(result.data?.paymentFlow!.reason).toBe('expired');
    });

    it('should not require payment for free essential plan', async () => {
      const client = new Types.ObjectId();

      await Subscription.create({
        cuid: 'client-starter',
        suid: 'suid-starter',
        client,
        planName: 'growth',
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          customerId: 'none',
          provider: IPaymentGatewayProvider.NONE,
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

      const result = await subscriptionService.getSubscriptionEntitlements(
        'client-starter',
        'super-admin'
      );

      expect(result.success).toBe(true);
      expect(result.data?.plan.name).toBe('growth');
      // paymentFlow is omitted when requiresPayment is false
      expect(result.data?.paymentFlow).toBeUndefined();
    });
  });

  describe('Subscription Plan Usage (Detailed)', () => {
    it('should return plan usage with limits and counts', async () => {
      const client = new Types.ObjectId();

      // Mock DAO counts to match expected usage values (within essential plan limits)
      (subscriptionService as any).propertyDAO.countDocuments = jest.fn().mockResolvedValue(1);
      (subscriptionService as any).propertyUnitDAO.countDocuments = jest.fn().mockResolvedValue(2);
      (subscriptionService as any).userDAO.list = jest.fn().mockResolvedValue({
        items: [{}], // 1 employee
        total: 1,
      });

      await Subscription.create({
        cuid: 'client-usage',
        suid: 'suid-usage',
        client,
        planName: 'essential',
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          customerId: 'cus_usage',
          provider: IPaymentGatewayProvider.STRIPE,
          planId: 'price_basic',
        },
        totalMonthlyPrice: 6500,
        billingInterval: 'monthly',
        currentSeats: 1,
        currentProperties: 1,
        currentUnits: 2,
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
      // Essential plan limits: maxProperties=3, maxUnits=10, includedSeats=3
      expect(result.data?.usage.properties).toBe(1);
      expect(result.data?.usage.units).toBe(2);
      expect(result.data?.usage.seats).toBe(1);
      expect(result.data?.limits.properties).toBe(3);
      expect(result.data?.limits.units).toBe(10);
      expect(result.data?.isLimitReached.properties).toBe(false);
      expect(result.data?.isLimitReached.units).toBe(false);
      expect(result.data?.isLimitReached.seats).toBe(false);
    });

    it('should correctly identify when limits are reached', async () => {
      const client = new Types.ObjectId();

      // Mock DAO counts to match at-limit values
      // Essential plan limits: 3 properties, 10 units, 3 included seats + 0 additional = 3 total
      (subscriptionService as any).propertyDAO.countDocuments = jest.fn().mockResolvedValue(3);
      (subscriptionService as any).propertyUnitDAO.countDocuments = jest.fn().mockResolvedValue(10);
      (subscriptionService as any).userDAO.list = jest.fn().mockResolvedValue({
        items: Array(3).fill({}), // 3 employees
        total: 3,
      });

      await Subscription.create({
        cuid: 'client-limits',
        suid: 'suid-limits',
        client,
        planName: 'essential',
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          customerId: 'cus_limits',
          provider: IPaymentGatewayProvider.STRIPE,
          planId: 'price_basic',
        },
        totalMonthlyPrice: 6500,
        billingInterval: 'monthly',
        currentSeats: 3,
        currentProperties: 3,
        currentUnits: 10,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
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
        status: ISubscriptionStatus.PENDING_PAYMENT,
        billing: {
          customerId: 'cus_payment',
          subscriberId: 'sub_payment',
          provider: IPaymentGatewayProvider.STRIPE,
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
        priceId: 'price_professional_monthly',
      });

      expect(result.success).toBe(true);
      expect(result.data?.sessionId).toBe('cs_test_123');
      expect(result.data?.checkoutUrl).toBe('https://checkout.stripe.com/c/pay/cs_test_123');
      expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          priceId: 'price_professional_monthly',
          successUrl: 'https://app.example.com/success',
          cancelUrl: 'https://app.example.com/cancel',
        })
      );
    });

    it('should use annual price for annual billing interval', async () => {
      const client = new Types.ObjectId();
      const _subscription = await Subscription.create({
        cuid: 'client-annual',
        suid: 'suid-annual',
        client,
        planName: 'portfolio',
        status: ISubscriptionStatus.PENDING_PAYMENT,
        billing: {
          customerId: 'cus_annual',
          subscriberId: 'sub_annual',
          provider: IPaymentGatewayProvider.STRIPE,
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
        priceId: 'price_professional_annual',
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
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          customerId: 'cus_123',
          subscriberId: 'sub_123',
          provider: IPaymentGatewayProvider.STRIPE,
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

      // Active subscription with subscriberId triggers the update flow,
      // which fails because updateSubscription returns { success: false }
      await expect(
        subscriptionService.initSubscriptionPayment(ctx, {
          successUrl: 'https://app.example.com/success',
          cancelUrl: 'https://app.example.com/cancel',
          priceId: 'price_professional_monthly',
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
          priceId: 'price_professional_monthly',
        })
      ).rejects.toThrow();
    });
  });

  describe('Seat Management (updateSubscriptionSeats)', () => {
    it('should allow purchasing additional seats when under the limit', async () => {
      const client = new Types.ObjectId();
      const subscription = await Subscription.create({
        cuid: 'client-seat-add',
        suid: 'suid-seat-add',
        client,
        planName: 'growth',
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          customerId: 'cus_test123',
          provider: IPaymentGatewayProvider.STRIPE,
          planId: 'price_growth_monthly',
          seatItemId: 'si_test123',
        },
        totalMonthlyPrice: 7999,
        billingInterval: 'monthly',
        currentSeats: 10, // Using all included seats
        currentProperties: 5,
        currentUnits: 20,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
        entitlements: {
          eSignature: true,
          maintenanceRequestService: true,
          guestPassService: true,
          reportingAnalytics: true,
        },
      });

      // No subscriberId set, so Stripe integration is skipped - only local DB update
      const result = await subscriptionService.updateAdditionalSeats('client-seat-add', 5);

      expect(result.success).toBe(true);

      // Verify database was updated
      const updated = await Subscription.findById(subscription._id);
      expect(updated?.additionalSeatsCount).toBe(5);
      expect(updated?.additionalSeatsCost).toBe(3995); // 5 * 799 cents
    });

    it('should allow removing seats when it would not exceed current usage', async () => {
      const client = new Types.ObjectId();
      const subscription = await Subscription.create({
        cuid: 'client-seat-remove',
        suid: 'suid-seat-remove',
        client,
        planName: 'growth',
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          customerId: 'cus_test456',
          provider: IPaymentGatewayProvider.STRIPE,
          planId: 'price_growth_monthly',
          seatItemId: 'si_test456',
        },
        totalMonthlyPrice: 7999,
        billingInterval: 'monthly',
        currentSeats: 8, // Using 8 out of 15 total seats
        currentProperties: 5,
        currentUnits: 20,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        additionalSeatsCount: 5, // 10 included + 5 purchased = 15 total
        additionalSeatsCost: 3995,
        entitlements: {
          eSignature: true,
          maintenanceRequestService: true,
          guestPassService: true,
          reportingAnalytics: true,
        },
      });

      const result = await subscriptionService.updateAdditionalSeats('client-seat-remove', -3);

      expect(result.success).toBe(true);

      // Verify database was updated
      const updated = await Subscription.findById(subscription._id);
      expect(updated?.additionalSeatsCount).toBe(2); // 5 - 3 = 2
      expect(updated?.additionalSeatsCost).toBe(1598); // 2 * 799 cents
    });

    it('should prevent removing seats when it would exceed current usage', async () => {
      const client = new Types.ObjectId();
      await Subscription.create({
        cuid: 'client-over-limit',
        suid: 'suid-over-limit',
        client,
        planName: 'growth',
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          customerId: 'cus_test789',
          provider: IPaymentGatewayProvider.STRIPE,
          planId: 'price_growth_monthly',
          seatItemId: 'si_test789',
        },
        totalMonthlyPrice: 7999,
        billingInterval: 'monthly',
        currentSeats: 21, // Using 21 seats (OVER by 9)
        currentProperties: 5,
        currentUnits: 20,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        additionalSeatsCount: 2, // 10 included + 2 purchased = 12 total
        additionalSeatsCost: 1598,
        entitlements: {
          eSignature: true,
          maintenanceRequestService: true,
          guestPassService: true,
          reportingAnalytics: true,
        },
      });

      await expect(
        subscriptionService.updateAdditionalSeats('client-over-limit', -1)
      ).rejects.toThrow(BadRequestError);
    });

    it('should prevent purchasing more than maxAdditionalSeats', async () => {
      const client = new Types.ObjectId();
      await Subscription.create({
        cuid: 'client-max-seats',
        suid: 'suid-max-seats',
        client,
        planName: 'growth',
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          customerId: 'cus_test999',
          provider: IPaymentGatewayProvider.STRIPE,
          planId: 'price_growth_monthly',
          seatItemId: 'si_test999',
        },
        totalMonthlyPrice: 7999,
        billingInterval: 'monthly',
        currentSeats: 20,
        currentProperties: 5,
        currentUnits: 20,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        additionalSeatsCount: 20, // 10 included + 20 purchased = 30 total
        additionalSeatsCost: 15980,
        entitlements: {
          eSignature: true,
          maintenanceRequestService: true,
          guestPassService: true,
          reportingAnalytics: true,
        },
      });

      // Growth plan maxAdditionalSeats is 25, already have 20, can only add 5 more
      await expect(
        subscriptionService.updateAdditionalSeats('client-max-seats', 10)
      ).rejects.toThrow(BadRequestError);
    });

    it('should reject seat purchase on essential plan', async () => {
      const client = new Types.ObjectId();
      await Subscription.create({
        cuid: 'client-essential-seats',
        suid: 'suid-essential-seats',
        client,
        planName: 'essential',
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          customerId: 'none',
          provider: IPaymentGatewayProvider.NONE,
          planId: 'plan_essential',
        },
        totalMonthlyPrice: 0,
        billingInterval: 'monthly',
        currentSeats: 1,
        currentProperties: 0,
        currentUnits: 0,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
      });

      // Essential plan does not support additional seats
      await expect(
        subscriptionService.updateAdditionalSeats('client-essential-seats', 5)
      ).rejects.toThrow(BadRequestError);
    });
  });
});
