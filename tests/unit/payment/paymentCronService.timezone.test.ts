jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));

import { PaymentRecordType } from '@interfaces/payments.interface';
import { PaymentCronService, localCalendarDay } from '@services/payments/paymentCron.service';

const CUID_TORONTO = 'CLIENT_TORONTO';
const CUID_VANCOUVER = 'CLIENT_VANCOUVER';
const CUID_UTC = 'CLIENT_UTC';

const makeMocks = () => {
  const paymentDAO = {
    list: jest.fn().mockReturnValue(Promise.resolve({ items: [], pagination: null })),
    findOverduePayments: jest
      .fn()
      .mockReturnValue(Promise.resolve({ items: [], pagination: null })),
    updateById: jest.fn().mockReturnValue(Promise.resolve({})),
    update: jest.fn().mockReturnValue(Promise.resolve({})),
  } as any;

  const clientDAO = {
    getCuidsByTimezone: jest.fn().mockReturnValue(Promise.resolve([])),
    getDistinctTimezones: jest.fn().mockReturnValue(Promise.resolve(['America/Toronto', 'UTC'])),
  } as any;

  const noop = {} as any;

  const service = new PaymentCronService({
    maintenancePaymentService: noop,
    paymentGatewayService: noop,
    paymentProcessorDAO: { findFirst: jest.fn().mockReturnValue(Promise.resolve(null)) } as any,
    subscriptionPlanConfig: noop,
    emitterService: { emit: jest.fn(), on: jest.fn() } as any,
    subscriptionDAO: noop,
    smsService: { sendToUser: jest.fn() } as any,
    invoiceDAO: noop,
    queueFactory: { getQueue: jest.fn() } as any,
    profileDAO: { findFirst: jest.fn().mockReturnValue(Promise.resolve(null)) } as any,
    paymentDAO,
    clientDAO,
    leaseDAO: { findFirst: jest.fn().mockReturnValue(Promise.resolve(null)) } as any,
  });

  return { service, paymentDAO, clientDAO };
};

const findJob = async (service: PaymentCronService, name: string) => {
  const jobs = await service.getCronJobs();
  const job = jobs.find((j) => j.name === name);
  if (!job) throw new Error(`job ${name} not registered`);
  return job;
};

