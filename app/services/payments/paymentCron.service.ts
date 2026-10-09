import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { InvoiceDAO } from '@dao/invoiceDAO';
import { envVariables } from '@shared/config';
import { QueueFactory } from '@services/queue';
import { NotFoundError } from '@shared/customErrors';
import { PaymentQueue } from '@queues/payment.queue';
import { EventEmitterService } from '@services/eventEmitter';
import { SMSService } from '@services/smsService/sms.service';
import { SubscriptionPlanConfig } from '@services/subscription';
import { MAX_CHARGE_ATTEMPTS, createLogger } from '@utils/index';
import { calcApplicationFeeSplit } from '@utils/financial.utils';
import { ICronProvider, ICronJob } from '@interfaces/cron.interface';
import { computeLeaseMonthlyFees } from '@services/lease/leaseHelpers';
import { StripeService } from '@services/external/stripe/stripe.service';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
import { MaintenancePaymentService } from '@services/payments/maintenancePayment.service';
import { MaintenanceFundsAvailablePayload, EventTypes } from '@interfaces/events.interface';
import {
  PaymentProcessorDAO,
  SubscriptionDAO,
  PaymentDAO,
  ProfileDAO,
  ClientDAO,
  LeaseDAO,
} from '@dao/index';
import {
  IPaymentGatewayProvider,
  PaymentRecordStatus,
  PaymentRecordType,
  IPaymentDocument,
  ILeaseDocument,
  SMSMessageType,
  PaymentMethod,
  PaymentSource,
  LeaseStatus,
} from '@interfaces/index';

interface IConstructor {
  maintenancePaymentService: MaintenancePaymentService;
  subscriptionPlanConfig: SubscriptionPlanConfig;
  paymentGatewayService: PaymentGatewayService;
  paymentProcessorDAO: PaymentProcessorDAO;
  emitterService: EventEmitterService;
  subscriptionDAO: SubscriptionDAO;
  // Kept for DI compatibility — Stripe is only reached through paymentGatewayService.
  stripeService?: StripeService;
  queueFactory: QueueFactory;
  smsService: SMSService;
  invoiceDAO: InvoiceDAO;
  profileDAO: ProfileDAO;
  paymentDAO: PaymentDAO;
  clientDAO: ClientDAO;
  leaseDAO: LeaseDAO;
}

interface ITenantChargeMethod {
  paymentMethodId?: string;
  tenantUserId?: string;
  accountLast4?: string;
  isBankDebit: boolean;
  methodType?: string;
  isPadDebit: boolean;
  mandateId?: string;
}

type AutoChargeOutcome = 'charged' | 'skipped' | 'deferred';

const CHARGEABLE_STATUSES = [PaymentRecordStatus.PENDING, PaymentRecordStatus.OVERDUE];
// Records billed through a Stripe invoice: the auto-charge pays the invoice on/after its due date
const INVOICED_AUTO_CHARGE_TYPES = [PaymentRecordType.RENT, PaymentRecordType.SECURITY_DEPOSIT];
const OPEN_DISPUTE_STATUSES = ['open', 'needs_response', 'under_review'];
const BANK_DEBIT_METHOD_TYPES = new Set([
  'us_bank_account',
  'acss_debit',
  'sepa_debit',
  'bacs_debit',
]);
const DEFAULT_PAD_PRE_NOTIFICATION_DAYS = 10;
// Weekly rent generation runs every 7 days, so auto-debit invoices are created this many days
// beyond the PAD notice period to guarantee the notice can go out on time.
const AUTO_DEBIT_EXTRA_LEAD_DAYS = 8;
const AUTO_CHARGE_BATCH_SIZE = 200;
const CARD_PROCESSING_STALE_HOURS = 72;
const BANK_DEBIT_PROCESSING_STALE_HOURS = 240;
const DAY_MS = 24 * 60 * 60 * 1000;

// Local hour (client timezone) at which each timezone-scoped job runs.
const LOCAL_HOUR = {
  markOverdue: 1,
  padPreDebitNotices: 5,
  autoChargeDueRent: 6,
  autoChargeOverdueMaintenance: 10,
};

export class PaymentCronService implements ICronProvider {
  private readonly log: Logger;
  private readonly maintenancePaymentService: MaintenancePaymentService;
  private readonly paymentGatewayService: PaymentGatewayService;
  private readonly paymentProcessorDAO: PaymentProcessorDAO;
  private readonly subscriptionPlanConfig: SubscriptionPlanConfig;
  private readonly emitterService: EventEmitterService;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly smsService: SMSService;
  private readonly invoiceDAO: InvoiceDAO;
  private readonly queueFactory: QueueFactory;
  private readonly profileDAO: ProfileDAO;
  private readonly paymentDAO: PaymentDAO;
  private readonly clientDAO: ClientDAO;
  private readonly leaseDAO: LeaseDAO;

  constructor({
    maintenancePaymentService,
    paymentGatewayService,
    paymentProcessorDAO,
    subscriptionPlanConfig,
    emitterService,
    subscriptionDAO,
    smsService,
    invoiceDAO,
    queueFactory,
    profileDAO,
    paymentDAO,
    clientDAO,
    leaseDAO,
  }: IConstructor) {
    this.log = createLogger('PaymentCronService');
    this.maintenancePaymentService = maintenancePaymentService;
    this.paymentGatewayService = paymentGatewayService;
    this.paymentProcessorDAO = paymentProcessorDAO;
    this.subscriptionPlanConfig = subscriptionPlanConfig;
    this.emitterService = emitterService;
    this.subscriptionDAO = subscriptionDAO;
    this.smsService = smsService;
    this.invoiceDAO = invoiceDAO;
    this.queueFactory = queueFactory;
    this.profileDAO = profileDAO;
    this.paymentDAO = paymentDAO;
    this.clientDAO = clientDAO;
    this.leaseDAO = leaseDAO;
  }

  /** Payments Canada Rule H1: minimum days between the PAD pre-debit notice and the debit. */
  private get padNoticeDays(): number {
    return envVariables.STRIPE?.PAD_PRE_NOTIFICATION_DAYS || DEFAULT_PAD_PRE_NOTIFICATION_DAYS;
  }

  /**
   * Build a cuid filter for timezone-scoped cron jobs.
   * Returns { cuid: { $in: [...] } } when a timezone is provided,
   * or an empty object for UTC-only (global) jobs.
   */
  private async buildCuidFilter(timezone?: string): Promise<Record<string, any>> {
    if (!timezone) return {};
    const cuids = await this.clientDAO.getCuidsByTimezone(timezone);
    // $in: [] is intentional — MongoDB matches nothing, so no payments are processed
    // when no clients exist for this timezone. This is a safe no-op.
    if (cuids.length === 0) return { cuid: { $in: [] } };
    return { cuid: { $in: cuids } };
  }

  async getCronJobs(): Promise<ICronJob[]> {
    const utcJobs: ICronJob[] = [
      {
        name: 'payment.weekly-rent-invoices',
        schedule: '0 2 * * 0', // Sunday 2:00 AM UTC
        handler: this.queueWeeklyRentInvoices.bind(this),
        enabled: true,
        service: 'PaymentCronService',
        description:
          'Queue rent invoice creation for leases due in the upcoming week (further ahead for auto-debit leases so the PAD notice can go out on time)',
        timeout: 600000,
      },
      {
        name: 'payment.daily-rent-safety-net',
        schedule: '0 5 * * *', // 5:00 AM UTC — catches misses before business hours
        handler: this.queueDailySafetyNetInvoices.bind(this),
        enabled: true,
        service: 'PaymentCronService',
        description:
          'Queue rent invoices for leases due soon that have no record for the period yet (catches any missed by weekly job)',
        timeout: 300000,
      },
      {
        name: 'payment.reconcile-stale-processing',
        schedule: '0 3 * * *', // 3:00 AM UTC — overnight batch
        handler: this.reconcileStaleProcessingPayments.bind(this),
        enabled: true,
        service: 'PaymentCronService',
        description: 'Reconcile PROCESSING payments by checking Stripe invoice status',
        timeout: 300000,
      },
      {
        name: 'payment.check-funds-availability-morning',
        schedule: '0 6 * * *',
        handler: this.checkFundsAvailability.bind(this),
        enabled: true,
        service: 'PaymentCronService',
        description:
          'Flip fundsAvailable on maintenance invoices whose tenant charge succeeded (morning run)',
        timeout: 300000,
      },
      {
        name: 'payment.check-funds-availability-evening',
        schedule: '0 22 * * *',
        handler: this.checkFundsAvailability.bind(this),
        enabled: true,
        service: 'PaymentCronService',
        description:
          'Flip fundsAvailable on maintenance invoices whose tenant charge succeeded (evening run)',
        timeout: 300000,
      },
      {
        name: 'payment.auto-payout-vendors',
        schedule: '0 12 * * *',
        handler: this.autoPayoutVendors.bind(this),
        enabled: true,
        service: 'PaymentCronService',
        description:
          'Auto-pay vendors whose invoices have had settled funds for 5+ days without PM action',
        timeout: 300000,
      },
      {
        name: 'payment.sync-connect-account-statuses',
        schedule: '0 4 * * *', // 4 AM UTC daily
        handler: this.syncConnectAccountStatuses.bind(this),
        enabled: true,
        service: 'PaymentCronService',
        description:
          'Sync Stripe Connect account statuses (chargesEnabled, payoutsEnabled, detailsSubmitted) for all active processors',
        timeout: 300000,
      },
    ];

    // Time-sensitive jobs run hourly and process only the clients whose local time is at the
    // job's hour (e.g. 6 AM Vancouver, not 6 AM UTC). Timezones are read on every run, so a new
    // client or a changed timezone is covered without restarting the worker.
    const localTimeJobs: ICronJob[] = [
      this.buildLocalHourJob(
        'payment.mark-overdue',
        LOCAL_HOUR.markOverdue,
        'Flip PENDING → OVERDUE for payments whose due date has passed in the client timezone',
        (tz) => this.markOverduePayments(tz)
      ),
      this.buildLocalHourJob(
        'payment.pad-pre-debit-notices',
        LOCAL_HOUR.padPreDebitNotices,
        'Send PAD pre-debit notices for upcoming bank (ACSS) debits',
        (tz) => this.sendPadPreDebitNotices(tz)
      ),
      this.buildLocalHourJob(
        'payment.auto-charge-due-rent',
        LOCAL_HOUR.autoChargeDueRent,
        'Auto-charge tenants for rent due today or overdue',
        (tz) => this.autoChargeDueRentPayments(tz)
      ),
      this.buildLocalHourJob(
        'payment.auto-charge-overdue-maintenance',
        LOCAL_HOUR.autoChargeOverdueMaintenance,
        'Auto-charge tenants for overdue maintenance and late-fee charges',
        (tz) => this.autoChargeOverdueMaintenancePayments(tz)
      ),
    ];

    return [...utcJobs, ...localTimeJobs];
  }

