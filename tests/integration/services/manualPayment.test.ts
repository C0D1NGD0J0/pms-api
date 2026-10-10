import { UserDAO } from '@dao/userDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import mongoose, { Types } from 'mongoose';
import { ClientDAO } from '@dao/clientDAO';
import { PaymentDAO } from '@dao/paymentDAO';
import { ProfileDAO } from '@dao/profileDAO';
import { InvoiceDAO } from '@dao/invoiceDAO';
import { clearTestDatabase } from '@tests/helpers';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { EventTypes } from '@interfaces/events.interface';
import { MaintenanceRequestDAO } from '@dao/maintenanceRequestDAO';
import { PaymentService } from '@services/payments/payments.service';
import {
  PaymentRecordStatus,
  PaymentRecordType,
  PaymentErrorCode,
  PaymentMethod,
} from '@interfaces/payments.interface';
import {
  MaintenanceRequest,
  Subscription,
  Payment,
  Profile,
  Invoice,
  Client,
  Lease,
  User,
} from '@models/index';

/**
 * Manual payments against real collections: settling an existing open charge instead of
 * inserting a duplicate, tenant/lease scoping, maintenance completion, the overage counter,
 * and the rent-period unique index. Only the payment gateway and event emitter are mocked.
 */
describe('PaymentService.recordManualPayment — settling open charges (integration)', () => {
  const CUID = 'MANUAL_PAY_CUID';
  const OTHER_CUID = 'MANUAL_OTHER_CUID';
  const PM_USER_ID = new Types.ObjectId().toString();

  let tenantUserId: Types.ObjectId;
  let tenantProfileId: Types.ObjectId;
  let leaseId: Types.ObjectId;
  const LUID = 'LEASE-MANUAL-1';

  const mockGateway = {
    voidInvoice: jest.fn(),
  };
  const mockEmitter = { emit: jest.fn(), on: jest.fn(), off: jest.fn() };

  let paymentService: PaymentService;

  const insertUser = async (cuid: string) => {
    const { insertedId } = await User.collection.insertOne({
      email: `tenant-${new Types.ObjectId().toString()}@example.com`,
      uid: `uid-${new Types.ObjectId().toString()}`,
      activecuid: cuid,
      isActive: true,
      deletedAt: null,
      cuids: [{ cuid, roles: ['tenant'], clientDisplayName: 'Test', isConnected: true }],
    });
    return insertedId;
  };

  const insertProfile = async (userId: Types.ObjectId) => {
    const profile = await Profile.create({
      puid: `puid-${new Types.ObjectId().toString()}`,
      user: userId,
      personalInfo: {
        firstName: 'Test',
        lastName: 'Tenant',
        displayName: 'Test Tenant',
        location: 'Toronto',
      },
      settings: { lang: 'en' },
    });
    return profile._id as Types.ObjectId;
  };

  const createCharge = async (overrides: Record<string, any> = {}) =>
    Payment.create({
      cuid: CUID,
      paymentType: PaymentRecordType.RENT,
      paymentMethod: PaymentMethod.ONLINE,
      status: PaymentRecordStatus.PENDING,
      baseAmount: 150000,
      applicationFee: 2625,
      currency: 'CAD',
      lease: leaseId,
      tenant: tenantProfileId,
      dueDate: new Date('2026-09-01'),
      period: { month: 9, year: 2026 },
      isManualEntry: false,
      paymentSource: 'cron',
      ...overrides,
    });

  const manualEntry = (overrides: Record<string, any> = {}) => ({
    paymentType: PaymentRecordType.RENT,
    paymentMethod: PaymentMethod.CASH,
    baseAmount: 150000,
    paidAt: new Date('2026-09-02'),
    tenantId: tenantUserId.toString(),
    leaseId: LUID,
    period: { month: 9, year: 2026 },
    ...overrides,
  });

  const record = (
    data: Record<string, any>,
    source: 'pm_initiated' | 'staff_initiated' = 'pm_initiated'
  ) => paymentService.recordManualPayment(CUID, PM_USER_ID, PM_USER_ID, data as any, source);

  // The usage counter is incremented fire-and-forget
  const flushBackgroundWork = () => new Promise((resolve) => setTimeout(resolve, 100));

  beforeEach(async () => {
    await clearTestDatabase();
    jest.clearAllMocks();
    mockGateway.voidInvoice.mockResolvedValue({ success: true, data: null });

    await Client.create({
      cuid: CUID,
      displayName: 'Manual Pay Client',
      accountAdmin: new Types.ObjectId(),
      accountType: { category: 'individual' },
      settings: { defaultCurrency: 'CAD' },
    });

    tenantUserId = await insertUser(CUID);
    tenantProfileId = await insertProfile(tenantUserId);

    const { insertedId } = await Lease.collection.insertOne({
      luid: LUID,
      cuid: CUID,
      tenantId: tenantUserId,
      useInvitationIdAsTenantId: false,
      fees: { currency: 'CAD', monthlyRent: 150000 },
      deletedAt: null,
    });
    leaseId = insertedId;

    await Subscription.collection.insertOne({
      cuid: CUID,
      planName: 'starter',
      manualRecords: { countThisPeriod: 0, periodStart: new Date('2026-09-01') },
    });

    const paymentDAO = new PaymentDAO({ paymentModel: Payment });
    paymentService = new PaymentService({
      paymentDAO,
      clientDAO: new ClientDAO({ clientModel: Client, userModel: User }),
      profileDAO: new ProfileDAO({ profileModel: Profile }),
      leaseDAO: new LeaseDAO({ leaseModel: Lease }),
      userDAO: new UserDAO({ userModel: User }),
      subscriptionDAO: new SubscriptionDAO(),
      invoiceDAO: new InvoiceDAO({ invoiceModel: Invoice }),
      maintenanceRequestDAO: new MaintenanceRequestDAO({
        maintenanceRequestModel: MaintenanceRequest,
      }),
      paymentGatewayService: mockGateway,
      emitterService: mockEmitter,
      propertyDAO: {},
      propertyUnitDAO: {},
      vendorDAO: {},
      paymentProcessorDAO: {},
      stripeService: {},
      pdfGeneratorService: {},
      invoiceTemplateRenderer: {},
      subscriptionPlanConfig: {},
      payoutAccountService: {},
      paymentWebhookService: {},
      paymentCronService: {},
      maintenancePaymentService: {},
      rentPaymentService: {},
    } as any);
  });

  const manualRecordCount = async () =>
    ((await Subscription.collection.findOne({ cuid: CUID })) as any).manualRecords.countThisPeriod;

  describe('rent', () => {
    it('settles the open rent charge for the period instead of inserting a duplicate', async () => {
      const charge = await createCharge({ gatewayPaymentId: 'in_open_rent' });

      const result = await record(manualEntry());
      await flushBackgroundWork();

      expect(result.data.manualEntryOutcome).toBe('settled');
      expect(result.data.pytuid).toBe(charge.pytuid);
      expect(await Payment.countDocuments({ cuid: CUID })).toBe(1);

      const settled = await Payment.findById(charge._id).lean();
      expect(settled).toMatchObject({
        status: PaymentRecordStatus.PAID,
        isManualEntry: true,
        paymentMethod: PaymentMethod.CASH,
        applicationFee: 0,
      });
      expect(settled!.paidAt).toEqual(new Date('2026-09-02'));
      expect(settled!.recordedBy!.toString()).toBe(PM_USER_ID);
      expect(settled!.gatewayPaymentId).toBeUndefined();
      expect(settled!.notes?.[0]?.note).toContain('Settled by a manual cash payment');
      expect(mockGateway.voidInvoice).toHaveBeenCalledWith('stripe', 'in_open_rent');
      expect(await manualRecordCount()).toBe(1);
    });

    it('settles a charge named by pytuid', async () => {
      const charge = await createCharge({ status: PaymentRecordStatus.OVERDUE });

      const result = await record(manualEntry({ pytuid: charge.pytuid, period: undefined }));

      expect(result.data.manualEntryOutcome).toBe('settled');
      expect((await Payment.findById(charge._id).lean())!.status).toBe(PaymentRecordStatus.PAID);
    });

    it('creates a new record when nothing is owed for the period', async () => {
      const result = await record(manualEntry());
      await flushBackgroundWork();

      expect(result.data.manualEntryOutcome).toBe('created');
      const created = await Payment.findOne({ pytuid: result.data.pytuid }).lean();
      expect(created).toMatchObject({
        status: PaymentRecordStatus.PAID,
        isManualEntry: true,
        currency: 'CAD',
      });
      expect(await manualRecordCount()).toBe(1);
    });

    it('rejects a second manual payment for a period that is already paid (no duplicate-key error)', async () => {
      await record(manualEntry());

      await expect(record(manualEntry())).rejects.toThrow('already paid');
      expect(await Payment.countDocuments({ cuid: CUID })).toBe(1);
    });

    it('refuses to settle a charge whose bank debit is in flight', async () => {
      await createCharge({ status: PaymentRecordStatus.PROCESSING });

      await expect(record(manualEntry())).rejects.toThrow('bank debit');
    });

    it('refuses to settle when the Stripe invoice cannot be voided (already being paid online)', async () => {
      const charge = await createCharge({ gatewayPaymentId: 'in_paid_meanwhile' });
      mockGateway.voidInvoice.mockResolvedValue({ success: false, data: null, message: 'paid' });

      await expect(record(manualEntry())).rejects.toThrow('already being paid online');
      expect((await Payment.findById(charge._id).lean())!.status).toBe(PaymentRecordStatus.PENDING);
    });

    it('rejects an amount that differs from the open charge', async () => {
      await createCharge();

      await expect(record(manualEntry({ baseAmount: 100000 }))).rejects.toMatchObject({
        message: expect.stringContaining('must match the charge'),
        code: PaymentErrorCode.AMOUNT_MISMATCH,
      });
    });

    it('asks the PM to choose when open rent charges exist but no period is given', async () => {
      await createCharge();

      await expect(record(manualEntry({ period: undefined }))).rejects.toMatchObject({
        message: expect.stringContaining('Choose the charge being paid'),
        code: PaymentErrorCode.CHARGE_SELECTION_REQUIRED,
      });
    });

    it('does not count a staff entry as reviewed', async () => {
      await createCharge();

      const result = await record(manualEntry(), 'staff_initiated');

      expect(result.data.managerReviewRequired).toBe(true);
    });
  });

  describe('late fees', () => {
    it('settles the single open late fee for the lease + period', async () => {
      const lateFee = await createCharge({
        paymentType: PaymentRecordType.LATE_FEE,
        baseAmount: 5000,
        status: PaymentRecordStatus.OVERDUE,
      });

      const result = await record(
        manualEntry({ paymentType: PaymentRecordType.LATE_FEE, baseAmount: 5000 })
      );

      expect(result.data.manualEntryOutcome).toBe('settled');
      expect(result.data.pytuid).toBe(lateFee.pytuid);
    });

    it('rejects when several open late fees match', async () => {
      await createCharge({ paymentType: PaymentRecordType.LATE_FEE, baseAmount: 5000 });
      await createCharge({ paymentType: PaymentRecordType.LATE_FEE, baseAmount: 5000 });

      await expect(
        record(manualEntry({ paymentType: PaymentRecordType.LATE_FEE, baseAmount: 5000 }))
      ).rejects.toThrow('2 open late fee charge(s)');
    });
  });

  describe('maintenance', () => {
    const MRUID = 'MR-MANUAL-1';

    beforeEach(async () => {
      await MaintenanceRequest.collection.insertOne({
        mruid: MRUID,
        cuid: CUID,
        tenantId: tenantUserId,
        propertyId: new Types.ObjectId(),
        deletedAt: null,
      });
      await Invoice.collection.insertOne({
        mruid: MRUID,
        cuid: CUID,
        isDeleted: false,
        tenantPaymentStatus: 'unpaid',
        amountInCents: 30000,
      });
    });

    it('settles the open maintenance charge and completes the maintenance flow', async () => {
      const charge = await createCharge({
        paymentType: PaymentRecordType.MAINTENANCE,
        baseAmount: 30000,
        lease: undefined,
        period: undefined,
        maintenanceRequestUid: MRUID,
      });

      const result = await record(
        manualEntry({
          paymentType: PaymentRecordType.MAINTENANCE,
          baseAmount: 30000,
          leaseId: undefined,
          period: undefined,
          mruid: MRUID,
        })
      );

      expect(result.data.manualEntryOutcome).toBe('settled');
      expect(result.data.pytuid).toBe(charge.pytuid);
      const invoice = await Invoice.collection.findOne({ mruid: MRUID });
      expect(invoice!.tenantPaymentStatus).toBe('paid');
      expect(mockEmitter.emit).toHaveBeenCalledWith(
        EventTypes.MAINTENANCE_CHARGE_PAID,
        expect.objectContaining({ cuid: CUID, mruid: MRUID, pytuid: charge.pytuid })
      );
    });

    it('creates a linked record when no charge exists, then refuses to record it twice', async () => {
      const entry = manualEntry({
        paymentType: PaymentRecordType.MAINTENANCE,
        baseAmount: 30000,
        leaseId: undefined,
        period: undefined,
        mruid: MRUID,
      });

      const result = await record(entry);
      expect(result.data.manualEntryOutcome).toBe('created');
      expect(result.data.maintenanceRequestUid).toBe(MRUID);
      expect(mockEmitter.emit).toHaveBeenCalledWith(
        EventTypes.MAINTENANCE_CHARGE_PAID,
        expect.objectContaining({ mruid: MRUID })
      );

      await expect(record(entry)).rejects.toThrow('already been paid');
    });
  });

  describe('client and lease scoping', () => {
    it('rejects a tenant from another client', async () => {
      const outsiderId = await insertUser(OTHER_CUID);
      await insertProfile(outsiderId);

      await expect(
        record(
          manualEntry({
            tenantId: outsiderId.toString(),
            leaseId: undefined,
            propertyId: undefined,
          })
        )
      ).rejects.toThrow('Tenant not found for this account');
    });

    it('rejects a tenant who is not on the lease', async () => {
      const otherTenantId = await insertUser(CUID);
      await insertProfile(otherTenantId);

      await expect(record(manualEntry({ tenantId: otherTenantId.toString() }))).rejects.toThrow(
        'not the tenant on this lease'
      );
    });

    it('ignores a soft-deleted lease', async () => {
      await Lease.collection.updateOne({ _id: leaseId }, { $set: { deletedAt: new Date() } });

      await expect(record(manualEntry())).rejects.toThrow('Lease not found');
    });

    it('rejects a charge that belongs to another tenant', async () => {
      const otherTenantId = await insertUser(CUID);
      const otherProfileId = await insertProfile(otherTenantId);
      const charge = await createCharge({ tenant: otherProfileId });

      await expect(record(manualEntry({ pytuid: charge.pytuid }))).rejects.toThrow(
        'different tenant'
      );
    });
  });

  it('does not count a settled charge twice when it was already a manual entry', async () => {
    const charge = await createCharge({
      status: PaymentRecordStatus.CANCELLED,
      isManualEntry: true,
    });

    const result = await record(manualEntry({ pytuid: charge.pytuid }));
    await flushBackgroundWork();

    expect(result.data.manualEntryOutcome).toBe('settled');
    expect(await manualRecordCount()).toBe(0);
  });
});

