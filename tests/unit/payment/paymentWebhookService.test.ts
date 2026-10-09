import { Types } from 'mongoose';
import { MAX_CHARGE_ATTEMPTS } from '@utils/constants';
import { EventTypes } from '@interfaces/events.interface';
import { PaymentWebhookService } from '@services/payments/paymentWebhook.service';
import { TenantPaymentStatus, InvoiceStatus } from '@interfaces/invoice.interface';
import {
  PaymentRecordStatus,
  PaymentRecordType,
  PaymentMethod,
} from '@interfaces/payments.interface';

const CUID = 'CUIDWEBHOOK1';
const PYTUID = 'PYT-WH-001';
const INVOICE_ID = 'in_current';
const TENANT_PROFILE_ID = new Types.ObjectId();
const TENANT_USER_ID = new Types.ObjectId();

const makePayment = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  pytuid: PYTUID,
  cuid: CUID,
  status: PaymentRecordStatus.PENDING,
  paymentType: PaymentRecordType.RENT,
  paymentMethod: PaymentMethod.ONLINE,
  baseAmount: 150000,
  applicationFee: 100,
  currency: 'CAD',
  gatewayPaymentId: INVOICE_ID,
  tenant: TENANT_PROFILE_ID,
  ...overrides,
});

const makeMocks = () => {
  const paymentDAO = {
    findFirst: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    startSession: jest.fn().mockResolvedValue({}),
    withTransaction: jest.fn((session: unknown, cb: (s: unknown) => unknown) => cb(session)),
  };
  const paymentGatewayService = {
    getInvoicePaymentDetails: jest.fn().mockResolvedValue({ success: true, data: {} }),
    getInvoiceIdForPaymentIntent: jest.fn().mockResolvedValue({ success: true, data: null }),
    retrievePaymentMethod: jest.fn().mockResolvedValue({ success: true, data: { type: 'card' } }),
    voidInvoice: jest.fn().mockResolvedValue({ success: true }),
    createInvoice: jest
      .fn()
      .mockResolvedValue({ success: true, data: { invoiceId: 'in_card_retry' } }),
    finalizeInvoice: jest.fn().mockResolvedValue({ success: true }),
    payInvoice: jest.fn().mockResolvedValue({ success: true }),
    updateCustomerDefaultPaymentMethod: jest.fn().mockResolvedValue({ success: true }),
    retrieveSetupIntent: jest.fn().mockResolvedValue({
      success: true,
      data: { paymentMethodId: 'pm_acss', mandateId: 'mandate_1' },
    }),
    getCharge: jest.fn().mockResolvedValue({ success: true, data: { transfer: 'tr_1' } }),
    getDisputeReversedAmount: jest.fn().mockResolvedValue({ success: true, data: 0 }),
    createTransfer: jest.fn().mockResolvedValue({ success: true, data: { transferId: 'tr_2' } }),
  };
  const profileDAO = {
    findFirst: jest.fn().mockResolvedValue({ _id: TENANT_PROFILE_ID, user: TENANT_USER_ID }),
    update: jest.fn().mockResolvedValue({ _id: TENANT_PROFILE_ID }),
  };
  const paymentProcessorDAO = {
    findFirst: jest.fn().mockResolvedValue({ accountId: 'acct_pm' }),
    update: jest.fn().mockResolvedValue({}),
  };
  const invoiceDAO = {
    findFirst: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue({}),
  };
  const emitterService = { emit: jest.fn(), on: jest.fn() };
  const stripeService = {
    getInvoicePaymentDetails: jest.fn(),
    retrievePaymentMethod: jest.fn(),
    getPaymentIntentChargeInfo: jest.fn(),
  };

  const service = new PaymentWebhookService({
    paymentGatewayService: paymentGatewayService as any,
    paymentProcessorDAO: paymentProcessorDAO as any,
    subscriptionPlanConfig: {
      getTransactionFeePercent: jest.fn().mockReturnValue(3),
      calculatePaymentGatewayFee: jest.fn().mockReturnValue(80),
      calculateAchApplicationFee: jest.fn().mockReturnValue(100),
    } as any,
    subscriptionDAO: { findFirst: jest.fn().mockResolvedValue({ planName: 'growth' }) } as any,
    emitterService: emitterService as any,
    stripeService: stripeService as any,
    smsService: { sendToUser: jest.fn().mockResolvedValue({}) } as any,
    userCache: { invalidateUserDetail: jest.fn().mockResolvedValue(undefined) } as any,
    invoiceDAO: invoiceDAO as any,
    profileDAO: profileDAO as any,
    paymentDAO: paymentDAO as any,
  });

  return {
    service,
    paymentDAO,
    paymentGatewayService,
    profileDAO,
    paymentProcessorDAO,
    invoiceDAO,
    emitterService,
    stripeService,
  };
};