  private buildLocalHourJob(
    baseName: string,
    localHour: number,
    description: string,
    run: (timezone: string) => Promise<void>
  ): ICronJob {
    return {
      name: `${baseName}.hourly`,
      schedule: '0 * * * *',
      handler: () => this.runForTimezonesAtLocalHour(baseName, localHour, run),
      enabled: true,
      service: 'PaymentCronService',
      description: `${description} [runs at ${localHour}:00 client time]`,
      timeout: 300000,
    };
  }

  private async runForTimezonesAtLocalHour(
    jobName: string,
    localHour: number,
    run: (timezone: string) => Promise<void>
  ): Promise<void> {
    let timezones: string[] = [];
    try {
      timezones = await this.clientDAO.getDistinctTimezones();
    } catch (err) {
      this.log.error({ err }, `[Cron] ${jobName}: failed to load client timezones — using UTC`);
    }
    if (timezones.length === 0) timezones = ['UTC'];

    const now = new Date();
    for (const timezone of timezones) {
      if (getLocalDateParts(now, timezone).hour !== localHour) continue;
      try {
        await run(timezone);
      } catch (err) {
        this.log.error({ err, timezone }, `[Cron] ${jobName} failed for timezone`);
      }
    }
  }

  /**
   * Create a PENDING payment tracking record without any Stripe/gateway interaction.
   * Used for cash, check, and e-transfer leases so the dashboard reflects expected revenue.
   */
  async createManualTrackingPayment(data: {
    cuid: string;
    tenantId: string;
    dueDate: Date;
    baseAmount: number;
    paymentType: PaymentRecordType;
    paymentMethod: PaymentMethod;
    leaseId?: string;
    period?: { month: number; year: number };
    maintenanceRequestUid?: string;
    description?: string;
    currency?: string;
    lineItems?: { description: string; amountInCents: number }[];
    paymentSource?: PaymentSource;
    acceptedPaymentMethod?: string;
  }): Promise<IPaymentDocument> {
    const tenantProfile = await this.profileDAO.findFirst({ user: data.tenantId });
    if (!tenantProfile) {
      throw new NotFoundError({ message: 'Tenant profile not found' });
    }

    const payment = await this.paymentDAO.insert({
      cuid: data.cuid,
      paymentType: data.paymentType,
      paymentMethod: data.paymentMethod,
      status: PaymentRecordStatus.PENDING,
      tenant: tenantProfile._id,
      ...(data.leaseId ? { lease: new Types.ObjectId(data.leaseId) } : {}),
      baseAmount: data.baseAmount,
      processingFee: 0,
      dueDate: data.dueDate,
      ...(data.period ? { period: data.period } : {}),
      ...(data.maintenanceRequestUid ? { maintenanceRequestUid: data.maintenanceRequestUid } : {}),
      ...(data.description ? { description: data.description } : {}),
      ...(data.currency ? { currency: data.currency } : {}),
      ...(data.lineItems?.length ? { lineItems: data.lineItems } : {}),
      ...(data.paymentSource ? { paymentSource: data.paymentSource } : {}),
      isManualEntry: false,
    });

    this.emitterService.emit(EventTypes.PAYMENT_REQUEST_CREATED, {
      tenantUserId: data.tenantId,
      amountInCents: data.baseAmount,
      dueDate: data.dueDate,
      pytuid: payment.pytuid,
      cuid: data.cuid,
      paymentType: data.paymentType,
      currency: payment.currency ?? data.currency,
      ...(data.acceptedPaymentMethod && { acceptedPaymentMethod: data.acceptedPaymentMethod }),
    });

    return payment;
  }

  calculateRentFees(
    totalAmount: number,
    transactionFeePercent: number,
    provider: string = 'stripe',
    paymentMethodType?: string
  ): {
    baseAmount: number;
    applicationFee: number;
    gatewayProcessingFee: number;
    platformNetRevenue: number;
  } {
    const { applicationFee, gatewayFee, platformRevenue } = calcApplicationFeeSplit(
      totalAmount,
      transactionFeePercent,
      (amount) =>
        this.subscriptionPlanConfig.calculatePaymentGatewayFee(amount, provider, paymentMethodType)
    );

    return {
      baseAmount: totalAmount,
      gatewayProcessingFee: gatewayFee,
      platformNetRevenue: platformRevenue,
      applicationFee,
    };
  }

  private isAutoDebitLease(lease: ILeaseDocument): boolean {
    return lease.fees?.acceptedPaymentMethod === 'auto-debit';
  }

  private isWithinLeaseTerm(lease: ILeaseDocument, dueDate: dayjs.Dayjs): boolean {
    const leaseStart = dayjs(lease.duration.startDate).startOf('day');
    const leaseEnd = (
      lease.duration.terminationDate
        ? dayjs(lease.duration.terminationDate)
        : dayjs(lease.duration.endDate)
    ).endOf('day');
    return !dueDate.isBefore(leaseStart) && !dueDate.isAfter(leaseEnd);
  }

  /**
   * Weekly cron (Sunday): queue rent for leases due within the next 7 days. Auto-debit leases
   * look further ahead (PAD notice period + a week) so their invoice exists before the
   * pre-debit notice must be sent.
   */
  private async queueWeeklyRentInvoices(): Promise<void> {
    const today = dayjs().startOf('day');

    // Page through every active lease — list() caps a single query at 1000 rows.
    // This cron only writes payments, never leases, so the pages stay stable.
    const BATCH_SIZE = 500;
    let page = 1;
    let hasMore = true;
    let totalLeases = 0;
    let queued = 0;
    const onlinePaymentsEnabled = new Map<string, boolean>();

    while (hasMore) {
      const { items: leases } = await this.leaseDAO.list(
        { status: LeaseStatus.ACTIVE, deletedAt: null },
        { limit: BATCH_SIZE, skip: (page - 1) * BATCH_SIZE }
      );

      for (const lease of leases) {
        try {
          const windowEnd = today.add(
            this.isAutoDebitLease(lease) ? this.padNoticeDays + AUTO_DEBIT_EXTRA_LEAD_DAYS : 7,
            'day'
          );
          const candidates = [
            rentDueDateForMonth(today, lease.fees.rentDueDay),
            rentDueDateForMonth(today.add(1, 'month'), lease.fees.rentDueDay),
          ].filter(
            (due) =>
              !due.isBefore(today) && !due.isAfter(windowEnd) && this.isWithinLeaseTerm(lease, due)
          );

          for (const dueDayjs of candidates) {
            if (await this.queueRentForPeriod(lease, dueDayjs, onlinePaymentsEnabled, 'Weekly')) {
              queued++;
            }
          }
        } catch (error) {
          this.log.error(
            { error, leaseId: lease._id },
            'Weekly rent invoice: error processing lease'
          );
        }
      }

      totalLeases += leases.length;
      hasMore = leases.length === BATCH_SIZE;
      page++;
    }

    this.log.info({ queued, total: totalLeases }, 'Weekly rent invoice queue complete');
  }

