import { Types } from 'mongoose';
import { Payment } from '@models/index';
import { PaymentDAO } from '@dao/paymentDAO';
import { clearTestDatabase } from '@tests/helpers';
import {
  PaymentRecordStatus,
  PaymentRecordType,
  PaymentMethod,
} from '@interfaces/payments.interface';

describe('PaymentDAO — findOverduePayments', () => {
  let paymentDAO: PaymentDAO;
  const testCuid = 'PAY_OVERDUE_TEST';

  beforeAll(async () => {
    paymentDAO = new PaymentDAO({ paymentModel: Payment });
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  const makePayment = (pytuid: string, overrides: Record<string, any> = {}) => ({
    cuid: testCuid,
    pytuid,
    invoiceNumber: `INV-${pytuid}`,
    currency: 'CAD',
    baseAmount: 150000,
    status: PaymentRecordStatus.PENDING,
    paymentType: PaymentRecordType.RENT,
    paymentMethod: PaymentMethod.CASH,
    isManualEntry: false,
    // Unique lease per payment to avoid the period unique index
    lease: new Types.ObjectId(),
    tenant: new Types.ObjectId(),
    processingFee: 0,
    applicationFee: 0,
    dueDate: new Date('2026-09-30T00:00:00Z'),
    ...overrides,
  });

  const pytuidsOf = (result: { items: { pytuid: string }[] }) =>
    result.items.map((p) => p.pytuid).sort();

  it('treats the cutoff as exclusive, so rent is not overdue on its own due date', async () => {
    await Payment.insertMany([
      makePayment('DUE-SEP30', { dueDate: new Date('2026-09-30T00:00:00Z') }),
      makePayment('DUE-OCT01', { dueDate: new Date('2026-10-01T00:00:00Z') }),
    ]);

    // Start of Oct 1 in the client's local calendar (stored convention: UTC midnight)
    const result = await paymentDAO.findOverduePayments(
      {},
      { limit: 50 },
      new Date('2026-10-01T00:00:00Z')
    );

    expect(pytuidsOf(result)).toEqual(['DUE-SEP30']);
  });

  it('defaults the cutoff to now when none is given', async () => {
    await Payment.insertMany([
      makePayment('PAST', { dueDate: new Date(Date.now() - 60 * 60 * 1000) }),
      makePayment('FUTURE', { dueDate: new Date(Date.now() + 60 * 60 * 1000) }),
    ]);

    const result = await paymentDAO.findOverduePayments({}, { limit: 50 });

    expect(pytuidsOf(result)).toEqual(['PAST']);
  });

  it('excludes payments with an active dispute (open, needs_response, under_review)', async () => {
    await Payment.insertMany([
      makePayment('NO-DISPUTE'),
      makePayment('OPEN', { dispute: { status: 'open' } }),
      makePayment('NEEDS-RESPONSE', { dispute: { status: 'needs_response' } }),
      makePayment('UNDER-REVIEW', { dispute: { status: 'under_review' } }),
      makePayment('DISPUTE-WON', { dispute: { status: 'won' } }),
    ]);

    const result = await paymentDAO.findOverduePayments(
      {},
      { limit: 50 },
      new Date('2026-10-01T00:00:00Z')
    );

    expect(pytuidsOf(result)).toEqual(['DISPUTE-WON', 'NO-DISPUTE']);
  });

  it('applies extra filters such as excluding manual entries and non-open statuses', async () => {
    await Payment.insertMany([
      makePayment('TRACKING'),
      makePayment('MANUAL', { isManualEntry: true }),
      makePayment('OVERDUE', { status: PaymentRecordStatus.OVERDUE }),
      makePayment('PAID', { status: PaymentRecordStatus.PAID, paidAt: new Date() }),
      makePayment('DELETED', { deletedAt: new Date() }),
      makePayment('OTHER-CLIENT', { cuid: 'SOMEONE_ELSE' }),
    ]);

    const result = await paymentDAO.findOverduePayments(
      { cuid: { $in: [testCuid] }, isManualEntry: { $ne: true } },
      { limit: 50 },
      new Date('2026-10-01T00:00:00Z')
    );

    expect(pytuidsOf(result)).toEqual(['OVERDUE', 'TRACKING']);
  });
});
