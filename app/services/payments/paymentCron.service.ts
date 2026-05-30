import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { InvoiceDAO } from '@dao/invoiceDAO';
import { QueueFactory } from '@services/queue';
import { NotFoundError } from '@shared/customErrors';
import { PaymentQueue } from '@queues/payment.queue';
import { EventEmitterService } from '@services/eventEmitter';
import { SubscriptionPlanConfig } from '@services/subscription';
import { MAX_CHARGE_ATTEMPTS, createLogger } from '@utils/index';
import { calcApplicationFeeSplit } from '@utils/financial.utils';
import { ICronProvider, ICronJob } from '@interfaces/cron.interface';
import { computeLeaseMonthlyFees } from '@services/lease/leaseHelpers';
import { StripeService } from '@services/external/stripe/stripe.service';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
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
  PaymentMethod,
  PaymentSource,
  LeaseStatus,
} from '@interfaces/index';

interface IConstructor {
  subscriptionPlanConfig: SubscriptionPlanConfig;
  paymentGatewayService: PaymentGatewayService;
  paymentProcessorDAO: PaymentProcessorDAO;
  emitterService: EventEmitterService;
  subscriptionDAO: SubscriptionDAO;
  stripeService: StripeService;
  queueFactory: QueueFactory;
  invoiceDAO: InvoiceDAO;
  profileDAO: ProfileDAO;
  paymentDAO: PaymentDAO;
  clientDAO: ClientDAO;
  leaseDAO: LeaseDAO;
}

export class PaymentCronService implements ICronProvider {
  private readonly log: Logger;
  private readonly paymentGatewayService: PaymentGatewayService;
  private readonly paymentProcessorDAO: PaymentProcessorDAO;
  private readonly subscriptionPlanConfig: SubscriptionPlanConfig;
  private readonly emitterService: EventEmitterService;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly stripeService: StripeService;
  private readonly invoiceDAO: InvoiceDAO;
  private readonly queueFactory: QueueFactory;
  private readonly profileDAO: ProfileDAO;
  private readonly paymentDAO: PaymentDAO;
  private readonly clientDAO: ClientDAO;
  private readonly leaseDAO: LeaseDAO;

  constructor({
    paymentGatewayService,
    paymentProcessorDAO,
    subscriptionPlanConfig,
    emitterService,
    subscriptionDAO,
    stripeService,
    invoiceDAO,
    queueFactory,
    profileDAO,
    paymentDAO,
    clientDAO,
    leaseDAO,
  }: IConstructor) {
    this.log = createLogger('PaymentCronService');
    this.paymentGatewayService = paymentGatewayService;
    this.paymentProcessorDAO = paymentProcessorDAO;
    this.subscriptionPlanConfig = subscriptionPlanConfig;
    this.emitterService = emitterService;
    this.subscriptionDAO = subscriptionDAO;
    this.stripeService = stripeService;
    this.invoiceDAO = invoiceDAO;
    this.queueFactory = queueFactory;
    this.profileDAO = profileDAO;
    this.paymentDAO = paymentDAO;
    this.clientDAO = clientDAO;
    this.leaseDAO = leaseDAO;
  }