  /**
   * Daily cron: safety net ensuring every active lease has a rent record for the current
   * month once its due date arrives (and ahead of the PAD notice period for auto-debit leases).
   * A period that already has a record — of any status — is never regenerated here; FAILED
   * records are only surfaced to the property manager. Re-billing is an explicit PM action.
   */
  private async queueDailySafetyNetInvoices(): Promise<void> {
    const today = dayjs().startOf('day');

    // Page through every active lease — list() caps a single query at 1000 rows.
    // This cron only writes payments, never leases, so the pages stay stable.
    const BATCH_SIZE = 500;
    let page = 1;
    let hasMore = true;
    let totalLeases = 0;
    let queued = 0;
    const onlinePaymentsEnabled = new Map<string, boolean>();

    while (hasMore) {
      const { items: leases } = await this.leaseDAO.list(
        { status: LeaseStatus.ACTIVE, deletedAt: null },
        { limit: BATCH_SIZE, skip: (page - 1) * BATCH_SIZE }
      );

      for (const lease of leases) {
        try {
          const windowEnd = today.add(
            this.isAutoDebitLease(lease) ? this.padNoticeDays + 1 : 1,
            'day'
          );
          const thisMonthDue = rentDueDateForMonth(today, lease.fees.rentDueDay);
          const nextMonthDue = rentDueDateForMonth(today.add(1, 'month'), lease.fees.rentDueDay);
          const candidates = [
            // This month's rent, even if its due date already passed
            ...(thisMonthDue.isAfter(windowEnd) ? [] : [thisMonthDue]),
            ...(nextMonthDue.isAfter(windowEnd) ? [] : [nextMonthDue]),
          ].filter((due) => this.isWithinLeaseTerm(lease, due));

          for (const dueDayjs of candidates) {
            if (
              await this.queueRentForPeriod(
                lease,
                dueDayjs,
                onlinePaymentsEnabled,
                'Daily safety net'
              )
            ) {
              queued++;
            }
          }
        } catch (error) {
          this.log.error({ error, leaseId: lease._id }, 'Daily safety net: error processing lease');
        }
      }

      totalLeases += leases.length;
      hasMore = leases.length === BATCH_SIZE;
      page++;
    }

    this.log.info({ queued, total: totalLeases }, 'Daily rent invoice safety net complete');
  }

  /**
   * Creates (or queues) the rent record for one lease period unless the period already has a
   * non-deleted record of any status. Returns true when something was queued.
   */
  private async queueRentForPeriod(
    lease: ILeaseDocument,
    dueDayjs: dayjs.Dayjs,
    onlinePaymentsEnabled: Map<string, boolean>,
    context: string
  ): Promise<boolean> {
    const dueDate = dueDayjs.toDate();
    const period = { month: dueDayjs.month() + 1, year: dueDayjs.year() };
    const existing = await this.paymentDAO.findByPeriod(
      lease.cuid,
      lease._id.toString(),
      period.month,
      period.year
    );
    if (existing) {
      if (existing.status === PaymentRecordStatus.FAILED) {
        await this.surfaceFailedRentPayment(existing);
      }
      return false;
    }

    if (this.isAutoDebitLease(lease)) {
      if (!onlinePaymentsEnabled.has(lease.cuid)) {
        const lClient = await this.clientDAO.getClientByCuid(lease.cuid);
        onlinePaymentsEnabled.set(
          lease.cuid,
          lClient?.settings?.tenantFeatures?.onlinePayments !== false
        );
      }
      if (!onlinePaymentsEnabled.get(lease.cuid)) {
        this.log.info(
          { leaseId: lease._id, cuid: lease.cuid },
          `${context} rent invoice skipped: online payments disabled for client`
        );
        return false;
      }

      const paymentQueue = this.queueFactory.getQueue('paymentQueue') as PaymentQueue;
      await paymentQueue.addCreateRentInvoiceJob({
        cuid: lease.cuid,
        leaseId: lease.luid,
        tenantId: lease.tenantId.toString(),
        period,
        dueDate,
        paymentType: PaymentRecordType.RENT,
      });
      return true;
    }

    const { totalMonthlyRent } = computeLeaseMonthlyFees(lease);
    await this.createManualTrackingPayment({
      cuid: lease.cuid,
      tenantId: lease.tenantId.toString(),
      dueDate,
      baseAmount: totalMonthlyRent,
      paymentType: PaymentRecordType.RENT,
      paymentMethod: this.mapLeasePaymentMethod(lease.fees?.acceptedPaymentMethod),
      leaseId: lease._id.toString(),
      period,
      currency: lease.fees?.currency,
      paymentSource: 'cron',
      acceptedPaymentMethod: lease.fees?.acceptedPaymentMethod,
    });
    return true;
  }

  /** Tells the PM (once) about a failed rent record; the record itself is left for PM action. */
  private async surfaceFailedRentPayment(payment: IPaymentDocument): Promise<void> {
    if (payment.isManualEntry || payment.failure?.pmNotifiedAt) return;

    this.emitterService.emit(EventTypes.PAYMENT_FAILED, {
      cuid: payment.cuid,
      pytuid: payment.pytuid,
      invoiceId: payment.gatewayPaymentId ?? payment.pytuid,
      amount: payment.baseAmount,
      currency: payment.currency,
      failureReason: payment.failure?.reason,
      tenantId: payment.tenant?.toString(),
      hostedInvoiceUrl: payment.receipt?.url,
    });
    await this.paymentDAO.updateById(payment._id.toString(), {
      'failure.pmNotifiedAt': dayjs().toDate(),
    });
  }

  /**
   * Daily cron (1 AM client time): flip PENDING → OVERDUE for payments whose due date is before
   * the client's local "today". For rent past the lease's grace period, adds the late fee.
   * PM-recorded (manual) entries are never touched.
   */
  private async markOverduePayments(timezone?: string): Promise<void> {
    try {
      const cuidFilter = await this.buildCuidFilter(timezone);
      const startOfLocalToday = localCalendarDay(new Date(), timezone ?? 'UTC');
      const BATCH_SIZE = 500;
      let page = 1;
      let hasMore = true;
      let lateFeesAdded = 0;
      let markedOverdue = 0;
      const lateAutoDebitRent: IPaymentDocument[] = [];

      // Page through every past-due payment — list() returns 20 rows unless given a limit.
      // Statuses only move between PENDING and OVERDUE here, so the result set stays stable.
      while (hasMore) {
        const { items: batch } = await this.paymentDAO.findOverduePayments(
          { ...cuidFilter, isManualEntry: { $ne: true } },
          { limit: BATCH_SIZE, skip: (page - 1) * BATCH_SIZE },
          startOfLocalToday
        );

        // Stripe-invoiced auto-debit payments are charged by the auto-charge cron; their late
        // fee is a separate charge, queued after paging so new records don't shift the pages.
        const isStripeInvoiced = (p: IPaymentDocument) => !!p.gatewayPaymentId && !p.isManualEntry;
        const trackedPayments = batch.filter((p) => !p.isManualEntry && !isStripeInvoiced(p));
        lateAutoDebitRent.push(
          ...batch.filter((p) => isStripeInvoiced(p) && p.paymentType === PaymentRecordType.RENT)
        );
        lateFeesAdded += await this.addDueLateFees(trackedPayments, startOfLocalToday);
        markedOverdue += await this.markPendingAsOverdue(trackedPayments);

        hasMore = batch.length === BATCH_SIZE;
        page++;
      }

      lateFeesAdded += await this.queueAutoDebitLateFees(lateAutoDebitRent, startOfLocalToday);

      this.log.info({ markedOverdue, lateFeesAdded }, '[Cron] Marked overdue payments complete');
    } catch (error: any) {
      this.log.error({ error: error.message }, '[Cron] Failed to mark overdue payments');
    }
  }

  private daysLate(dueDate: Date, startOfLocalToday: Date): number {
    return Math.max(
      0,
      Math.round((startOfLocalToday.getTime() - utcCalendarDay(dueDate).getTime()) / DAY_MS)
    );
  }

  /**
   * Adds the lease's late fee to past-due rent once it is late enough. Checked on every run —
   * not only the run that first marks the payment overdue — because the lease's late-fee
   * threshold (lateFeeDays, default 5) is usually reached days after the due date.
   */
  private async addDueLateFees(
    payments: IPaymentDocument[],
    startOfLocalToday: Date
  ): Promise<number> {
    let added = 0;
    for (const payment of payments) {
      if (
        payment.paymentType !== PaymentRecordType.RENT ||
        !payment.lease ||
        !payment.dueDate ||
        payment.lineItems?.some((li: { description: string }) =>
          li.description.toLowerCase().includes('late fee')
        )
      ) {
        continue;
      }

      try {
        const lease = await this.leaseDAO.findFirst({ _id: payment.lease, deletedAt: null });
        if (!lease) continue;

        const daysLate = this.daysLate(payment.dueDate, startOfLocalToday);
        const fees = lease.calculateFees({ daysLate });
        if (fees.late.fee > 0) {
          await this.paymentDAO.updateById(payment._id.toString(), {
            $push: { lineItems: { description: 'Late Fee', amountInCents: fees.late.fee } },
            $inc: { baseAmount: fees.late.fee },
          });
          added++;
          this.log.info(
            { pytuid: payment.pytuid, lateFee: fees.late.fee, daysLate },
            '[Cron] Late fee added to rent payment'
          );
        }
      } catch (err) {
        this.log.warn({ err, pytuid: payment.pytuid }, '[Cron] Failed to add late fee');
      }
    }
    return added;
  }