const emittedEvents = (emitter: { emit: jest.Mock }) =>
  emitter.emit.mock.calls.map(([eventType]) => eventType);

const statusSetIn = (paymentDAO: { update: jest.Mock }) =>
  paymentDAO.update.mock.calls.map(([, op]) => op?.$set?.status).filter(Boolean);

// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentWebhookService - handleInvoicePaymentSucceeded status guards', () => {
  it.each([PaymentRecordStatus.REFUNDED, PaymentRecordStatus.CANCELLED])(
    'does not overwrite a %s record',
    async (status) => {
      const mocks = makeMocks();
      mocks.paymentDAO.findFirst.mockResolvedValue(makePayment({ status }));

      const result = await mocks.service.handleInvoicePaymentSucceeded(INVOICE_ID, {});

      expect(result.success).toBe(true);
      expect(mocks.paymentDAO.update).not.toHaveBeenCalled();
      expect(mocks.emitterService.emit).not.toHaveBeenCalled();
    }
  );

  it('reads charge details through paymentGatewayService, not StripeService', async () => {
    const mocks = makeMocks();
    mocks.paymentDAO.findFirst.mockResolvedValue(makePayment());
    mocks.paymentGatewayService.getInvoicePaymentDetails.mockResolvedValue({
      success: true,
      data: { chargeId: 'ch_paid', paymentMethodType: 'acss_debit' },
    });

    await mocks.service.handleInvoicePaymentSucceeded(INVOICE_ID, {});

    expect(mocks.stripeService.getInvoicePaymentDetails).not.toHaveBeenCalled();
    expect(mocks.paymentDAO.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: PaymentRecordStatus.PAID,
          gatewayChargeId: 'ch_paid',
          stripePaymentMethodType: 'acss_debit',
        }),
      })
    );
    expect(mocks.emitterService.emit).toHaveBeenCalledWith(
      EventTypes.PAYMENT_SUCCEEDED,
      expect.objectContaining({ currency: 'CAD', tenantId: TENANT_USER_ID.toString() })
    );
  });
});

