import { Types } from 'mongoose';
import { Payment } from '@models/index';
import { PaymentDAO } from '@dao/paymentDAO';
import { clearTestDatabase } from '@tests/helpers';
import {
  PaymentRecordStatus,
  PaymentRecordType,
  PaymentMethod,
} from '@interfaces/payments.interface';

import {
  createTestProperty,
  createTestClient,
  createTestLease,
  createTestUser,
} from '../../setup/testFactories';

describe('PaymentDAO.getIncomeByPropertyAndCurrency — P&L income (integration)', () => {
  const paymentDAO = new PaymentDAO({ paymentModel: Payment });
  const period = { $gte: new Date('2026-01-01'), $lte: new Date('2026-12-31') };
  let cuid: string;
  let leaseId: Types.ObjectId;
  let month = 0;

  const createPayment = (overrides: Record<string, any>) =>
    Payment.create({
      cuid,
      lease: leaseId,
      paymentType: PaymentRecordType.RENT,
      paymentMethod: PaymentMethod.ONLINE,
      status: PaymentRecordStatus.PAID,
      baseAmount: 100000,
      currency: 'CAD',
      tenant: new Types.ObjectId(),
      dueDate: new Date('2026-03-01'),
      paidAt: new Date('2026-03-02'),
      isManualEntry: false,
      period: { month: ++month, year: 2026 }, // one rent record per lease per month
      ...overrides,
    });

  beforeEach(async () => {
    await clearTestDatabase();
    month = 0;
    const client = await createTestClient();
    cuid = client.cuid;
    const tenant = await createTestUser(cuid, { roles: ['tenant'] });
    const property = await createTestProperty(cuid, client._id as Types.ObjectId);
    const lease = await createTestLease(
      property._id as Types.ObjectId,
      tenant._id as Types.ObjectId,
      cuid
    );
    leaseId = lease._id as Types.ObjectId;
  });

  it('counts kept rent net of refunds, and leaves out deposits and unreviewed entries', async () => {
    await createPayment({}); // 100000 rent
    await createPayment({ refund: { amount: 25000 } }); // 75000 after a partial refund
    await createPayment({ paymentType: PaymentRecordType.SECURITY_DEPOSIT, baseAmount: 200000 });
    await createPayment({ paymentType: PaymentRecordType.DEPOSIT_REFUND, isManualEntry: true });
    await createPayment({ isManualEntry: true, managerReviewRequired: true, baseAmount: 40000 });

    const [row] = await paymentDAO.getIncomeByPropertyAndCurrency(cuid, period);

    expect(row._id.currency).toBe('CAD');
    expect(row.total).toBe(175000);
  });

  it('never subtracts more than the payment amount', async () => {
    await createPayment({ refund: { amount: 999999 } });

    const [row] = await paymentDAO.getIncomeByPropertyAndCurrency(cuid, period);
    expect(row.total).toBe(0);
  });
});