  /**
   * Auto-debit rent is a finalized Stripe invoice, so its late fee can't be added as a line item.
   * Once the lease's late-fee threshold is reached, queue a separate LATE_FEE payment for the
   * same period through the rent invoice job (the worker creates it via createRentPayment, which
   * builds the late-fee invoice). The auto-charge-overdue-maintenance cron then charges it.
   */
  private async queueAutoDebitLateFees(
    rentPayments: IPaymentDocument[],
    startOfLocalToday: Date
  ): Promise<number> {
    let queued = 0;
    for (const payment of rentPayments) {
      if (!payment.lease || !payment.dueDate || !payment.period) continue;

      try {
        const lease = await this.leaseDAO.findFirst({ _id: payment.lease, deletedAt: null });
        if (!lease) continue;

        const daysLate = this.daysLate(payment.dueDate, startOfLocalToday);
        if (lease.calculateFees({ daysLate }).late.fee <= 0) continue;

        // createRentPayment allows one late fee per lease and period — don't queue a job it rejects
        const existingLateFee = await this.paymentDAO.findFirst({
          lease: lease._id,
          paymentType: PaymentRecordType.LATE_FEE,
          'period.month': payment.period.month,
          'period.year': payment.period.year,
          deletedAt: null,
        });
        if (existingLateFee) continue;

        const paymentQueue = this.queueFactory.getQueue('paymentQueue') as PaymentQueue;
        await paymentQueue.addCreateRentInvoiceJob({
          cuid: payment.cuid,
          leaseId: lease.luid,
          tenantId: lease.tenantId.toString(),
          period: payment.period,
          // The rent's due date, so the fee is calculated on (and charged as) days past it
          dueDate: payment.dueDate,
          paymentType: PaymentRecordType.LATE_FEE,
          description: `Late fee for ${payment.period.month}/${payment.period.year}`,
        });
        queued++;
        this.log.info(
          { pytuid: payment.pytuid, daysLate },
          '[Cron] Late fee queued for auto-debit rent payment'
        );
      } catch (err) {
        this.log.warn({ err, pytuid: payment.pytuid }, '[Cron] Failed to queue late fee');
      }
    }
    return queued;
  }

