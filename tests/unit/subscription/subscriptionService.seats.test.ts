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
  let mockStripeService: any;
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
      client: {
        DEL: jest.fn().mockResolvedValue(1),
      },
    };

    mockStripeService = {
      getPriceByLookupKey: jest.fn().mockResolvedValue({
        id: 'price_test123',
        unit_amount: 500,
        recurring: { interval: 'month' },
      }),
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
      userDAO: {} as any,
      emitterService: mockEmitterService,
      propertyDAO: {} as any,
      propertyUnitDAO: {} as any,
    });
  });

  describe('updateAdditionalSeats - Purchase Flow (positive delta)', () => {
    it('should purchase seats and create Stripe subscription item for monthly subscription', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: testCuid,
        planName: 'growth',
        billingInterval: 'monthly',
        status: ISubscriptionStatus.ACTIVE,
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
        totalMonthlyPrice: 29,
        currentSeats: 8,
        billing: {
          subscriberId: 'sub_stripe123',
          customerId: 'cus_stripe123',
          provider: 'stripe',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      // Mock Stripe price validation - monthly price with monthly interval
      // Growth plan seats are 799¢ = $7.99/month
      mockStripeService.getPriceByLookupKey.mockResolvedValue({
        id: 'price_monthly123',
        unit_amount: 799,
        recurring: { interval: 'month' },
      });

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
        additionalSeatsCost: 39.95, // 5 * $7.99
        totalMonthlyPrice: 68.95, // $29 + $39.95
        billing: {
          ...mockSubscription.billing,
          seatItemId: 'si_new123',
        },
      } as any);

      const result = await subscriptionService.updateAdditionalSeats(testCuid, 5);

      expect(result.success).toBe(true);
      expect(mockStripeService.getPriceByLookupKey).toHaveBeenCalledWith('growth_seats_monthly');
      expect(mockPaymentGatewayService.addSubscriptionItem).toHaveBeenCalledWith(
        IPaymentGatewayProvider.STRIPE,
        'sub_stripe123',
        'growth_seats_monthly',
        5
      );

      expect(mockSubscriptionDAO.update).toHaveBeenCalledWith(
        { _id: mockSubscription._id },
        {
          $inc: { additionalSeatsCount: 5 },
          $set: {
            additionalSeatsCost: 39.95, // 5 * $7.99
            totalMonthlyPrice: 68.95, // $29 + $39.95
            'billing.seatItemId': 'si_new123',
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
        billingInterval: 'monthly',
        additionalSeatsCount: 10,
        additionalSeatsCost: 79.90,
        totalMonthlyPrice: 129.90,
        currentSeats: 30,
        billing: {
          subscriberId: 'sub_stripe123',
          provider: 'stripe',
          seatItemId: 'si_existing123',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      // Mock Stripe price validation - monthly price
      mockStripeService.getPriceByLookupKey.mockResolvedValue({
        id: 'price_monthly123',
        unit_amount: 799,
        recurring: { interval: 'month' },
      });

      // Mock Stripe response - existing seat item
      mockPaymentGatewayService.getSubscriptionWithItems.mockResolvedValue({
        success: true,
        data: {
          items: {
            data: [
              {
                id: 'si_existing123',
                quantity: 10,
                price: { lookup_key: 'portfolio_seat_monthly' },
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

      expect(mockStripeService.getPriceByLookupKey).toHaveBeenCalledWith('portfolio_seat_monthly');
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
        billing: {},
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

    it('should purchase seats for annual subscription using annual lookup key', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: testCuid,
        planName: 'growth',
        billingInterval: 'annual',
        status: ISubscriptionStatus.ACTIVE,
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
        totalMonthlyPrice: 768,
        currentSeats: 8,
        billing: {
          subscriberId: 'sub_stripe123',
          customerId: 'cus_stripe123',
          provider: 'stripe',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      // Mock Stripe price validation - annual price with year interval
      mockStripeService.getPriceByLookupKey.mockResolvedValue({
        id: 'price_annual123',
        unit_amount: 9500,
        recurring: { interval: 'year' },
      });

      mockPaymentGatewayService.getSubscriptionWithItems.mockResolvedValue({
        success: true,
        data: { items: { data: [] } },
      });

      mockPaymentGatewayService.addSubscriptionItem.mockResolvedValue({
        success: true,
        data: { id: 'si_new123' },
      });

      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        additionalSeatsCount: 2,
      } as any);

      await subscriptionService.updateAdditionalSeats(testCuid, 2);

      expect(mockStripeService.getPriceByLookupKey).toHaveBeenCalledWith('growth_seat_annual');
      expect(mockPaymentGatewayService.addSubscriptionItem).toHaveBeenCalledWith(
        IPaymentGatewayProvider.STRIPE,
        'sub_stripe123',
        'growth_seat_annual',
        2
      );
    });

    it('should throw user-friendly error when billing intervals mismatch', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: testCuid,
        planName: 'growth',
        billingInterval: 'annual',
        additionalSeatsCount: 0,
        billing: { subscriberId: 'sub_stripe123', provider: 'stripe' },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      // Mock Stripe returning monthly price when annual expected
      mockStripeService.getPriceByLookupKey.mockResolvedValue({
        id: 'price_monthly123',
        unit_amount: 500,
        recurring: { interval: 'month' }, // Wrong interval!
      });

      await expect(subscriptionService.updateAdditionalSeats(testCuid, 2)).rejects.toThrow(
        /billing interval mismatch/
      );
    });

    it('should throw error when seat price not found in Stripe', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: testCuid,
        planName: 'growth',
        billingInterval: 'monthly',
        additionalSeatsCount: 0,
        billing: { subscriberId: 'sub_stripe123', provider: 'stripe' },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      // Mock Stripe returning null (price not found)
      mockStripeService.getPriceByLookupKey.mockResolvedValue(null);

      await expect(subscriptionService.updateAdditionalSeats(testCuid, 2)).rejects.toThrow(
        /seat price configuration is missing/
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
        billingInterval: 'monthly',
        additionalSeatsCount: 10,
        additionalSeatsCost: 50,
        totalMonthlyPrice: 79,
        currentSeats: 15, // 10 included + 5 in use from additional
        billing: {
          subscriberId: 'sub_stripe123',
          provider: 'stripe',
          seatItemId: 'si_123',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      // Mock Stripe price validation
      mockStripeService.getPriceByLookupKey.mockResolvedValue({
        id: 'price_monthly123',
        unit_amount: 500,
        recurring: { interval: 'month' },
      });

      mockPaymentGatewayService.getSubscriptionWithItems.mockResolvedValue({
        success: true,
        data: {
          items: {
            data: [{ id: 'si_123', quantity: 10, price: { lookup_key: 'growth_seats_monthly' } }],
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
        billing: {
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
          $unset: { 'billing.seatItemId': '' },
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

    it('should calculate maxCanRemove correctly when currentSeats > includedSeats', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: testCuid,
        planName: 'growth',
        billingInterval: 'monthly',
        additionalSeatsCount: 10,
        currentSeats: 15, // 10 included + 5 additional in use
        billing: {
          subscriberId: 'sub_stripe123',
          provider: 'stripe',
          seatItemId: 'si_123',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      // Mock Stripe price validation
      mockStripeService.getPriceByLookupKey.mockResolvedValue({
        id: 'price_monthly123',
        unit_amount: 799,
        recurring: { interval: 'month' },
      });

      mockPaymentGatewayService.getSubscriptionWithItems.mockResolvedValue({
        success: true,
        data: {
          items: {
            data: [{ id: 'si_123', quantity: 10, price: { lookup_key: 'growth_seats_monthly' } }],
          },
        },
      });

      mockPaymentGatewayService.updateSubscriptionItemQuantity.mockResolvedValue({
        success: true,
        data: {},
      });

      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        additionalSeatsCount: 5,
      } as any);

      // maxCanRemove = additionalSeatsCount - (currentSeats - includedSeats)
      // = 10 - (15 - 10) = 10 - 5 = 5
      // So we can remove 5 seats maximum
      const result = await subscriptionService.updateAdditionalSeats(testCuid, -5);

      expect(result.success).toBe(true);
      expect(mockPaymentGatewayService.updateSubscriptionItemQuantity).toHaveBeenCalledWith(
        IPaymentGatewayProvider.STRIPE,
        'si_123',
        5
      );
    });

    it('should throw detailed error when trying to remove more than maxCanRemove', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: testCuid,
        planName: 'portfolio',
        additionalSeatsCount: 15,
        currentSeats: 35, // 25 included + 10 additional in use
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      // maxCanRemove = 15 - (35 - 25) = 15 - 10 = 5
      // Trying to remove 8 seats
      // totalAllowed after removal = 25 + (15 - 8) = 32
      // currentSeats = 35
      // usersToArchive = 35 - 32 = 3

      await expect(subscriptionService.updateAdditionalSeats(testCuid, -8)).rejects.toThrow(
        BadRequestError
      );
      await expect(subscriptionService.updateAdditionalSeats(testCuid, -8)).rejects.toThrow(
        /Cannot remove 8 seats\. You currently have 35 active users but would only have 32 seats allowed\. Please archive 3 user\(s\) first/
      );
    });

    it('should succeed when removing seats and still within current usage', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: testCuid,
        planName: 'growth',
        billingInterval: 'monthly',
        additionalSeatsCount: 10,
        currentSeats: 12, // 10 included + 2 additional in use
        billing: {
          subscriberId: 'sub_stripe123',
          provider: 'stripe',
          seatItemId: 'si_123',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      // Mock Stripe price validation
      mockStripeService.getPriceByLookupKey.mockResolvedValue({
        id: 'price_monthly123',
        unit_amount: 799,
        recurring: { interval: 'month' },
      });

      mockPaymentGatewayService.getSubscriptionWithItems.mockResolvedValue({
        success: true,
        data: {
          items: {
            data: [{ id: 'si_123', quantity: 10, price: { lookup_key: 'growth_seats_monthly' } }],
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

      // Removing 7 seats: 10 - 7 = 3 additional seats remaining
      // Total allowed = 10 included + 3 = 13 seats
      // currentSeats = 12, so it's within limit
      const result = await subscriptionService.updateAdditionalSeats(testCuid, -7);

      expect(result.success).toBe(true);
      expect(mockPaymentGatewayService.updateSubscriptionItemQuantity).toHaveBeenCalledWith(
        IPaymentGatewayProvider.STRIPE,
        'si_123',
        3
      );
    });

    it('should validate seat removal when currentSeats equals includedSeats', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: testCuid,
        planName: 'growth',
        billingInterval: 'monthly',
        additionalSeatsCount: 5,
        currentSeats: 10, // Exactly at included seats, all additional seats unused
        billing: {
          subscriberId: 'sub_stripe123',
          provider: 'stripe',
          seatItemId: 'si_123',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      // Mock Stripe price validation
      mockStripeService.getPriceByLookupKey.mockResolvedValue({
        id: 'price_monthly123',
        unit_amount: 799,
        recurring: { interval: 'month' },
      });

      mockPaymentGatewayService.getSubscriptionWithItems.mockResolvedValue({
        success: true,
        data: {
          items: {
            data: [{ id: 'si_123', quantity: 5, price: { lookup_key: 'growth_seats_monthly' } }],
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

      // Can remove all 5 additional seats since none are in use
      const result = await subscriptionService.updateAdditionalSeats(testCuid, -5);

      expect(result.success).toBe(true);
      expect(mockPaymentGatewayService.deleteSubscriptionItem).toHaveBeenCalledWith(
        IPaymentGatewayProvider.STRIPE,
        'si_123'
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
        billingInterval: 'monthly',
        additionalSeatsCount: 0,
        totalMonthlyPrice: 29,
        currentSeats: 8,
        billing: {
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

      // Mock Stripe price validation
      mockStripeService.getPriceByLookupKey.mockResolvedValue({
        id: 'price_monthly123',
        unit_amount: 500,
        recurring: { interval: 'month' },
      });

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
        billing: {
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
        billingInterval: 'monthly',
        additionalSeatsCount: 5,
        currentSeats: 10,
        totalMonthlyPrice: 54,
        billing: {
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

      // Mock Stripe price validation
      mockStripeService.getPriceByLookupKey.mockResolvedValue({
        id: 'price_monthly123',
        unit_amount: 500,
        recurring: { interval: 'month' },
      });

      // Mock Stripe response - existing seat item
      mockPaymentGatewayService.getSubscriptionWithItems.mockResolvedValue({
        success: true,
        data: {
          items: {
            data: [
              {
                id: 'si_existing123',
                quantity: 5,
                price: { lookup_key: 'growth_seats_monthly' },
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