  async getCronJobs(): Promise<ICronJob[]> {
    // Non-time-sensitive jobs — fixed UTC is fine
    const utcJobs: ICronJob[] = [
      {
        name: 'payment.weekly-rent-invoices',
        schedule: '0 0 * * 0',
        handler: this.queueWeeklyRentInvoices.bind(this),
        enabled: true,
        service: 'PaymentCronService',
        description: 'Queue rent invoice creation for leases due in the upcoming week',
        timeout: 600000,
      },
      {
        name: 'payment.daily-rent-safety-net',
        schedule: '0 9 * * *',
        handler: this.queueDailySafetyNetInvoices.bind(this),
        enabled: true,
        service: 'PaymentCronService',
        description:
          'Queue rent invoices for leases due today or tomorrow (catches any missed by weekly job)',
        timeout: 300000,
      },
      {
        name: 'payment.check-funds-availability-morning',
        schedule: '0 6 * * *',
        handler: this.checkFundsAvailability.bind(this),
        enabled: true,
        service: 'PaymentCronService',
        description:
          'Check Stripe Connect balance and flip fundsAvailable on settled maintenance invoices (morning run)',
        timeout: 300000,
      },
      {
        name: 'payment.check-funds-availability-evening',
        schedule: '0 22 * * *',
        handler: this.checkFundsAvailability.bind(this),
        enabled: true,
        service: 'PaymentCronService',
        description:
          'Check Stripe Connect balance and flip fundsAvailable on settled maintenance invoices (evening run)',
        timeout: 300000,
      },
    ];

    // Time-sensitive jobs — register once per distinct client timezone so they fire
    // at the right local time (e.g. 6 AM Vancouver, not 6 AM UTC).
    let timezones: string[] = [];
    try {
      timezones = await this.clientDAO.getDistinctTimezones();
    } catch (err) {
      this.log.error(
        { err },
        '[PaymentCronService] Failed to load distinct timezones — falling back to UTC'
      );
    }
    if (timezones.length === 0) {
      timezones = ['UTC'];
    }

    const tzJobs: ICronJob[] = timezones.flatMap((tz) => [
      {
        name: `payment.auto-charge-overdue-maintenance.${tz}`,
        schedule: '0 10 * * *',
        timezone: tz,
        handler: () => this.autoChargeOverdueMaintenancePayments(),
        enabled: true,
        service: 'PaymentCronService',
        description: `Auto-charge tenant CC for overdue maintenance invoices [${tz}]`,
        timeout: 300000,
      },
      {
        name: `payment.auto-charge-due-rent.${tz}`,
        schedule: '0 6 * * *',
        timezone: tz,
        handler: () => this.autoChargeDueRentPayments(),
        enabled: true,
        service: 'PaymentCronService',
        description: `Auto-charge tenants for rent due today or overdue [${tz}]`,
        timeout: 300000,
      },
      {
        name: `payment.mark-overdue.${tz}`,
        schedule: '0 1 * * *',
        timezone: tz,
        handler: () => this.markOverduePayments(),
        enabled: true,
        service: 'PaymentCronService',
        description: `Flip PENDING → OVERDUE for payments where dueDate has passed [${tz}]`,
        timeout: 300000,
      },
    ]);

    return [...utcJobs, ...tzJobs];
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

  /**
   * Weekly cron (Sunday midnight): queue invoice jobs for leases due this month
   * or within the next 7 days.
   */
  private async queueWeeklyRentInvoices(): Promise<void> {
    const today = dayjs().startOf('day');
    const sevenDaysLater = today.add(7, 'day');

    const { items: leases } = await this.leaseDAO.list(
      { status: LeaseStatus.ACTIVE, deletedAt: null },
      { limit: 5000 }
    );

    let queued = 0;
    const onlinePaymentsEnabled = new Map<string, boolean>();
    for (const lease of leases) {
      try {
        const leaseStart = dayjs(lease.duration.startDate).startOf('day');
        const thisMonthDue = today.date(lease.fees.rentDueDay).startOf('day');
        const nextMonthDue = today.add(1, 'month').date(lease.fees.rentDueDay).startOf('day');

        const candidates: dayjs.Dayjs[] = [];
        if (
          !thisMonthDue.isBefore(today) &&
          !thisMonthDue.isBefore(leaseStart) &&
          !thisMonthDue.isAfter(sevenDaysLater)
        ) {
          candidates.push(thisMonthDue);
        }
        if (
          !nextMonthDue.isBefore(today) &&
          !nextMonthDue.isBefore(leaseStart) &&
          !nextMonthDue.isAfter(sevenDaysLater)
        ) {
          candidates.push(nextMonthDue);
        }

        for (const dueDayjs of candidates) {
          const dueDate = dueDayjs.toDate();
          const period = { month: dueDayjs.month() + 1, year: dueDayjs.year() };
          const existing = await this.paymentDAO.findByPeriod(
            lease.cuid,
            lease._id.toString(),
            period.month,
            period.year
          );
          if (existing) {
            const activeStatuses = [
              PaymentRecordStatus.PENDING,
              PaymentRecordStatus.OVERDUE,
              PaymentRecordStatus.PAID,
              PaymentRecordStatus.PROCESSING,
            ];
            if (activeStatuses.includes(existing.status as PaymentRecordStatus)) continue;
            if (lease.fees?.acceptedPaymentMethod !== 'auto-debit') {
              await this.paymentDAO.updateById(existing._id.toString(), {
                deletedAt: dayjs().toDate(),
              });
            }
          }

          if (lease.fees?.acceptedPaymentMethod === 'auto-debit') {
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
                'Weekly rent invoice skipped: online payments disabled for client'
              );
              continue;
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
          } else {
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
            });
          }
          queued++;
        }
      } catch (error) {
        this.log.error(
          { error, leaseId: lease._id },
          'Weekly rent invoice: error processing lease'
        );
      }
    }

    this.log.info({ queued, total: leases.length }, 'Weekly rent invoice queue complete');
  }

  /**
   * Daily cron (9 AM): safety net ensuring every active lease has a rent payment
   * for the current month once its due date has arrived.
   */
  private async queueDailySafetyNetInvoices(): Promise<void> {
    const today = dayjs().startOf('day');
    const tomorrow = today.add(1, 'day');

    const { items: leases } = await this.leaseDAO.list(
      { status: LeaseStatus.ACTIVE, deletedAt: null },
      { limit: 5000 }
    );

    let queued = 0;
    const onlinePaymentsEnabled = new Map<string, boolean>();
    for (const lease of leases) {
      try {
        const thisMonthDue = today.date(lease.fees.rentDueDay).startOf('day');
        const leaseStart = dayjs(lease.duration.startDate).startOf('day');

        if (thisMonthDue.isAfter(tomorrow) || thisMonthDue.isBefore(leaseStart)) continue;

        const period = { month: thisMonthDue.month() + 1, year: thisMonthDue.year() };
        const existing = await this.paymentDAO.findByPeriod(
          lease.cuid,
          lease._id.toString(),
          period.month,
          period.year
        );
        if (existing) {
          const activeStatuses = [
            PaymentRecordStatus.PENDING,
            PaymentRecordStatus.OVERDUE,
            PaymentRecordStatus.PAID,
            PaymentRecordStatus.PROCESSING,
          ];
          if (activeStatuses.includes(existing.status as PaymentRecordStatus)) continue;
          if (existing.status === PaymentRecordStatus.CANCELLED) continue;
          if (!existing.failure?.pmNotifiedAt) {
            this.emitterService.emit(EventTypes.PAYMENT_FAILED, {
              cuid: existing.cuid,
              pytuid: existing.pytuid,
              invoiceId: existing.gatewayPaymentId ?? existing.pytuid,
              amount: existing.baseAmount,
              tenantId: existing.tenant?.toString(),
            });
            await this.paymentDAO.updateById(existing._id.toString(), {
              'failure.pmNotifiedAt': dayjs().toDate(),
            });
          }
          if (lease.fees?.acceptedPaymentMethod !== 'auto-debit') {
            await this.paymentDAO.updateById(existing._id.toString(), {
              deletedAt: dayjs().toDate(),
            });
          }
        }

        if (lease.fees?.acceptedPaymentMethod === 'auto-debit') {
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
              'Daily safety net skipped: online payments disabled for client'
            );
            continue;
          }

          const paymentQueue = this.queueFactory.getQueue('paymentQueue') as PaymentQueue;
          await paymentQueue.addCreateRentInvoiceJob({
            cuid: lease.cuid,
            leaseId: lease.luid,
            tenantId: lease.tenantId.toString(),
            period,
            dueDate: thisMonthDue.toDate(),
            paymentType: PaymentRecordType.RENT,
          });
        } else {
          const { totalMonthlyRent } = computeLeaseMonthlyFees(lease);
          await this.createManualTrackingPayment({
            cuid: lease.cuid,
            tenantId: lease.tenantId.toString(),
            dueDate: thisMonthDue.toDate(),
            baseAmount: totalMonthlyRent,
            paymentType: PaymentRecordType.RENT,
            paymentMethod: this.mapLeasePaymentMethod(lease.fees?.acceptedPaymentMethod),
            leaseId: lease._id.toString(),
            period,
            currency: lease.fees?.currency,
            paymentSource: 'cron',
          });
        }
        queued++;
      } catch (error) {
        this.log.error({ error, leaseId: lease._id }, 'Daily safety net: error processing lease');
      }
    }

    this.log.info({ queued, total: leases.length }, 'Daily rent invoice safety net complete');
  }

  /**
   * Daily cron (1 AM): flip PENDING → OVERDUE for all payment types where dueDate has passed.
   */
  private async markOverduePayments(): Promise<void> {
    try {
      const { items: pastDuePayments } = await this.paymentDAO.findOverduePayments();

      if (pastDuePayments.length === 0) {
        this.log.info('[Cron] No payments to mark overdue');
        return;
      }

      const pendingIds = pastDuePayments
        .filter(
          (p) =>
            p.status === PaymentRecordStatus.PENDING && !(p.gatewayPaymentId && !p.isManualEntry)
        )
        .map((p) => p._id);

      if (pendingIds.length === 0) {
        this.log.info('[Cron] All past-due payments already marked overdue');
        return;
      }

      await this.paymentDAO.update(
        { _id: { $in: pendingIds }, deletedAt: null },
        { $set: { status: PaymentRecordStatus.OVERDUE } }
      );

      for (const payment of pastDuePayments.filter(
        (p) => p.status === PaymentRecordStatus.PENDING && !(p.gatewayPaymentId && !p.isManualEntry)
      )) {
        this.emitterService.emit(EventTypes.PAYMENT_OVERDUE, {
          cuid: payment.cuid,
          pytuid: payment.pytuid,
          dueDate: payment.dueDate,
          amount: payment.baseAmount,
          paymentType: payment.paymentType,
          tenantId: payment.tenant?.toString(),
        });
      }

      this.log.info(
        { marked: pendingIds.length, total: pastDuePayments.length },
        '[Cron] Marked overdue payments complete'
      );
    } catch (error: any) {
      this.log.error({ error: error.message }, '[Cron] Failed to mark overdue payments');
    }
  }

  /**
   * Daily cron (10 AM): auto-charges tenant for non-rent charges past their grace period.
   */
  private async autoChargeOverdueMaintenancePayments(): Promise<void> {
    const now = dayjs().toDate();

    const { items: overduePayments } = await this.paymentDAO.list(
      {
        status: { $in: [PaymentRecordStatus.PENDING, PaymentRecordStatus.OVERDUE] },
        paymentType: { $in: [PaymentRecordType.MAINTENANCE, PaymentRecordType.LATE_FEE] },
        isManualEntry: false,
        gatewayChargeId: { $exists: false },
        dueDate: { $lt: now },
        deletedAt: null,
      },
      { limit: 500 }
    );

    if (overduePayments.length === 0) {
      this.log.info('[Cron] No overdue maintenance payments to auto-charge');
      return;
    }

    let charged = 0;
    let failed = 0;
    const onlinePaymentsEnabled = new Map<string, boolean>();

    for (const payment of overduePayments) {
      try {
        if (!onlinePaymentsEnabled.has(payment.cuid)) {
          const pClient = await this.clientDAO.getClientByCuid(payment.cuid);
          onlinePaymentsEnabled.set(
            payment.cuid,
            pClient?.settings?.tenantFeatures?.onlinePayments !== false
          );
        }
        if (!onlinePaymentsEnabled.get(payment.cuid)) {
          this.log.info(
            { pytuid: payment.pytuid, cuid: payment.cuid },
            '[Cron] Skipping auto-charge: online payments disabled for client'
          );
          continue;
        }

        const tenantProfile = await this.profileDAO.findFirst({ _id: payment.tenant });
        if (!tenantProfile?.user) {
          this.log.warn(
            { pytuid: payment.pytuid },
            '[Cron] Skipping auto-charge: tenant profile not found'
          );
          failed++;
          continue;
        }

        const tenantUserId = tenantProfile.user.toString();

        // Attempt the charge BEFORE mutating the payment record.
        // This prevents a state where paymentMethod is updated but the charge never succeeds.
        await this.payPendingChargeInternal(payment, tenantUserId);

        await this.paymentDAO.updateById(payment._id.toString(), {
          paymentMethod: PaymentMethod.BANK_TRANSFER,
        });

        charged++;
      } catch (err: any) {
        const errMsg = (err?.message ?? '').toLowerCase();
        const isAcssLimitError =
          errMsg.includes('acss_debit') || errMsg.includes('amount_too_large');

        if (isAcssLimitError) {
          this.log.warn(
            { pytuid: payment.pytuid, cuid: payment.cuid },
            '[Cron] ACSS per-txn limit exceeded — leaving payment PENDING for card retry'
          );
          await this.paymentDAO.updateById(payment._id.toString(), {
            'failure.reason':
              'Bank debit failed: payment amount exceeds per-transaction limit. Card payment required.',
            'failure.lastFailedAt': dayjs().toDate(),
          });
        } else {
          this.log.error(
            { err: err.message, pytuid: payment.pytuid, cuid: payment.cuid },
            '[Cron] Failed to auto-charge maintenance payment'
          );
        }
        failed++;
      }
    }

    this.log.info(
      { charged, failed, total: overduePayments.length },
      '[Cron] Auto-charge overdue maintenance payments complete'
    );
  }

  /**
   * Daily cron (6 AM): triggers Stripe collection for rent payments whose due date has arrived.
   */
  private async autoChargeDueRentPayments(): Promise<void> {
    const now = dayjs().toDate();

    const { items: duePayments } = await this.paymentDAO.list(
      {
        paymentType: PaymentRecordType.RENT,
        status: { $in: [PaymentRecordStatus.PENDING, PaymentRecordStatus.OVERDUE] },
        isManualEntry: false,
        gatewayPaymentId: { $exists: true, $ne: null },
        gatewayChargeId: { $exists: false },
        dueDate: { $lte: now },
        deletedAt: null,
      },
      { limit: 500 }
    );

    if (duePayments.length === 0) {
      this.log.info('[Cron] No due rent payments to auto-charge');
      return;
    }

    let charged = 0;
    let failed = 0;
    const onlinePaymentsEnabled = new Map<string, boolean>();
    const processorAccountIds = new Map<string, string>();

    for (const payment of duePayments) {
      try {
        if (!onlinePaymentsEnabled.has(payment.cuid)) {
          const pClient = await this.clientDAO.getClientByCuid(payment.cuid);
          onlinePaymentsEnabled.set(
            payment.cuid,
            pClient?.settings?.tenantFeatures?.onlinePayments !== false
          );
        }
        if (!onlinePaymentsEnabled.get(payment.cuid)) {
          this.log.info(
            { pytuid: payment.pytuid, cuid: payment.cuid },
            '[Cron] Skipping rent auto-charge: online payments disabled for client'
          );
          continue;
        }

        if (!processorAccountIds.has(payment.cuid)) {
          const processor = await this.paymentProcessorDAO.findFirst({ cuid: payment.cuid });
          if (!processor?.accountId) {
            this.log.warn(
              { cuid: payment.cuid },
              '[Cron] Skipping rent auto-charge: no payment processor configured'
            );
            failed++;
            continue;
          }
          processorAccountIds.set(payment.cuid, processor.accountId);
        }

        await this.paymentGatewayService.payInvoice(
          IPaymentGatewayProvider.STRIPE,
          payment.gatewayPaymentId!
        );
        await this.paymentDAO.updateById(payment._id.toString(), {
          status: PaymentRecordStatus.PROCESSING,
        });
        charged++;
      } catch (err: any) {
        const errMsg = (err?.message ?? '').toLowerCase();
        const isAcssLimitError =
          errMsg.includes('acss_debit') || errMsg.includes('amount_too_large');

        if (isAcssLimitError) {
          // ACSS limit errors are not retryable with ACSS — leave PENDING for card retry via webhook
          this.log.warn(
            { pytuid: payment.pytuid, cuid: payment.cuid },
            '[Cron] ACSS per-txn limit exceeded — leaving rent payment PENDING for card retry'
          );
          await this.paymentDAO.updateById(payment._id.toString(), {
            'failure.reason':
              'Bank debit failed: payment amount exceeds per-transaction limit. Card payment required.',
            'failure.lastFailedAt': dayjs().toDate(),
          });
          failed++;
          continue;
        }

        const newRetryCount = (payment.failure?.retryCount ?? 0) + 1;
        const exhausted = newRetryCount >= MAX_CHARGE_ATTEMPTS;

        this.log.error(
          {
            err: err.message,
            pytuid: payment.pytuid,
            cuid: payment.cuid,
            newRetryCount,
            exhausted,
          },
          '[Cron] Failed to auto-charge due rent payment'
        );

        if (exhausted) {
          await this.paymentDAO.updateById(payment._id.toString(), {
            status: PaymentRecordStatus.FAILED,
            'failure.lastFailedAt': dayjs().toDate(),
            'failure.retryCount': newRetryCount,
            'failure.pmNotifiedAt': dayjs().toDate(),
          });
          this.emitterService.emit(EventTypes.PAYMENT_FAILED, {
            cuid: payment.cuid,
            pytuid: payment.pytuid,
            invoiceId: payment.gatewayPaymentId ?? '',
            amount: payment.baseAmount,
            tenantId: payment.tenant?.toString(),
          });
        } else {
          await this.paymentDAO.updateById(payment._id.toString(), {
            status: PaymentRecordStatus.OVERDUE,
            'failure.lastFailedAt': dayjs().toDate(),
            'failure.retryCount': newRetryCount,
          });
        }
        failed++;
      }
    }

    this.log.info(
      { charged, failed, total: duePayments.length },
      '[Cron] Auto-charge due rent payments complete'
    );
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

    const subscription = await this.subscriptionDAO.findFirst({ cuid, deletedAt: null });
    const transactionFeePercent = subscription
      ? this.subscriptionPlanConfig.getTransactionFeePercent(subscription.planName)
      : 0;
    const feeBreakdown = this.calculateRentFees(payment.baseAmount, transactionFeePercent);

    let activeInvoiceId = payment.gatewayPaymentId;

    if (!activeInvoiceId) {
      const invoiceResult = await this.paymentGatewayService.createInvoice(
        IPaymentGatewayProvider.STRIPE,
        {
          tenantCustomerId,
          connectedAccountId: paymentProcessor.accountId,
          applicationFeeAmountInCents: feeBreakdown.applicationFee,
          currency: (payment.currency ?? 'USD').toLowerCase(),
          description: payment.description || `Maintenance charge ${pytuid}`,
          autoChargeDueDate: dayjs().toDate(),
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

      activeInvoiceId = invoiceResult.data.invoiceId;
      const hostedUrl = finalizeResult.data?.hostedInvoiceUrl;

      await this.paymentDAO.updateById(payment._id.toString(), {
        gatewayPaymentId: activeInvoiceId,
        ...(hostedUrl && { 'receipt.url': hostedUrl }),
      });
    }

    const payResult = await this.paymentGatewayService.payInvoice(
      IPaymentGatewayProvider.STRIPE,
      activeInvoiceId!,
      { paymentMethod: paymentMethodId }
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
   * Twice-daily cron: for each maintenance invoice where the tenant has paid but
   * PM funds haven't been confirmed available yet, check the Stripe Connect balance
   * and flip fundsAvailable when the charge has settled.
   */
  private async checkFundsAvailability(): Promise<void> {
    const invoices = await this.invoiceDAO.findPendingFundsCheck(500);

    if (invoices.length === 0) {
      this.log.info('[Cron] No invoices pending funds availability check');
      return;
    }

    // Group invoices by cuid so we make one Stripe balance call per PM account
    const invoicesByCuid = new Map<string, typeof invoices>();
    for (const inv of invoices) {
      const cuid = inv.cuid;
      if (!invoicesByCuid.has(cuid)) {
        invoicesByCuid.set(cuid, []);
      }
      invoicesByCuid.get(cuid)!.push(inv);
    }

    // Cache PM processor account IDs keyed by cuid
    const processorAccountIds = new Map<string, string | null>();

    let flipped = 0;
    let skipped = 0;

    for (const [cuid, cuidInvoices] of invoicesByCuid) {
      try {
        if (!processorAccountIds.has(cuid)) {
          const processor = await this.paymentProcessorDAO.findFirst({ cuid });
          processorAccountIds.set(cuid, processor?.accountId ?? null);
        }

        const accountId = processorAccountIds.get(cuid);
        if (!accountId) {
          this.log.warn({ cuid }, '[Cron] No Stripe Connect account for client — skipping');
          skipped += cuidInvoices.length;
          continue;
        }

        const balance = await this.stripeService.getConnectBalance(accountId);

        for (const invoice of cuidInvoices) {
          const currency = (invoice.currency ?? 'usd').toLowerCase();
          const availableEntry = balance.available.find((b) => b.currency === currency);

          if (!availableEntry || availableEntry.amount < invoice.amountInCents) {
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
            cuid,
          };
          this.emitterService.emit(EventTypes.MAINTENANCE_FUNDS_AVAILABLE, fundsPayload);

          flipped++;
        }
      } catch (err: any) {
        this.log.error(
          { err: err.message, cuid },
          '[Cron] Error checking funds availability for client'
        );
        skipped += invoicesByCuid.get(cuid)?.length ?? 0;
      }
    }

    this.log.info(
      { flipped, skipped, total: invoices.length },
      '[Cron] Funds availability check complete'
    );
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
}
