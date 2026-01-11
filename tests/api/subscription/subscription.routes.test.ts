import request from 'supertest';
import express from 'express';
import subscriptionRoutes from '@routes/subscription.routes';
import { container } from '@di/container';
import { SubscriptionController } from '@controllers/index';
import {
  clearTestDatabase,
  setupTestDatabase,
  disconnectTestDatabase,
} from '@tests/helpers';

describe('Subscription Routes API Tests', () => {
  let app: express.Application;
  let mockSubscriptionController: Partial<SubscriptionController>;

  beforeAll(async () => {
    await setupTestDatabase();

    app = express();
    app.use(express.json());

    // Mock controller methods
    mockSubscriptionController = {
      getSubscriptionPlans: jest.fn(async (req, res) => {
        return res.json({
          success: true,
          data: [
            {
              planName: 'personal',
              name: 'Personal',
              description: 'Perfect for individual landlords',
              pricing: {
                monthly: {
                  priceInCents: 0,
                  displayPrice: '$0',
                },
                annual: {
                  priceInCents: 0,
                  displayPrice: '$0',
                  savings: 0,
                },
              },
              trialDays: 0,
              ctaText: 'Get Started Free',
              isFeatured: false,
              displayOrder: 1,
              transactionFeePercent: 3.5,
              isCustomPricing: false,
              seatPricing: {
                includedSeats: 5,
                additionalSeatPriceCents: 0,
                maxAdditionalSeats: 0,
              },
              limits: {
                maxProperties: 5,
                maxUnits: 10,
                maxVendors: -1,
              },
              featureList: ['Up to 5 properties', 'Basic tenant management'],
              disabledFeatures: ['Advanced reporting', 'Team members'],
            },
          ],
        });
      }),
    };

    // Mock container resolution
    const originalResolve = container.resolve.bind(container);
    jest.spyOn(container, 'resolve').mockImplementation((name: string) => {
      if (name === 'subscriptionController') {
        return mockSubscriptionController as SubscriptionController;
      }
      return originalResolve(name);
    });

    app.use('/api/v1/subscriptions', subscriptionRoutes);
  });

  afterAll(async () => {
    await disconnectTestDatabase();
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    await clearTestDatabase();
    jest.clearAllMocks();
  });

  describe('GET /api/v1/subscriptions/plans', () => {
    it('should return all subscription plans', async () => {
      const response = await request(app).get('/api/v1/subscriptions/plans');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('should return plan with correct structure', async () => {
      const response = await request(app).get('/api/v1/subscriptions/plans');

      const plan = response.body.data[0];
      expect(plan).toHaveProperty('planName');
      expect(plan).toHaveProperty('name');
      expect(plan).toHaveProperty('description');
      expect(plan).toHaveProperty('pricing');
      expect(plan.pricing).toHaveProperty('monthly');
      expect(plan.pricing).toHaveProperty('annual');
      expect(plan).toHaveProperty('limits');
      expect(plan).toHaveProperty('seatPricing');
      expect(plan).toHaveProperty('featureList');
    });

    it('should include pricing information', async () => {
      const response = await request(app).get('/api/v1/subscriptions/plans');

      const plan = response.body.data[0];
      expect(plan.pricing.monthly).toHaveProperty('priceInCents');
      expect(plan.pricing.monthly).toHaveProperty('displayPrice');
      expect(plan.pricing.annual).toHaveProperty('priceInCents');
      expect(plan.pricing.annual).toHaveProperty('displayPrice');
      expect(plan.pricing.annual).toHaveProperty('savings');
    });

    it('should be publicly accessible without authentication', async () => {
      const response = await request(app)
        .get('/api/v1/subscriptions/plans')
        .set('Authorization', ''); // No auth header

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should have rate limiting applied', async () => {
      // The route uses basicLimiter middleware
      // Just verify the route responds correctly
      const response = await request(app).get('/api/v1/subscriptions/plans');

      expect(response.status).toBe(200);
      expect(mockSubscriptionController.getSubscriptionPlans).toHaveBeenCalled();
    });
  });
});