describe('Payment rent-period unique index (integration)', () => {
  const tenant = new Types.ObjectId();

  const rent = (overrides: Record<string, any>) => ({
    paymentType: PaymentRecordType.RENT,
    paymentMethod: PaymentMethod.CASH,
    status: PaymentRecordStatus.PAID,
    baseAmount: 100000,
    tenant,
    dueDate: new Date('2026-09-01'),
    period: { month: 9, year: 2026 },
    isManualEntry: true,
    ...overrides,
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  it('allows property-mode rent (no lease) for the same period in different clients', async () => {
    await Payment.create(rent({ cuid: 'CLIENT_A' }));
    await Payment.create(rent({ cuid: 'CLIENT_B' }));
    await Payment.create(rent({ cuid: 'CLIENT_A' }));

    expect(await Payment.countDocuments({ lease: { $exists: false } })).toBe(3);
  });

  it('still allows only one rent record per lease and period', async () => {
    const lease = new Types.ObjectId();
    await Payment.create(rent({ cuid: 'CLIENT_A', lease }));

    await expect(Payment.create(rent({ cuid: 'CLIENT_A', lease }))).rejects.toThrow(
      /duplicate key/
    );
  });

  it('syncIndexes replaces the old cross-client index on an existing database', async () => {
    const collection = mongoose.connection.db!.collection('payments');
    const indexName = 'lease_1_paymentType_1_period.month_1_period.year_1';

    // Simulate a database created before the fix
    await collection.dropIndex(indexName);
    await collection.createIndex(
      { lease: 1, paymentType: 1, 'period.month': 1, 'period.year': 1 },
      {
        name: indexName,
        unique: true,
        partialFilterExpression: { paymentType: 'rent', deletedAt: null },
      }
    );

    await Payment.syncIndexes();

    const index = (await collection.indexes()).find((i) => i.name === indexName);
    expect(index?.partialFilterExpression).toEqual({
      paymentType: 'rent',
      deletedAt: null,
      lease: { $type: 'objectId' },
    });
  });
});
