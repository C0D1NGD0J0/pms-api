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
      const result = await subscriptionDAO.updateResourceCount('property', testClientId, 3);

      expect(result).toBe(true);

      const subscription = await Subscription.findOne({ client: testClientId });
      expect(subscription?.currentProperties).toBe(3);
    });

    it('should return false when property limit reached', async () => {
      const result = await subscriptionDAO.updateResourceCount('property', testClientId, 2);

      expect(result).toBe(false);

      const subscription = await Subscription.findOne({ client: testClientId });
      expect(subscription?.currentProperties).toBe(2); // Should remain unchanged
    });

    it('should prevent race condition with concurrent property additions', async () => {
      // Current: 2 properties, Limit: 3 (only 1 more allowed)
      const maxLimit = 3;

      // Simulate 5 concurrent requests
      const promises = Array(5)
        .fill(null)
        .map(() => subscriptionDAO.updateResourceCount('property', testClientId, maxLimit));

      const results = await Promise.all(promises);

      // Only 1 should succeed
      const successCount = results.filter((r) => r === true).length;
      expect(successCount).toBe(1);

      const subscription = await Subscription.findOne({ client: testClientId });
      expect(subscription?.currentProperties).toBe(3); // Should be exactly at limit
    });
  });

  describe('propertyUnit resource', () => {
    it('should increment unit count when below limit', async () => {
      const result = await subscriptionDAO.updateResourceCount('propertyUnit', testClientId, 10);

      expect(result).toBe(true);

      const subscription = await Subscription.findOne({ client: testClientId });
      expect(subscription?.currentUnits).toBe(6);
    });

    it('should return false when unit limit reached', async () => {
      const result = await subscriptionDAO.updateResourceCount('propertyUnit', testClientId, 5);

      expect(result).toBe(false);

      const subscription = await Subscription.findOne({ client: testClientId });
      expect(subscription?.currentUnits).toBe(5); // Should remain unchanged
    });

    it('should prevent race condition with concurrent unit additions', async () => {
      // Current: 5 units, Limit: 7 (only 2 more allowed)
      const maxLimit = 7;

      // Simulate 10 concurrent requests
      const promises = Array(10)
        .fill(null)
        .map(() => subscriptionDAO.updateResourceCount('propertyUnit', testClientId, maxLimit));

      const results = await Promise.all(promises);

      // Only 2 should succeed
      const successCount = results.filter((r) => r === true).length;
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
            3,
            txSession
          );

          expect(result).toBe(true);
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
          await subscriptionDAO.updateResourceCount('property', testClientId, 3, txSession);

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
});
