import dayjs from 'dayjs';
import { UserDAO } from '@dao/userDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import mongoose, { Types } from 'mongoose';
import { ClientDAO } from '@dao/clientDAO';
import { PaymentDAO } from '@dao/paymentDAO';
import { ProfileDAO } from '@dao/profileDAO';
import { envVariables } from '@shared/config';
import { clearTestDatabase } from '@tests/helpers';
import { runSchemaSync } from '@database/schema-sync';
import { proRateAmount } from '@utils/financial.utils';
import { EventTypes } from '@interfaces/events.interface';
import { PaymentProcessorDAO } from '@dao/paymentProcessorDAO';
import { subscriptionPlanConfig } from '@services/subscription';
import { PaymentService } from '@services/payments/payments.service';
import { PaymentCronService } from '@services/payments/paymentCron.service';
import { RentPaymentService } from '@services/payments/rentPayment.service';
import { PaymentProcessor, Payment, Profile, Client, Lease, User } from '@models/index';
import {
  PaymentRecordStatus,
  PaymentRecordType,
  PaymentMethod,
} from '@interfaces/payments.interface';

import {
  createTestProperty,
  createTestProfile,
  createTestClient,
  createTestLease,
  createTestUser,
} from '../../setup/testFactories';

/**
 * Rent creation, lease activation and security-deposit flows of RentPaymentService against a
 * real database. Only the payment gateway (Stripe), queues, cache and event emitter are mocked.
 */
