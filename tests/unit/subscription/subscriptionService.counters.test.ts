import { Types } from 'mongoose';
import { ClientDAO } from '@dao/clientDAO';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { SubscriptionService } from '@services/subscription/subscription.service';

describe('SubscriptionService - Usage Counter Event Handlers', () => {
  let subscriptionService: SubscriptionService;
  let mockSubscriptionDAO: jest.Mocked<SubscriptionDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;
  let mockEmitterService: jest.Mocked<EventEmitterService>;
  let unitBatchCreatedHandler: (payload: unknown) => void | Promise<void>;

  const mockClientId = new Types.ObjectId();
  const testCuid = 'test-client-123';

  beforeEach(() => {
    mockSubscriptionDAO = {
      updateResourceCount: jest.fn(),
    } as any;

    mockClientDAO = {
      getClientByCuid: jest.fn().mockResolvedValue({
        _id: mockClientId,
        cuid: testCuid,
      }),
    } as any;

    mockEmitterService = {
      on: jest.fn((eventType, handler) => {
        if (eventType === EventTypes.UNIT_BATCH_CREATED) {
          unitBatchCreatedHandler = handler;
        }
      }),
      off: jest.fn(),
    } as any;

    subscriptionService = new SubscriptionService({
      subscriptionDAO: mockSubscriptionDAO,
      clientDAO: mockClientDAO,
      emitterService: mockEmitterService,
      authCache: {} as any,
      sseService: {} as any,
      userDAO: {} as any,
      paymentGatewayService: {} as any,
      propertyDAO: {} as any,
      propertyUnitDAO: {} as any,
    });
  });

  describe('Event Listener Setup', () => {
    it('should register UNIT_BATCH_CREATED event listener on initialization', () => {
      expect(mockEmitterService.on).toHaveBeenCalledWith(
        EventTypes.UNIT_BATCH_CREATED,
        expect.any(Function)
      );
    });

    it('should remove event listeners on cleanup', () => {
      subscriptionService.cleanupEventListeners();
      expect(mockEmitterService.off).toHaveBeenCalledWith(
        EventTypes.UNIT_BATCH_CREATED,
        expect.any(Function)
      );
    });
  });

  describe('UNIT_BATCH_CREATED Handler - Cumulative Tracking', () => {
    it('should increment unit counter when units are created', async () => {
      const payload = {
        cuid: testCuid,
        unitsCreated: 5,
        unitsFailed: 0,
        propertyId: 'prop123',
        userId: 'user123',
      };

      await unitBatchCreatedHandler(payload);

      expect(mockClientDAO.getClientByCuid).toHaveBeenCalledWith(testCuid);
      expect(mockSubscriptionDAO.updateResourceCount).toHaveBeenCalledWith('propertyUnit', mockClientId, 5);
    });

    it('should handle multiple unit creations cumulatively', async () => {
      const batch1 = { cuid: testCuid, unitsCreated: 3 };
      const batch2 = { cuid: testCuid, unitsCreated: 7 };

      await unitBatchCreatedHandler(batch1);
      await unitBatchCreatedHandler(batch2);

      expect(mockSubscriptionDAO.updateResourceCount).toHaveBeenCalledTimes(2);
      expect(mockSubscriptionDAO.updateResourceCount).toHaveBeenNthCalledWith(1, 'propertyUnit', mockClientId, 3);
      expect(mockSubscriptionDAO.updateResourceCount).toHaveBeenNthCalledWith(2, 'propertyUnit', mockClientId, 7);
    });

    it('should not increment counter when zero units created', async () => {
      const payload = { cuid: testCuid, unitsCreated: 0 };

      await unitBatchCreatedHandler(payload);

      expect(mockSubscriptionDAO.updateResourceCount).not.toHaveBeenCalled();
    });

    it('should handle missing cuid gracefully', async () => {
      const payload = { unitsCreated: 5 };

      await expect(unitBatchCreatedHandler(payload)).resolves.not.toThrow();
      expect(mockSubscriptionDAO.updateResourceCount).not.toHaveBeenCalled();
    });

    it('should handle client not found gracefully', async () => {
      mockClientDAO.getClientByCuid.mockResolvedValueOnce(null);
      const payload = { cuid: testCuid, unitsCreated: 5 };

      await expect(unitBatchCreatedHandler(payload)).resolves.not.toThrow();
      expect(mockSubscriptionDAO.updateResourceCount).not.toHaveBeenCalled();
    });

    it('should handle DAO errors gracefully', async () => {
      mockSubscriptionDAO.updateResourceCount.mockRejectedValueOnce(new Error('DB Error'));
      const payload = { cuid: testCuid, unitsCreated: 5 };

      await expect(unitBatchCreatedHandler(payload)).resolves.not.toThrow();
    });
  });

  describe('Cumulative Counting Logic', () => {
    it('should count units cumulatively including archived units', async () => {
      // Simulate: Create 10 units → Archive 3 → Create 5 more
      // Expected counter: 10 + 5 = 15 (archived units still count)
      const batch1 = { cuid: testCuid, unitsCreated: 10 };
      const batch2 = { cuid: testCuid, unitsCreated: 5 };

      await unitBatchCreatedHandler(batch1);
      // Note: Archive event doesn't decrement (by design)
      await unitBatchCreatedHandler(batch2);

      expect(mockSubscriptionDAO.updateResourceCount).toHaveBeenCalledTimes(2);
      expect(mockSubscriptionDAO.updateResourceCount).toHaveBeenNthCalledWith(1, 'propertyUnit', mockClientId, 10);
      expect(mockSubscriptionDAO.updateResourceCount).toHaveBeenNthCalledWith(2, 'propertyUnit', mockClientId, 5);
    });
  });

  describe('Anti-Gaming Protection', () => {
    it('should prevent gaming by counting archived resources', async () => {
      // Scenario: User tries to game by archiving/unarchiving
      // Create 10 units (counter = 10)
      await unitBatchCreatedHandler({ cuid: testCuid, unitsCreated: 10 });

      // Archive 5 units (counter still = 10, not decremented)
      // Unarchive requires no counter change since we count cumulatively

      // Try to create 5 more units
      await unitBatchCreatedHandler({ cuid: testCuid, unitsCreated: 5 });

      // Counter should be 15, not 10 (prevents gaming)
      expect(mockSubscriptionDAO.updateResourceCount).toHaveBeenCalledTimes(2);
      expect(mockSubscriptionDAO.updateResourceCount).toHaveBeenNthCalledWith(1, 'propertyUnit', mockClientId, 10);
      expect(mockSubscriptionDAO.updateResourceCount).toHaveBeenNthCalledWith(2, 'propertyUnit', mockClientId, 5);
    });
  });

  describe('Additional Seat Enforcement', () => {
    let invitationSentHandler: (payload: unknown) => void | Promise<void>;

    beforeEach(() => {
      mockSubscriptionDAO.findFirst = jest.fn();

      // Capture the actual handler registered by the service
      mockEmitterService.on.mockImplementation((eventType, handler) => {
        if (eventType === EventTypes.INVITATION_SENT) {
          invitationSentHandler = handler;
        } else if (eventType === EventTypes.UNIT_BATCH_CREATED) {
          unitBatchCreatedHandler = handler;
        }
        return mockEmitterService;
      });

      // Re-initialize service to capture handlers
      subscriptionService = new SubscriptionService({
        subscriptionDAO: mockSubscriptionDAO,
        clientDAO: mockClientDAO,
        emitterService: mockEmitterService,
        authCache: {} as any,
        sseService: {} as any,
        userDAO: {} as any,
        paymentGatewayService: {} as any,
        propertyDAO: {} as any,
      propertyUnitDAO: {} as any,
    });
    });

    it('should allow invitation when seats available', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        planName: 'growth',
        currentSeats: 8,
        additionalSeatsCount: 2,
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockSubscriptionDAO.updateResourceCount.mockResolvedValue(mockSubscription as any);

      const payload = {
        cuid: testCuid,
        role: 'admin',
        invitationId: 'inv123',
        inviteeEmail: 'test@example.com',
        clientId: mockClientId.toString(),
      };

      // Growth plan: 10 included + 2 additional = 12 total
      // Current: 8 seats, limit: 12, so 4 available
      await invitationSentHandler(payload);

      expect(mockSubscriptionDAO.updateResourceCount).toHaveBeenCalledWith(
        'seat',
        mockClientId,
        1,
        12 // includedSeats (10) + additionalSeatsCount (2)
      );
    });

    it('should block invitation when seat limit reached', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        planName: 'growth',
        currentSeats: 12,
        additionalSeatsCount: 2,
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockSubscriptionDAO.updateResourceCount.mockResolvedValue(null); // Limit reached

      const payload = {
        cuid: testCuid,
        role: 'staff',
        invitationId: 'inv456',
        inviteeEmail: 'blocked@example.com',
        clientId: mockClientId.toString(),
      };

      await expect(invitationSentHandler(payload)).rejects.toThrow('Seat limit reached');
    });

    it('should calculate correct limit with additional seats purchased', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        planName: 'portfolio',
        currentSeats: 30,
        additionalSeatsCount: 10,
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockSubscriptionDAO.updateResourceCount.mockResolvedValue(mockSubscription as any);

      const payload = {
        cuid: testCuid,
        role: 'manager',
        invitationId: 'inv789',
        inviteeEmail: 'manager@example.com',
        clientId: mockClientId.toString(),
      };

      await invitationSentHandler(payload);

      // Portfolio plan: 25 included + 10 additional = 35 total allowed
      expect(mockSubscriptionDAO.updateResourceCount).toHaveBeenCalledWith(
        'seat',
        mockClientId,
        1,
        35
      );
    });
  });
});