describe('PaymentWebhookService - handleInvoicePaymentFailed', () => {
  it.each([PaymentRecordStatus.PAID, PaymentRecordStatus.REFUNDED, PaymentRecordStatus.CANCELLED])(
    'ignores a late failure on a %s record and never retries with card',
    async (status) => {
      const mocks = makeMocks();
      mocks.paymentDAO.findFirst.mockResolvedValue(makePayment({ status }));

      const result = await mocks.service.handleInvoicePaymentFailed(INVOICE_ID, {
        default_payment_method: 'pm_acss',
      });

      expect(result.success).toBe(true);
      expect(mocks.paymentDAO.update).not.toHaveBeenCalled();
      expect(mocks.paymentGatewayService.createInvoice).not.toHaveBeenCalled();
      expect(mocks.paymentGatewayService.payInvoice).not.toHaveBeenCalled();
      expect(mocks.emitterService.emit).not.toHaveBeenCalled();
    }
  );

  it('ignores a failure for an invoice that is no longer the current one', async () => {
    const mocks = makeMocks();
    mocks.paymentDAO.findFirst.mockResolvedValue(
      makePayment({ gatewayPaymentId: 'in_replacement' })
    );

    const result = await mocks.service.handleInvoicePaymentFailed('in_old', {});

    expect(result.message).toMatch(/no longer the current invoice/);
    expect(mocks.paymentDAO.update).not.toHaveBeenCalled();
  });

  it('ignores a failure for a split invoice that is already paid', async () => {
    const mocks = makeMocks();
    mocks.paymentDAO.findFirst.mockResolvedValue(
      makePayment({
        status: PaymentRecordStatus.PROCESSING,
        gatewayPaymentId: undefined,
        splitInvoices: [
          { invoiceId: 'in_rent', amount: 100000, category: 'rent', status: 'paid' },
          { invoiceId: 'in_fees', amount: 50000, category: 'fees', status: 'pending' },
        ],
      })
    );

    await mocks.service.handleInvoicePaymentFailed('in_rent', {});

    expect(mocks.paymentDAO.update).not.toHaveBeenCalled();
  });

  it('keeps the record OVERDUE on the first decline even though Stripe will not retry', async () => {
    const mocks = makeMocks();
    mocks.paymentDAO.findFirst.mockResolvedValue(makePayment());

    const result = await mocks.service.handleInvoicePaymentFailed(INVOICE_ID, {
      attempt_count: 1,
      next_payment_attempt: undefined,
    });

    expect(result.message).toBe('Payment will be retried');
    expect(statusSetIn(mocks.paymentDAO)).toEqual([PaymentRecordStatus.OVERDUE]);
    expect(mocks.paymentDAO.update.mock.calls[0][1].$set['failure.retryCount']).toBe(1);
    expect(emittedEvents(mocks.emitterService)).not.toContain(EventTypes.PAYMENT_FAILED);
  });

  it('marks FAILED with failureReason and currency once our retry count is exhausted', async () => {
    const mocks = makeMocks();
    mocks.paymentDAO.findFirst.mockResolvedValue(
      makePayment({
        status: PaymentRecordStatus.OVERDUE,
        failure: { retryCount: MAX_CHARGE_ATTEMPTS - 1 },
      })
    );
    mocks.paymentGatewayService.getInvoicePaymentDetails.mockResolvedValue({
      success: true,
      data: { lastPaymentError: { message: 'Your card was declined.' } },
    });

    await mocks.service.handleInvoicePaymentFailed(INVOICE_ID, {
      next_payment_attempt: 1999999999,
    });

    expect(statusSetIn(mocks.paymentDAO)).toEqual([PaymentRecordStatus.FAILED]);
    expect(mocks.emitterService.emit).toHaveBeenCalledWith(
      EventTypes.PAYMENT_FAILED,
      expect.objectContaining({
        pytuid: PYTUID,
        currency: 'CAD',
        failureReason: 'Your card was declined.',
        tenantId: TENANT_USER_ID.toString(),
      })
    );
  });

  it('retries an ACSS failure with the card on file and tells the tenant instead of reporting a failure', async () => {
    const mocks = makeMocks();
    mocks.paymentDAO.findFirst.mockResolvedValue(makePayment());
    mocks.profileDAO.findFirst.mockResolvedValue({
      _id: TENANT_PROFILE_ID,
      user: TENANT_USER_ID,
      tenantInfo: {
        cardPaymentMethods: new Map([['acct_pm', 'pm_card']]),
        paymentGatewayCustomers: new Map([['platform', 'cus_1']]),
      },
    });
    mocks.paymentGatewayService.retrievePaymentMethod.mockImplementation(
      async (_provider: unknown, pmId: string) =>
        pmId === 'pm_acss'
          ? { success: true, data: { type: 'acss_debit' } }
          : { success: true, data: { type: 'card', last4: '4242' } }
    );

    const result = await mocks.service.handleInvoicePaymentFailed(INVOICE_ID, {
      default_payment_method: 'pm_acss',
    });

    expect(result.success).toBe(true);
    expect(mocks.stripeService.retrievePaymentMethod).not.toHaveBeenCalled();
    expect(mocks.paymentGatewayService.payInvoice).toHaveBeenCalledWith(
      expect.anything(),
      'in_card_retry',
      { paymentMethod: 'pm_card' }
    );
    expect(mocks.emitterService.emit).toHaveBeenCalledWith(
      EventTypes.PAYMENT_RETRIED_WITH_CARD,
      expect.objectContaining({
        cuid: CUID,
        pytuid: PYTUID,
        tenantId: TENANT_USER_ID.toString(),
        amount: 150000,
        currency: 'CAD',
        cardLast4: '4242',
        failureReason: expect.any(String),
      })
    );
    expect(emittedEvents(mocks.emitterService)).not.toContain(EventTypes.PAYMENT_FAILED);
  });

  it('reports PAYMENT_FAILED when an ACSS failure cannot fall back to a card', async () => {
    const mocks = makeMocks();
    mocks.paymentDAO.findFirst.mockResolvedValue(makePayment());
    mocks.profileDAO.findFirst.mockResolvedValue({
      _id: TENANT_PROFILE_ID,
      user: TENANT_USER_ID,
      tenantInfo: {},
    });
    mocks.paymentGatewayService.retrievePaymentMethod.mockResolvedValue({
      success: true,
      data: { type: 'acss_debit' },
    });

    await mocks.service.handleInvoicePaymentFailed(INVOICE_ID, {
      default_payment_method: 'pm_acss',
    });

    expect(mocks.paymentGatewayService.payInvoice).not.toHaveBeenCalled();
    expect(statusSetIn(mocks.paymentDAO)).toContain(PaymentRecordStatus.FAILED);
    expect(mocks.emitterService.emit).toHaveBeenCalledWith(
      EventTypes.PAYMENT_FAILED,
      expect.objectContaining({ currency: 'CAD', failureReason: expect.any(String) })
    );
    expect(emittedEvents(mocks.emitterService)).not.toContain(EventTypes.PAYMENT_RETRIED_WITH_CARD);
  });
});

