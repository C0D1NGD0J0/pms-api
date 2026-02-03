import { Types } from 'mongoose';
import { Subscription } from '@models/index';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import {
  disconnectTestDatabase,
  clearTestDatabase,
  setupTestDatabase,
} from '@tests/helpers';

describe('SubscriptionDAO - updateResourceCount', () => {
  let subscriptionDAO: SubscriptionDAO;
  let testClientId: Types.ObjectId;

  beforeAll(async () => {
    await setupTestDatabase();
    subscriptionDAO = new SubscriptionDAO();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  beforeEach(async () => {
    await clearTestDatabase();
    testClientId = new Types.ObjectId();

    // Create test subscription
    await Subscription.create({
      client: testClientId,
      cuid: 'TEST_CLIENT',
      planName: 'growth',
      status: 'active',
      currentProperties: 2,
      currentUnits: 5,
      currentSeats: 1,
      startDate: new Date(),
      billingInterval: 'monthly',
      totalMonthlyPrice: 0,
      paymentGateway: {
        provider: 'none',
        customerId: 'none',
        planId: 'none',
      },
    });
  });

  describe('property resource', () => {
    it('should increment property count when below limit', async () => {
      const result = await subscriptionDAO.updateResourceCount('property', testClientId, 1, 3);

      expect(result).not.toBeNull();
      expect(result?.currentProperties).toBe(3);
    });

    it('should return null when property limit reached', async () => {
      const result = await subscriptionDAO.updateResourceCount('property', testClientId, 1, 2);

      expect(result).toBeNull();

      const subscription = await Subscription.findOne({ client: testClientId });
      expect(subscription?.currentProperties).toBe(2); // Should remain unchanged
    });

    it('should prevent race condition with concurrent property additions', async () => {
      // Current: 2 properties, Limit: 3 (only 1 more allowed)
      const maxLimit = 3;

      // Simulate 5 concurrent requests
      const promises = Array(5)
        .fill(null)
        .map(() => subscriptionDAO.updateResourceCount('property', testClientId, 1, maxLimit));

      const results = await Promise.all(promises);

      // Only 1 should succeed
      const successCount = results.filter((r) => r !== null).length;
      expect(successCount).toBe(1);

      const subscription = await Subscription.findOne({ client: testClientId });
      expect(subscription?.currentProperties).toBe(3); // Should be exactly at limit
    });
  });

  describe('propertyUnit resource', () => {
    it('should increment unit count when below limit', async () => {
      const result = await subscriptionDAO.updateResourceCount('propertyUnit', testClientId, 1, 10);

      expect(result).not.toBeNull();
      expect(result?.currentUnits).toBe(6);
    });

    it('should return null when unit limit reached', async () => {
      const result = await subscriptionDAO.updateResourceCount('propertyUnit', testClientId, 1, 5);

      expect(result).toBeNull();

      const subscription = await Subscription.findOne({ client: testClientId });
      expect(subscription?.currentUnits).toBe(5); // Should remain unchanged
    });

    it('should prevent race condition with concurrent unit additions', async () => {
      // Current: 5 units, Limit: 7 (only 2 more allowed)
      const maxLimit = 7;

      // Simulate 10 concurrent requests
      const promises = Array(10)
        .fill(null)
        .map(() => subscriptionDAO.updateResourceCount('propertyUnit', testClientId, 1, maxLimit));

      const results = await Promise.all(promises);

      // Only 2 should succeed
      const successCount = results.filter((r) => r !== null).length;
      expect(successCount).toBe(2);

      const subscription = await Subscription.findOne({ client: testClientId });
      expect(subscription?.currentUnits).toBe(7); // Should be exactly at limit
    });
  });

  describe('with MongoDB transactions', () => {
    it('should work within a transaction session', async () => {
      const session = await subscriptionDAO.startSession();

      try {
        await subscriptionDAO.withTransaction(session, async (txSession) => {
          const result = await subscriptionDAO.updateResourceCount(
            'property',
            testClientId,
            1,
            5,
            txSession
          );

          expect(result).not.toBeNull();
        });

        const subscription = await Subscription.findOne({ client: testClientId });
        expect(subscription?.currentProperties).toBe(3);
      } finally {
        await session.endSession();
      }
    });

    it('should rollback on transaction failure', async () => {
      const session = await subscriptionDAO.startSession();

      try {
        await subscriptionDAO.withTransaction(session, async (txSession) => {
          await subscriptionDAO.updateResourceCount('property', testClientId, 1, 5, txSession);

          // Simulate error - transaction will rollback
          throw new Error('Transaction failed');
        });
      } catch (error) {
        // Expected to throw
      } finally {
        await session.endSession();
      }

      const subscription = await Subscription.findOne({ client: testClientId });
      expect(subscription?.currentProperties).toBe(2); // Should be unchanged due to rollback
    });
  });

  describe('updateAdditionalSeats', () => {
    it('should update additional seats count and cost', async () => {
      const result = await subscriptionDAO.updateAdditionalSeats(testClientId, 5, 3995);

      expect(result).not.toBeNull();
      expect(result?.additionalSeatsCount).toBe(5);
      expect(result?.additionalSeatsCost).toBe(3995);
    });

    it('should update to zero seats when removing all', async () => {
      await subscriptionDAO.updateAdditionalSeats(testClientId, 10, 7990);

      const result = await subscriptionDAO.updateAdditionalSeats(testClientId, 0, 0);

      expect(result?.additionalSeatsCount).toBe(0);
      expect(result?.additionalSeatsCost).toBe(0);
    });
  });

  describe('updatePaymentGateway', () => {
    it('should update payment gateway information', async () => {
      const subscription = await Subscription.findOne({ client: testClientId });
      const newGateway = {
        provider: 'stripe' as const,
        customerId: 'cus_test123',
        planId: 'price_growth_monthly',
        seatItemId: 'si_test456',
      };

      const result = await subscriptionDAO.updatePaymentGateway(subscription!._id, newGateway);

      expect(result?.paymentGateway.provider).toBe('stripe');
      expect(result?.paymentGateway.customerId).toBe('cus_test123');
      expect(result?.paymentGateway.seatItemId).toBe('si_test456');
    });
  });

  describe('cancelSubscription', () => {
    it('should mark subscription as inactive and set canceledAt', async () => {
      const cancelDate = new Date();
      const subscription = await Subscription.findOne({ client: testClientId });

      const result = await subscriptionDAO.cancelSubscription(subscription!._id, cancelDate);

      expect(result?.status).toBe('inactive');
      expect(result?.canceledAt).toBeDefined();
    });

    it('should use current date if no date provided', async () => {
      const subscription = await Subscription.findOne({ client: testClientId });

      const result = await subscriptionDAO.cancelSubscription(subscription!._id);

      expect(result?.status).toBe('inactive');
      expect(result?.canceledAt).toBeInstanceOf(Date);
    });
  });

  describe('updateStatus', () => {
    it('should transition from pending_payment to active', async () => {
      await Subscription.updateOne({ client: testClientId }, { status: 'pending_payment' });
      const subscription = await Subscription.findOne({ client: testClientId });

      const result = await subscriptionDAO.updateStatus(subscription!._id, 'active');

      expect(result?.status).toBe('active');
    });

    it('should transition to inactive', async () => {
      const subscription = await Subscription.findOne({ client: testClientId });

      const result = await subscriptionDAO.updateStatus(subscription!._id, 'inactive');

      expect(result?.status).toBe('inactive');
    });
  });

  describe('setPendingDowngrade', () => {
    it('should set pending downgrade date', async () => {
      const downgradeDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      const subscription = await Subscription.findOne({ client: testClientId });

      const result = await subscriptionDAO.setPendingDowngrade(subscription!._id, downgradeDate);

      expect(result?.pendingDowngradeAt).toBeDefined();
      expect(result?.pendingDowngradeAt?.getTime()).toBe(downgradeDate.getTime());
    });
  });

  describe('findPendingDowngrades', () => {
    it('should find subscriptions past downgrade threshold', async () => {
      const pastDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
      await Subscription.updateOne(
        { client: testClientId },
        { status: 'pending_payment', pendingDowngradeAt: pastDate }
      );

      const results = await subscriptionDAO.findPendingDowngrades(new Date());

      expect(results.length).toBe(1);
      expect(results[0].cuid).toBe('TEST_CLIENT');
    });

    it('should not return future downgrades', async () => {
      const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      await Subscription.updateOne(
        { client: testClientId },
        { status: 'pending_payment', pendingDowngradeAt: futureDate }
      );

      const results = await subscriptionDAO.findPendingDowngrades(new Date());

      expect(results.length).toBe(0);
    });
  });

  describe('bulkExpireSubscriptions', () => {
    it('should expire active subscriptions past end date', async () => {
      const expiredDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      await Subscription.updateOne({ client: testClientId }, { endDate: expiredDate });

      const count = await subscriptionDAO.bulkExpireSubscriptions();

      expect(count).toBe(1);
      const subscription = await Subscription.findOne({ client: testClientId });
      expect(subscription?.status).toBe('inactive');
    });

    it('should not affect subscriptions with future end dates', async () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await Subscription.updateOne({ client: testClientId }, { endDate: futureDate });

      const count = await subscriptionDAO.bulkExpireSubscriptions();

      expect(count).toBe(0);
      const subscription = await Subscription.findOne({ client: testClientId });
      expect(subscription?.status).toBe('active');
    });
  });
});