  /** Flips PENDING past-due payments to OVERDUE and notifies the tenant. */
  private async markPendingAsOverdue(payments: IPaymentDocument[]): Promise<number> {
    const pendingPayments = payments.filter((p) => p.status === PaymentRecordStatus.PENDING);
    let marked = 0;

    for (const payment of pendingPayments) {
      // Conditional on PENDING so a payment settled meanwhile is never flipped back
      const updated = await this.paymentDAO.update(
        { _id: payment._id, status: PaymentRecordStatus.PENDING, deletedAt: null },
        {
          $set: {
            status: PaymentRecordStatus.OVERDUE,
            overdueAt: new Date(),
          },
        }
      );
      if (!updated) continue;
      marked++;

      this.emitterService.emit(EventTypes.PAYMENT_OVERDUE, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        dueDate: payment.dueDate,
        amount: payment.baseAmount,
        currency: payment.currency,
        paymentType: payment.paymentType,
        tenantId: payment.tenant?.toString(),
      });

      // SMS notification to tenant
      if (payment.tenant) {
        this.smsService
          .sendToUser(
            payment.cuid,
            payment.tenant.toString(),
            'Your payment is overdue. Please make payment as soon as possible.',
            SMSMessageType.SYSTEM
          )
          .catch((err: any) => {
            this.log.warn({ err }, 'SMS send failed (fire-and-forget)');
          });
      }
    }
    return marked;
  }

  /**
   * Pages through every payment matching `filter`, ordered by _id. Uses an _id cursor instead
   * of skip so records whose status changes while being processed don't shift the pages.
   */
  private async *iteratePaymentBatches(
    filter: Record<string, any>,
    batchSize = AUTO_CHARGE_BATCH_SIZE
  ): AsyncGenerator<IPaymentDocument[]> {
    let lastId: Types.ObjectId | undefined;
    while (true) {
      const { items } = await this.paymentDAO.list(
        lastId ? { ...filter, _id: { $gt: lastId } } : filter,
        { limit: batchSize, sort: { _id: 1 } }
      );
      if (!items.length) return;
      yield items;
      if (items.length < batchSize) return;
      lastId = items[items.length - 1]._id;
    }
  }

  private async getProcessor(
    cuid: string,
    cache: Map<string, { accountId?: string; chargesEnabled?: boolean } | null>
  ): Promise<{ accountId?: string; chargesEnabled?: boolean } | null> {
    if (!cache.has(cuid)) {
      const processor = await this.paymentProcessorDAO.findFirst({ cuid });
      cache.set(cuid, processor ?? null);
    }
    return cache.get(cuid) ?? null;
  }

  /**
   * Resolves how the tenant will be charged — the same saved method payPendingChargeInternal
   * uses (tenantInfo.paymentMethods / paymentMandates for the PM's Connect account).
   * A Canadian pre-authorized debit (ACSS) is subject to the PAD advance-notice rule.
   */
  private async resolveTenantChargeMethod(
    payment: IPaymentDocument,
    processorCache: Map<string, { accountId?: string; chargesEnabled?: boolean } | null>
  ): Promise<ITenantChargeMethod> {
    const tenantProfile = payment.tenant
      ? await this.profileDAO.findFirst({ _id: payment.tenant })
      : null;
    const tenantUserId = tenantProfile?.user?.toString();
    const processor = await this.getProcessor(payment.cuid, processorCache);
    if (!tenantProfile || !processor?.accountId) {
      return { tenantUserId, isBankDebit: false, isPadDebit: false };
    }

    const paymentMethodId = tenantProfile.tenantInfo?.paymentMethods?.get(processor.accountId);
    const mandateId = tenantProfile.tenantInfo?.paymentMandates?.get(processor.accountId);

    let methodType: string | undefined;
    let accountLast4: string | undefined;
    if (paymentMethodId) {
      const result = await this.paymentGatewayService.retrievePaymentMethod(
        IPaymentGatewayProvider.STRIPE,
        paymentMethodId
      );
      if (result.success && result.data) {
        methodType = result.data.type;
        accountLast4 = result.data.last4;
      }
    }

    // Unknown type with a mandate on file — assume a bank debit so the notice rule still applies
    const isPadDebit = methodType === 'acss_debit' || (!methodType && !!mandateId);
    return {
      isBankDebit: isPadDebit || (!!methodType && BANK_DEBIT_METHOD_TYPES.has(methodType)),
      paymentMethodId: paymentMethodId || undefined,
      mandateId: mandateId || undefined,
      tenantUserId,
      accountLast4,
      methodType,
      isPadDebit,
    };
  }

  /**
   * PAD rule (Payments Canada H1): a bank debit may only be initiated once the pre-debit notice
   * was sent at least N calendar days earlier (client timezone). Sends the notice when missing.
   * Returns true when the debit may go ahead now.
   */
  private async isPadDebitAllowed(
    payment: IPaymentDocument,
    method: ITenantChargeMethod,
    timezone: string
  ): Promise<boolean> {
    if (!method.isPadDebit) return true;

    if (!payment.padNoticeSentAt) {
      await this.sendPadPreDebitNotice(payment, method, timezone);
      return false;
    }

    const noticeDay = localCalendarDay(payment.padNoticeSentAt, timezone);
    const today = localCalendarDay(new Date(), timezone);
    const daysSinceNotice = Math.round((today.getTime() - noticeDay.getTime()) / DAY_MS);
    if (daysSinceNotice < this.padNoticeDays) {
      this.log.info(
        { pytuid: payment.pytuid, cuid: payment.cuid, daysSinceNotice },
        '[Cron] PAD notice period not elapsed — debit deferred'
      );
      return false;
    }
    return true;
  }

  /**
   * Records and emits the PAD pre-debit notice. The debit date is the later of the due date and
   * N days from today. Claimed atomically so the notice is sent once per payment.
   */
  private async sendPadPreDebitNotice(
    payment: IPaymentDocument,
    method: ITenantChargeMethod,
    timezone: string
  ): Promise<boolean> {
    const now = new Date();
    const earliestDebitDay = dayjs(localCalendarDay(now, timezone))
      .add(this.padNoticeDays, 'day')
      .toDate();
    const dueDay = utcCalendarDay(payment.dueDate);
    const debitDate = dueDay > earliestDebitDay ? dueDay : earliestDebitDay;

    const claimed = await this.paymentDAO.update(
      { _id: payment._id, padNoticeSentAt: null, deletedAt: null },
      { $set: { padNoticeSentAt: now } }
    );
    if (!claimed) return false;

    this.emitterService.emit(EventTypes.PAD_PRE_DEBIT_NOTIFICATION, {
      cuid: payment.cuid,
      pytuid: payment.pytuid,
      tenantId: method.tenantUserId ?? payment.tenant?.toString(),
      amount: payment.baseAmount,
      currency: payment.currency,
      debitDate,
      paymentType: payment.paymentType,
      ...(method.accountLast4 && { accountLast4: method.accountLast4 }),
      ...(method.mandateId && { mandateReference: method.mandateId }),
    });
    this.log.info(
      { pytuid: payment.pytuid, cuid: payment.cuid, debitDate },
      '[Cron] PAD pre-debit notice sent'
    );
    return true;
  }

  /**
   * Daily cron (5 AM client time): sends the PAD pre-debit notice for every upcoming charge the
   * auto-charge crons will debit from a Canadian bank account (rent, maintenance, late fees).
   */
  private async sendPadPreDebitNotices(timezone?: string): Promise<void> {
    const tz = timezone ?? 'UTC';
    const cuidFilter = await this.buildCuidFilter(timezone);
    // One extra day so the notice goes out no later than N days before the due date
    const noticeHorizon = dayjs(localCalendarDay(new Date(), tz))
      .add(this.padNoticeDays + 1, 'day')
      .toDate();

    const filter = {
      status: { $in: CHARGEABLE_STATUSES },
      isManualEntry: { $ne: true },
      vendorId: { $exists: false },
      gatewayChargeId: { $exists: false },
      padNoticeSentAt: null,
      dueDate: { $lt: noticeHorizon },
      'dispute.status': { $nin: OPEN_DISPUTE_STATUSES },
      deletedAt: null,
      $or: [
        {
          paymentType: { $in: INVOICED_AUTO_CHARGE_TYPES },
          gatewayPaymentId: { $exists: true, $ne: null },
        },
        { paymentType: { $in: [PaymentRecordType.MAINTENANCE, PaymentRecordType.LATE_FEE] } },
      ],
      ...cuidFilter,
    };

    const processorCache = new Map<string, { accountId?: string } | null>();
    const onlinePaymentsEnabled = new Map<string, boolean>();
    let sent = 0;
    let checked = 0;

    for await (const batch of this.iteratePaymentBatches(filter)) {
      for (const payment of batch) {
        checked++;
        try {
          if (!(await this.isOnlinePaymentsEnabled(payment.cuid, onlinePaymentsEnabled))) continue;
          const method = await this.resolveTenantChargeMethod(payment, processorCache);
          if (!method.isPadDebit) continue;
          if (await this.sendPadPreDebitNotice(payment, method, tz)) sent++;
        } catch (err: any) {
          this.log.error(
            { err: err?.message, pytuid: payment.pytuid },
            '[Cron] Failed to send PAD pre-debit notice'
          );
        }
      }
    }

    this.log.info({ sent, checked, timezone: tz }, '[Cron] PAD pre-debit notices complete');
  }

  private async isOnlinePaymentsEnabled(
    cuid: string,
    cache: Map<string, boolean>
  ): Promise<boolean> {
    if (!cache.has(cuid)) {
      const client = await this.clientDAO.getClientByCuid(cuid);
      cache.set(cuid, client?.settings?.tenantFeatures?.onlinePayments !== false);
    }
    return cache.get(cuid) ?? true;
  }

  /**
   * Daily cron (10 AM client time): auto-charges tenant for non-rent charges past their grace
   * period. Bank (ACSS) debits wait for the PAD notice period.
   */
  private async autoChargeOverdueMaintenancePayments(timezone?: string): Promise<void> {
    const tz = timezone ?? 'UTC';
    const cuidFilter = await this.buildCuidFilter(timezone);
    const filter = {
      status: { $in: CHARGEABLE_STATUSES },
      paymentType: { $in: [PaymentRecordType.MAINTENANCE, PaymentRecordType.LATE_FEE] },
      isManualEntry: false,
      vendorId: { $exists: false },
      gatewayChargeId: { $exists: false },
      dueDate: { $lt: new Date() },
      'dispute.status': { $nin: OPEN_DISPUTE_STATUSES },
      deletedAt: null,
      ...cuidFilter,
    };

    const processorCache = new Map<string, { accountId?: string } | null>();
    const totals = { charged: 0, failed: 0, deferred: 0, total: 0 };

    for await (const batch of this.iteratePaymentBatches(filter)) {
      totals.total += batch.length;
      const result = await this.processAutoChargePayments(batch, 'maintenance', async (payment) => {
        const method = await this.resolveTenantChargeMethod(payment, processorCache);
        if (!method.tenantUserId) {
          this.log.warn(
            { pytuid: payment.pytuid },
            '[Cron] Skipping auto-charge: tenant profile not found'
          );
          return 'skipped';
        }
        if (!(await this.isPadDebitAllowed(payment, method, tz))) return 'deferred';

        // Attempt the charge BEFORE mutating the payment record.
        // This prevents a state where paymentMethod is updated but the charge never succeeds.
        await this.payPendingChargeInternal(payment, method.tenantUserId);

        await this.markChargeSubmitted(payment, {
          paymentMethod: method.isBankDebit ? PaymentMethod.BANK_TRANSFER : PaymentMethod.ONLINE,
          ...(method.methodType && { stripePaymentMethodType: method.methodType }),
        });
        return 'charged';
      });
      totals.charged += result.charged;
      totals.failed += result.failed;
      totals.deferred += result.deferred;
    }

    this.log.info(totals, '[Cron] Auto-charge overdue maintenance payments complete');
  }

  /**
   * Daily cron (6 AM client time): triggers Stripe collection for rent whose due date (a calendar
   * day) has arrived in the client's timezone. Every unpaid split invoice is paid. Bank (ACSS)
   * debits wait for the PAD notice period.
   */
  private async autoChargeDueRentPayments(timezone?: string): Promise<void> {
    const tz = timezone ?? 'UTC';
    const cuidFilter = await this.buildCuidFilter(timezone);
    const startOfLocalTomorrow = dayjs(localCalendarDay(new Date(), tz)).add(1, 'day').toDate();
    const filter = {
      paymentType: { $in: INVOICED_AUTO_CHARGE_TYPES },
      status: { $in: CHARGEABLE_STATUSES },
      isManualEntry: false,
      gatewayPaymentId: { $exists: true, $ne: null },
      gatewayChargeId: { $exists: false },
      dueDate: { $lt: startOfLocalTomorrow },
      'dispute.status': { $nin: OPEN_DISPUTE_STATUSES },
      deletedAt: null,
      ...cuidFilter,
    };

    const processorCache = new Map<string, { accountId?: string } | null>();
    const totals = { charged: 0, failed: 0, deferred: 0, total: 0 };

    for await (const batch of this.iteratePaymentBatches(filter)) {
      totals.total += batch.length;
      const result = await this.processAutoChargePayments(batch, 'rent', async (payment) => {
        const processor = await this.getProcessor(payment.cuid, processorCache);
        if (!processor?.accountId) {
          this.log.warn(
            { cuid: payment.cuid },
            '[Cron] Skipping rent auto-charge: no payment processor configured'
          );
          return 'skipped';
        }

        const method = await this.resolveTenantChargeMethod(payment, processorCache);
        if (!(await this.isPadDebitAllowed(payment, method, tz))) return 'deferred';

        await this.payRentInvoices(payment);
        return 'charged';
      });
      totals.charged += result.charged;
      totals.failed += result.failed;
      totals.deferred += result.deferred;
    }

    this.log.info(totals, '[Cron] Auto-charge due rent payments complete');
  }

  /**
   * Pays the rent invoice — or every unpaid split invoice (rent + fees) — then marks the record
   * PROCESSING. Throws only when nothing could be charged, so the shared loop applies its
   * retry handling; splits that failed alongside a successful one are marked failed.
   */
  private async payRentInvoices(payment: IPaymentDocument): Promise<void> {
    const invoicesToPay = payment.splitInvoices?.length
      ? payment.splitInvoices
          .map((split, index) => ({ invoiceId: split.invoiceId, index, status: split.status }))
          .filter((split) => split.status !== 'paid')
      : [{ invoiceId: payment.gatewayPaymentId!, index: -1, status: 'pending' }];

    if (invoicesToPay.length === 0) {
      // Every split is already paid — hand the record to reconciliation to settle it
      await this.markChargeSubmitted(payment);
      return;
    }

    const failures: { index: number; message: string }[] = [];
    for (const { invoiceId, index } of invoicesToPay) {
      const payResult = await this.paymentGatewayService.payInvoice(
        IPaymentGatewayProvider.STRIPE,
        invoiceId
      );
      if (!payResult.success) {
        failures.push({ index, message: payResult.message || 'Failed to pay invoice' });
      }
    }

    if (failures.length === invoicesToPay.length) {
      // The gateway returns failures instead of throwing; rethrow so the shared loop
      // applies its retry / FAILED / ACSS-limit handling.
      throw new Error(failures[0].message);
    }

    const failedSplitUpdates = Object.fromEntries(
      failures
        .filter((failure) => failure.index >= 0)
        .map((failure) => [`splitInvoices.${failure.index}.status`, 'failed'])
    );
    if (failures.length) {
      this.log.warn(
        { pytuid: payment.pytuid, failures },
        '[Cron] Some split invoices could not be charged'
      );
    }

    await this.markChargeSubmitted(payment, {
      ...failedSplitUpdates,
      ...(failures.length && {
        'failure.reason': failures[0].message,
        'failure.lastFailedAt': new Date(),
      }),
    });
  }

  /** PENDING/OVERDUE → PROCESSING, only if the record is still unpaid (never overwrites PAID). */
  private async markChargeSubmitted(
    payment: IPaymentDocument,
    extraFields: Record<string, any> = {}
  ): Promise<void> {
    const updated = await this.paymentDAO.update(
      { _id: payment._id, status: { $in: CHARGEABLE_STATUSES }, deletedAt: null },
      {
        $set: {
          status: PaymentRecordStatus.PROCESSING,
          chargedAt: new Date(),
          ...extraFields,
        },
      }
    );
    if (!updated) {
      this.log.info(
        { pytuid: payment.pytuid },
        '[Cron] Payment status changed while charging — left as is'
      );
    }
  }

  /**
   * Shared auto-charge loop: checks onlinePayments, re-reads each payment so one settled
   * meanwhile (paid, cancelled, refunded, manually recorded) is never charged, and records
   * failures.
   */
  private async processAutoChargePayments(
    payments: IPaymentDocument[],
    context: string,
    chargePayment: (payment: IPaymentDocument) => Promise<AutoChargeOutcome>
  ): Promise<{ charged: number; failed: number; deferred: number }> {
    let charged = 0;
    let failed = 0;
    let deferred = 0;
    const onlinePaymentsEnabled = new Map<string, boolean>();

    for (const payment of payments) {
      try {
        if (!(await this.isOnlinePaymentsEnabled(payment.cuid, onlinePaymentsEnabled))) {
          this.log.info(
            { pytuid: payment.pytuid, cuid: payment.cuid },
            `[Cron] Skipping ${context} auto-charge: online payments disabled for client`
          );
          continue;
        }

        const current = await this.paymentDAO.findFirst({
          _id: payment._id,
          status: { $in: CHARGEABLE_STATUSES },
          isManualEntry: { $ne: true },
          gatewayChargeId: { $exists: false },
          deletedAt: null,
        });
        if (!current) {
          this.log.info(
            { pytuid: payment.pytuid },
            `[Cron] Skipping ${context} auto-charge: payment no longer open`
          );
          continue;
        }

        const outcome = await chargePayment(current);
        if (outcome === 'charged') charged++;
        else if (outcome === 'deferred') deferred++;
        else failed++;
      } catch (err: any) {
        await this.recordAutoChargeFailure(payment, err, context);
        failed++;
      }
    }

    return { charged, failed, deferred };
  }

  private async recordAutoChargeFailure(
    payment: IPaymentDocument,
    err: any,
    context: string
  ): Promise<void> {
    const failureReason: string = err?.message || 'Automatic charge failed';
    const stillOpen = {
      _id: payment._id,
      status: { $in: CHARGEABLE_STATUSES },
      deletedAt: null,
    };

    try {
      if (isAmountTooLargeError(err)) {
        const limitReason =
          'Bank debit failed: payment amount exceeds per-transaction limit. Card payment required.';
        this.log.warn(
          { pytuid: payment.pytuid, cuid: payment.cuid },
          `[Cron] ACSS per-txn limit exceeded — leaving ${context} payment open for card payment`
        );
        const alreadyNotified = !!payment.failure?.pmNotifiedAt;
        await this.paymentDAO.update(stillOpen, {
          $set: {
            'failure.reason': limitReason,
            'failure.lastFailedAt': new Date(),
            ...(!alreadyNotified && { 'failure.pmNotifiedAt': new Date() }),
          },
        });
        if (!alreadyNotified) this.emitPaymentFailed(payment, limitReason);
        return;
      }

      const newRetryCount = (payment.failure?.retryCount ?? 0) + 1;
      const exhausted = newRetryCount >= MAX_CHARGE_ATTEMPTS;

      this.log.error(
        {
          err: failureReason,
          pytuid: payment.pytuid,
          cuid: payment.cuid,
          newRetryCount,
          exhausted,
        },
        `[Cron] Failed to auto-charge ${context} payment`
      );

      if (exhausted) {
        await this.paymentDAO.update(stillOpen, {
          $set: {
            status: PaymentRecordStatus.FAILED,
            'failure.reason': failureReason,
            'failure.lastFailedAt': new Date(),
            'failure.retryCount': newRetryCount,
            'failure.pmNotifiedAt': new Date(),
          },
        });
        this.emitPaymentFailed(payment, failureReason);
      } else {
        await this.paymentDAO.update(stillOpen, {
          $set: {
            status: PaymentRecordStatus.OVERDUE,
            'failure.reason': failureReason,
            'failure.lastFailedAt': new Date(),
            'failure.retryCount': newRetryCount,
          },
        });
      }
    } catch (updateErr: any) {
      this.log.error(
        { err: updateErr?.message, pytuid: payment.pytuid },
        '[Cron] Failed to record auto-charge failure'
      );
    }
  }

  private emitPaymentFailed(payment: IPaymentDocument, failureReason: string): void {
    this.emitterService.emit(EventTypes.PAYMENT_FAILED, {
      cuid: payment.cuid,
      pytuid: payment.pytuid,
      invoiceId: payment.gatewayPaymentId ?? '',
      amount: payment.baseAmount,
      currency: payment.currency,
      failureReason,
      tenantId: payment.tenant?.toString(),
      hostedInvoiceUrl: payment.receipt?.url,
    });
  }

  /**
   * Internal helper: pays a pending charge via Stripe for cron auto-charge paths.
   * Replicates the core logic of PaymentService.payPendingCharge for maintenance/late-fee charges.
   */
  private async payPendingChargeInternal(
    payment: IPaymentDocument,
    tenantUserId: string
  ): Promise<void> {
    const { cuid, pytuid } = payment;

    const tenantProfile = await this.profileDAO.findFirst({
      user: new Types.ObjectId(tenantUserId),
    });
    if (!tenantProfile) {
      throw new Error(`Tenant profile not found for userId ${tenantUserId}`);
    }

    const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
    if (!paymentProcessor?.accountId || !paymentProcessor.chargesEnabled) {
      throw new Error('Payment account not configured or not ready for charges');
    }

    const tenantCustomerId = tenantProfile.tenantInfo?.paymentGatewayCustomers?.get('platform');
    if (!tenantCustomerId) {
      throw new Error('No payment method on file for tenant');
    }

    const paymentMethodId = tenantProfile.tenantInfo?.paymentMethods?.get(
      paymentProcessor.accountId
    );
    if (!paymentMethodId) {
      throw new Error('No payment method on file for tenant at this PM account');
    }

    const mandateId = tenantProfile.tenantInfo?.paymentMandates?.get(paymentProcessor.accountId);

    const subscription = await this.subscriptionDAO.findFirst({ cuid, deletedAt: null });
    const transactionFeePercent = subscription
      ? this.subscriptionPlanConfig.getTransactionFeePercent(subscription.planName)
      : 0;
    const feeBreakdown = this.calculateRentFees(payment.baseAmount, transactionFeePercent);

    let activeInvoiceId = payment.gatewayPaymentId;

    if (!activeInvoiceId) {
      const { invoiceId, hostedInvoiceUrl: hostedUrl } = await this.createAndFinalizeInvoice({
        tenantCustomerId,
        connectedAccountId: paymentProcessor.accountId,
        applicationFee: feeBreakdown.applicationFee,
        currency: (payment.currency ?? 'USD').toLowerCase(),
        description: payment.description || `Maintenance charge ${pytuid}`,
        dueDate: dayjs().toDate(),
        lineItems: payment.lineItems?.length
          ? (payment.lineItems as { description: string; amountInCents: number }[])
          : [
              {
                description: payment.description || 'Maintenance charge',
                amountInCents: payment.baseAmount,
              },
            ],
        cuid,
        paymentMethodId,
        skipDestinationTransfer: payment.paymentType === PaymentRecordType.MAINTENANCE,
      });

      activeInvoiceId = invoiceId;

      await this.paymentDAO.updateById(payment._id.toString(), {
        gatewayPaymentId: activeInvoiceId,
        ...(hostedUrl && { 'receipt.url': hostedUrl }),
      });
    }

    const payResult = await this.paymentGatewayService.payInvoice(
      IPaymentGatewayProvider.STRIPE,
      activeInvoiceId!,
      { paymentMethod: paymentMethodId, ...(mandateId && { mandate: mandateId }) }
    );

    if (!payResult.success) {
      throw new Error(payResult.message || 'Failed to initiate payment');
    }

    this.log.info(
      { pytuid, cuid, invoiceId: activeInvoiceId, paymentType: payment.paymentType },
      '[PaymentCronService] Pending maintenance charge submitted for payment'
    );
  }

  /**
   * Twice-daily cron: flips fundsAvailable on maintenance invoices once the tenant's charge has
   * succeeded. Maintenance charges are platform charges (no destination transfer), and the
   * vendor transfer links to the tenant charge via source_transaction, so Stripe itself holds
   * the transfer until those funds settle — the PM's Connect balance is irrelevant here.
   */
  private async checkFundsAvailability(): Promise<void> {
    const invoices = await this.invoiceDAO.findPendingFundsCheck(500);

    if (invoices.length === 0) {
      this.log.info('[Cron] No invoices pending funds availability check');
      return;
    }

    let flipped = 0;
    let skipped = 0;

    for (const invoice of invoices) {
      try {
        const tenantCharge = await this.paymentDAO.findFirst({
          cuid: invoice.cuid,
          maintenanceRequestUid: invoice.mruid,
          paymentType: PaymentRecordType.MAINTENANCE,
          vendorId: { $exists: false },
          status: PaymentRecordStatus.PAID,
          gatewayChargeId: { $exists: true, $ne: null },
          deletedAt: null,
        });
        if (!tenantCharge) {
          skipped++;
          continue;
        }

        await this.invoiceDAO.updateById((invoice as any)._id.toString(), {
          $set: { fundsAvailable: true, fundsAvailableAt: new Date() },
        });

        const fundsPayload: MaintenanceFundsAvailablePayload = {
          amountInCents: invoice.amountInCents,
          invuid: invoice.invuid,
          mruid: invoice.mruid,
          cuid: invoice.cuid,
        };
        this.emitterService.emit(EventTypes.MAINTENANCE_FUNDS_AVAILABLE, fundsPayload);

        flipped++;
      } catch (err: any) {
        this.log.error(
          { err: err.message, cuid: invoice.cuid, invuid: invoice.invuid },
          '[Cron] Error checking funds availability for invoice'
        );
        skipped++;
      }
    }

    this.log.info(
      { flipped, skipped, total: invoices.length },
      '[Cron] Funds availability check complete'
    );
  }

  /**
   * Daily cron (noon UTC): auto-pay vendors whose approved invoices have had
   * settled funds for 5+ days without PM action. Calls the existing payVendor()
   * method which handles all guards, Stripe transfer, and notifications.
   */
  private async autoPayoutVendors(): Promise<void> {
    const invoices = await this.invoiceDAO.findReadyForAutoPayout(100);

    if (invoices.length === 0) {
      this.log.info('[Cron] No invoices ready for auto vendor payout');
      return;
    }

    let paid = 0;
    let failed = 0;

    for (const invoice of invoices) {
      const cuid = invoice.cuid;
      const mruid = invoice.mruid;

      if (!cuid || !mruid) {
        this.log.warn(
          { invuid: invoice.invuid },
          '[Cron] Invoice missing cuid or mruid — skipping'
        );
        failed++;
        continue;
      }

      try {
        await this.maintenancePaymentService.payVendor(cuid, mruid);
        paid++;

        // Notify finance staff — profile fetch is best-effort, payout already succeeded
        let vendorName = 'Unknown Vendor';
        try {
          const vendorProfile = await this.profileDAO.getProfileByUserId(
            invoice.submittedBy.toString()
          );
          vendorName = vendorProfile?.fullname || vendorName;
        } catch {
          this.log.warn(
            { cuid, mruid },
            '[Cron] Vendor profile fetch failed — using fallback name'
          );
        }

        this.emitterService.emit(EventTypes.MAINTENANCE_AUTO_VENDOR_PAID, {
          amountInCents: invoice.amountInCents,
          vendorName,
          mruid,
          cuid,
        });

        this.log.info(
          { cuid, mruid, invuid: invoice.invuid, amount: invoice.amountInCents },
          '[Cron] Auto vendor payout succeeded'
        );
      } catch (error: any) {
        failed++;
        this.log.error(
          { cuid, mruid, invuid: invoice.invuid, error: error.message },
          '[Cron] Auto vendor payout failed — continuing to next'
        );
      }
    }

    this.log.info(
      { paid, failed, total: invoices.length },
      '[Cron] Auto vendor payout run complete'
    );
  }

  /**
   * Daily cron (3 AM UTC): reconcile payments stuck in PROCESSING by checking their
   * Stripe invoice(s). Catches missed webhooks, voided invoices, and charges that never
   * completed. A split payment is PAID only when every split invoice is paid.
   */
  private async reconcileStaleProcessingPayments(): Promise<void> {
    const staleCutoff = dayjs().subtract(24, 'hour').toDate();
    const filter = {
      status: PaymentRecordStatus.PROCESSING,
      $or: [
        { chargedAt: { $lt: staleCutoff } },
        { chargedAt: { $exists: false }, dueDate: { $lt: staleCutoff } },
      ],
      gatewayPaymentId: { $exists: true },
      gatewayChargeId: { $exists: false },
      deletedAt: null,
    };

    const processorCache = new Map<string, { accountId?: string } | null>();
    const counts = { reconciled: 0, markedOverdue: 0, cancelled: 0, total: 0 };

    for await (const batch of this.iteratePaymentBatches(filter)) {
      for (const payment of batch) {
        counts.total++;
        try {
          // Skip if client has no payment processor — no point calling Stripe
          const processor = await this.getProcessor(payment.cuid, processorCache);
          if (!processor?.accountId) {
            this.log.debug(
              { cuid: payment.cuid },
              'Skipping reconciliation — no payment processor'
            );
            continue;
          }

          const outcome = await this.reconcileProcessingPayment(payment);
          if (outcome === 'paid') counts.reconciled++;
          else if (outcome === 'cancelled') counts.cancelled++;
          else if (outcome === 'overdue') counts.markedOverdue++;
        } catch (err) {
          this.log.error({ err, pytuid: payment.pytuid }, '[Cron] Failed to reconcile payment');
        }
      }
    }

    if (counts.total === 0) {
      this.log.info('[Cron] No stale PROCESSING payments to reconcile');
      return;
    }
    this.log.info(counts, '[Cron] Payment reconciliation complete');
  }

  private async fetchInvoiceOrThrow(invoiceId: string) {
    const result = await this.paymentGatewayService.getInvoice(
      IPaymentGatewayProvider.STRIPE,
      invoiceId
    );
    if (!result.success || !result.data) {
      throw new Error(result.message || `Failed to fetch invoice ${invoiceId}`);
    }
    return result.data;
  }

  private async fetchInvoicePaymentDetails(invoiceId: string) {
    const result = await this.paymentGatewayService.getInvoicePaymentDetails(
      IPaymentGatewayProvider.STRIPE,
      invoiceId
    );
    if (!result.success) {
      throw new Error(result.message || `Failed to fetch payment details for ${invoiceId}`);
    }
    return result.data ?? {};
  }

  private async reconcileProcessingPayment(
    payment: IPaymentDocument
  ): Promise<'paid' | 'cancelled' | 'overdue' | 'unchanged'> {
    const splits = payment.splitInvoices ?? [];
    const invoiceRefs = splits.length
      ? splits.map((split, index) => ({ invoiceId: split.invoiceId, index, known: split.status }))
      : [{ invoiceId: payment.gatewayPaymentId!, index: -1, known: 'pending' as const }];

    const states: {
      index: number;
      invoiceId: string;
      status: string | null;
      paidAt?: Date;
      hostedInvoiceUrl?: string;
    }[] = [];
    for (const ref of invoiceRefs) {
      if (ref.known === 'paid') {
        states.push({ index: ref.index, invoiceId: ref.invoiceId, status: 'paid' });
        continue;
      }
      const invoice = await this.fetchInvoiceOrThrow(ref.invoiceId);
      states.push({ index: ref.index, invoiceId: ref.invoiceId, ...invoice });
    }

    const stillOpen = { _id: payment._id, status: PaymentRecordStatus.PROCESSING, deletedAt: null };

    if (states.every((s) => s.status === 'paid')) {
      // Stripe charged successfully — webhook was missed
      const primaryInvoiceId = payment.gatewayPaymentId!;
      const paymentDetails = await this.fetchInvoicePaymentDetails(primaryInvoiceId);
      const primary = states.find((s) => s.invoiceId === primaryInvoiceId) ?? states[0];
      const paidAt = primary.paidAt ?? new Date();
      const receiptUrl = primary.hostedInvoiceUrl;

      const splitUpdates = Object.fromEntries(
        states
          .filter((s) => s.index >= 0 && splits[s.index]?.status !== 'paid')
          .flatMap((s) => [
            [`splitInvoices.${s.index}.status`, 'paid'],
            [`splitInvoices.${s.index}.paidAt`, s.paidAt ?? paidAt],
          ])
      );

      const updated = await this.paymentDAO.update(stillOpen, {
        $set: {
          status: PaymentRecordStatus.PAID,
          paidAt,
          ...(paymentDetails.chargeId && { gatewayChargeId: paymentDetails.chargeId }),
          ...(paymentDetails.paymentMethodType && {
            stripePaymentMethodType: paymentDetails.paymentMethodType,
          }),
          ...(receiptUrl && { 'receipt.url': receiptUrl }),
          ...splitUpdates,
        },
      });
      if (!updated) return 'unchanged';

      this.emitterService.emit(EventTypes.PAYMENT_SUCCEEDED, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        amount: payment.baseAmount,
        currency: payment.currency,
        invoiceId: primaryInvoiceId,
        tenantId: await this.resolveTenantUserId(payment),
        paidAt,
        paymentType: payment.paymentType,
        ...(receiptUrl && { receiptUrl }),
      });

      this.log.info(
        { pytuid: payment.pytuid, cuid: payment.cuid },
        '[Cron] Reconciled stale PROCESSING payment to PAID'
      );
      return 'paid';
    }

    if (states.every((s) => s.status === 'void')) {
      const updated = await this.paymentDAO.update(stillOpen, {
        $set: { status: PaymentRecordStatus.CANCELLED },
      });
      if (!updated) return 'unchanged';
      this.log.info({ pytuid: payment.pytuid }, '[Cron] Voided Stripe invoice — marked CANCELLED');
      return 'cancelled';
    }

    const failedSplitIndexes: number[] = [];
    let failureReason: string | undefined;
    let staleReason: string | undefined;

    for (const state of states) {
      if (state.status === 'uncollectible') {
        failedSplitIndexes.push(state.index);
        failureReason ??= 'Stripe invoice status: uncollectible';
      } else if (state.status === 'open') {
        // Open invoices may still be processing (ACSS/SEPA/Bacs bank debits can take days).
        // Check the underlying PaymentIntent before marking overdue.
        const details = await this.fetchInvoicePaymentDetails(state.invoiceId);
        if (details.lastPaymentError) {
          failedSplitIndexes.push(state.index);
          failureReason ??= `Stripe invoice open — payment failed${details.lastPaymentError.message ? `: ${details.lastPaymentError.message}` : ''}`;
          continue;
        }
        const isBankDebit =
          !!details.paymentMethodType && BANK_DEBIT_METHOD_TYPES.has(details.paymentMethodType);
        const staleAfterHours = isBankDebit
          ? BANK_DEBIT_PROCESSING_STALE_HOURS
          : CARD_PROCESSING_STALE_HOURS;
        const hoursStale = dayjs().diff(dayjs(payment.chargedAt ?? payment.dueDate), 'hour');
        if (hoursStale > staleAfterHours) {
          staleReason ??= `Stripe invoice open — not completed after ${staleAfterHours}+ hours`;
        }
      }
    }

    if (!failureReason && !staleReason) return 'unchanged';

    const updated = await this.paymentDAO.update(stillOpen, {
      $set: {
        status: PaymentRecordStatus.OVERDUE,
        'failure.reason': failureReason ?? staleReason,
        'failure.lastFailedAt': new Date(),
        ...Object.fromEntries(
          failedSplitIndexes
            .filter((index) => index >= 0)
            .map((index) => [`splitInvoices.${index}.status`, 'failed'])
        ),
      },
    });
    if (!updated) return 'unchanged';

    if (failureReason) {
      this.emitPaymentFailed(payment, failureReason);
    }
    this.log.warn(
      { pytuid: payment.pytuid, reason: failureReason ?? staleReason },
      '[Cron] Stale PROCESSING payment marked OVERDUE'
    );
    return 'overdue';
  }

  private async resolveTenantUserId(payment: IPaymentDocument): Promise<string | undefined> {
    if (!payment.tenant) return undefined;
    try {
      const profile = await this.profileDAO.findFirst({ _id: payment.tenant });
      return profile?.user?.toString() ?? payment.tenant.toString();
    } catch {
      return payment.tenant.toString();
    }
  }

  private async createAndFinalizeInvoice(opts: {
    tenantCustomerId: string;
    connectedAccountId: string;
    applicationFee: number;
    currency: string;
    description: string;
    dueDate: Date;
    lineItems: { description: string; amountInCents: number }[];
    cuid: string;
    paymentMethodId?: string;
    leaseUid?: string;
    skipDestinationTransfer?: boolean;
  }): Promise<{ invoiceId: string; hostedInvoiceUrl?: string }> {
    const invoiceResult = await this.paymentGatewayService.createInvoice(
      IPaymentGatewayProvider.STRIPE,
      {
        tenantCustomerId: opts.tenantCustomerId,
        connectedAccountId: opts.connectedAccountId,
        applicationFeeAmountInCents: opts.applicationFee,
        currency: opts.currency,
        description: opts.description,
        autoChargeDueDate: opts.dueDate,
        lineItems: opts.lineItems,
        cuid: opts.cuid,
        paymentMethodId: opts.paymentMethodId,
        leaseUid: opts.leaseUid,
        skipDestinationTransfer: opts.skipDestinationTransfer,
      }
    );
    if (!invoiceResult.success || !invoiceResult.data) {
      throw new Error(invoiceResult.message || 'Failed to create invoice');
    }

    const finalizeResult = await this.paymentGatewayService.finalizeInvoice(
      IPaymentGatewayProvider.STRIPE,
      invoiceResult.data.invoiceId
    );
    if (!finalizeResult.success) {
      throw new Error(finalizeResult.message || 'Failed to finalize invoice');
    }

    return {
      invoiceId: invoiceResult.data.invoiceId,
      hostedInvoiceUrl: finalizeResult.data?.hostedInvoiceUrl,
    };
  }

  private mapLeasePaymentMethod(acceptedPaymentMethod: string | undefined): PaymentMethod {
    switch (acceptedPaymentMethod) {
      case 'e-transfer':
        return PaymentMethod.BANK_TRANSFER;
      case 'check':
        return PaymentMethod.CHECK;
      case 'cash':
        return PaymentMethod.CASH;
      default:
        return PaymentMethod.OTHER;
    }
  }

  private async syncConnectAccountStatuses(): Promise<void> {
    this.log.info('Starting Stripe Connect account status sync');

    const processors = await this.paymentProcessorDAO.list(
      { accountId: { $exists: true, $ne: null }, deletedAt: null } as any,
      { limit: 10000 }
    );

    let synced = 0;
    let errors = 0;

    for (const proc of processors.items) {
      try {
        const result = await this.paymentGatewayService.getConnectAccount(
          IPaymentGatewayProvider.STRIPE,
          proc.accountId
        );
        if (!result.success || !result.data) continue;

        const account = result.data;
        const updates: Record<string, any> = {};

        if (proc.chargesEnabled !== (account.charges_enabled || false)) {
          updates.chargesEnabled = account.charges_enabled || false;
        }
        if (proc.payoutsEnabled !== (account.payouts_enabled || false)) {
          updates.payoutsEnabled = account.payouts_enabled || false;
        }
        if (proc.detailsSubmitted !== (account.details_submitted || false)) {
          updates.detailsSubmitted = account.details_submitted || false;
        }

        if (Object.keys(updates).length > 0) {
          await this.paymentProcessorDAO.update({ _id: proc._id }, { $set: updates });
          this.log.info({ accountId: proc.accountId, updates }, 'Connect status updated');
        }
        synced++;
      } catch (err: any) {
        this.log.warn({ err: err.message, accountId: proc.accountId }, 'Failed to sync account');
        errors++;
      }
    }

    this.log.info(
      { synced, errors, total: processors.items.length },
      'Connect status sync complete'
    );
  }
}