describe('PaymentWebhookService - handleChargePending', () => {
  it('emits PAD_DEBIT_INITIATED for ACSS debits and never the pre-debit notice', async () => {
    const mocks = makeMocks();
    mocks.paymentDAO.findFirst.mockResolvedValue(makePayment());

    await mocks.service.handleChargePending('ch_pad', {
      invoice: INVOICE_ID,
      payment_intent: 'pi_1',
      amount: 150000,
      currency: 'cad',
      payment_method_details: { type: 'acss_debit' },
    });

    expect(mocks.paymentDAO.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: PaymentRecordStatus.PROCESSING,
          gatewayChargeId: 'ch_pad',
          stripePaymentMethodType: 'acss_debit',
        }),
      })
    );
    expect(mocks.emitterService.emit).toHaveBeenCalledWith(EventTypes.PAD_DEBIT_INITIATED, {
      cuid: CUID,
      pytuid: PYTUID,
      tenantId: TENANT_USER_ID.toString(),
      amount: 150000,
      currency: 'CAD',
    });
    expect(emittedEvents(mocks.emitterService)).not.toContain(
      EventTypes.PAD_PRE_DEBIT_NOTIFICATION
    );
  });

  it('does not send the Canadian PAD notice for US ACH debits', async () => {
    const mocks = makeMocks();
    mocks.paymentDAO.findFirst.mockResolvedValue(makePayment({ currency: 'USD' }));

    await mocks.service.handleChargePending('ch_ach', {
      invoice: INVOICE_ID,
      payment_method_details: { type: 'us_bank_account' },
    });

    expect(statusSetIn(mocks.paymentDAO)).toEqual([PaymentRecordStatus.PROCESSING]);
    expect(mocks.emitterService.emit).not.toHaveBeenCalled();
  });

  it('matches split invoices and records the charge on the split', async () => {
    const mocks = makeMocks();
    mocks.paymentDAO.findFirst.mockResolvedValue(
      makePayment({
        gatewayPaymentId: undefined,
        splitInvoices: [
          { invoiceId: 'in_rent', amount: 100000, category: 'rent', status: 'pending' },
          { invoiceId: 'in_fees', amount: 50000, category: 'fees', status: 'pending' },
        ],
      })
    );

    await mocks.service.handleChargePending('ch_split', {
      invoice: 'in_fees',
      payment_method_details: { type: 'acss_debit' },
    });

    expect(mocks.paymentDAO.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([{ 'splitInvoices.invoiceId': { $in: ['in_fees'] } }]),
      })
    );
    const $set = mocks.paymentDAO.update.mock.calls[0][1].$set;
    expect($set['splitInvoices.1.chargeId']).toBe('ch_split');
    expect($set.gatewayChargeId).toBeUndefined();
  });

  it('resolves the invoice through the PaymentIntent when the charge payload has no invoice (basil+)', async () => {
    const mocks = makeMocks();
    mocks.paymentGatewayService.getInvoiceIdForPaymentIntent.mockResolvedValue({
      success: true,
      data: INVOICE_ID,
    });
    mocks.paymentDAO.findFirst.mockResolvedValue(makePayment());

    const result = await mocks.service.handleChargePending('ch_basil', {
      payment_intent: 'pi_basil',
      payment_method_details: { type: 'acss_debit' },
    });

    expect(result.success).toBe(true);
    expect(mocks.paymentGatewayService.getInvoiceIdForPaymentIntent).toHaveBeenCalledWith(
      expect.anything(),
      'pi_basil'
    );
    expect(mocks.paymentDAO.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([{ gatewayPaymentId: { $in: [INVOICE_ID, 'pi_basil'] } }]),
      })
    );
  });

  it.each([PaymentRecordStatus.PAID, PaymentRecordStatus.REFUNDED, PaymentRecordStatus.CANCELLED])(
    'does not move a %s record back to PROCESSING',
    async (status) => {
      const mocks = makeMocks();
      mocks.paymentDAO.findFirst.mockResolvedValue(makePayment({ status }));

      await mocks.service.handleChargePending('ch_late', {
        invoice: INVOICE_ID,
        payment_method_details: { type: 'acss_debit' },
      });

      expect(mocks.paymentDAO.update).not.toHaveBeenCalled();
      expect(mocks.emitterService.emit).not.toHaveBeenCalled();
    }
  );
});

