import { Types } from 'mongoose';
import { ClientDAO } from '@dao/clientDAO';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { SSEService } from '@services/sse/sse.service';
import { BadRequestError } from '@shared/customErrors';
import { PaymentGatewayService } from '@services/paymentGateway';
import { IPaymentGatewayProvider, ISubscriptionStatus } from '@interfaces/index';
import { SubscriptionService } from '@services/subscription/subscription.service';

describe('SubscriptionService - Additional Seat Management', () => {
  let subscriptionService: SubscriptionService;
  let mockSubscriptionDAO: jest.Mocked<SubscriptionDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;
  let mockPaymentGatewayService: jest.Mocked<PaymentGatewayService>;
  let mockSSEService: jest.Mocked<SSEService>;
  let mockAuthCache: any;
  let mockSession: any;

  const testCuid = 'test-client-123';
  const mockClientId = new Types.ObjectId();

  beforeEach(() => {
    mockSession = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      abortTransaction: jest.fn(),
      endSession: jest.fn(),
    };

    mockSubscriptionDAO = {
      findFirst: jest.fn(),
      update: jest.fn(),
      startSession: jest.fn().mockResolvedValue(mockSession),
      withTransaction: jest.fn((session, callback) => callback(session)),
    } as any;

    mockClientDAO = {
      getClientByCuid: jest.fn().mockResolvedValue({
        _id: mockClientId,
        cuid: testCuid,
        accountAdmin: new Types.ObjectId(),
      }),
    } as any;

    mockPaymentGatewayService = {
      getSubscriptionWithItems: jest.fn(),
      addSubscriptionItem: jest.fn(),
      updateSubscriptionItemQuantity: jest.fn(),
      deleteSubscriptionItem: jest.fn(),
    } as any;

    mockSSEService = {
      sendToUser: jest.fn().mockResolvedValue(true),
    } as any;

    mockAuthCache = {
      invalidateCurrentUser: jest.fn().mockResolvedValue({ success: true }),
    };

    const mockEmitterService = {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
    } as any;

    subscriptionService = new SubscriptionService({
      subscriptionDAO: mockSubscriptionDAO,
      clientDAO: mockClientDAO,
      paymentGatewayService: mockPaymentGatewayService,
      sseService: mockSSEService,
      authCache: mockAuthCache,
      stripeService: {} as any,
      userDAO: {} as any,
      emitterService: mockEmitterService,
    });
  });

  describe('updateAdditionalSeats - Purchase Flow (positive delta)', () => {
    it('should purchase seats and create Stripe subscription item for first purchase', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: testCuid,
        planName: 'growth',
        status: ISubscriptionStatus.ACTIVE,
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
        totalMonthlyPrice: 29,
        currentSeats: 8,
        paymentGateway: {
          subscriberId: 'sub_stripe123',
          customerId: 'cus_stripe123',
          provider: 'stripe',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      // Mock Stripe response - no existing seat item
      mockPaymentGatewayService.getSubscriptionWithItems.mockResolvedValue({
        success: true,
        data: {
          items: {
            data: [], // No existing seat items
          },
        },
      });

      mockPaymentGatewayService.addSubscriptionItem.mockResolvedValue({
        success: true,
        data: { id: 'si_new123' },
      });

      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        additionalSeatsCount: 5,
        additionalSeatsCost: 25,
        totalMonthlyPrice: 54,
        paymentGateway: {
          ...mockSubscription.paymentGateway,
          seatItemId: 'si_new123',
        },
      } as any);

      const result = await subscriptionService.updateAdditionalSeats(testCuid, 5);

      expect(result.success).toBe(true);
      expect(mockPaymentGatewayService.addSubscriptionItem).toHaveBeenCalledWith(
        IPaymentGatewayProvider.STRIPE,
        'sub_stripe123',
        'growth_seats',
        5
      );

      expect(mockSubscriptionDAO.update).toHaveBeenCalledWith(
        { _id: mockSubscription._id },
        {
          $inc: { additionalSeatsCount: 5 },
          $set: {
            additionalSeatsCost: 25,
            totalMonthlyPrice: 54,
            'paymentGateway.seatItemId': 'si_new123',
          },
        },
        { new: true },
        mockSession
      );
    });

    it('should update existing Stripe subscription item for subsequent purchases', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: testCuid,
        planName: 'portfolio',
        additionalSeatsCount: 10,
        additionalSeatsCost: 79.90,
        totalMonthlyPrice: 129.90,
        currentSeats: 30,
        paymentGateway: {
          subscriberId: 'sub_stripe123',
          provider: 'stripe',
          seatItemId: 'si_existing123',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      // Mock Stripe response - existing seat item
      mockPaymentGatewayService.getSubscriptionWithItems.mockResolvedValue({
        success: true,
        data: {
          items: {
            data: [
              {
                id: 'si_existing123',
                quantity: 10,
                price: { lookup_key: 'portfolio_seats' },
              },
            ],
          },
        },
      });

      mockPaymentGatewayService.updateSubscriptionItemQuantity.mockResolvedValue({
        success: true,
        data: {},
      });

      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        additionalSeatsCount: 15,
      } as any);

      await subscriptionService.updateAdditionalSeats(testCuid, 5);

      expect(mockPaymentGatewayService.updateSubscriptionItemQuantity).toHaveBeenCalledWith(
        IPaymentGatewayProvider.STRIPE,
        'si_existing123',
        15 // 10 existing + 5 new
      );
    });

    it('should throw error when purchasing exceeds max additional seats', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: testCuid,
        planName: 'growth',
        additionalSeatsCount: 20,
        paymentGateway: {},
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      // Growth plan max additional seats is 25, already have 20, trying to add 10
      await expect(subscriptionService.updateAdditionalSeats(testCuid, 10)).rejects.toThrow(
        BadRequestError
      );
      await expect(subscriptionService.updateAdditionalSeats(testCuid, 10)).rejects.toThrow(
        /maximum of 25 additional seats/
      );
    });

    it('should throw error for Essential plan', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: testCuid,
        planName: 'essential',
        additionalSeatsCount: 0,
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      await expect(subscriptionService.updateAdditionalSeats(testCuid, 3)).rejects.toThrow(
        /Cannot manage seats on Essential plan/
      );
    });
  });

  describe('updateAdditionalSeats - Removal Flow (negative delta)', () => {
    it('should remove seats and update Stripe subscription item', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: testCuid,
        planName: 'growth',
        additionalSeatsCount: 10,
        additionalSeatsCost: 50,
        totalMonthlyPrice: 79,
        currentSeats: 15, // 10 included + 5 in use from additional
        paymentGateway: {
          subscriberId: 'sub_stripe123',
          provider: 'stripe',
          seatItemId: 'si_123',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      mockPaymentGatewayService.getSubscriptionWithItems.mockResolvedValue({
        success: true,
        data: {
          items: {
            data: [{ id: 'si_123', quantity: 10, price: { lookup_key: 'growth_seats' } }],
          },
        },
      });

      mockPaymentGatewayService.updateSubscriptionItemQuantity.mockResolvedValue({
        success: true,
        data: {},
      });

      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        additionalSeatsCount: 7,
      } as any);

      await subscriptionService.updateAdditionalSeats(testCuid, -3);

      expect(mockPaymentGatewayService.updateSubscriptionItemQuantity).toHaveBeenCalledWith(
        IPaymentGatewayProvider.STRIPE,
        'si_123',
        7 // 10 - 3
      );
    });

    it('should delete Stripe subscription item when removing all additional seats', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: testCuid,
        planName: 'growth',
        additionalSeatsCount: 5,
        currentSeats: 10,
        paymentGateway: {
          subscriberId: 'sub_stripe123',
          provider: 'stripe',
          seatItemId: 'si_123',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      mockPaymentGatewayService.getSubscriptionWithItems.mockResolvedValue({
        success: true,
        data: {
          items: {
            data: [{ id: 'si_123', quantity: 5, price: { lookup_key: 'growth_seats' } }],
          },
        },
      });

      mockPaymentGatewayService.deleteSubscriptionItem.mockResolvedValue({
        success: true,
        data: {},
      });

      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        additionalSeatsCount: 0,
      } as any);

      await subscriptionService.updateAdditionalSeats(testCuid, -5);

      expect(mockPaymentGatewayService.deleteSubscriptionItem).toHaveBeenCalledWith(
        IPaymentGatewayProvider.STRIPE,
        'si_123'
      );

      expect(mockSubscriptionDAO.update).toHaveBeenCalledWith(
        { _id: mockSubscription._id },
        expect.objectContaining({
          $unset: { 'paymentGateway.seatItemId': '' },
        }),
        { new: true },
        mockSession
      );
    });

    it('should throw error when removing more seats than purchased', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: testCuid,
        planName: 'growth',
        additionalSeatsCount: 3,
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      await expect(subscriptionService.updateAdditionalSeats(testCuid, -5)).rejects.toThrow(
        /You only have 3 additional seats/
      );
    });

    it('should throw error when removal would exceed current usage', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: testCuid,
        planName: 'growth',
        additionalSeatsCount: 10,
        currentSeats: 18, // 10 included + 8 additional in use
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      // Trying to remove 6 seats would leave total = 10 included + 4 additional = 14
      // But currentSeats = 18, so 4 users would exceed the limit
      await expect(subscriptionService.updateAdditionalSeats(testCuid, -6)).rejects.toThrow(
        /Please archive 4 user\(s\) first/
      );
    });
  });

  describe('updateAdditionalSeats - Validation', () => {
    it('should throw error for zero delta', async () => {
      await expect(subscriptionService.updateAdditionalSeats(testCuid, 0)).rejects.toThrow(
        /Seat change cannot be zero/
      );
    });

    it('should throw error when subscription not found', async () => {
      mockSubscriptionDAO.findFirst.mockResolvedValue(null);

      await expect(subscriptionService.updateAdditionalSeats(testCuid, 5)).rejects.toThrow(
        /Subscription not found/
      );
    });
  });

  describe('updateAdditionalSeats - SSE Notifications', () => {
    it('should send SSE notification on successful purchase', async () => {
      const mockAccountAdmin = new Types.ObjectId();
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: testCuid,
        planName: 'growth',
        additionalSeatsCount: 0,
        totalMonthlyPrice: 29,
        currentSeats: 8,
        paymentGateway: {
          subscriberId: 'sub_stripe123',
          customerId: 'cus_stripe123',
          provider: 'stripe',
        },
      };

      mockClientDAO.getClientByCuid.mockResolvedValue({
        _id: mockClientId,
        cuid: testCuid,
        accountAdmin: mockAccountAdmin,
      } as any);

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      // Mock Stripe response - no existing seat item
      mockPaymentGatewayService.getSubscriptionWithItems.mockResolvedValue({
        success: true,
        data: {
          items: {
            data: [],
          },
        },
      });

      mockPaymentGatewayService.addSubscriptionItem.mockResolvedValue({
        success: true,
        data: { id: 'si_new123' },
      });

      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        additionalSeatsCount: 3,
        totalMonthlyPrice: 44,
        paymentGateway: {
          seatItemId: 'si_new123',
        },
      } as any);

      await subscriptionService.updateAdditionalSeats(testCuid, 3);

      expect(mockSSEService.sendToUser).toHaveBeenCalledWith(
        mockAccountAdmin.toString(),
        testCuid,
        expect.objectContaining({
          eventType: 'seats_purchased',
          message: 'Successfully purchased 3 seats',
        }),
        'subscription_update'
      );
    });

    it('should send SSE notification on successful removal', async () => {
      const mockAccountAdmin = new Types.ObjectId();
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: testCuid,
        planName: 'growth',
        additionalSeatsCount: 5,
        currentSeats: 10,
        totalMonthlyPrice: 54,
        paymentGateway: {
          subscriberId: 'sub_stripe123',
          customerId: 'cus_stripe123',
          provider: 'stripe',
          seatItemId: 'si_existing123',
        },
      };

      mockClientDAO.getClientByCuid.mockResolvedValue({
        _id: mockClientId,
        cuid: testCuid,
        accountAdmin: mockAccountAdmin,
      } as any);

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      // Mock Stripe response - existing seat item
      mockPaymentGatewayService.getSubscriptionWithItems.mockResolvedValue({
        success: true,
        data: {
          items: {
            data: [
              {
                id: 'si_existing123',
                quantity: 5,
                price: { lookup_key: 'growth_seats' },
              },
            ],
          },
        },
      });

      mockPaymentGatewayService.updateSubscriptionItemQuantity.mockResolvedValue({
        success: true,
        data: {},
      });

      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        additionalSeatsCount: 3,
      } as any);

      await subscriptionService.updateAdditionalSeats(testCuid, -2);

      expect(mockSSEService.sendToUser).toHaveBeenCalledWith(
        mockAccountAdmin.toString(),
        testCuid,
        expect.objectContaining({
          eventType: 'seats_purchased',
          message: 'Successfully removed 2 seats',
        }),
        'subscription_update'
      );
    });
  });
});
