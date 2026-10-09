import { Types } from 'mongoose';
import { EventTypes } from '@interfaces/events.interface';
import { IPaymentGatewayProvider } from '@interfaces/index';
import { PaymentRecordStatus, PaymentRecordType } from '@interfaces/payments.interface';

jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));

import { RentPaymentService } from '@services/payments/rentPayment.service';

describe('RentPaymentService — handleDepositRefund', () => {
  let mockPaymentDAO: { findFirst: jest.Mock; updateById: jest.Mock; insert: jest.Mock };
  let mockClientDAO: { findFirst: jest.Mock };
  let mockLeaseDAO: { findFirst: jest.Mock };
  let mockPaymentGatewayService: { createRefund: jest.Mock };
  let mockEmitterService: { emit: jest.Mock; on: jest.Mock; off: jest.Mock };
  let registeredListeners: Record<string, (...args: any[]) => any>;

  const CUID = 'TESTCLIENT123';
  const LEASE_ID = new Types.ObjectId().toString();

  const makeDepositPayment = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    pytuid: 'PYT-DEP-001',
    cuid: CUID,
    paymentType: PaymentRecordType.SECURITY_DEPOSIT,
    status: PaymentRecordStatus.PAID,
    baseAmount: 150000,
    gatewayChargeId: 'ch_stripe_123',
    deletedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    registeredListeners = {};

    mockPaymentDAO = {
      findFirst: jest.fn(),
      updateById: jest.fn().mockReturnValue(Promise.resolve({})),
      insert: jest.fn(),
    };

    mockClientDAO = {
      findFirst: jest.fn().mockReturnValue(Promise.resolve({ settings: {} })),
    };

    mockLeaseDAO = { findFirst: jest.fn().mockReturnValue(Promise.resolve(null)) };

    mockPaymentGatewayService = {
      createRefund: jest
        .fn()
        .mockReturnValue(Promise.resolve({ success: true, data: { refundId: 're_stripe_456' } })),
    };

    mockEmitterService = {
      emit: jest.fn(),
      on: jest.fn().mockImplementation((event: string, handler: (...args: any[]) => any) => {
        registeredListeners[event] = handler;
        return mockEmitterService;
      }),
      off: jest.fn(),
    };

    new RentPaymentService({
      paymentDAO: mockPaymentDAO as any,
      clientDAO: mockClientDAO as any,
      paymentGatewayService: mockPaymentGatewayService as any,
      emitterService: mockEmitterService as any,
      subscriptionPlanConfig: {} as any,
      paymentWebhookService: {} as any,
      paymentProcessorDAO: {} as any,
      subscriptionDAO: {} as any,
      paymentCronService: {} as any,
      queueFactory: { getQueue: jest.fn() } as any,
      profileDAO: {} as any,
      userCache: {} as any,
      leaseDAO: mockLeaseDAO as any,
    }).registerEventListeners();
  });

  it('should register INSPECTION_APPROVED listener', () => {
    expect(registeredListeners[EventTypes.INSPECTION_APPROVED]).toBeDefined();
  });

  // ─── Stripe refund path ────────────────────────────────────────────────────

  describe('Stripe-backed deposit', () => {
    it('should refund via Stripe and store gatewayRefundId + refundedBy', async () => {
      const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];
      const deposit = makeDepositPayment();

      mockPaymentDAO.findFirst.mockReturnValue(Promise.resolve(deposit));

      await handler({ refundAmount: 100000, leaseId: LEASE_ID, cuid: CUID });

      expect(mockPaymentGatewayService.createRefund).toHaveBeenCalledWith(
        IPaymentGatewayProvider.STRIPE,
        {
          chargeId: 'ch_stripe_123',
          amountInCents: 100000,
          reason: 'requested_by_customer',
          note: 'Move-out inspection — security deposit refund',
          idempotencyKey: 'deposit-refund:PYT-DEP-001:0',
        }
      );

      expect(mockPaymentDAO.updateById).toHaveBeenCalledWith(deposit._id.toString(), {
        $unset: { 'refund.failureReason': 1, 'refund.failedAt': 1 },
        $set: expect.objectContaining({
          status: PaymentRecordStatus.REFUNDED,
          'refund.amount': 100000,
          'refund.refundedAt': expect.any(Date),
          'refund.refundedBy': 'system:inspection-approved',
          'refund.reason': 'Move-out inspection deposit refund',
          'refund.gatewayRefundId': 're_stripe_456',
        }),
      });
    });

    it('should use a new idempotency key when retrying after a failed refund', async () => {
      const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];
      const failedAt = new Date('2026-10-01T12:00:00Z');
      const deposit = makeDepositPayment({ refund: { failureReason: 'card_declined', failedAt } });

      mockPaymentDAO.findFirst.mockReturnValue(Promise.resolve(deposit));

      await handler({ refundAmount: 100000, leaseId: LEASE_ID, cuid: CUID });

      expect(mockPaymentGatewayService.createRefund).toHaveBeenCalledWith(
        IPaymentGatewayProvider.STRIPE,
        expect.objectContaining({
          idempotencyKey: `deposit-refund:PYT-DEP-001:${failedAt.getTime()}`,
        })
      );
    });

    it('should emit PAYMENT_REFUNDED once Stripe accepts the refund', async () => {
      const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];
      const tenantProfileId = new Types.ObjectId();
      const deposit = makeDepositPayment({ tenant: tenantProfileId, currency: 'CAD' });
      mockPaymentDAO.findFirst.mockReturnValue(Promise.resolve(deposit));

      await handler({ refundAmount: 100000, leaseId: LEASE_ID, cuid: CUID });

      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        EventTypes.PAYMENT_REFUNDED,
        expect.objectContaining({
          cuid: CUID,
          pytuid: 'PYT-DEP-001',
          tenantId: tenantProfileId.toString(),
          amount: 100000,
          totalRefunded: 100000,
          currency: 'CAD',
          isPartial: true,
          reason: 'Move-out inspection deposit refund',
        })
      );
    });

    it('should stage PENDING_REFUND with the failure reason and emit DEPOSIT_REFUND_FAILED when Stripe refund fails', async () => {
      const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];
      const deposit = makeDepositPayment({ currency: 'CAD' });

      mockPaymentDAO.findFirst.mockReturnValue(Promise.resolve(deposit));
      mockPaymentGatewayService.createRefund.mockReturnValue(
        Promise.resolve({ success: false, message: 'Card expired' })
      );

      await handler({ refundAmount: 100000, leaseId: LEASE_ID, cuid: CUID });

      expect(mockPaymentDAO.updateById).toHaveBeenCalledWith(deposit._id.toString(), {
        $set: expect.objectContaining({
          status: PaymentRecordStatus.PENDING_REFUND,
          'refund.amount': 100000,
          'refund.failureReason': 'Card expired',
          'refund.failedAt': expect.any(Date),
        }),
      });
      expect(mockPaymentDAO.updateById).not.toHaveBeenCalledWith(
        deposit._id.toString(),
        expect.objectContaining({
          $set: expect.objectContaining({ status: PaymentRecordStatus.REFUNDED }),
        })
      );
      expect(mockEmitterService.emit).toHaveBeenCalledWith(EventTypes.DEPOSIT_REFUND_FAILED, {
        cuid: CUID,
        pytuid: 'PYT-DEP-001',
        leaseId: LEASE_ID,
        amount: 100000,
        currency: 'CAD',
        reason: 'Card expired',
      });
      expect(mockEmitterService.emit).not.toHaveBeenCalledWith(
        EventTypes.PAYMENT_REFUNDED,
        expect.anything()
      );
    });

    it('should cap the refund at the collected deposit (security + pet)', async () => {
      const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];
      const deposit = makeDepositPayment({ baseAmount: 175000 });
      mockPaymentDAO.findFirst.mockReturnValue(Promise.resolve(deposit));

      await handler({ refundAmount: 999999, leaseId: LEASE_ID, cuid: CUID });

      expect(mockPaymentGatewayService.createRefund).toHaveBeenCalledWith(
        IPaymentGatewayProvider.STRIPE,
        expect.objectContaining({ amountInCents: 175000 })
      );
    });
  });

  // ─── Offline deposit path ──────────────────────────────────────────────────

  describe('Offline deposit (no Stripe charge)', () => {
    it('should stage PENDING_REFUND for manager release without calling Stripe', async () => {
      const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];
      const deposit = makeDepositPayment({ gatewayChargeId: null });

      mockPaymentDAO.findFirst.mockReturnValue(Promise.resolve(deposit));

      await handler({ refundAmount: 80000, leaseId: LEASE_ID, cuid: CUID });

      expect(mockPaymentGatewayService.createRefund).not.toHaveBeenCalled();
      expect(mockPaymentDAO.updateById).toHaveBeenCalledWith(deposit._id.toString(), {
        $set: expect.objectContaining({
          status: PaymentRecordStatus.PENDING_REFUND,
          'refund.amount': 80000,
          'refund.refundedBy': 'system:inspection-approved',
          'refund.reason':
            'Move-out inspection deposit refund (offline) — awaiting manager release',
        }),
      });
    });
  });

  // ─── PENDING_REFUND path ───────────────────────────────────────────────────

  describe('requireDepositRefundApproval = true', () => {
    it('should stage as PENDING_REFUND instead of refunding immediately', async () => {
      const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];
      const deposit = makeDepositPayment();

      mockPaymentDAO.findFirst.mockReturnValue(Promise.resolve(deposit));
      mockClientDAO.findFirst.mockReturnValue(
        Promise.resolve({ settings: { requireDepositRefundApproval: true } })
      );

      await handler({ refundAmount: 100000, leaseId: LEASE_ID, cuid: CUID });

      // Should NOT call Stripe
      expect(mockPaymentGatewayService.createRefund).not.toHaveBeenCalled();

      // Should stage as PENDING_REFUND
      expect(mockPaymentDAO.updateById).toHaveBeenCalledWith(deposit._id.toString(), {
        $set: expect.objectContaining({
          status: PaymentRecordStatus.PENDING_REFUND,
          'refund.amount': 100000,
          'refund.refundedBy': 'system:inspection-approved',
          'refund.reason': 'Move-out inspection deposit refund — awaiting PM approval',
        }),
      });
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('should skip refund when refundAmount is 0', async () => {
      const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];

      // No paid deposit exists
      mockPaymentDAO.findFirst.mockReturnValue(Promise.resolve(null));

      await handler({ refundAmount: 0, leaseId: LEASE_ID, cuid: CUID });

      expect(mockPaymentGatewayService.createRefund).not.toHaveBeenCalled();
      expect(mockPaymentDAO.updateById).not.toHaveBeenCalled();
    });

    it('should skip refund when refundAmount is undefined', async () => {
      const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];

      mockPaymentDAO.findFirst.mockReturnValue(Promise.resolve(null));

      await handler({ leaseId: LEASE_ID, cuid: CUID });

      expect(mockPaymentGatewayService.createRefund).not.toHaveBeenCalled();
      expect(mockPaymentDAO.updateById).not.toHaveBeenCalled();
    });

    it('should warn when refundAmount=0 but a paid deposit exists', async () => {
      const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];
      const deposit = makeDepositPayment();

      // First findFirst call: the $0 refund check finds a paid deposit
      mockPaymentDAO.findFirst.mockReturnValue(Promise.resolve(deposit));

      await handler({ refundAmount: 0, leaseId: LEASE_ID, cuid: CUID });

      // Should query for the deposit (warning check)
      expect(mockPaymentDAO.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentType: PaymentRecordType.SECURITY_DEPOSIT,
          status: { $in: [PaymentRecordStatus.PAID] },
        })
      );

      // Should NOT process any refund
      expect(mockPaymentDAO.updateById).not.toHaveBeenCalled();
    });

    it('should refund the deposit held on the original lease when the lease is a renewal', async () => {
      const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];
      const originalLeaseId = new Types.ObjectId();
      const deposit = makeDepositPayment({ lease: originalLeaseId });

      mockPaymentDAO.findFirst
        .mockReturnValueOnce(Promise.resolve(null))
        .mockReturnValueOnce(Promise.resolve(deposit));
      mockLeaseDAO.findFirst.mockReturnValueOnce(
        Promise.resolve({ previousLeaseId: originalLeaseId })
      );

      await handler({ refundAmount: 100000, leaseId: LEASE_ID, cuid: CUID });

      expect(mockPaymentDAO.findFirst).toHaveBeenLastCalledWith(
        expect.objectContaining({ lease: originalLeaseId })
      );
      expect(mockPaymentGatewayService.createRefund).toHaveBeenCalledWith(
        IPaymentGatewayProvider.STRIPE,
        expect.objectContaining({ chargeId: 'ch_stripe_123', amountInCents: 100000 })
      );
    });

    it('should skip when no paid deposit payment exists', async () => {
      const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];

      mockPaymentDAO.findFirst.mockReturnValue(Promise.resolve(null));

      await handler({ refundAmount: 50000, leaseId: LEASE_ID, cuid: CUID });

      // No deposit found — nothing to refund
      expect(mockPaymentGatewayService.createRefund).not.toHaveBeenCalled();
      expect(mockPaymentDAO.updateById).not.toHaveBeenCalled();
    });

    it('should not throw when an unexpected error occurs', async () => {
      const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];

      mockPaymentDAO.findFirst.mockReturnValue(Promise.reject(new Error('DB down')));

      // Should not throw — error is caught and logged
      await expect(
        handler({ refundAmount: 50000, leaseId: LEASE_ID, cuid: CUID })
      ).resolves.not.toThrow();
    });
  });
});