/**
 * The rent due date for the month containing `monthAnchor`. A rentDueDay past the end of a
 * short month (29–31) falls on that month's last day instead of rolling into the next month.
 */
export function rentDueDateForMonth(monthAnchor: dayjs.Dayjs, rentDueDay: number): dayjs.Dayjs {
  const monthStart = monthAnchor.startOf('month');
  return monthStart.date(Math.min(rentDueDay, monthStart.daysInMonth())).startOf('day');
}

/**
 * The client's local calendar date for `date`, as UTC midnight — the convention rent due dates
 * are stored in. Comparing stored due dates against this treats them as calendar days.
 */
export function localCalendarDay(date: Date, timeZone: string): Date {
  const { year, month, day } = getLocalDateParts(date, timeZone);
  return new Date(Date.UTC(year, month - 1, day));
}

function getLocalDateParts(
  date: Date,
  timeZone: string
): { year: number; month: number; day: number; hour: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(date);
  } catch {
    return getLocalDateParts(date, 'UTC');
  }
  const valueOf = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: valueOf('year'),
    month: valueOf('month'),
    day: valueOf('day'),
    hour: valueOf('hour') % 24,
  };
}

function isAmountTooLargeError(err: any): boolean {
  if (err?.code === 'amount_too_large' || err?.raw?.code === 'amount_too_large') return true;
  const message = (err?.message ?? '').toLowerCase();
  if (/amount[_ ]too[_ ]large/.test(message)) return true;
  return (
    message.includes('acss_debit') &&
    /(exceeds|maximum|no more than|per-transaction limit|transaction limit)/.test(message)
  );
}

function utcCalendarDay(date: Date): Date {
  return dayjs.utc(date).startOf('day').toDate();
}
