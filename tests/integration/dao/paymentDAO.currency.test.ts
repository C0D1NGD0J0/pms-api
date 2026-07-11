import { Types } from 'mongoose';
import { PaymentDAO } from '@dao/paymentDAO';
import { Payment, Client } from '@models/index';
import { clearTestDatabase } from '@tests/helpers';
import { PaymentRecordStatus, PaymentRecordType, PaymentMethod } from '@interfaces/payments.interface';

describe('PaymentDAO — currency-aware getPaymentStats', () => {
  let paymentDAO: PaymentDAO;
  const testCuid = 'PAY_CURRENCY_TEST';

  beforeAll(async () => {
    paymentDAO = new PaymentDAO({ paymentModel: Payment });
  });

  beforeEach(async () => {
    await clearTestDatabase();

    await Client.create({
      _id: new Types.ObjectId(),
      cuid: testCuid,
      displayName: 'Currency Test Client',
      accountAdmin: new Types.ObjectId(),
      accountType: { category: 'individual' },
    });
  });

  const makePayment = (currency: string, baseAmount: number, status: PaymentRecordStatus, paidAt?: Date) => ({
    cuid: testCuid,
    currency,
    baseAmount,
    status,
    pytuid: `PY-${Math.random().toString(36).slice(2)}`,
    invoiceNumber: `INV-${Math.random().toString(36).slice(2)}`,
    paymentType: PaymentRecordType.RENT,
    paymentMethod: PaymentMethod.ONLINE,
    isManualEntry: false,
    // Unique lease per payment to avoid compound unique index conflict
    lease: new Types.ObjectId(),
    tenant: new Types.ObjectId(),
    dueDate: new Date(),
    processingFee: 0,
    applicationFee: 0,
    ...(paidAt ? { paidAt } : {}),
  });

  it('returns separate byCurrency entries for USD and NGN payments', async () => {
    await Payment.insertMany([
      makePayment('USD', 150000, PaymentRecordStatus.PAID, new Date()),
      makePayment('USD', 50000, PaymentRecordStatus.PAID, new Date()),
      makePayment('NGN', 8000000, PaymentRecordStatus.PAID, new Date()),
    ]);

    const stats = await paymentDAO.getPaymentStats(testCuid);

    expect(stats.byCurrency).toHaveLength(2);

    const usd = stats.byCurrency.find((r) => r.currency === 'USD');
    const ngn = stats.byCurrency.find((r) => r.currency === 'NGN');

    expect(usd).toBeDefined();
    expect(usd!.totalRevenue).toBe(200000);
    expect(usd!.monthRevenue).toBe(200000); // both paid this month

    expect(ngn).toBeDefined();
    expect(ngn!.totalRevenue).toBe(8000000);
  });

  it('returns separate byCurrency entries for pending amounts', async () => {
    await Payment.insertMany([
      makePayment('USD', 100000, PaymentRecordStatus.PENDING),
      makePayment('GBP', 75000, PaymentRecordStatus.PENDING),
    ]);

    const stats = await paymentDAO.getPaymentStats(testCuid);

    expect(stats.byCurrency).toHaveLength(2);

    const usd = stats.byCurrency.find((r) => r.currency === 'USD');
    const gbp = stats.byCurrency.find((r) => r.currency === 'GBP');

    expect(usd!.pendingAmount).toBe(100000);
    expect(gbp!.pendingAmount).toBe(75000);
  });

  it('returns empty byCurrency array when no payments exist', async () => {
    const stats = await paymentDAO.getPaymentStats(testCuid);
    expect(stats.byCurrency).toEqual([]);
    expect(stats.overdueCount).toBe(0);
    expect(stats.totalCount).toBe(0);
  });

  it('stores and retrieves chargedAt field', async () => {
    const chargedDate = new Date('2025-06-15T10:00:00Z');
    const paymentData = makePayment('USD', 100000, PaymentRecordStatus.PAID, new Date());
    const created = await Payment.create({ ...paymentData, chargedAt: chargedDate });

    const found = await Payment.findById(created._id).lean();
    expect(found).toBeDefined();
    expect(found!.chargedAt).toEqual(chargedDate);
  });

  it('stores and retrieves stripePaymentMethodType field', async () => {
    const paymentData = makePayment('USD', 50000, PaymentRecordStatus.PAID, new Date());
    const created = await Payment.create({
      ...paymentData,
      stripePaymentMethodType: 'acss_debit',
    });

    const found = await Payment.findById(created._id).lean();
    expect(found).toBeDefined();
    expect(found!.stripePaymentMethodType).toBe('acss_debit');
  });

  it('chargedAt defaults to undefined when not provided', async () => {
    const paymentData = makePayment('USD', 75000, PaymentRecordStatus.PENDING);
    const created = await Payment.create(paymentData);

    const found = await Payment.findById(created._id).lean();
    expect(found!.chargedAt).toBeUndefined();
  });

  it('stripePaymentMethodType defaults to undefined when not provided', async () => {
    const paymentData = makePayment('CAD', 60000, PaymentRecordStatus.PENDING);
    const created = await Payment.create(paymentData);

    const found = await Payment.findById(created._id).lean();
    expect(found!.stripePaymentMethodType).toBeUndefined();
  });

  it('does not mix currencies into a single revenue total', async () => {
    // 100 USD + 100 NGN = should NOT appear as 200 in any single entry
    await Payment.insertMany([
      makePayment('USD', 100, PaymentRecordStatus.PAID, new Date()),
      makePayment('NGN', 100, PaymentRecordStatus.PAID, new Date()),
    ]);

    const stats = await paymentDAO.getPaymentStats(testCuid);
    const totals = stats.byCurrency.map((r) => r.totalRevenue);

    // Both entries should be 100, never 200
    expect(totals).not.toContain(200);
    expect(totals.every((t) => t === 100)).toBe(true);
  });
});
