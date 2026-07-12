import { Types } from 'mongoose';
import { PaymentDAO } from '@dao/paymentDAO';
import { ProfileDAO } from '@dao/profileDAO';
import { InvoiceDAO } from '@dao/invoiceDAO';
import { Payment, Client, Profile } from '@models/index';
import { clearTestDatabase } from '@tests/helpers';
import {
  PaymentRecordStatus,
  PaymentRecordType,
  PaymentMethod,
} from '@interfaces/payments.interface';
import { PaymentWebhookService } from '@services/payments/paymentWebhook.service';
import type { IStripeInvoiceWebhookData } from '@services/payments/paymentWebhook.service';

/**
 * Integration tests for the split invoices feature.
 *
 * The split invoices feature splits large ACSS debit payments (over $3,000 CAD)
 * into two Stripe invoices: one for rent, one for fees. This test file covers:
 *
 * 1. Webhook handling of partial and full split invoice payments
 * 2. Non-split payment webhook flow (backward compatibility)
 * 3. Model-level storage of splitInvoices data
 *
 * External services (Stripe, EventEmitter, SMS, caches) are mocked.
 * Real DAOs + mongodb-memory-server are used for database interactions.
 */
describe('PaymentWebhookService — split invoice handling', () => {
  let webhookService: PaymentWebhookService;
  let paymentDAO: PaymentDAO;
  let profileDAO: ProfileDAO;

  const testCuid = 'SPLIT_INV_TEST';
  const tenantProfileId = new Types.ObjectId();
  const tenantUserId = new Types.ObjectId();
  const leaseId = new Types.ObjectId();

  // Mock external services
  const mockStripeService = {
    getInvoicePaymentDetails: jest.fn(),
  } as any;

  const mockEmitterService = {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  } as any;

  const mockSmsService = {
    sendToUser: jest.fn().mockResolvedValue(undefined),
  } as any;

  const mockUserCache = {
    getUserDetail: jest.fn().mockResolvedValue({ success: false, data: null }),
    cacheUserDetail: jest.fn().mockResolvedValue(undefined),
    invalidateUserDetail: jest.fn().mockResolvedValue(undefined),
    invalidateUserLists: jest.fn().mockResolvedValue(undefined),
  } as any;

  const mockPaymentGatewayService = {} as any;
  const mockPaymentProcessorDAO = {} as any;
  const mockSubscriptionDAO = {} as any;
  const mockSubscriptionPlanConfig = {} as any;

  beforeAll(async () => {
    paymentDAO = new PaymentDAO({ paymentModel: Payment });
    profileDAO = new ProfileDAO({ profileModel: Profile });
  });

  beforeEach(async () => {
    await clearTestDatabase();
    jest.clearAllMocks();

    // Create test client
    await Client.create({
      _id: new Types.ObjectId(),
      cuid: testCuid,
      displayName: 'Split Invoice Test Client',
      accountAdmin: new Types.ObjectId(),
      accountType: { category: 'individual' },
    });

    // Create test tenant profile (needed for receipt email lookup)
    await Profile.create({
      _id: tenantProfileId,
      puid: `puid-${Math.random().toString(36).slice(2, 10)}`,
      user: tenantUserId,
      personalInfo: {
        firstName: 'Test',
        lastName: 'Tenant',
        displayName: 'Test Tenant',
        location: 'Toronto',
      },
      settings: { lang: 'en' },
    });

    // Default: Stripe returns a charge ID and acss_debit method
    mockStripeService.getInvoicePaymentDetails.mockResolvedValue({
      chargeId: 'ch_test_default',
      paymentMethodType: 'acss_debit',
    });

    // Use a mock invoiceDAO (not tested here)
    const mockInvoiceDAO = {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(null),
    } as any;

    webhookService = new PaymentWebhookService({
      paymentGatewayService: mockPaymentGatewayService,
      paymentProcessorDAO: mockPaymentProcessorDAO,
      subscriptionPlanConfig: mockSubscriptionPlanConfig,
      subscriptionDAO: mockSubscriptionDAO,
      emitterService: mockEmitterService,
      stripeService: mockStripeService,
      smsService: mockSmsService,
      userCache: mockUserCache,
      invoiceDAO: mockInvoiceDAO,
      profileDAO,
      paymentDAO,
    });
  });

  // Helper: create a payment record in the DB
  const createPayment = async (overrides: Record<string, any> = {}) => {
    const defaults = {
      cuid: testCuid,
      pytuid: `PY-${Math.random().toString(36).slice(2, 10)}`,
      invoiceNumber: `INV-${Math.random().toString(36).slice(2, 10)}`,
      paymentType: PaymentRecordType.RENT,
      paymentMethod: PaymentMethod.ONLINE,
      status: PaymentRecordStatus.PROCESSING,
      baseAmount: 395000,
      processingFee: 0,
      applicationFee: 7900,
      platformRevenue: 7900,
      currency: 'CAD',
      lease: leaseId,
      tenant: tenantProfileId,
      dueDate: new Date('2026-08-01'),
      isManualEntry: false,
      period: { month: 8, year: 2026 },
    };

    return Payment.create({ ...defaults, ...overrides });
  };

  const baseInvoiceData: IStripeInvoiceWebhookData = {
    hosted_invoice_url: 'https://invoice.stripe.com/test',
  };

  // ===========================================================================
  // Webhook: partial split payment (first of two invoices paid)
  // ===========================================================================

  describe('partial split payment', () => {
    it('should mark only the matching split entry as paid and keep parent PROCESSING', async () => {
      const payment = await createPayment({
        gatewayPaymentId: 'in_rent_partial',
        splitInvoices: [
          { invoiceId: 'in_rent_partial', amount: 350000, category: 'rent', status: 'pending' },
          { invoiceId: 'in_fees_partial', amount: 45000, category: 'fees', status: 'pending' },
        ],
      });

      mockStripeService.getInvoicePaymentDetails.mockResolvedValue({
        chargeId: 'ch_rent_partial',
        paymentMethodType: 'acss_debit',
      });

      const result = await webhookService.handleInvoicePaymentSucceeded(
        'in_rent_partial',
        baseInvoiceData
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe('Split invoice partial payment recorded');

      // Verify DB state
      const updated = await Payment.findById(payment._id).lean();
      expect(updated).toBeDefined();
      expect(updated!.status).toBe(PaymentRecordStatus.PROCESSING);
      expect(updated!.paidAt).toBeUndefined();

      const rentSplit = updated!.splitInvoices!.find((si: any) => si.category === 'rent');
      const feesSplit = updated!.splitInvoices!.find((si: any) => si.category === 'fees');

      expect(rentSplit!.status).toBe('paid');
      expect(rentSplit!.chargeId).toBe('ch_rent_partial');
      expect(rentSplit!.paidAt).toBeDefined();

      expect(feesSplit!.status).toBe('pending');
      expect(feesSplit!.chargeId).toBeUndefined();

      // Should NOT emit PAYMENT_SUCCEEDED for partial
      expect(mockEmitterService.emit).not.toHaveBeenCalled();
    });

    it('should transition parent from PENDING to PROCESSING on first split payment', async () => {
      const payment = await createPayment({
        status: PaymentRecordStatus.PENDING,
        gatewayPaymentId: 'in_rent_pend',
        splitInvoices: [
          { invoiceId: 'in_rent_pend', amount: 350000, category: 'rent', status: 'pending' },
          { invoiceId: 'in_fees_pend', amount: 45000, category: 'fees', status: 'pending' },
        ],
      });

      mockStripeService.getInvoicePaymentDetails.mockResolvedValue({
        chargeId: 'ch_rent_pend',
        paymentMethodType: 'acss_debit',
      });

      await webhookService.handleInvoicePaymentSucceeded('in_rent_pend', baseInvoiceData);

      const updated = await Payment.findById(payment._id).lean();
      expect(updated!.status).toBe(PaymentRecordStatus.PROCESSING);
    });
  });

  // ===========================================================================
  // Webhook: all splits paid (second invoice completes the payment)
  // ===========================================================================

  describe('all splits paid', () => {
    it('should mark parent as PAID when the last split invoice is paid', async () => {
      const payment = await createPayment({
        gatewayPaymentId: 'in_rent_full',
        splitInvoices: [
          { invoiceId: 'in_rent_full', amount: 350000, category: 'rent', status: 'paid', chargeId: 'ch_rent_full', paidAt: new Date() },
          { invoiceId: 'in_fees_full', amount: 45000, category: 'fees', status: 'pending' },
        ],
      });

      mockStripeService.getInvoicePaymentDetails.mockResolvedValue({
        chargeId: 'ch_fees_full',
        paymentMethodType: 'acss_debit',
      });

      const result = await webhookService.handleInvoicePaymentSucceeded(
        'in_fees_full',
        baseInvoiceData
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe('Payment updated successfully');

      // Verify DB state
      const updated = await Payment.findById(payment._id).lean();
      expect(updated!.status).toBe(PaymentRecordStatus.PAID);
      expect(updated!.paidAt).toBeDefined();
      expect(updated!.gatewayChargeId).toBe('ch_fees_full');
      expect(updated!.stripePaymentMethodType).toBe('acss_debit');

      // Both splits should be paid
      const allPaid = updated!.splitInvoices!.every((si: any) => si.status === 'paid');
      expect(allPaid).toBe(true);

      const feesSplit = updated!.splitInvoices!.find((si: any) => si.category === 'fees');
      expect(feesSplit!.chargeId).toBe('ch_fees_full');
      expect(feesSplit!.paidAt).toBeDefined();

      // Should emit PAYMENT_SUCCEEDED when fully paid
      expect(mockEmitterService.emit).toHaveBeenCalled();
    });

    it('should set receipt URL from hosted_invoice_url when all splits are paid', async () => {
      await createPayment({
        gatewayPaymentId: 'in_rent_receipt',
        splitInvoices: [
          { invoiceId: 'in_rent_receipt', amount: 300000, category: 'rent', status: 'paid', chargeId: 'ch_r', paidAt: new Date() },
          { invoiceId: 'in_fees_receipt', amount: 50000, category: 'fees', status: 'pending' },
        ],
      });

      mockStripeService.getInvoicePaymentDetails.mockResolvedValue({
        chargeId: 'ch_f_receipt',
        paymentMethodType: 'acss_debit',
      });

      await webhookService.handleInvoicePaymentSucceeded('in_fees_receipt', {
        hosted_invoice_url: 'https://invoice.stripe.com/receipt_url',
      });

      const updated = await Payment.findOne({ gatewayPaymentId: 'in_rent_receipt' }).lean();
      expect(updated!.receipt?.url).toBe('https://invoice.stripe.com/receipt_url');
    });
  });

  // ===========================================================================
  // Webhook: non-split payment (backward compatibility)
  // ===========================================================================

  describe('non-split payment', () => {
    it('should mark payment directly as PAID without splitInvoices', async () => {
      const payment = await createPayment({
        gatewayPaymentId: 'in_nosplit',
        status: PaymentRecordStatus.PENDING,
        // No splitInvoices field
      });

      // Remove the default empty array that Mongoose creates
      await Payment.updateOne({ _id: payment._id }, { $unset: { splitInvoices: 1 } });

      mockStripeService.getInvoicePaymentDetails.mockResolvedValue({
        chargeId: 'ch_nosplit',
        paymentMethodType: 'card',
      });

      const result = await webhookService.handleInvoicePaymentSucceeded(
        'in_nosplit',
        baseInvoiceData
      );

      expect(result.success).toBe(true);

      const updated = await Payment.findById(payment._id).lean();
      expect(updated!.status).toBe(PaymentRecordStatus.PAID);
      expect(updated!.paidAt).toBeDefined();
      expect(updated!.gatewayChargeId).toBe('ch_nosplit');
      expect(updated!.stripePaymentMethodType).toBe('card');

      // Emit should be called for direct payment
      expect(mockEmitterService.emit).toHaveBeenCalled();
    });

    it('should handle already-paid payment idempotently', async () => {
      await createPayment({
        gatewayPaymentId: 'in_already_paid',
        status: PaymentRecordStatus.PAID,
        paidAt: new Date(),
      });

      const result = await webhookService.handleInvoicePaymentSucceeded(
        'in_already_paid',
        baseInvoiceData
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe('Payment already paid');
      expect(mockStripeService.getInvoicePaymentDetails).not.toHaveBeenCalled();
    });

    it('should return failure when payment record is not found', async () => {
      const result = await webhookService.handleInvoicePaymentSucceeded(
        'in_nonexistent',
        baseInvoiceData
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('Payment record not found');
    });
  });

  // ===========================================================================
  // Webhook: edge cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle webhook when Stripe returns no charge ID', async () => {
      await createPayment({
        gatewayPaymentId: 'in_no_charge',
        status: PaymentRecordStatus.PENDING,
      });

      await Payment.updateOne({ gatewayPaymentId: 'in_no_charge' }, { $unset: { splitInvoices: 1 } });

      mockStripeService.getInvoicePaymentDetails.mockResolvedValue({
        chargeId: null,
        paymentMethodType: 'acss_debit',
      });

      const result = await webhookService.handleInvoicePaymentSucceeded(
        'in_no_charge',
        baseInvoiceData
      );

      expect(result.success).toBe(true);

      const updated = await Payment.findOne({ gatewayPaymentId: 'in_no_charge' }).lean();
      expect(updated!.status).toBe(PaymentRecordStatus.PAID);
      // gatewayChargeId should be null since Stripe returned no charge
      expect(updated!.gatewayChargeId).toBeNull();
    });

    it('should find payment by splitInvoices.invoiceId (not just gatewayPaymentId)', async () => {
      // The gatewayPaymentId is the rent invoice, but the webhook arrives for the fees invoice
      const payment = await createPayment({
        gatewayPaymentId: 'in_rent_lookup',
        splitInvoices: [
          { invoiceId: 'in_rent_lookup', amount: 300000, category: 'rent', status: 'paid', chargeId: 'ch_r', paidAt: new Date() },
          { invoiceId: 'in_fees_lookup', amount: 60000, category: 'fees', status: 'pending' },
        ],
      });

      mockStripeService.getInvoicePaymentDetails.mockResolvedValue({
        chargeId: 'ch_fees_lookup',
        paymentMethodType: 'acss_debit',
      });

      // The fees invoice ID is NOT the gatewayPaymentId, but the $or query should find it
      const result = await webhookService.handleInvoicePaymentSucceeded(
        'in_fees_lookup',
        baseInvoiceData
      );

      expect(result.success).toBe(true);

      const updated = await Payment.findById(payment._id).lean();
      expect(updated!.status).toBe(PaymentRecordStatus.PAID);
    });

    it('should handle payment with empty splitInvoices array as non-split', async () => {
      // Mongoose stores empty sub-doc arrays as [] — this should follow the non-split path
      const payment = await createPayment({
        gatewayPaymentId: 'in_empty_splits',
        status: PaymentRecordStatus.PENDING,
        splitInvoices: [],
      });

      mockStripeService.getInvoicePaymentDetails.mockResolvedValue({
        chargeId: 'ch_empty_splits',
        paymentMethodType: 'card',
      });

      const result = await webhookService.handleInvoicePaymentSucceeded(
        'in_empty_splits',
        baseInvoiceData
      );

      expect(result.success).toBe(true);

      const updated = await Payment.findById(payment._id).lean();
      expect(updated!.status).toBe(PaymentRecordStatus.PAID);
    });
  });
});