describe('PaymentCronService — client-timezone jobs', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getCronJobs', () => {
    it('registers one hourly UTC job per operation, independent of the client timezones', async () => {
      const { service, clientDAO } = makeMocks();

      const jobs = await service.getCronJobs();
      const hourlyJobs = jobs.filter((j) => j.name.endsWith('.hourly'));

      expect(hourlyJobs.map((j) => j.name).sort()).toEqual([
        'payment.auto-charge-due-rent.hourly',
        'payment.auto-charge-overdue-maintenance.hourly',
        'payment.mark-overdue.hourly',
        'payment.pad-pre-debit-notices.hourly',
      ]);
      hourlyJobs.forEach((job) => {
        expect(job.schedule).toBe('0 * * * *');
        expect(job.timezone).toBeUndefined();
      });
      // Timezones are read when the job runs, not at registration
      expect(clientDAO.getDistinctTimezones).not.toHaveBeenCalled();
    });
  });

  describe('runs at the client local hour', () => {
    it('marks overdue only for timezones where it is 1 AM local time', async () => {
      // 06:00 UTC on a winter day = 01:00 in Toronto (UTC-5), 22:00 in Vancouver
      jest.useFakeTimers({ now: new Date('2026-01-15T06:00:00Z') });
      const { service, clientDAO, paymentDAO } = makeMocks();
      clientDAO.getDistinctTimezones.mockReturnValue(
        Promise.resolve(['America/Toronto', 'America/Vancouver', 'UTC'])
      );
      clientDAO.getCuidsByTimezone.mockReturnValue(Promise.resolve([CUID_TORONTO]));

      const job = await findJob(service, 'payment.mark-overdue.hourly');
      await job.handler();

      expect(clientDAO.getCuidsByTimezone).toHaveBeenCalledTimes(1);
      expect(clientDAO.getCuidsByTimezone).toHaveBeenCalledWith('America/Toronto');
      expect(paymentDAO.findOverduePayments).toHaveBeenCalledWith(
        { cuid: { $in: [CUID_TORONTO] }, isManualEntry: { $ne: true } },
        { limit: 500, skip: 0 },
        new Date('2026-01-15T00:00:00Z')
      );
    });

    it('picks up a timezone added after the worker started, without re-registering', async () => {
      jest.useFakeTimers({ now: new Date('2026-01-15T14:00:00Z') }); // 06:00 in Vancouver
      const { service, clientDAO, paymentDAO } = makeMocks();
      const job = await findJob(service, 'payment.auto-charge-due-rent.hourly');

      // A new Vancouver client signs up after registration
      clientDAO.getDistinctTimezones.mockReturnValue(
        Promise.resolve(['America/Toronto', 'America/Vancouver'])
      );
      clientDAO.getCuidsByTimezone.mockReturnValue(Promise.resolve([CUID_VANCOUVER]));

      await job.handler();

      expect(clientDAO.getCuidsByTimezone).toHaveBeenCalledWith('America/Vancouver');
      const listFilter = paymentDAO.list.mock.calls[0][0];
      expect(listFilter.cuid).toEqual({ $in: [CUID_VANCOUVER] });
      expect(listFilter.paymentType).toEqual({
        $in: [PaymentRecordType.RENT, PaymentRecordType.SECURITY_DEPOSIT],
      });
    });

    it('skips every timezone when none is at the job hour', async () => {
      jest.useFakeTimers({ now: new Date('2026-01-15T12:00:00Z') });
      const { service, clientDAO, paymentDAO } = makeMocks();

      const job = await findJob(service, 'payment.auto-charge-overdue-maintenance.hourly');
      await job.handler();

      expect(clientDAO.getCuidsByTimezone).not.toHaveBeenCalled();
      expect(paymentDAO.list).not.toHaveBeenCalled();
    });

    it('falls back to UTC when no client timezones exist', async () => {
      jest.useFakeTimers({ now: new Date('2026-01-15T10:00:00Z') });
      const { service, clientDAO, paymentDAO } = makeMocks();
      clientDAO.getDistinctTimezones.mockReturnValue(Promise.resolve([]));
      clientDAO.getCuidsByTimezone.mockReturnValue(Promise.resolve([CUID_UTC]));

      const job = await findJob(service, 'payment.auto-charge-overdue-maintenance.hourly');
      await job.handler();

      expect(clientDAO.getCuidsByTimezone).toHaveBeenCalledWith('UTC');
      const listFilter = paymentDAO.list.mock.calls[0][0];
      expect(listFilter.cuid).toEqual({ $in: [CUID_UTC] });
      expect(listFilter.paymentType).toEqual({
        $in: [PaymentRecordType.MAINTENANCE, PaymentRecordType.LATE_FEE],
      });
    });

    it('runs a half-hour-offset timezone once a day', async () => {
      const { service, clientDAO } = makeMocks();
      clientDAO.getDistinctTimezones.mockReturnValue(Promise.resolve(['Asia/Kolkata'])); // UTC+5:30
      const job = await findJob(service, 'payment.mark-overdue.hourly');

      let runs = 0;
      for (let hour = 0; hour < 24; hour++) {
        jest.useFakeTimers({ now: new Date(Date.UTC(2026, 0, 15, hour)) });
        clientDAO.getCuidsByTimezone.mockClear();
        await job.handler();
        runs += clientDAO.getCuidsByTimezone.mock.calls.length;
      }
      expect(runs).toBe(1);
    });

    it('scopes queries with an empty $in when the timezone has no active clients', async () => {
      jest.useFakeTimers({ now: new Date('2026-01-15T06:00:00Z') });
      const { service, clientDAO, paymentDAO } = makeMocks();
      clientDAO.getCuidsByTimezone.mockReturnValue(Promise.resolve([]));

      const job = await findJob(service, 'payment.mark-overdue.hourly');
      await job.handler();

      expect(paymentDAO.findOverduePayments.mock.calls[0][0]).toEqual({
        cuid: { $in: [] },
        isManualEntry: { $ne: true },
      });
    });
  });

  describe('localCalendarDay', () => {
    it('returns the client-local calendar date as UTC midnight', () => {
      // 03:00 UTC on Oct 2 is still Oct 1 in Toronto, already Oct 2 in Tokyo
      const instant = new Date('2026-10-02T03:00:00Z');
      expect(localCalendarDay(instant, 'America/Toronto')).toEqual(
        new Date('2026-10-01T00:00:00Z')
      );
      expect(localCalendarDay(instant, 'Asia/Tokyo')).toEqual(new Date('2026-10-02T00:00:00Z'));
    });

    it('falls back to UTC for an invalid timezone', () => {
      const instant = new Date('2026-10-02T03:00:00Z');
      expect(localCalendarDay(instant, 'Not/AZone')).toEqual(new Date('2026-10-02T00:00:00Z'));
    });
  });
});