describe('PaymentWebhookService - handleChargeRefunded', () => {
  const CHARGE_ID = 'ch_refund';

  it('keeps a partially refunded record PAID and stores the cumulative amount', async () => {
    const mocks = makeMocks();
    mocks.paymentDAO.findFirst.mockResolvedValue(
      makePayment({ status: PaymentRecordStatus.PAID, gatewayChargeId: CHARGE_ID })
    );

    await mocks.service.handleChargeRefunded(CHARGE_ID, {
      amount: 150000,
      amount_refunded: 50000,
      refunded: false,
      previous_attributes: { amount_refunded: 0 },
    });

    const $set = mocks.paymentDAO.update.mock.calls[0][1].$set;
    expect($set.status).toBeUndefined();
    expect($set['refund.amount']).toBe(50000);
    expect($set['refund.refundedBy']).toBe('system:stripe-webhook');
    expect(mocks.emitterService.emit).toHaveBeenCalledWith(EventTypes.PAYMENT_REFUNDED, {
      cuid: CUID,
      pytuid: PYTUID,
      chargeId: CHARGE_ID,
      tenantId: TENANT_USER_ID.toString(),
      amount: 50000,
      refundAmount: 50000,
      totalRefunded: 50000,
      currency: 'CAD',
      isPartial: true,
      reason: undefined,
    });
  });

  it('marks REFUNDED on a full refund, reports only the latest refund amount and keeps refundedBy', async () => {
    const mocks = makeMocks();
    mocks.paymentDAO.findFirst.mockResolvedValue(
      makePayment({
        status: PaymentRecordStatus.PAID,
        gatewayChargeId: CHARGE_ID,
        refund: { amount: 50000, refundedBy: 'user-sub-123', reason: 'Goodwill' },
      })
    );

    await mocks.service.handleChargeRefunded(CHARGE_ID, {
      amount: 150000,
      amount_refunded: 150000,
      refunded: true,
      previous_attributes: { amount_refunded: 50000 },
    });

    const $set = mocks.paymentDAO.update.mock.calls[0][1].$set;
    expect($set.status).toBe(PaymentRecordStatus.REFUNDED);
    expect($set['refund.amount']).toBe(150000);
    expect($set).not.toHaveProperty('refund.refundedBy');
    expect(mocks.emitterService.emit).toHaveBeenCalledWith(
      EventTypes.PAYMENT_REFUNDED,
      expect.objectContaining({
        amount: 100000,
        totalRefunded: 150000,
        isPartial: false,
        reason: 'Goodwill',
      })
    );
  });

  it('finds the payment by invoice and back-fills gatewayChargeId when the charge id was never saved', async () => {
    const mocks = makeMocks();
    const payment = makePayment({ status: PaymentRecordStatus.PAID });
    mocks.paymentDAO.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(payment);

    await mocks.service.handleChargeRefunded(CHARGE_ID, {
      invoice: INVOICE_ID,
      amount: 150000,
      amount_refunded: 150000,
      refunded: true,
    });

    expect(mocks.paymentDAO.findFirst).toHaveBeenLastCalledWith({
      gatewayPaymentId: INVOICE_ID,
      deletedAt: null,
    });
    expect(mocks.paymentDAO.update.mock.calls[0][1].$set.gatewayChargeId).toBe(CHARGE_ID);
  });

  it('ignores a charge.refunded event with no refunded amount', async () => {
    const mocks = makeMocks();
    mocks.paymentDAO.findFirst.mockResolvedValue(makePayment({ gatewayChargeId: CHARGE_ID }));

    await mocks.service.handleChargeRefunded(CHARGE_ID, {});

    expect(mocks.paymentDAO.update).not.toHaveBeenCalled();
    expect(mocks.emitterService.emit).not.toHaveBeenCalled();
  });

  it('skips the update and notification when the API refund already recorded this total', async () => {
    const mocks = makeMocks();
    mocks.paymentDAO.findFirst.mockResolvedValue(
      makePayment({
        status: PaymentRecordStatus.PAID,
        gatewayChargeId: CHARGE_ID,
        refund: { amount: 50000, refundedBy: 'user-sub-123' },
      })
    );

    const result = await mocks.service.handleChargeRefunded(CHARGE_ID, {
      amount: 150000,
      amount_refunded: 50000,
      refunded: false,
    });

    expect(result.message).toBe('Refund already recorded');
    expect(mocks.paymentDAO.update).not.toHaveBeenCalled();
    expect(mocks.emitterService.emit).not.toHaveBeenCalled();
  });
});

