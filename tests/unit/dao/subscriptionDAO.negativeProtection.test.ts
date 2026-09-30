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
    it('should prevent resourceTracker.seatCount from going negative', async () => {
      // Mock a subscription with 3 current seats
      const mockSubscription = {
        _id: new Types.ObjectId(),
        client: mockClientId,
        resourceTracker: { propertyCount: 5, unitCount: 10, seatCount: 3 },
      };

      // Mock the update method to simulate MongoDB query behavior
      const _updateSpy = jest
        .spyOn(subscriptionDAO, 'update')
        .mockImplementation(async (filter: any) => {
          // Simulate MongoDB's behavior: only update if filter matches
          const seatFilter = filter['resourceTracker.seatCount'];
          if (seatFilter && seatFilter.$gte) {
            const required = seatFilter.$gte;
            if (mockSubscription.resourceTracker.seatCount >= required) {
              return {
                ...mockSubscription,
                resourceTracker: {
                  ...mockSubscription.resourceTracker,
                  seatCount: mockSubscription.resourceTracker.seatCount - required,
                },
              } as any;
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
          'resourceTracker.seatCount': { $gte: 5 },
        }),
        expect.objectContaining({
          $inc: { 'resourceTracker.seatCount': -5 },
        }),
        expect.any(Object),
        undefined
      );
    });

    it('should allow decrement when sufficient resources exist', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        client: mockClientId,
        resourceTracker: { propertyCount: 0, unitCount: 0, seatCount: 10 },
      };

      const _updateSpy = jest
        .spyOn(subscriptionDAO, 'update')
        .mockImplementation(async (filter: any) => {
          const seatFilter = filter['resourceTracker.seatCount'];
          if (seatFilter && seatFilter.$gte) {
            const required = seatFilter.$gte;
            if (mockSubscription.resourceTracker.seatCount >= required) {
              return {
                ...mockSubscription,
                resourceTracker: {
                  ...mockSubscription.resourceTracker,
                  seatCount: mockSubscription.resourceTracker.seatCount - required,
                },
              } as any;
            }
            return null;
          }
          return mockSubscription as any;
        });

      const result = await subscriptionDAO.updateResourceCount('seat', mockClientId, -3);

      expect(result).not.toBeNull();
      expect(result?.resourceTracker.seatCount).toBe(7);
    });

    it('should prevent resourceTracker.propertyCount from going negative', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        client: mockClientId,
        resourceTracker: { propertyCount: 2, unitCount: 0, seatCount: 0 },
      };

      const _updateSpy = jest
        .spyOn(subscriptionDAO, 'update')
        .mockImplementation(async (filter: any) => {
          const propFilter = filter['resourceTracker.propertyCount'];
          if (propFilter && propFilter.$gte) {
            const required = propFilter.$gte;
            if (mockSubscription.resourceTracker.propertyCount >= required) {
              return {
                ...mockSubscription,
                resourceTracker: {
                  ...mockSubscription.resourceTracker,
                  propertyCount: mockSubscription.resourceTracker.propertyCount - required,
                },
              } as any;
            }
            return null;
          }
          return mockSubscription as any;
        });

      const result = await subscriptionDAO.updateResourceCount('property', mockClientId, -5);

      expect(result).toBeNull();
    });

    it('should prevent resourceTracker.unitCount from going negative', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        client: mockClientId,
        resourceTracker: { propertyCount: 0, unitCount: 8, seatCount: 0 },
      };

      const _updateSpy = jest
        .spyOn(subscriptionDAO, 'update')
        .mockImplementation(async (filter: any) => {
          const unitFilter = filter['resourceTracker.unitCount'];
          if (unitFilter && unitFilter.$gte) {
            const required = unitFilter.$gte;
            if (mockSubscription.resourceTracker.unitCount >= required) {
              return {
                ...mockSubscription,
                resourceTracker: {
                  ...mockSubscription.resourceTracker,
                  unitCount: mockSubscription.resourceTracker.unitCount - required,
                },
              } as any;
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
        resourceTracker: { propertyCount: 0, unitCount: 0, seatCount: 5 },
      };

      const _updateSpy = jest.spyOn(subscriptionDAO, 'update').mockResolvedValue({
        ...mockSubscription,
        resourceTracker: { propertyCount: 0, unitCount: 0, seatCount: 10 },
      } as any);

      const result = await subscriptionDAO.updateResourceCount('seat', mockClientId, 5);

      expect(result).not.toBeNull();
      expect(_updateSpy).toHaveBeenCalledWith(
        { client: mockClientId },
        { $inc: { 'resourceTracker.seatCount': 5 } },
        { returnDocument: 'after' },
        undefined
      );
    });

    it('should handle decrement by exactly current value (edge case)', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        client: mockClientId,
        resourceTracker: { propertyCount: 0, unitCount: 0, seatCount: 5 },
      };

      const _updateSpy = jest
        .spyOn(subscriptionDAO, 'update')
        .mockImplementation(async (filter: any) => {
          const seatFilter = filter['resourceTracker.seatCount'];
          if (seatFilter && seatFilter.$gte) {
            const required = seatFilter.$gte;
            if (mockSubscription.resourceTracker.seatCount >= required) {
              return {
                ...mockSubscription,
                resourceTracker: { propertyCount: 0, unitCount: 0, seatCount: 0 },
              } as any;
            }
            return null;
          }
          return mockSubscription as any;
        });

      // Decrement by exactly the current value - should succeed and result in 0
      const result = await subscriptionDAO.updateResourceCount('seat', mockClientId, -5);

      expect(result).not.toBeNull();
      expect(result?.resourceTracker.seatCount).toBe(0);
    });
  });

  describe('updateResourceCount - Max Limit Check (Increment)', () => {
    it('should enforce max limit when incrementing', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        client: mockClientId,
        resourceTracker: { propertyCount: 0, unitCount: 0, seatCount: 12 },
      };

      const _updateSpy = jest
        .spyOn(subscriptionDAO, 'update')
        .mockImplementation(async (filter: any) => {
          const seatFilter = filter['resourceTracker.seatCount'];
          if (seatFilter && seatFilter.$lt) {
            const maxLimit = seatFilter.$lt;
            if (mockSubscription.resourceTracker.seatCount < maxLimit) {
              return {
                ...mockSubscription,
                resourceTracker: {
                  ...mockSubscription.resourceTracker,
                  seatCount: mockSubscription.resourceTracker.seatCount + 1,
                },
              } as any;
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
        resourceTracker: { propertyCount: 0, unitCount: 0, seatCount: 10 },
      };

      const _updateSpy = jest
        .spyOn(subscriptionDAO, 'update')
        .mockImplementation(async (filter: any) => {
          const seatFilter = filter['resourceTracker.seatCount'];
          if (seatFilter && seatFilter.$lt) {
            const maxLimit = seatFilter.$lt;
            if (mockSubscription.resourceTracker.seatCount < maxLimit) {
              return {
                ...mockSubscription,
                resourceTracker: {
                  ...mockSubscription.resourceTracker,
                  seatCount: mockSubscription.resourceTracker.seatCount + 1,
                },
              } as any;
            }
            return null;
          }
          return mockSubscription as any;
        });

      const result = await subscriptionDAO.updateResourceCount('seat', mockClientId, 1, 12);

      expect(result).not.toBeNull();
      expect(result?.resourceTracker.seatCount).toBe(11);
    });
  });
});