describe('RentPaymentService — activation, rent creation and deposits (integration)', () => {
  const ACCOUNT_ID = 'acct_rent_test';
  const RENT = 200_000;
  const SECURITY_DEPOSIT = 100_000;
  const PET_DEPOSIT = 25_000;

  let paymentDAO: PaymentDAO;
  let profileDAO: ProfileDAO;
  let leaseDAO: LeaseDAO;
  let clientDAO: ClientDAO;
  let userDAO: UserDAO;
  let paymentProcessorDAO: PaymentProcessorDAO;
  let service: RentPaymentService;
  let paymentGatewayService: Record<string, jest.Mock>;
  let emitterService: { emit: jest.Mock; on: jest.Mock; off: jest.Mock };
  let subscriptionDAO: { findFirst: jest.Mock; incrementUsageCounter: jest.Mock };
  let invoiceCounter: number;
  let addJobToQueue: jest.Mock;

  let cuid: string;
  let clientId: Types.ObjectId;
  let tenantUserId: Types.ObjectId;
  let tenantProfileId: Types.ObjectId;
  let propertyId: Types.ObjectId;

  beforeAll(() => {
    paymentDAO = new PaymentDAO({ paymentModel: Payment });
    profileDAO = new ProfileDAO({ profileModel: Profile });
    leaseDAO = new LeaseDAO({ leaseModel: Lease });
    clientDAO = new ClientDAO({ clientModel: Client, userModel: User } as any);
    userDAO = new UserDAO({ userModel: User });
    paymentProcessorDAO = new PaymentProcessorDAO({ paymentProcessorModel: PaymentProcessor });
  });

  beforeEach(async () => {
    await clearTestDatabase();
    jest.clearAllMocks();
    invoiceCounter = 0;
    addJobToQueue = jest.fn().mockResolvedValue(undefined);

    const client = await createTestClient();
    cuid = client.cuid;
    clientId = client._id as Types.ObjectId;
    const tenant = await createTestUser(cuid, { roles: ['tenant'] });
    tenantUserId = tenant._id as Types.ObjectId;
    tenantProfileId = (await createTestProfile(tenantUserId, clientId))._id as Types.ObjectId;
    // Tenant profiles carry a tenantInfo object (the factory leaves it null)
    await mongoose.connection
      .db!.collection('profiles')
      .updateOne({ _id: tenantProfileId }, { $set: { tenantInfo: {} } });
    propertyId = (await createTestProperty(cuid, clientId))._id as Types.ObjectId;

    await PaymentProcessor.create({
      cuid,
      client: clientId,
      accountId: ACCOUNT_ID,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    paymentGatewayService = {
      createCustomer: jest.fn().mockResolvedValue({ success: true, data: { customerId: 'cus_1' } }),
      createInvoice: jest.fn().mockImplementation(async () => ({
        success: true,
        data: { invoiceId: `in_test_${++invoiceCounter}` },
      })),
      finalizeInvoice: jest
        .fn()
        .mockResolvedValue({ success: true, data: { hostedInvoiceUrl: 'https://stripe/inv' } }),
      voidInvoice: jest.fn().mockResolvedValue({ success: true, data: null }),
      payInvoice: jest.fn().mockResolvedValue({ success: true, data: null }),
      retrievePaymentMethod: jest.fn().mockResolvedValue({ success: true, data: { type: 'card' } }),
      createRefund: jest.fn().mockResolvedValue({ success: true, data: { refundId: 're_1' } }),
    };
    emitterService = { emit: jest.fn(), on: jest.fn(), off: jest.fn() };
    subscriptionDAO = {
      findFirst: jest.fn().mockResolvedValue({ status: 'active', planName: 'growth' }),
      incrementUsageCounter: jest.fn().mockResolvedValue(undefined),
    };

    // Real createManualTrackingPayment, without the rest of the cron service's dependencies.
    const paymentCronService = {
      createManualTrackingPayment: (data: any) =>
        PaymentCronService.prototype.createManualTrackingPayment.call(
          { profileDAO, paymentDAO, emitterService },
          data
        ),
    };

    service = new RentPaymentService({
      subscriptionPlanConfig,
      paymentGatewayService: paymentGatewayService as any,
      paymentWebhookService: { retryPaymentWithCard: jest.fn() } as any,
      paymentProcessorDAO,
      paymentCronService: paymentCronService as any,
      emitterService: emitterService as any,
      subscriptionDAO: subscriptionDAO as any,
      queueFactory: { getQueue: jest.fn(() => ({ addJobToQueue })) } as any,
      paymentDAO,
      profileDAO,
      userCache: { invalidateUserDetail: jest.fn() } as any,
      clientDAO,
      leaseDAO,
    });
  });

  const createActiveLease = async (overrides: Record<string, unknown> = {}) => {
    const lease = await createTestLease(propertyId, tenantUserId, cuid);
    await mongoose.connection.db!.collection('leases').updateOne(
      { _id: lease._id },
      {
        $set: {
          status: 'active',
          'duration.startDate': dayjs().startOf('month').toDate(),
          'duration.endDate': dayjs().add(1, 'year').toDate(),
          'fees.rentAmount': RENT,
          'fees.securityDeposit': SECURITY_DEPOSIT,
          'fees.currency': 'CAD',
          'fees.acceptedPaymentMethod': 'auto-debit',
          'fees.lateFeeAmount': 5_000,
          'fees.lateFeeDays': 3,
          'fees.lateFeeType': 'fixed',
          'petPolicy.allowed': true,
          'petPolicy.deposit': PET_DEPOSIT,
          ...overrides,
        },
      }
    );
    return (await Lease.findById(lease._id))!;
  };

  const activate = (lease: { _id: unknown; luid: string }) =>
    service.handleLeaseActivated({
      leaseId: String(lease._id),
      luid: lease.luid,
      cuid,
      tenantId: tenantUserId.toString(),
    });

  const paymentsOf = (leaseId: unknown, paymentType: PaymentRecordType) =>
    Payment.find({ lease: leaseId as Types.ObjectId, paymentType, deletedAt: null }).lean();

  // ───────────────────────────────────────────────────────────────────────────
  // R2 / R10 / S10 — lease activation
  // ───────────────────────────────────────────────────────────────────────────

  describe('lease activation', () => {
    it('invoices the first month and the full deposit through Stripe for an auto-debit lease', async () => {
      const lease = await createActiveLease();

      await activate(lease);

      const [rent] = await paymentsOf(lease._id, PaymentRecordType.RENT);
      expect(rent.gatewayPaymentId).toMatch(/^in_test_/);
      expect(rent.status).toBe(PaymentRecordStatus.PENDING);
      expect(rent.tenant.toString()).toBe(tenantProfileId.toString());
      expect(rent.baseAmount).toBe(RENT);

      const [deposit] = await paymentsOf(lease._id, PaymentRecordType.SECURITY_DEPOSIT);
      expect(deposit.gatewayPaymentId).toMatch(/^in_test_/);
      expect(deposit.baseAmount).toBe(SECURITY_DEPOSIT + PET_DEPOSIT);
      expect(deposit.tenant.toString()).toBe(tenantProfileId.toString());
      expect(deposit.applicationFee).toBe(0);
      expect(paymentGatewayService.createInvoice).toHaveBeenCalledTimes(2);
    });

    it('does not invoice the deposit again for a renewal lease', async () => {
      const original = await createActiveLease({ status: 'expired' });
      const renewal = await createActiveLease({ previousLeaseId: original._id });

      await activate(renewal);

      expect(await paymentsOf(renewal._id, PaymentRecordType.RENT)).toHaveLength(1);
      expect(await paymentsOf(renewal._id, PaymentRecordType.SECURITY_DEPOSIT)).toHaveLength(0);
      expect(paymentGatewayService.createInvoice).toHaveBeenCalledTimes(1);
    });

    it('records payable charges without an invoice when Stripe onboarding is unfinished', async () => {
      await PaymentProcessor.updateOne({ cuid }, { $set: { chargesEnabled: false } });
      const lease = await createActiveLease();

      await activate(lease);

      const [rent] = await paymentsOf(lease._id, PaymentRecordType.RENT);
      expect(rent.gatewayPaymentId).toBeUndefined();
      expect(rent.paymentMethod).toBe(PaymentMethod.ONLINE);
      expect(rent.lineItems?.length).toBeGreaterThan(0);

      const [deposit] = await paymentsOf(lease._id, PaymentRecordType.SECURITY_DEPOSIT);
      expect(deposit.baseAmount).toBe(SECURITY_DEPOSIT + PET_DEPOSIT);
      expect(deposit.tenant.toString()).toBe(tenantProfileId.toString());
      expect(paymentGatewayService.createInvoice).not.toHaveBeenCalled();
    });

    it('pro-rates the first month of a cash lease that starts mid-month', async () => {
      const startDate = dayjs().startOf('month').add(14, 'day').toDate();
      const lease = await createActiveLease({
        'duration.startDate': startDate,
        'fees.acceptedPaymentMethod': 'cash',
      });

      await activate(lease);

      const [rent] = await paymentsOf(lease._id, PaymentRecordType.RENT);
      expect(rent.paymentMethod).toBe(PaymentMethod.CASH);
      expect(rent.baseAmount).toBe(proRateAmount(RENT, startDate).amount);
      expect(rent.baseAmount).toBeLessThan(RENT);
      expect(rent.lineItems?.[0].description).toMatch(/Pro-rated Rent/);
      expect(await paymentsOf(lease._id, PaymentRecordType.SECURITY_DEPOSIT)).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // createRentPayment — R3 / R4 / R8 / M4 / L4
  // ───────────────────────────────────────────────────────────────────────────

  describe('createRentPayment', () => {
    const lastMonth = () => dayjs().subtract(1, 'month').startOf('month');

    const createRent = (lease: { luid: string }, overrides: Record<string, unknown> = {}) =>
      service.createRentPayment(
        cuid,
        {
          paymentType: PaymentRecordType.RENT,
          leaseId: lease.luid,
          tenantId: tenantUserId.toString(),
          dueDate: lastMonth().toDate(),
          period: { month: lastMonth().month() + 1, year: lastMonth().year() },
          ...overrides,
        } as any,
        { createStripeInvoice: true }
      );

    it('never adds a late fee to a rent invoice created after its due date', async () => {
      const lease = await createActiveLease({
        'duration.startDate': dayjs().subtract(3, 'month').startOf('month').toDate(),
      });

      const { data } = await createRent(lease);

      expect(data.baseAmount).toBe(RENT);
      expect(data.lineItems?.some((li) => /late fee/i.test(li.description))).toBe(false);
    });

    it('voids the old invoice before replacing a failed rent record for the same period', async () => {
      const lease = await createActiveLease({
        'duration.startDate': dayjs().subtract(3, 'month').startOf('month').toDate(),
      });
      const { data: first } = await createRent(lease);
      await Payment.updateOne({ _id: first._id }, { $set: { status: PaymentRecordStatus.FAILED } });

      const { data: replacement } = await createRent(lease);

      expect(paymentGatewayService.voidInvoice).toHaveBeenCalledWith(
        expect.anything(),
        first.gatewayPaymentId
      );
      expect((await Payment.findById(first._id).lean())?.deletedAt).toBeTruthy();
      expect(replacement.gatewayPaymentId).not.toBe(first.gatewayPaymentId);
    });

    it('splits an ACSS payment over the limit and charges each split a fee on its own amount', async () => {
      const limit = envVariables.STRIPE.ACSS_PER_TXN_LIMIT;
      const petFee = 20_000;
      const lease = await createActiveLease({
        'duration.startDate': dayjs().subtract(3, 'month').startOf('month').toDate(),
        'fees.rentAmount': limit - 10_000,
        'petPolicy.monthlyFee': petFee,
      });

      const { data } = await createRent(lease);

      const feesInvoiceCall = paymentGatewayService.createInvoice.mock.calls.find(([, input]) =>
        input.description.startsWith('Fees for')
      );
      const expectedFeesSplitFee = subscriptionPlanConfig.calculateAchApplicationFee(petFee);
      expect(feesInvoiceCall?.[1].applicationFeeAmountInCents).toBe(expectedFeesSplitFee);
      expect(feesInvoiceCall?.[1].applicationFeeAmountInCents).toBeLessThanOrEqual(petFee);

      const fees = data.splitInvoices?.find((s) => s.category === 'fees');
      const rent = data.splitInvoices?.find((s) => s.category === 'rent');
      expect(fees?.applicationFee).toBe(expectedFeesSplitFee);
      expect(rent?.applicationFee).toBe(
        subscriptionPlanConfig.calculateAchApplicationFee(limit - 10_000)
      );
      expect(data.applicationFee).toBe((fees?.applicationFee ?? 0) + (rent?.applicationFee ?? 0));
    });

    it('does not split when the rent alone exceeds the ACSS limit (card fallback handles it)', async () => {
      const limit = envVariables.STRIPE.ACSS_PER_TXN_LIMIT;
      const lease = await createActiveLease({
        'duration.startDate': dayjs().subtract(3, 'month').startOf('month').toDate(),
        'fees.rentAmount': limit + 50_000,
        'petPolicy.monthlyFee': 20_000,
      });

      const { data } = await createRent(lease);

      expect(paymentGatewayService.createInvoice).toHaveBeenCalledTimes(1);
      expect(data.splitInvoices ?? []).toHaveLength(0);
    });

    it('emails an auto-debit payment request linking to the tenant portal by uid', async () => {
      const lease = await createActiveLease({
        'duration.startDate': dayjs().subtract(3, 'month').startOf('month').toDate(),
      });
      const tenant = await User.findById(tenantUserId).lean();

      const { data } = await createRent(lease, { notifyByEmail: true });

      expect(addJobToQueue).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          to: tenant!.email,
          data: expect.objectContaining({
            isAutoDebit: true,
            paymentUrl: expect.stringContaining(`/tenants/${cuid}/${tenant!.uid}/payments`),
          }),
        })
      );
      expect(emitterService.emit).toHaveBeenCalledWith(
        EventTypes.PAYMENT_REQUEST_CREATED,
        expect.objectContaining({
          pytuid: data.pytuid,
          currency: 'CAD',
          paymentType: PaymentRecordType.RENT,
          acceptedPaymentMethod: 'auto-debit',
        })
      );
    });

    it('rejects a tenant that is not the lease tenant', async () => {
      const lease = await createActiveLease();
      const otherTenant = await createTestUser(cuid, { roles: ['tenant'] });

      await expect(createRent(lease, { tenantId: otherTenant._id.toString() })).rejects.toThrow(
        'Tenant does not match the lease tenant'
      );
    });

    it('rejects deposit refunds and deposits as payment requests', async () => {
      const lease = await createActiveLease();

      await expect(
        createRent(lease, { paymentType: PaymentRecordType.DEPOSIT_REFUND })
      ).rejects.toThrow(/Deposits are invoiced when the lease is activated/);
      await expect(
        createRent(lease, { paymentType: PaymentRecordType.SECURITY_DEPOSIT })
      ).rejects.toThrow(/Deposits are invoiced when the lease is activated/);
      expect(await Payment.countDocuments({ lease: lease._id })).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // payPendingCharge — R11 / S10
  // ───────────────────────────────────────────────────────────────────────────

  describe('payPendingCharge', () => {
    beforeEach(async () => {
      await Profile.updateOne(
        { _id: tenantProfileId },
        {
          $set: {
            'tenantInfo.paymentGatewayCustomers.platform': 'cus_1',
            [`tenantInfo.paymentMethods.${ACCOUNT_ID}`]: 'pm_card_1',
          },
        }
      );
    });

    it('lets the tenant pay an overdue rent charge', async () => {
      const lease = await createActiveLease();
      await activate(lease);
      const [rent] = await paymentsOf(lease._id, PaymentRecordType.RENT);
      await Payment.updateOne({ _id: rent._id }, { $set: { status: PaymentRecordStatus.OVERDUE } });

      const result = await service.payPendingCharge(cuid, rent.pytuid, tenantUserId.toString());

      expect(result.success).toBe(true);
      expect(paymentGatewayService.payInvoice).toHaveBeenCalledWith(
        expect.anything(),
        rent.gatewayPaymentId,
        expect.objectContaining({ paymentMethod: 'pm_card_1' })
      );
    });

    it('lets the tenant pay the deposit recorded at activation (stored against their profile)', async () => {
      await PaymentProcessor.updateOne({ cuid }, { $set: { chargesEnabled: false } });
      const lease = await createActiveLease();
      await activate(lease);
      await PaymentProcessor.updateOne({ cuid }, { $set: { chargesEnabled: true } });
      const [deposit] = await paymentsOf(lease._id, PaymentRecordType.SECURITY_DEPOSIT);

      const result = await service.payPendingCharge(cuid, deposit.pytuid, tenantUserId.toString());

      expect(result.success).toBe(true);
      expect(paymentGatewayService.createInvoice).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ applicationFeeAmountInCents: 0 })
      );
      expect(paymentGatewayService.payInvoice).toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Move-out deposit refund — S6 / S7 / S8 / S9
  // ───────────────────────────────────────────────────────────────────────────

  describe('move-out deposit refund', () => {
    const refund = (leaseId: unknown, refundAmount: number) =>
      (service as any).handleDepositRefund({ leaseId: String(leaseId), cuid, refundAmount });

    const createPaidDeposit = (leaseId: unknown, overrides: Record<string, unknown> = {}) =>
      paymentDAO.insert({
        cuid,
        paymentType: PaymentRecordType.SECURITY_DEPOSIT,
        paymentMethod: PaymentMethod.ONLINE,
        lease: leaseId as Types.ObjectId,
        tenant: tenantProfileId,
        baseAmount: SECURITY_DEPOSIT + PET_DEPOSIT,
        currency: 'CAD',
        status: PaymentRecordStatus.PAID,
        dueDate: new Date(),
        gatewayChargeId: 'ch_deposit',
        isManualEntry: false,
        ...overrides,
      } as any);

    it('refunds the deposit collected on the original lease when moving out of a renewal', async () => {
      const original = await createActiveLease({ status: 'expired' });
      const renewal = await createActiveLease({ previousLeaseId: original._id });
      const deposit = await createPaidDeposit(original._id);

      await refund(renewal._id, SECURITY_DEPOSIT + PET_DEPOSIT);

      expect(paymentGatewayService.createRefund).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ chargeId: 'ch_deposit', amountInCents: 125_000 })
      );
      const updated = await Payment.findById(deposit._id).lean();
      expect(updated?.status).toBe(PaymentRecordStatus.REFUNDED);
      expect(updated?.refund?.amount).toBe(125_000);
      expect(emitterService.emit).toHaveBeenCalledWith(
        EventTypes.PAYMENT_REFUNDED,
        expect.objectContaining({
          pytuid: deposit.pytuid,
          tenantId: tenantProfileId.toString(),
          amount: 125_000,
          totalRefunded: 125_000,
          currency: 'CAD',
          isPartial: false,
        })
      );
    });

    it('stages a failed Stripe refund as PENDING_REFUND and alerts managers', async () => {
      const lease = await createActiveLease();
      const deposit = await createPaidDeposit(lease._id);
      paymentGatewayService.createRefund.mockResolvedValueOnce({
        success: false,
        message: 'insufficient balance',
      });

      await refund(lease._id, 90_000);

      const updated = await Payment.findById(deposit._id).lean();
      expect(updated?.status).toBe(PaymentRecordStatus.PENDING_REFUND);
      expect(updated?.refund?.failureReason).toBe('insufficient balance');
      expect(updated?.refund?.amount).toBe(90_000);
      expect(emitterService.emit).toHaveBeenCalledWith(
        EventTypes.DEPOSIT_REFUND_FAILED,
        expect.objectContaining({ pytuid: deposit.pytuid, amount: 90_000, currency: 'CAD' })
      );
      expect(emitterService.emit).not.toHaveBeenCalledWith(
        EventTypes.PAYMENT_REFUNDED,
        expect.anything()
      );
    });

    it('stages an offline deposit refund for manager release instead of marking it refunded', async () => {
      const lease = await createActiveLease();
      const deposit = await createPaidDeposit(lease._id, {
        gatewayChargeId: undefined,
        paymentMethod: PaymentMethod.CASH,
      });

      await refund(lease._id, 50_000);

      const updated = await Payment.findById(deposit._id).lean();
      expect(updated?.status).toBe(PaymentRecordStatus.PENDING_REFUND);
      expect(updated?.refund?.refundedAt).toBeUndefined();
      expect(paymentGatewayService.createRefund).not.toHaveBeenCalled();
    });

    it('exposes the full refundable deposit (security + pet) for the lease chain', async () => {
      const original = await createActiveLease({ status: 'expired' });
      const renewal = await createActiveLease({ previousLeaseId: original._id });
      await createPaidDeposit(original._id);

      const refundable = await service.getRefundableDeposit(cuid, String(renewal._id));

      expect(refundable).toEqual(
        expect.objectContaining({ amount: SECURITY_DEPOSIT + PET_DEPOSIT, currency: 'CAD' })
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Compatibility with the manual settle flow in PaymentService
  // ───────────────────────────────────────────────────────────────────────────

  describe('manual settlement of the activation deposit', () => {
    it('settles the deposit charge with a cash payment, and its refund is staged for release', async () => {
      await PaymentProcessor.updateOne({ cuid }, { $set: { chargesEnabled: false } });
      const lease = await createActiveLease();
      await activate(lease);
      const [deposit] = await paymentsOf(lease._id, PaymentRecordType.SECURITY_DEPOSIT);

      const paymentService = new PaymentService({
        rentPaymentService: service,
        paymentGatewayService: paymentGatewayService as any,
        subscriptionDAO: subscriptionDAO as any,
        emitterService: emitterService as any,
        subscriptionPlanConfig,
        paymentDAO,
        profileDAO,
        leaseDAO,
        clientDAO,
        userDAO,
        paymentProcessorDAO,
        maintenancePaymentService: {} as any,
        paymentWebhookService: {} as any,
        payoutAccountService: {} as any,
        paymentCronService: {} as any,
        invoiceTemplateRenderer: {} as any,
        pdfGeneratorService: {} as any,
        stripeService: {} as any,
        invoiceDAO: {} as any,
        propertyDAO: {} as any,
        propertyUnitDAO: {} as any,
        maintenanceRequestDAO: {} as any,
        vendorDAO: {} as any,
      });

      const result = await paymentService.recordManualPayment(
        cuid,
        new Types.ObjectId().toString(),
        new Types.ObjectId().toString(),
        {
          paymentType: PaymentRecordType.SECURITY_DEPOSIT,
          paymentMethod: PaymentMethod.CASH,
          baseAmount: SECURITY_DEPOSIT + PET_DEPOSIT,
          tenantId: tenantUserId.toString(),
          leaseId: lease.luid,
          paidAt: new Date(),
        }
      );

      expect(result.data.manualEntryOutcome).toBe('settled');
      expect(result.data.pytuid).toBe(deposit.pytuid);

      await (service as any).handleDepositRefund({
        leaseId: String(lease._id),
        cuid,
        refundAmount: SECURITY_DEPOSIT,
      });

      const updated = await Payment.findById(deposit._id).lean();
      expect(updated?.status).toBe(PaymentRecordStatus.PENDING_REFUND);
      expect(updated?.refund?.amount).toBe(SECURITY_DEPOSIT);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // S10 — schema sync relinks old deposits stored against the User id
  // ───────────────────────────────────────────────────────────────────────────

  describe('schema sync — deposit tenant relink', () => {
    it('rewrites a deposit stored with a User id to the tenant profile id, idempotently', async () => {
      const lease = await createActiveLease();
      const { insertedId } = await mongoose.connection.db!.collection('payments').insertOne({
        cuid,
        pytuid: 'PYT-LEGACY-DEP',
        invoiceNumber: 'INV-LEGACY',
        paymentType: PaymentRecordType.SECURITY_DEPOSIT,
        paymentMethod: PaymentMethod.ONLINE,
        lease: lease._id,
        tenant: tenantUserId,
        baseAmount: SECURITY_DEPOSIT,
        currency: 'CAD',
        status: PaymentRecordStatus.PENDING,
        dueDate: new Date(),
        isManualEntry: false,
        deletedAt: null,
      });

      await runSchemaSync();
      await runSchemaSync();

      const relinked = await Payment.findById(insertedId).lean();
      expect(relinked?.tenant.toString()).toBe(tenantProfileId.toString());
    });
  });
});