describe('PaymentWebhookService - payment received SMS', () => {
  it('formats the amount with the payment currency', async () => {
    const mocks = makeMocks();
    const sendToUser = jest.fn().mockResolvedValue({});
    (mocks.service as any).smsService = { sendToUser };
    mocks.paymentDAO.findFirst.mockResolvedValue(makePayment({ currency: 'EUR' }));

    await mocks.service.handleInvoicePaymentSucceeded(INVOICE_ID, {});

    expect(sendToUser).toHaveBeenCalledWith(
      CUID,
      TENANT_USER_ID.toString(),
      'Payment of €1,500.00 received successfully.',
      expect.anything()
    );
  });
});

describe('PaymentWebhookService - PAD mandate confirmation is sent once', () => {
  const setupIntent = {
    id: 'seti_1',
    metadata: { tenantId: TENANT_USER_ID.toString(), cuid: CUID },
    customer: 'cus_1',
    payment_method: 'pm_acss',
    mandate: 'mandate_1',
  };

  const setupMocks = () => {
    const mocks = makeMocks();
    mocks.paymentGatewayService.retrievePaymentMethod.mockResolvedValue({
      success: true,
      data: { type: 'acss_debit' },
    });
    return mocks;
  };

  it('emits PAD_MANDATE_CONFIRMED the first time the mandate is stored', async () => {
    const mocks = setupMocks();

    await mocks.service.handleSetupIntentSucceeded(setupIntent);

    expect(mocks.profileDAO.update).toHaveBeenCalledWith(
      {
        user: TENANT_USER_ID,
        'tenantInfo.padMandateDetails.acct_pm.mandateId': { $ne: 'mandate_1' },
      },
      expect.anything()
    );
    expect(emittedEvents(mocks.emitterService)).toEqual(
      expect.arrayContaining([
        EventTypes.PAYMENT_METHOD_SETUP_COMPLETED,
        EventTypes.PAD_MANDATE_CONFIRMED,
      ])
    );
  });

  it('skips the confirmation when the same mandate was already stored by the other webhook', async () => {
    const mocks = setupMocks();
    mocks.profileDAO.update.mockResolvedValue(null);

    await mocks.service.handleSetupSessionCompleted(
      {
        id: 'cs_1',
        mode: 'setup',
        customer: 'cus_1',
        setup_intent: 'seti_1',
        metadata: { tenantId: TENANT_USER_ID.toString(), cuid: CUID },
      },
      'platform'
    );

    expect(emittedEvents(mocks.emitterService)).not.toContain(EventTypes.PAD_MANDATE_CONFIRMED);
    expect(emittedEvents(mocks.emitterService)).not.toContain(
      EventTypes.PAYMENT_METHOD_SETUP_COMPLETED
    );
  });

  it('does not add the mandate filter for card setups', async () => {
    const mocks = makeMocks();

    await mocks.service.handleSetupIntentSucceeded({ ...setupIntent, mandate: null });

    expect(mocks.profileDAO.update).toHaveBeenCalledWith(
      { user: TENANT_USER_ID },
      expect.anything()
    );
    expect(emittedEvents(mocks.emitterService)).not.toContain(EventTypes.PAD_MANDATE_CONFIRMED);
  });
});

