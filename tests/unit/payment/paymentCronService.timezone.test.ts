import dayjs from 'dayjs';
import { Types } from 'mongoose';

jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));

import { PaymentCronService } from '@services/payments/paymentCron.service';
import { PaymentRecordStatus, PaymentRecordType } from '@interfaces/payments.interface';

const CUID_TORONTO = 'CLIENT_TORONTO';
const CUID_VANCOUVER = 'CLIENT_VANCOUVER';
const CUID_UTC = 'CLIENT_UTC';

const _makePayment = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  pytuid: `PYT${Math.random().toString(36).slice(2, 6)}`,
  cuid: CUID_TORONTO,
  status: PaymentRecordStatus.PENDING,
  paymentType: PaymentRecordType.RENT,
  baseAmount: 150000,
  dueDate: dayjs().subtract(2, 'day').toDate(),
  tenant: new Types.ObjectId(),
  isManualEntry: false,
  lineItems: [],
  ...overrides,
});

const makeMocks = () => {
  const paymentDAO = {
    list: jest.fn().mockReturnValue(Promise.resolve({ items: [], pagination: null })),
    findOverduePayments: jest
      .fn()
      .mockReturnValue(Promise.resolve({ items: [], pagination: null })),
    updateById: jest.fn().mockReturnValue(Promise.resolve({})),
  } as any;

  const clientDAO = {
    getCuidsByTimezone: jest.fn().mockReturnValue(Promise.resolve([])),
    getDistinctTimezones: jest.fn().mockReturnValue(Promise.resolve(['America/Toronto', 'UTC'])),
  } as any;

  const leaseDAO = {
    findFirst: jest.fn().mockReturnValue(Promise.resolve(null)),
  } as any;

  const profileDAO = {
    findFirst: jest.fn().mockReturnValue(Promise.resolve(null)),
  } as any;

  const paymentProcessorDAO = {
    findFirst: jest.fn().mockReturnValue(Promise.resolve(null)),
  } as any;

  const noop = {} as any;

  const service = new PaymentCronService({
    maintenancePaymentService: noop,
    paymentGatewayService: noop,
    paymentProcessorDAO,
    subscriptionPlanConfig: noop,
    emitterService: { emit: jest.fn(), on: jest.fn() } as any,
    subscriptionDAO: noop,
    stripeService: noop,
    smsService: { sendToUser: jest.fn() } as any,
    invoiceDAO: noop,
    queueFactory: { getQueue: jest.fn() } as any,
    profileDAO,
    paymentDAO,
    clientDAO,
    leaseDAO,
  });

  return { service, paymentDAO, clientDAO, leaseDAO };
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PaymentCronService — timezone-scoped jobs', () => {
  describe('getCronJobs', () => {
    it('should create per-timezone jobs for each distinct client timezone', async () => {
      const { service, clientDAO } = makeMocks();
      clientDAO.getDistinctTimezones.mockReturnValue(
        Promise.resolve(['America/Toronto', 'America/Vancouver'])
      );

      const jobs = await service.getCronJobs();
      const tzJobNames = jobs.map((j) => j.name).filter((n) => n.includes('America/'));

      // 3 operations x 2 timezones = 6 timezone-scoped jobs
      expect(tzJobNames).toHaveLength(6);
      expect(tzJobNames).toContain('payment.auto-charge-overdue-maintenance.America/Toronto');
      expect(tzJobNames).toContain('payment.auto-charge-due-rent.America/Vancouver');
      expect(tzJobNames).toContain('payment.mark-overdue.America/Toronto');
      expect(tzJobNames).toContain('payment.mark-overdue.America/Vancouver');
    });

    it('should fall back to UTC when no client timezones exist', async () => {
      const { service, clientDAO } = makeMocks();
      clientDAO.getDistinctTimezones.mockReturnValue(Promise.resolve([]));

      const jobs = await service.getCronJobs();
      const tzJobNames = jobs.filter((j) => j.name.startsWith('payment.mark-overdue.'));

      expect(tzJobNames).toHaveLength(1);
      expect(tzJobNames[0].name).toBe('payment.mark-overdue.UTC');
    });
  });

  describe('markOverduePayments', () => {
    it('should only query payments for clients in the specified timezone', async () => {
      const { service, clientDAO, paymentDAO } = makeMocks();
      clientDAO.getCuidsByTimezone.mockReturnValue(Promise.resolve([CUID_TORONTO]));

      const jobs = await service.getCronJobs();
      const markOverdueToronto = jobs.find(
        (j) => j.name === 'payment.mark-overdue.America/Toronto'
      );

      await markOverdueToronto!.handler();

      expect(clientDAO.getCuidsByTimezone).toHaveBeenCalledWith('America/Toronto');
      expect(paymentDAO.findOverduePayments).toHaveBeenCalledWith({
        cuid: { $in: [CUID_TORONTO] },
      });
    });

    it('should skip processing when no clients exist in timezone', async () => {
      const { service, clientDAO, paymentDAO } = makeMocks();
      clientDAO.getCuidsByTimezone.mockReturnValue(Promise.resolve([]));

      const jobs = await service.getCronJobs();
      const markOverdue = jobs.find((j) => j.name === 'payment.mark-overdue.America/Toronto');

      await markOverdue!.handler();

      // Should pass empty $in filter — matches nothing
      expect(paymentDAO.findOverduePayments).toHaveBeenCalledWith({
        cuid: { $in: [] },
      });
    });
  });

  describe('autoChargeDueRentPayments', () => {
    it('should scope rent auto-charge to timezone clients', async () => {
      const { service, clientDAO, paymentDAO } = makeMocks();
      clientDAO.getCuidsByTimezone.mockReturnValue(Promise.resolve([CUID_TORONTO, CUID_VANCOUVER]));

      const jobs = await service.getCronJobs();
      const autoCharge = jobs.find(
        (j) => j.name === 'payment.auto-charge-due-rent.America/Toronto'
      );

      await autoCharge!.handler();

      expect(clientDAO.getCuidsByTimezone).toHaveBeenCalledWith('America/Toronto');
      const listCall = paymentDAO.list.mock.calls[0][0];
      expect(listCall.cuid).toEqual({ $in: [CUID_TORONTO, CUID_VANCOUVER] });
      expect(listCall.paymentType).toBe(PaymentRecordType.RENT);
    });
  });

  describe('autoChargeOverdueMaintenancePayments', () => {
    it('should scope maintenance auto-charge to timezone clients', async () => {
      const { service, clientDAO, paymentDAO } = makeMocks();
      clientDAO.getCuidsByTimezone.mockReturnValue(Promise.resolve([CUID_UTC]));

      const jobs = await service.getCronJobs();
      const autoCharge = jobs.find((j) => j.name === 'payment.auto-charge-overdue-maintenance.UTC');

      await autoCharge!.handler();

      expect(clientDAO.getCuidsByTimezone).toHaveBeenCalledWith('UTC');
      const listCall = paymentDAO.list.mock.calls[0][0];
      expect(listCall.cuid).toEqual({ $in: [CUID_UTC] });
      expect(listCall.paymentType).toEqual({
        $in: [PaymentRecordType.MAINTENANCE, PaymentRecordType.LATE_FEE],
      });
    });
  });

  describe('buildCuidFilter (via handlers)', () => {
    it('should return empty filter when no timezone is provided (UTC-only jobs)', async () => {
      const { service, clientDAO, paymentDAO } = makeMocks();
      clientDAO.getDistinctTimezones.mockReturnValue(Promise.resolve(['UTC']));

      const jobs = await service.getCronJobs();
      // test mark-overdue with UTC timezone
      const markOverdueUtc = jobs.find((j) => j.name === 'payment.mark-overdue.UTC');
      clientDAO.getCuidsByTimezone.mockReturnValue(Promise.resolve([CUID_UTC]));

      await markOverdueUtc!.handler();

      expect(paymentDAO.findOverduePayments).toHaveBeenCalledWith({
        cuid: { $in: [CUID_UTC] },
      });
    });
  });
});
