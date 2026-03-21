import { Types } from 'mongoose';
import { SubscriptionDAO } from '@dao/subscriptionDAO';

describe('SubscriptionDAO - Negative Value Protection', () => {
  let subscriptionDAO: SubscriptionDAO;
  const mockClientId = new Types.ObjectId();

  beforeEach(() => {
    subscriptionDAO = new SubscriptionDAO();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('updateResourceCount - Decrement Protection', () => {
    it('should prevent currentSeats from going negative', async () => {
      // Mock a subscription with 3 current seats
      const mockSubscription = {
        _id: new Types.ObjectId(),
        client: mockClientId,
        currentSeats: 3,
        currentProperties: 5,
        currentUnits: 10,
      };

      // Mock the update method to simulate MongoDB query behavior
      const _updateSpy = jest.spyOn(subscriptionDAO, 'update').mockImplementation(async (filter: any) => {
        // Simulate MongoDB's behavior: only update if filter matches
        if (filter.currentSeats && filter.currentSeats.$gte) {
          const required = filter.currentSeats.$gte;
          if (mockSubscription.currentSeats >= required) {
            return { ...mockSubscription, currentSeats: mockSubscription.currentSeats - required } as any;
          }
          return null; // No document matched
        }
        return mockSubscription as any;
      });

      // Attempt to decrement by 5 when only 3 exist - should fail
      const result = await subscriptionDAO.updateResourceCount('seat', mockClientId, -5);

      expect(result).toBeNull();
      expect(_updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          client: mockClientId,
          currentSeats: { $gte: 5 }, // Ensures currentSeats >= 5 before decrementing
        }),
        expect.objectContaining({
          $inc: { currentSeats: -5 },
        }),
        expect.any(Object),
        undefined
      );
    });

    it('should allow decrement when sufficient resources exist', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        client: mockClientId,
        currentSeats: 10,
      };

      const _updateSpy = jest.spyOn(subscriptionDAO, 'update').mockImplementation(async (filter: any) => {
        if (filter.currentSeats && filter.currentSeats.$gte) {
          const required = filter.currentSeats.$gte;
          if (mockSubscription.currentSeats >= required) {
            return { ...mockSubscription, currentSeats: mockSubscription.currentSeats - required } as any;
          }
          return null;
        }
        return mockSubscription as any;
      });

      const result = await subscriptionDAO.updateResourceCount('seat', mockClientId, -3);

      expect(result).not.toBeNull();
      expect(result?.currentSeats).toBe(7);
    });

    it('should prevent currentProperties from going negative', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        client: mockClientId,
        currentProperties: 2,
      };

      const _updateSpy = jest.spyOn(subscriptionDAO, 'update').mockImplementation(async (filter: any) => {
        if (filter.currentProperties && filter.currentProperties.$gte) {
          const required = filter.currentProperties.$gte;
          if (mockSubscription.currentProperties >= required) {
            return { ...mockSubscription, currentProperties: mockSubscription.currentProperties - required } as any;
          }
          return null;
        }
        return mockSubscription as any;
      });

      const result = await subscriptionDAO.updateResourceCount('property', mockClientId, -5);

      expect(result).toBeNull();
    });

    it('should prevent currentUnits from going negative', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        client: mockClientId,
        currentUnits: 8,
      };

      const _updateSpy = jest.spyOn(subscriptionDAO, 'update').mockImplementation(async (filter: any) => {
        if (filter.currentUnits && filter.currentUnits.$gte) {
          const required = filter.currentUnits.$gte;
          if (mockSubscription.currentUnits >= required) {
            return { ...mockSubscription, currentUnits: mockSubscription.currentUnits - required } as any;
          }
          return null;
        }
        return mockSubscription as any;
      });

      const result = await subscriptionDAO.updateResourceCount('propertyUnit', mockClientId, -10);

      expect(result).toBeNull();
    });

    it('should still allow incrementing without negative check', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        client: mockClientId,
        currentSeats: 5,
      };

      const _updateSpy = jest.spyOn(subscriptionDAO, 'update').mockResolvedValue({
        ...mockSubscription,
        currentSeats: 10,
      } as any);

      const result = await subscriptionDAO.updateResourceCount('seat', mockClientId, 5);

      expect(result).not.toBeNull();
      expect(_updateSpy).toHaveBeenCalledWith(
        { client: mockClientId },
        { $inc: { currentSeats: 5 } },
        { new: true },
        undefined
      );
    });

    it('should handle decrement by exactly current value (edge case)', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        client: mockClientId,
        currentSeats: 5,
      };

      const _updateSpy = jest.spyOn(subscriptionDAO, 'update').mockImplementation(async (filter: any) => {
        if (filter.currentSeats && filter.currentSeats.$gte) {
          const required = filter.currentSeats.$gte;
          if (mockSubscription.currentSeats >= required) {
            return { ...mockSubscription, currentSeats: 0 } as any;
          }
          return null;
        }
        return mockSubscription as any;
      });

      // Decrement by exactly the current value - should succeed and result in 0
      const result = await subscriptionDAO.updateResourceCount('seat', mockClientId, -5);

      expect(result).not.toBeNull();
      expect(result?.currentSeats).toBe(0);
    });
  });

  describe('updateResourceCount - Max Limit Check (Increment)', () => {
    it('should enforce max limit when incrementing', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        client: mockClientId,
        currentSeats: 12,
      };

      const _updateSpy = jest.spyOn(subscriptionDAO, 'update').mockImplementation(async (filter: any) => {
        if (filter.currentSeats && filter.currentSeats.$lt) {
          const maxLimit = filter.currentSeats.$lt;
          if (mockSubscription.currentSeats < maxLimit) {
            return { ...mockSubscription, currentSeats: mockSubscription.currentSeats + 1 } as any;
          }
          return null; // Limit reached
        }
        return mockSubscription as any;
      });

      // Try to increment when already at max (12) with maxLimit=12
      const result = await subscriptionDAO.updateResourceCount('seat', mockClientId, 1, 12);

      expect(result).toBeNull();
    });

    it('should allow increment when below max limit', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        client: mockClientId,
        currentSeats: 10,
      };

      const _updateSpy = jest.spyOn(subscriptionDAO, 'update').mockImplementation(async (filter: any) => {
        if (filter.currentSeats && filter.currentSeats.$lt) {
          const maxLimit = filter.currentSeats.$lt;
          if (mockSubscription.currentSeats < maxLimit) {
            return { ...mockSubscription, currentSeats: mockSubscription.currentSeats + 1 } as any;
          }
          return null;
        }
        return mockSubscription as any;
      });

      const result = await subscriptionDAO.updateResourceCount('seat', mockClientId, 1, 12);

      expect(result).not.toBeNull();
      expect(result?.currentSeats).toBe(11);
    });
  });
});