describe('PaymentWebhookService - maintenance invoice stamping', () => {
  it('stamps only the newest approved invoice of the request', async () => {
    const mocks = makeMocks();
    const approvedInvoiceId = new Types.ObjectId();
    mocks.paymentDAO.findFirst.mockResolvedValue(
      makePayment({ paymentType: PaymentRecordType.MAINTENANCE, maintenanceRequestUid: 'MR-1' })
    );
    mocks.paymentGatewayService.getInvoicePaymentDetails.mockResolvedValue({
      success: true,
      data: { chargeId: 'ch_maint' },
    });
    mocks.invoiceDAO.findFirst.mockResolvedValue({ _id: approvedInvoiceId });

    await mocks.service.handleInvoicePaymentSucceeded(INVOICE_ID, {});

    expect(mocks.invoiceDAO.findFirst).toHaveBeenCalledWith(
      { mruid: 'MR-1', cuid: CUID, status: InvoiceStatus.APPROVED, isDeleted: false },
      { sort: { createdAt: -1 } }
    );
    expect(mocks.invoiceDAO.update).toHaveBeenCalledWith(
      { _id: approvedInvoiceId, cuid: CUID },
      {
        $set: { tenantPaymentStatus: TenantPaymentStatus.PAID, stripeChargeId: 'ch_maint' },
      }
    );
  });

  it('does not stamp any invoice when none is approved', async () => {
    const mocks = makeMocks();
    mocks.paymentDAO.findFirst.mockResolvedValue(
      makePayment({ paymentType: PaymentRecordType.MAINTENANCE, maintenanceRequestUid: 'MR-2' })
    );

    await mocks.service.handleInvoicePaymentSucceeded(INVOICE_ID, {});

    expect(mocks.invoiceDAO.update).not.toHaveBeenCalled();
  });
});

