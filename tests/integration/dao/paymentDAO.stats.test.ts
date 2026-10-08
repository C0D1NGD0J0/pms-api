import { Types } from 'mongoose';
import { Payment } from '@models/index';
import { PaymentDAO } from '@dao/paymentDAO';
import { clearTestDatabase } from '@tests/helpers';
import {
  PaymentRecordStatus,
  PaymentRecordType,
  PaymentMethod,
} from '@interfaces/payments.interface';

describe('PaymentDAO.getPaymentStats — collected revenue (integration)', () => {
  const CUID = 'DAO_STATS_CUID';
  const paymentDAO = new PaymentDAO({ paymentModel: Payment });

  const createPayment = (overrides: Record<string, any>) =>
    Payment.create({
      cuid: CUID,
      paymentType: PaymentRecordType.RENT,
      paymentMethod: PaymentMethod.ONLINE,
      status: PaymentRecordStatus.PAID,
      baseAmount: 100000,
      currency: 'CAD',
      tenant: new Types.ObjectId(),
      dueDate: new Date(),
      paidAt: new Date(),
      isManualEntry: false,
      ...overrides,
    });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  it('nets partial refunds, skips deposit refunds and treats unreviewed staff entries as pending', async () => {
    await createPayment({}); // 100000 collected
    await createPayment({ refund: { amount: 30000 } }); // 70000 net
    await createPayment({ paymentType: PaymentRecordType.DEPOSIT_REFUND, isManualEntry: true });
    await createPayment({ isManualEntry: true, managerReviewRequired: true, baseAmount: 40000 });
    await createPayment({ status: PaymentRecordStatus.PENDING, baseAmount: 5000 });

    const stats = await paymentDAO.getPaymentStats(CUID);
    const cad = stats.byCurrency.find((row) => row.currency === 'CAD');

    expect(cad).toEqual({
      currency: 'CAD',
      totalRevenue: 170000,
      monthRevenue: 170000,
      pendingAmount: 45000,
    });
  });

  it('never subtracts more than the payment amount', async () => {
    await createPayment({ refund: { amount: 999999 } });

    const stats = await paymentDAO.getPaymentStats(CUID);
    expect(stats.byCurrency[0].totalRevenue).toBe(0);
  });
});
