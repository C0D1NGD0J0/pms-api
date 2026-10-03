import { Types } from 'mongoose';
import { Payment } from '@models/index';
import { PaymentDAO } from '@dao/paymentDAO';
import { clearTestDatabase } from '@tests/helpers';
import {
  PaymentRecordStatus,
  PaymentRecordType,
  PaymentMethod,
} from '@interfaces/payments.interface';

// Tenant payment metrics are computed here and layered onto tenant details by
// UserService.getClientTenantDetails — the user DAO only returns placeholders.
describe('PaymentDAO — getTenantPaymentMetrics', () => {
  const cuid = 'TEST_CLIENT_123';
  let paymentDAO: PaymentDAO;
  let tenantId: Types.ObjectId;

  const rentPayment = (overrides: Record<string, unknown>) => ({
    cuid,
    tenant: tenantId,
    baseAmount: 200000, // $2000 in cents
    processingFee: 1000, // $10 in cents
    paymentMethod: PaymentMethod.ONLINE,
    paymentType: PaymentRecordType.RENT,
    description: 'Rent payment',
    ...overrides,
  });

  beforeAll(() => {
    paymentDAO = new PaymentDAO({ paymentModel: Payment });
  });

  beforeEach(async () => {
    await clearTestDatabase();
    tenantId = new Types.ObjectId();
  });

  it('computes totals, on-time rate and average delay from paid payments', async () => {
    await Payment.insertMany([
      rentPayment({
        pytuid: 'PAY_001',
        invoiceNumber: 'INV-001',
        status: PaymentRecordStatus.PAID,
        dueDate: new Date('2024-01-01'),
        paidAt: new Date('2024-01-01'), // on time
        period: { month: 1, year: 2024 },
      }),
      rentPayment({
        pytuid: 'PAY_002',
        invoiceNumber: 'INV-002',
        status: PaymentRecordStatus.PAID,
        dueDate: new Date('2024-02-01'),
        paidAt: new Date('2024-02-05'), // 4 days late
        period: { month: 2, year: 2024 },
      }),
    ]);

    const { metrics } = await paymentDAO.getTenantPaymentMetrics(cuid, tenantId.toString());

    // 2 paid payments x (200000 + 1000)
    expect(metrics.totalRentPaid).toBe(402000);
    // 1 of 2 paid on time
    expect(metrics.onTimePaymentRate).toBe(50);
    // (0 + 4) / 2
    expect(metrics.averagePaymentDelay).toBe(2);
  });

  it('returns history (newest first, base + fee as amount) only when requested', async () => {
    await Payment.insertMany([
      rentPayment({
        pytuid: 'PAY_001',
        invoiceNumber: 'INV-001',
        status: PaymentRecordStatus.PAID,
        dueDate: new Date('2024-01-01'),
        paidAt: new Date('2024-01-01'),
        period: { month: 1, year: 2024 },
      }),
      rentPayment({
        pytuid: 'PAY_002',
        invoiceNumber: 'INV-002',
        status: PaymentRecordStatus.PENDING,
        dueDate: new Date('2024-03-01'),
        period: { month: 3, year: 2024 },
      }),
    ]);

    const withHistory = await paymentDAO.getTenantPaymentMetrics(cuid, tenantId.toString(), {
      includeHistory: true,
    });
    expect(withHistory.payments).toHaveLength(2);
    expect(withHistory.payments[0].invoiceNumber).toBe('INV-002');
    expect(withHistory.payments[0].amount).toBe(201000);

    const withoutHistory = await paymentDAO.getTenantPaymentMetrics(cuid, tenantId.toString());
    expect(withoutHistory.payments).toEqual([]);
  });

  it('returns zeroed metrics for a tenant with no payments', async () => {
    const result = await paymentDAO.getTenantPaymentMetrics(cuid, tenantId.toString(), {
      includeHistory: true,
    });

    expect(result.payments).toEqual([]);
    expect(result.metrics).toEqual({
      totalRentPaid: 0,
      onTimePaymentRate: 0,
      averagePaymentDelay: 0,
    });
  });
});