describe('PaymentWebhookService - disputes', () => {
  const DISPUTE_ID = 'dp_1';
  const disputeData = { charge: 'ch_disputed', amount: 150000, currency: 'cad' };

  const payoutsBlockedCalls = (paymentProcessorDAO: { update: jest.Mock }) =>
    paymentProcessorDAO.update.mock.calls.filter(([, op]) => op?.$set?.payoutsBlocked);

  it('does not block payouts on a lost dispute when the transfer reversal succeeded', async () => {
    const mocks = makeMocks();
    mocks.paymentDAO.findFirst.mockResolvedValue(
      makePayment({ status: PaymentRecordStatus.PAID, dispute: { status: 'open' } })
    );
    mocks.paymentGatewayService.getDisputeReversedAmount.mockResolvedValue({
      success: true,
      data: 150000,
    });

    await mocks.service.handleDisputeLost(DISPUTE_ID, disputeData);

    expect(payoutsBlockedCalls(mocks.paymentProcessorDAO)).toHaveLength(0);
    expect(mocks.paymentDAO.update).toHaveBeenCalledWith(
      expect.anything(),
      { $set: expect.objectContaining({ 'dispute.status': 'lost' }) },
      undefined,
      expect.anything()
    );
    expect(mocks.emitterService.emit).toHaveBeenCalledWith(
      EventTypes.PAYMENT_DISPUTE_LOST,
      expect.objectContaining({ disputeId: DISPUTE_ID })
    );
  });

  it('blocks payouts on a lost dispute when the reversal did not recover the funds', async () => {
    const mocks = makeMocks();
    mocks.paymentDAO.findFirst.mockResolvedValue(makePayment({ dispute: { status: 'open' } }));
    mocks.paymentGatewayService.getDisputeReversedAmount.mockResolvedValue({
      success: true,
      data: 0,
    });

    await mocks.service.handleDisputeLost(DISPUTE_ID, disputeData);

    expect(payoutsBlockedCalls(mocks.paymentProcessorDAO)).toHaveLength(1);
  });

  it('blocks payouts when the reversal cannot be verified', async () => {
    const mocks = makeMocks();
    mocks.paymentDAO.findFirst.mockResolvedValue(makePayment({ dispute: { status: 'open' } }));
    mocks.paymentGatewayService.getDisputeReversedAmount.mockResolvedValue({
      success: false,
      data: null,
    });

    await mocks.service.handleDisputeLost(DISPUTE_ID, disputeData);

    expect(payoutsBlockedCalls(mocks.paymentProcessorDAO)).toHaveLength(1);
  });

  it.each([
    ['needs_response', 'needs_response'],
    ['warning_needs_response', 'needs_response'],
    ['under_review', 'under_review'],
    ['warning_under_review', 'under_review'],
  ])('syncs Stripe status %s as %s on charge.dispute.updated', async (stripeStatus, stored) => {
    const mocks = makeMocks();
    mocks.paymentDAO.findFirst.mockResolvedValue(makePayment({ dispute: { status: 'open' } }));

    await mocks.service.handleDisputeUpdated(DISPUTE_ID, { ...disputeData, status: stripeStatus });

    expect(mocks.paymentDAO.update).toHaveBeenCalledWith(expect.anything(), {
      $set: expect.objectContaining({ 'dispute.status': stored }),
    });
  });

  it('leaves terminal Stripe statuses to charge.dispute.closed', async () => {
    const mocks = makeMocks();

    const result = await mocks.service.handleDisputeUpdated(DISPUTE_ID, {
      ...disputeData,
      status: 'lost',
    });

    expect(result.success).toBe(true);
    expect(mocks.paymentDAO.findFirst).not.toHaveBeenCalled();
  });

  it('does not reopen a resolved dispute', async () => {
    const mocks = makeMocks();
    mocks.paymentDAO.findFirst.mockResolvedValue(makePayment({ dispute: { status: 'won' } }));

    await mocks.service.handleDisputeUpdated(DISPUTE_ID, {
      ...disputeData,
      status: 'needs_response',
    });

    expect(mocks.paymentDAO.update).not.toHaveBeenCalled();
  });

  it('returns reversed funds and marks the dispute closed when an inquiry closes', async () => {
    const mocks = makeMocks();
    mocks.paymentDAO.findFirst.mockResolvedValue(makePayment({ dispute: { status: 'open' } }));
    mocks.paymentGatewayService.getDisputeReversedAmount.mockResolvedValue({
      success: true,
      data: 150000,
    });

    await mocks.service.handleDisputeWarningClosed(DISPUTE_ID, {
      ...disputeData,
      status: 'warning_closed',
    });

    expect(mocks.paymentGatewayService.createTransfer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ amountInCents: 150000, destination: 'acct_pm' })
    );
    expect(mocks.paymentDAO.update).toHaveBeenCalledWith(
      expect.anything(),
      { $set: expect.objectContaining({ 'dispute.status': 'closed' }) },
      undefined,
      expect.anything()
    );
    expect(emittedEvents(mocks.emitterService)).not.toContain(EventTypes.PAYMENT_DISPUTE_WON);
  });
});
