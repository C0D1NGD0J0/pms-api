import dayjs from 'dayjs';
import Logger from 'bunyan';
import { JOB_NAME } from '@utils/constants';
import { envVariables } from '@shared/config';
import { FilterQuery, Types } from 'mongoose';
import { QueueFactory } from '@services/queue';
import { MoneyUtils } from '@utils/money.utils';
import { PaymentQueue } from '@queues/payment.queue';
import { EventEmitterService } from '@services/eventEmitter';
import { PdfGeneratorService } from '@services/pdfGenerator';
import { SubscriptionPlanConfig } from '@services/subscription';
import { calcApplicationFeeSplit } from '@utils/financial.utils';
import { ICronProvider, ICronJob } from '@interfaces/cron.interface';
import { IPayoutSchedule } from '@interfaces/paymentGateway.interface';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
import { MaintenanceInvoiceApprovedPayload, EventTypes } from '@interfaces/events.interface';
import { calculateProRatedAmount, computeLeaseMonthlyFees } from '@services/lease/leaseHelpers';
import {
  IPromiseReturnedData,
  IPaginateResult,
  IRequestContext,
  MailType,
} from '@interfaces/utils.interface';
import {
  getPaymentProcessorUrls,
  preventTenantConflict,
  calcCollectionRate,
  createLogger,
  daysInMs,
} from '@utils/index';
import {
  PaymentProcessorDAO,
  SubscriptionDAO,
  PaymentDAO,
  ProfileDAO,
  ClientDAO,
  LeaseDAO,
  UserDAO,
} from '@dao/index';
import {
  IPaymentGatewayProvider,
  IManualPaymentFormData,
  IPaymentFullyPopulated,
  PaymentRecordStatus,
  ISubscriptionStatus,
  IRefundPaymentData,
  IPaymentPopulated,
  PaymentRecordType,
  IPaymentListItem,
  IPaymentDocument,
  IPaymentFormData,
  IProfileWithUser,
  ILeaseDocument,
  PaymentMethod,
  LeaseStatus,
} from '@interfaces/index';

interface IConstructor {
  subscriptionPlanConfig: SubscriptionPlanConfig;
  paymentGatewayService: PaymentGatewayService;
  pdfGeneratorService: PdfGeneratorService;
  paymentProcessorDAO: PaymentProcessorDAO;
  emitterService: EventEmitterService;
  subscriptionDAO: SubscriptionDAO;
  queueFactory: QueueFactory;
  paymentDAO: PaymentDAO;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  leaseDAO: LeaseDAO;
  userDAO: UserDAO;
}

interface IStripeAccountWebhookData {
  requirements?: {
    currently_due?: string[];
    eventually_due?: string[];
    past_due?: string[];
    disabled_reason?: string;
  };
  details_submitted?: boolean;
  payouts_enabled?: boolean;
  charges_enabled?: boolean;
}

interface IStripeInvoiceWebhookData {
  last_payment_error?: { message?: string };
  next_payment_attempt?: number;
  hosted_invoice_url?: string;
  attempt_count?: number;
  charge?: string;
}

interface IStripePayoutEntry {
  description?: string | null;
  arrival_date: number;
  currency: string;
  created: number;
  amount: number;
  status: string;
  id: string;
}

interface IStripeDisputeWebhookData {
  evidence_details?: { due_by?: number };
  charge?: string | { id: string };
  currency: string;
  reason?: string;
  amount: number;
}

interface IStripeBalanceData {
  available: IStripeBalanceEntry[];
  pending: IStripeBalanceEntry[];
}

interface IStripePayoutList {
  data: IStripePayoutEntry[];
  has_more: boolean;
}

interface IStripeBalanceEntry {
  currency: string;
  amount: number;
}

interface IStripeChargeWebhookData {
  amount_refunded?: number;
}

export class PaymentService implements ICronProvider {
  private readonly log: Logger;
  private readonly userDAO: UserDAO;
  private readonly leaseDAO: LeaseDAO;
  private readonly clientDAO: ClientDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly paymentDAO: PaymentDAO;
  private readonly emitterService: EventEmitterService;
  private readonly queueFactory: QueueFactory;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly paymentProcessorDAO: PaymentProcessorDAO;
  private readonly paymentGatewayService: PaymentGatewayService;
  private readonly pdfGeneratorService: PdfGeneratorService;
  private readonly subscriptionPlanConfig: SubscriptionPlanConfig;

  constructor({
    userDAO,
    profileDAO,
    clientDAO,
    paymentDAO,
    leaseDAO,
    emitterService,
    queueFactory,
    subscriptionDAO,
    paymentProcessorDAO,
    subscriptionPlanConfig,
    paymentGatewayService,
    pdfGeneratorService,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.leaseDAO = leaseDAO;
    this.clientDAO = clientDAO;
    this.profileDAO = profileDAO;
    this.paymentDAO = paymentDAO;
    this.emitterService = emitterService;
    this.queueFactory = queueFactory;
    this.subscriptionDAO = subscriptionDAO;
    this.log = createLogger('PaymentService');
    this.paymentProcessorDAO = paymentProcessorDAO;
    this.paymentGatewayService = paymentGatewayService;
    this.pdfGeneratorService = pdfGeneratorService;
    this.subscriptionPlanConfig = subscriptionPlanConfig;
    this.emitterService.on(
      EventTypes.MAINTENANCE_INVOICE_APPROVED,
      this.handleMaintenanceInvoiceApproved.bind(this)
    );
    this.emitterService.on(
      EventTypes.LEASE_ESIGNATURE_COMPLETED,
      this.handleLeaseActivated.bind(this)
    );
  }

  getCronJobs(): ICronJob[] {
    return [
      {
        name: 'payment.weekly-rent-invoices',
        schedule: '0 0 * * 0', // Sunday midnight UTC
        handler: this.queueWeeklyRentInvoices.bind(this),
        enabled: true,
        service: 'PaymentService',
        description: 'Queue rent invoice creation for leases due in the upcoming week',
        timeout: 600000,
      },
      {
        name: 'payment.daily-rent-safety-net',
        schedule: '0 9 * * *', // 9 AM UTC daily
        handler: this.queueDailySafetyNetInvoices.bind(this),
        enabled: true,
        service: 'PaymentService',
        description:
          'Queue rent invoices for leases due today or tomorrow (catches any missed by weekly job)',
        timeout: 300000,
      },
      {
        name: 'payment.auto-charge-overdue-maintenance',
        schedule: '0 10 * * *', // 10 AM UTC daily
        handler: this.autoChargeOverdueMaintenancePayments.bind(this),
        enabled: true,
        service: 'PaymentService',
        description: 'Auto-charge tenant CC for maintenance invoices past their 5-day grace period',
        timeout: 300000,
      },
      {
        name: 'payment.auto-charge-due-rent',
        schedule: '0 6 * * *', // 6 AM UTC daily — after mark-overdue (1 AM), before business hours
        handler: this.autoChargeDueRentPayments.bind(this),
        enabled: true,
        service: 'PaymentService',
        description:
          'Auto-charge tenants for rent payments due today or overdue (Stripe invoice already exists)',
        timeout: 300000,
      },
      {
        name: 'payment.mark-overdue',
        schedule: '0 1 * * *', // 1 AM UTC daily — runs before the overdue charge cron
        handler: this.markOverduePayments.bind(this),
        enabled: true,
        service: 'PaymentService',
        description: 'Flip PENDING → OVERDUE for all payment types where dueDate has passed',
        timeout: 300000,
      },
    ];
  }

  /**
   * Returns the next due date for a lease given its rentDueDay and a reference date.
   * If the due day has already passed this month, returns next month's due date.
   */
  private calculateNextDueDate(rentDueDay: number, referenceDate: Date): Date {
    const year = referenceDate.getFullYear();
    const month = referenceDate.getMonth(); // 0-indexed
    const thisMonthDue = new Date(year, month, rentDueDay);
    if (thisMonthDue >= referenceDate) {
      return thisMonthDue;
    }
    return new Date(year, month + 1, rentDueDay);
  }

  /**
   * Weekly cron (Sunday midnight): queue invoice jobs for leases due in the next 7 days.
   */
  private async queueWeeklyRentInvoices(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysLater = new Date(today.getTime() + daysInMs(7));

    const { items: leases } = await this.leaseDAO.list(
      { status: LeaseStatus.ACTIVE, deletedAt: null },
      { limit: 5000 }
    );

    let queued = 0;
    const onlinePaymentsEnabled = new Map<string, boolean>();
    for (const lease of leases) {
      try {
        const dueDate = this.calculateNextDueDate(lease.fees.rentDueDay, today);
        if (dueDate < today || dueDate > sevenDaysLater) continue;

        const period = { month: dueDate.getMonth() + 1, year: dueDate.getFullYear() };
        const existing = await this.paymentDAO.findByPeriod(
          lease.cuid,
          lease._id.toString(),
          period.month,
          period.year
        );
        if (existing) continue;

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
            leaseId: lease._id.toString(),
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
            paymentMethod: PaymentService.mapLeasePaymentMethod(lease.fees?.acceptedPaymentMethod),
            leaseId: lease._id.toString(),
            period,
            currency: lease.fees?.currency,
          });
        }
        queued++;
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
   * Daily cron (9 AM): safety net for leases due today or tomorrow.
   */
  private async queueDailySafetyNetInvoices(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + daysInMs(1));

    const { items: leases } = await this.leaseDAO.list(
      {
        status: LeaseStatus.ACTIVE,
        'fees.rentDueDay': { $in: [today.getDate(), tomorrow.getDate()] },
        deletedAt: null,
      },
      { limit: 5000 }
    );

    let queued = 0;
    const onlinePaymentsEnabled = new Map<string, boolean>();
    for (const lease of leases) {
      try {
        const dueDate = this.calculateNextDueDate(lease.fees.rentDueDay, today);
        const period = { month: dueDate.getMonth() + 1, year: dueDate.getFullYear() };
        const existing = await this.paymentDAO.findByPeriod(
          lease.cuid,
          lease._id.toString(),
          period.month,
          period.year
        );
        if (existing) continue;

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
            leaseId: lease._id.toString(),
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
            paymentMethod: PaymentService.mapLeasePaymentMethod(lease.fees?.acceptedPaymentMethod),
            leaseId: lease._id.toString(),
            period,
            currency: lease.fees?.currency,
          });
        }
        queued++;
      } catch (error) {
        this.log.error({ error, leaseId: lease._id }, 'Daily safety net: error processing lease');
      }
    }

    this.log.info({ queued, total: leases.length }, 'Daily rent invoice safety net complete');
  }

  async recordManualPayment(
    cuid: string,
    userId: string,
    requestingUserSub: string,
    data: IManualPaymentFormData
  ): IPromiseReturnedData<IPaymentDocument> {
    try {
      // Prevent conflict of interest: cannot record payment where you are the tenant
      preventTenantConflict(requestingUserSub, data.tenantId as string);

      const client = await this.clientDAO.findFirst({ cuid, deletedAt: null });
      if (!client) {
        throw new NotFoundError({ message: 'Client not found' });
      }

      const tenantProfile = await this.profileDAO.findFirst({ user: data.tenantId });
      if (!tenantProfile) {
        throw new NotFoundError({ message: 'Tenant profile not found' });
      }

      let lease;
      if (data.leaseId) {
        lease = await this.leaseDAO.findFirst({ luid: data.leaseId, cuid });
        if (!lease) {
          throw new NotFoundError({ message: 'Lease not found' });
        }
      }

      const payment = await this.paymentDAO.insert({
        cuid,
        paymentType: data.paymentType,
        paymentMethod: data.paymentMethod,
        lease: lease ? lease._id : undefined,
        tenant: tenantProfile._id,
        baseAmount: data.baseAmount,
        processingFee: data.processingFee || 0,
        status: data.status || PaymentRecordStatus.PAID,
        dueDate: data.paidAt,
        paidAt: data.paidAt,
        period: data.period,
        description: data.description,
        recordedBy: new Types.ObjectId(userId),
        isManualEntry: true,
        ...(data.receipt
          ? { receipt: { ...data.receipt, uploadedBy: new Types.ObjectId(userId) } }
          : {}),
      });

      return {
        success: true,
        data: payment,
        message: 'Manual payment recorded successfully',
      };
    } catch (error: any) {
      this.log.error('Error recording manual payment:', error);
      throw error;
    }
  }

  async createRentPayment(
    cuid: string,
    data: IPaymentFormData,
    options?: { createStripeInvoice?: boolean }
  ): IPromiseReturnedData<IPaymentDocument> {
    try {
      if (!data.leaseId) {
        throw new BadRequestError({ message: 'Lease ID is required for rent payments' });
      }

      const lease = await this.leaseDAO.findFirst(
        { luid: data.leaseId, cuid },
        { populate: ['property.id'] }
      );
      if (!lease) {
        throw new NotFoundError({ message: 'Lease not found' });
      }
      if (lease.status !== LeaseStatus.ACTIVE) {
        throw new BadRequestError({ message: 'Cannot create payment for inactive lease' });
      }

      const acceptedPaymentMethod = lease.fees?.acceptedPaymentMethod;
      const isAutoDebit = acceptedPaymentMethod === 'auto-debit';

      // Guard against duplicate period for ALL lease types.
      // The unique partial index on { lease, paymentType, period.month, period.year }
      // (filtered by deletedAt: null) applies regardless of payment method.
      // Two cases:
      //   1. Existing record is CANCELLED → soft-delete it to free the index slot, then proceed
      //   2. Existing record is active (PENDING/OVERDUE/PAID) → reject with a clear message
      const effectivePaymentType =
        data.paymentType === 'late_fee' ? PaymentRecordType.LATE_FEE : PaymentRecordType.RENT;

      if (data.period) {
        const existingForPeriod = await this.paymentDAO.findFirst({
          lease: lease._id,
          paymentType: effectivePaymentType,
          'period.month': data.period.month,
          'period.year': data.period.year,
          deletedAt: null,
        });
        if (existingForPeriod) {
          const isRetryable =
            existingForPeriod.status === PaymentRecordStatus.CANCELLED ||
            existingForPeriod.status === PaymentRecordStatus.FAILED;
          if (isRetryable) {
            // Free the index slot so the new insert can succeed.
            // CANCELLED: PM explicitly cancelled. FAILED: Stripe rejected the charge.
            // Both are dead-end states — a replacement record is the correct next step.
            await this.paymentDAO.updateById(existingForPeriod._id.toString(), {
              deletedAt: new Date(),
            });
          } else {
            const monthName = new Date(data.period.year, data.period.month - 1, 1).toLocaleString(
              'default',
              { month: 'long' }
            );
            const typeLabel =
              effectivePaymentType === PaymentRecordType.LATE_FEE ? 'late fee' : 'rent';
            throw new BadRequestError({
              message: `A ${typeLabel} payment for ${monthName} ${data.period.year} already exists for this lease (status: ${existingForPeriod.status}). Cancel the existing payment first or select a different period.`,
            });
          }
        }
      }

      // Non-auto-debit leases (cash / check / e-transfer) never touch Stripe.
      // Create a PENDING tracking record so dashboard stats reflect expected revenue,
      // then return early — no invoice, no gateway calls.
      if (!isAutoDebit) {
        let trackingAmount: number;
        if (effectivePaymentType === PaymentRecordType.LATE_FEE) {
          const fees = lease.calculateFees({ daysLate: data.daysLate ?? 0 });
          trackingAmount = fees.late.fee;
          if (trackingAmount <= 0) {
            throw new BadRequestError({
              message: 'No late fee is applicable — the payment is still within the grace period.',
            });
          }
        } else {
          trackingAmount = computeLeaseMonthlyFees(lease).totalMonthlyRent;
        }
        const payment = await this.createManualTrackingPayment({
          cuid,
          tenantId: data.tenantId,
          dueDate: new Date(data.dueDate),
          baseAmount: trackingAmount,
          paymentType: effectivePaymentType,
          paymentMethod: PaymentService.mapLeasePaymentMethod(acceptedPaymentMethod),
          leaseId: lease._id.toString(),
          period: data.period,
          description: data.description,
          currency: lease.fees?.currency,
        });
        if (data.notifyByEmail) {
          await this.queuePaymentRequestEmail({
            cuid,
            tenantId: data.tenantId,
            lease,
            amountInCents: trackingAmount,
            currency: lease.fees?.currency ?? 'usd',
            paymentType: effectivePaymentType,
            dueDate: data.dueDate,
            description: data.description,
          });
        }
        return { success: true, data: payment, message: 'Payment tracking record created' };
      }

      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        throw new NotFoundError({ message: 'Client not found' });
      }
      if (client.settings?.tenantFeatures?.onlinePayments === false) {
        throw new BadRequestError({
          message: 'Online payments are disabled for this account',
        });
      }

      const subscription = await this.subscriptionDAO.findFirst({ cuid, deletedAt: null });
      if (!subscription) {
        throw new BadRequestError({ message: 'No active subscription found' });
      }
      if (subscription.status !== ISubscriptionStatus.ACTIVE) {
        this.log.warn(
          'Subscription not active — payment will be collected but payouts are paused',
          {
            cuid,
            subscriptionStatus: subscription.status,
          }
        );
      }

      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor || !paymentProcessor.accountId) {
        throw new BadRequestError({
          message: 'Payment account not setup. Please complete onboarding.',
        });
      }
      if (!paymentProcessor.chargesEnabled || !paymentProcessor.payoutsEnabled) {
        throw new BadRequestError({ message: 'Payment account verification incomplete' });
      }
      if (paymentProcessor.payoutsBlocked) {
        throw new ForbiddenError({
          message:
            paymentProcessor.payoutsBlockedReason ||
            'Payouts are currently blocked for this account.',
        });
      }

      const existingPaymentCount = await this.paymentDAO.countDocuments({
        lease: lease._id,
        cuid,
        deletedAt: null,
      });
      const isFirstPayment = existingPaymentCount === 0;

      let effectiveDaysLate = 0;
      if (!isFirstPayment) {
        if (data.daysLate !== undefined) {
          effectiveDaysLate = data.daysLate;
        } else if (data.dueDate) {
          effectiveDaysLate = Math.max(0, dayjs().diff(dayjs(data.dueDate), 'day'));
        }
      }

      const leaseFees = lease.calculateFees({ daysLate: effectiveDaysLate });
      let lineItems: Array<{ description: string; amountInCents: number }>;

      if (effectivePaymentType === PaymentRecordType.LATE_FEE) {
        if (leaseFees.late.fee <= 0) {
          throw new BadRequestError({
            message: 'No late fee is applicable — the payment is still within the grace period.',
          });
        }
        const lateDesc =
          leaseFees.late.type === 'percentage'
            ? `Late Fee (${leaseFees.late.percentage}% – ${leaseFees.late.daysLate} days late)`
            : `Late Fee (${leaseFees.late.daysLate} days late)`;
        lineItems = [{ description: lateDesc, amountInCents: leaseFees.late.fee }];
      } else {
        const { managementFee } = computeLeaseMonthlyFees(lease);
        lineItems = this.buildLineItemsFromFees(leaseFees, {
          isFirstPayment,
          startDate: lease.duration.startDate,
          managementFee,
        });
      }
      const totalAmountInCents = lineItems.reduce((sum, item) => sum + item.amountInCents, 0);

      if (!options?.createStripeInvoice) {
        const payment = await this.createManualTrackingPayment({
          cuid,
          tenantId: data.tenantId,
          dueDate: new Date(data.dueDate),
          baseAmount: totalAmountInCents,
          paymentType: effectivePaymentType,
          paymentMethod: PaymentMethod.ONLINE,
          leaseId: lease._id.toString(),
          period: data.period,
          description: data.description,
          currency: leaseFees.currency,
          lineItems: lineItems.map(({ description, amountInCents }) => ({
            description,
            amountInCents,
          })),
        });
        if (data.notifyByEmail) {
          await this.queuePaymentRequestEmail({
            cuid,
            tenantId: data.tenantId,
            lease,
            amountInCents: totalAmountInCents,
            currency: leaseFees.currency,
            paymentType: effectivePaymentType,
            dueDate: data.dueDate,
            description: data.description,
          });
        }
        return { success: true, data: payment, message: 'Payment request created' };
      }

      const transactionFeePercent = this.subscriptionPlanConfig.getTransactionFeePercent(
        subscription.planName
      );
      const feeBreakdown = this.calculateRentFees(totalAmountInCents, transactionFeePercent);

      const tenantProfile = (await this.profileDAO.findFirst(
        { user: data.tenantId },
        {
          populate: ['user'],
        }
      )) as IProfileWithUser | null;
      if (!tenantProfile) {
        throw new NotFoundError({ message: 'Tenant profile not found' });
      }

      let tenantCustomerId = tenantProfile.tenantInfo?.paymentGatewayCustomers?.get('platform');
      if (!tenantCustomerId) {
        this.log.info('No platform Stripe customer for tenant — creating one', {
          profileId: tenantProfile._id,
          cuid,
        });

        const customerResult = await this.paymentGatewayService.createCustomer({
          provider: IPaymentGatewayProvider.STRIPE,
          email: tenantProfile.user.email,
          name:
            `${tenantProfile.personalInfo?.firstName ?? ''} ${tenantProfile.personalInfo?.lastName ?? ''}`.trim() ||
            undefined,
          metadata: { cuid, userId: tenantProfile.user._id?.toString() },
        });

        if (!customerResult.success || !customerResult.data) {
          throw new BadRequestError({
            message: 'Failed to create payment customer for tenant.',
          });
        }

        tenantCustomerId = customerResult.data.customerId;

        await this.profileDAO.updateById(tenantProfile._id.toString(), {
          $set: {
            ['tenantInfo.paymentGatewayCustomers.platform']: tenantCustomerId,
          },
        });
      }

      const paymentMethodId = tenantProfile.tenantInfo?.paymentMethods?.get(
        paymentProcessor.accountId
      );

      const invoiceResult = await this.paymentGatewayService.createInvoice(
        IPaymentGatewayProvider.STRIPE,
        {
          tenantCustomerId,
          connectedAccountId: paymentProcessor.accountId,
          applicationFeeAmountInCents: feeBreakdown.applicationFee,
          currency: leaseFees.currency.toLowerCase(),
          description: data.description || `Rent for ${data.period?.month}/${data.period?.year}`,
          autoChargeDueDate: data.dueDate,
          lineItems,
          cuid,
          paymentMethodId,
          leaseUid: lease.luid,
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

      const hostedInvoiceUrl = finalizeResult.data?.hostedInvoiceUrl;

      const payment = await this.paymentDAO.insert({
        cuid,
        paymentType: effectivePaymentType,
        paymentMethod: PaymentMethod.ONLINE,
        lease: lease._id,
        tenant: tenantProfile._id, // References Profile document
        baseAmount: totalAmountInCents,
        processingFee: feeBreakdown.gatewayProcessingFee,
        applicationFee: feeBreakdown.applicationFee,
        gatewayPaymentId: invoiceResult.data.invoiceId,
        currency: leaseFees.currency,
        status: PaymentRecordStatus.PENDING,
        dueDate: data.dueDate,
        period: data.period,
        description: data.description,
        isManualEntry: false,
        lineItems: lineItems.map(({ description, amountInCents }) => ({
          description,
          amountInCents,
        })),
        ...(hostedInvoiceUrl && { receipt: { url: hostedInvoiceUrl } }),
      });

      this.emitterService.emit(EventTypes.PAYMENT_REQUEST_CREATED, {
        tenantUserId: tenantProfile.user._id.toString(),
        amountInCents: totalAmountInCents,
        dueDate: new Date(data.dueDate),
        pytuid: payment.pytuid,
        cuid,
      });

      if (data.notifyByEmail) {
        await this.queuePaymentRequestEmail({
          cuid,
          tenantId: data.tenantId,
          lease,
          amountInCents: totalAmountInCents,
          currency: leaseFees.currency,
          paymentType: effectivePaymentType,
          dueDate: data.dueDate,
          description: data.description,
        });
      }

      return {
        success: true,
        data: payment,
        message: 'Rent payment processed successfully',
      };
    } catch (error: any) {
      this.log.error('Error creating rent payment:', error);
      throw error;
    }
  }

  async listPayments(
    cuid: string,
    filters?: {
      status?: string;
      type?: string;
      tenantId?: string;
      leaseId?: string;
      luid?: string;
      page?: number;
      limit?: number;
    },
    context?: IRequestContext
  ): IPromiseReturnedData<{ items: IPaymentListItem[]; pagination?: IPaginateResult }> {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 10;
    const skip = (page - 1) * limit;

    let tenantUserId: string | undefined;
    let tenantId: string | undefined = filters?.tenantId;

    if (context?.currentuser?.client?.role === 'tenant') {
      tenantUserId = context.currentuser.sub;
      tenantId = undefined;
    }

    try {
      const client = await this.clientDAO.findFirst({ cuid, deletedAt: null });
      if (!client) {
        throw new NotFoundError({ message: 'Client not found' });
      }

      const query: FilterQuery<IPaymentDocument> = { cuid, deletedAt: null };

      if (filters?.status) {
        query.status = filters.status;
      }
      if (filters?.type) {
        query.paymentType = filters.type;
      }

      // tenantUserId (User._id) takes precedence — resolve to Profile._id
      if (tenantUserId) {
        const profile = await this.profileDAO.findFirst({
          user: new Types.ObjectId(tenantUserId),
        });
        if (profile) {
          query.tenant = profile._id;
        }
      } else if (tenantId) {
        query.tenant = new Types.ObjectId(tenantId);
      }

      if (filters?.leaseId) {
        query.lease = new Types.ObjectId(filters.leaseId);
      } else if (filters?.luid) {
        const lease = await this.leaseDAO.findFirst({ luid: filters.luid, cuid, deletedAt: null });
        if (lease) {
          query.lease = lease._id;
        }
      }

      const result = await this.paymentDAO.list(
        query,
        {
          sort: { dueDate: -1, createdAt: -1 },
          populate: [
            {
              path: 'tenant',
              select: 'personalInfo',
            },
            {
              path: 'lease',
              select: 'property',
            },
          ],
          projection:
            'pytuid paymentMethod paymentType baseAmount processingFee applicationFee status dueDate paidAt period failure receipt lineItems currency',
          skip,
          limit,
        },
        true
      );

      const cleanItems = (result.items as unknown as IPaymentPopulated[]).map((payment) => {
        const addr = payment.lease?.property?.address;
        const addressStr = typeof addr === 'string' ? addr : (addr?.fullAddress ?? '');
        return {
          pytuid: payment.pytuid,
          tenant: payment.tenant
            ? {
                firstName: payment.tenant.personalInfo?.firstName || '',
                lastName: payment.tenant.personalInfo?.lastName || '',
                fullName:
                  `${payment.tenant.personalInfo?.firstName || ''} ${payment.tenant.personalInfo?.lastName || ''}`.trim() ||
                  'Unknown Tenant',
              }
            : null,
          property: payment.lease?.property?.name || addressStr || 'Unknown Property',
          amount: payment.baseAmount + (payment.processingFee || 0),
          baseAmount: payment.baseAmount,
          processingFee: payment.processingFee || 0,
          applicationFee: payment.applicationFee || 0,
          status: payment.status,
          paymentType: payment.paymentType,
          paymentMethod: payment.paymentMethod,
          dueDate: payment.dueDate,
          paidAt: payment.paidAt,
          period: payment.period,
          currency: payment.currency,
          lineItems: payment.lineItems || [],
          failure: payment.failure || undefined,
          receipt: payment.receipt || undefined,
        };
      });

      return {
        success: true,
        data: {
          items: cleanItems,
          ...(result.pagination ? { pagination: result.pagination } : {}),
        },
        message: 'Payments retrieved successfully',
      };
    } catch (error) {
      this.log.error('Error listing payments', error);
      throw error;
    }
  }

  async getPaymentByUid(cuid: string, pytuid: string): IPromiseReturnedData<any> {
    try {
      if (!cuid || !pytuid) {
        throw new BadRequestError({ message: 'Client ID and Payment ID are required' });
      }

      const client = await this.clientDAO.findFirst({ cuid, deletedAt: null });
      if (!client) {
        throw new NotFoundError({ message: 'Client not found' });
      }

      const payment = (await this.paymentDAO.findFirst(
        { pytuid, cuid, deletedAt: null },
        {
          populate: [
            {
              path: 'tenant',
              select:
                'personalInfo.firstName personalInfo.lastName personalInfo.phoneNumber puid user',
              populate: { path: 'user', select: 'email' },
            },
            {
              path: 'lease',
              select:
                'property.id property.unitId property.address property.name property.unitNumber leaseNumber status duration.startDate duration.endDate luid',
              populate: [
                {
                  path: 'property.id',
                  select:
                    'propertyType specifications.bedrooms specifications.bathrooms status managedBy',
                },
                {
                  path: 'property.unitId',
                  select: 'specifications.bedrooms specifications.bathrooms unitNumber',
                },
              ],
            },
          ],
        }
      )) as IPaymentFullyPopulated | null;

      if (!payment) {
        throw new NotFoundError({ message: 'Payment not found' });
      }

      const tenantProfile = {
        firstName: payment.tenant?.personalInfo?.firstName,
        lastName: payment.tenant?.personalInfo?.lastName,
        phoneNumber: payment.tenant?.personalInfo?.phoneNumber,
        email: payment.tenant?.user?.email,
        puid: payment.tenant?.puid,
      };

      const propertyDoc = payment.lease?.property?.id;
      const unitDoc = payment.lease?.property?.unitId;
      let propertyManager = null;
      if (propertyDoc?.managedBy) {
        const managerProfile = (await this.profileDAO.findFirst(
          { user: propertyDoc.managedBy },
          {
            select: 'personalInfo.firstName personalInfo.lastName personalInfo.phoneNumber user',
            populate: { path: 'user', select: 'email' },
          }
        )) as IProfileWithUser | null;
        if (managerProfile) {
          propertyManager = {
            fullName:
              `${managerProfile.personalInfo?.firstName || ''} ${managerProfile.personalInfo?.lastName || ''}`.trim(),
            email: managerProfile.user?.email || '',
            phoneNumber: managerProfile.personalInfo?.phoneNumber || '',
          };
        }
      }

      const leaseInfo = payment.lease
        ? {
            address: payment.lease.property?.address,
            leaseNumber: payment.lease.leaseNumber,
            status: payment.lease.status,
            startDate: payment.lease.duration?.startDate,
            endDate: payment.lease.duration?.endDate,
            leaseUid: payment.lease.luid,
            unitNumber: unitDoc?.unitNumber ?? (payment.lease.property as any)?.unitNumber,
            propertyName: payment.lease.property?.name,
            propertyType: propertyDoc?.propertyType,
            propertyStatus: propertyDoc?.operationalStatus,
            bedrooms: unitDoc?.specifications?.bedrooms ?? propertyDoc?.specifications?.bedrooms,
            bathrooms: unitDoc?.specifications?.bathrooms ?? propertyDoc?.specifications?.bathrooms,
            propertyManager,
          }
        : null;

      const paymentObj = payment.toObject();
      delete paymentObj.tenant;
      delete paymentObj.lease;

      this.log.info({ pytuid, cuid }, 'Payment retrieved');

      return {
        success: true,
        data: {
          ...paymentObj,
          tenant: {
            uid: tenantProfile.puid || '',
            fullName: `${tenantProfile.firstName || ''} ${tenantProfile.lastName || ''}`.trim(),
            email: tenantProfile.email || '',
            phoneNumber: tenantProfile.phoneNumber || '',
          },
          property: {
            pid: '',
            name: leaseInfo?.propertyName || '',
            address: leaseInfo?.address || '',
          },
          leaseInfo,
        },
        message: 'Payment retrieved successfully',
      };
    } catch (error) {
      this.log.error('Error getting payment', error);
      throw error;
    }
  }

  async createConnectAccount(
    cuid: string,
    data: { email: string; country: string }
  ): IPromiseReturnedData<any> {
    try {
      const existingProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (existingProcessor?.accountId) {
        throw new BadRequestError({
          message: 'Connect account already exists for this client',
        });
      }

      const client = await this.clientDAO.findFirst({ cuid });
      if (!client) {
        throw new NotFoundError({ message: 'Client not found' });
      }

      // Fetch the account admin's profile to prefill the Stripe KYC form
      const adminProfile = client.accountAdmin
        ? await this.profileDAO.findFirst({ user: client.accountAdmin })
        : null;

      const isEnterprise = client.accountType.isEnterpriseAccount;
      const accountResult = await this.paymentGatewayService.createConnectAccount(
        IPaymentGatewayProvider.STRIPE,
        {
          cuid,
          email: data.email,
          country: data.country,
          businessType: isEnterprise ? 'company' : 'individual',
          metadata: { cuid },
          prefill: {
            firstName: adminProfile?.personalInfo?.firstName,
            lastName: adminProfile?.personalInfo?.lastName,
            phone: adminProfile?.personalInfo?.phoneNumber,
            companyName: isEnterprise
              ? client.companyProfile?.tradingName || client.companyProfile?.legalEntityName
              : undefined,
          },
        }
      );
      if (!accountResult.success || !accountResult.data) {
        throw new BadRequestError({
          message: accountResult.message || 'Failed to create Connect account',
        });
      }

      await this.paymentProcessorDAO.insert({
        cuid,
        client: client._id,
        accountId: accountResult.data.accountId,
        chargesEnabled: accountResult.data.chargesEnabled || false,
        payoutsEnabled: accountResult.data.payoutsEnabled || false,
        detailsSubmitted: accountResult.data.detailsSubmitted || false,
      });

      return {
        success: true,
        data: {
          accountId: accountResult.data.accountId,
          chargesEnabled: accountResult.data.chargesEnabled,
          payoutsEnabled: accountResult.data.payoutsEnabled,
          detailsSubmitted: accountResult.data.detailsSubmitted,
        },
        message: 'Connect account created successfully',
      };
    } catch (error) {
      this.log.error('Error creating Connect account', error);
      throw error;
    }
  }

  async getKycOnboardingLink(
    cuid: string,
    urlOverrides?: { returnUrl?: string; refreshUrl?: string }
  ): IPromiseReturnedData<{ url: string }> {
    try {
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor || !paymentProcessor.accountId) {
        throw new BadRequestError({
          message: 'No Connect account found. Please create one first.',
        });
      }

      const baseUrl = envVariables.FRONTEND.URL || 'http://localhost:3000';
      const fallback = getPaymentProcessorUrls(baseUrl, cuid);
      const linkResult = await this.paymentGatewayService.createKycOnboardingLink(
        IPaymentGatewayProvider.STRIPE,
        {
          accountId: paymentProcessor.accountId,
          refreshUrl: urlOverrides?.refreshUrl || fallback.refreshUrl,
          returnUrl: urlOverrides?.returnUrl || fallback.kycReturnUrl,
        }
      );

      if (!linkResult.success || !linkResult.data) {
        throw new BadRequestError({
          message: linkResult.message || 'Failed to create onboarding link',
        });
      }

      return {
        success: true,
        data: { url: linkResult.data.url },
        message: 'Onboarding link created successfully',
      };
    } catch (error) {
      this.log.error('Error creating onboarding link', error);
      throw error;
    }
  }

  async getAccountUpdateLink(
    cuid: string,
    urlOverrides?: { returnUrl?: string; refreshUrl?: string }
  ): IPromiseReturnedData<{ url: string }> {
    try {
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor || !paymentProcessor.accountId) {
        throw new BadRequestError({
          message: 'No Connect account found.',
        });
      }

      const baseUrl = envVariables.FRONTEND.URL || 'http://localhost:3000';
      const fallback = getPaymentProcessorUrls(baseUrl, cuid);
      // Express accounts only support account_onboarding type — Stripe shows the
      // appropriate update form when the account is already verified.
      const linkResult = await this.paymentGatewayService.createKycOnboardingLink(
        IPaymentGatewayProvider.STRIPE,
        {
          accountId: paymentProcessor.accountId,
          refreshUrl: urlOverrides?.refreshUrl || fallback.refreshUrl,
          returnUrl: urlOverrides?.returnUrl || fallback.accountUpdateReturnUrl,
        }
      );

      if (!linkResult.success || !linkResult.data) {
        throw new BadRequestError({
          message: linkResult.message || 'Failed to create account update link',
        });
      }

      return {
        success: true,
        data: { url: linkResult.data.url },
        message: 'Account update link created successfully',
      };
    } catch (error) {
      this.log.error('Error creating account update link', error);
      throw error;
    }
  }

  async getExternalDashboardLoginLink(cuid: string): IPromiseReturnedData<{ url: string }> {
    try {
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor || !paymentProcessor.accountId) {
        throw new BadRequestError({
          message: 'No Connect account found',
        });
      }

      const linkResult = await this.paymentGatewayService.createDashboardLoginLink(
        IPaymentGatewayProvider.STRIPE,
        paymentProcessor.accountId
      );

      if (!linkResult.success || !linkResult.data) {
        throw new BadRequestError({ message: linkResult.message || 'Failed to create login link' });
      }

      return {
        success: true,
        data: { url: linkResult.data.url },
        message: 'Login link created successfully',
      };
    } catch (error) {
      this.log.error('Error creating login link', error);
      throw error;
    }
  }

  async getPayoutBalance(cuid: string): IPromiseReturnedData<any> {
    try {
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor?.accountId) {
        throw new NotFoundError({ message: 'No Connect account found for this client' });
      }
      if (!paymentProcessor.payoutsEnabled) {
        throw new BadRequestError({ message: 'Payouts are not enabled for this account' });
      }

      const result = await this.paymentGatewayService.getConnectBalance(
        IPaymentGatewayProvider.STRIPE,
        paymentProcessor.accountId
      );
      if (!result.success || !result.data) {
        throw new BadRequestError({ message: result.message || 'Failed to fetch balance' });
      }

      const balance = result.data as IStripeBalanceData;
      return {
        success: true,
        data: {
          available: balance.available.map((b) => ({ amount: b.amount, currency: b.currency })),
          pending: balance.pending.map((b) => ({ amount: b.amount, currency: b.currency })),
        },
      };
    } catch (error) {
      this.log.error('Error fetching payout balance', error);
      throw error;
    }
  }

  async getPayoutHistory(
    cuid: string,
    query: { limit?: number; cursor?: string }
  ): IPromiseReturnedData<any> {
    try {
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor?.accountId) {
        throw new NotFoundError({ message: 'No Connect account found for this client' });
      }
      if (!paymentProcessor.payoutsEnabled) {
        throw new BadRequestError({ message: 'Payouts are not enabled for this account' });
      }

      const result = await this.paymentGatewayService.listConnectPayouts(
        IPaymentGatewayProvider.STRIPE,
        paymentProcessor.accountId,
        { limit: query.limit, starting_after: query.cursor }
      );
      if (!result.success || !result.data) {
        throw new BadRequestError({ message: result.message || 'Failed to fetch payouts' });
      }

      const list = result.data as IStripePayoutList;
      const payouts = list.data.map((p) => ({
        id: p.id,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        arrivalDate: new Date(p.arrival_date * 1000).toISOString(),
        createdAt: new Date(p.created * 1000).toISOString(),
        description: p.description ?? undefined,
      }));

      return {
        success: true,
        data: {
          payouts,
          hasMore: list.has_more,
          nextCursor: list.has_more ? list.data[list.data.length - 1]?.id : undefined,
        },
      };
    } catch (error) {
      this.log.error('Error fetching payout history', error);
      throw error;
    }
  }

  async getPayoutSchedule(cuid: string): IPromiseReturnedData<IPayoutSchedule> {
    try {
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor?.accountId) {
        throw new NotFoundError({ message: 'No Connect account found for this client' });
      }

      const result = await this.paymentGatewayService.getPayoutSchedule(
        IPaymentGatewayProvider.STRIPE,
        paymentProcessor.accountId
      );
      if (!result.success || !result.data) {
        throw new BadRequestError({ message: result.message || 'Failed to fetch payout schedule' });
      }

      return { success: true, data: result.data };
    } catch (error) {
      this.log.error('Error fetching payout schedule', error);
      throw error;
    }
  }

  async updatePayoutSchedule(
    cuid: string,
    interval: 'daily' | 'weekly' | 'monthly',
    weeklyAnchor?: string
  ): IPromiseReturnedData<null> {
    try {
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor?.accountId) {
        throw new NotFoundError({ message: 'No Connect account found for this client' });
      }
      if (!paymentProcessor.payoutsEnabled) {
        throw new BadRequestError({ message: 'Payouts are not enabled for this account' });
      }

      const result = await this.paymentGatewayService.updatePayoutSchedule(
        IPaymentGatewayProvider.STRIPE,
        paymentProcessor.accountId,
        interval,
        weeklyAnchor
      );
      if (!result.success) {
        throw new BadRequestError({
          message: result.message || 'Failed to update payout schedule',
        });
      }

      this.log.info({ cuid, interval, weeklyAnchor }, 'Payout schedule updated');
      return { success: true, data: null, message: 'Payout schedule updated successfully' };
    } catch (error) {
      this.log.error('Error updating payout schedule', error);
      throw error;
    }
  }

  /**
   * Build invoice line items from pre-calculated lease fees
   * Accepts already-calculated fees to avoid redundant calculations
   *
   * @param fees - Pre-calculated fees from lease.calculateFees()
   * @returns Array of line items with amounts in cents
   */
  private buildLineItemsFromFees(
    fees: {
      monthly: { rent: number; petFee: number; total: number };
      late: {
        daysLate: number;
        fee: number;
        type: string;
        percentage: number;
        gracePeriod: number;
      };
      deposits: { security: number; pet: number; total: number };
      currency: string;
    },
    options?: {
      isFirstPayment?: boolean;
      startDate?: Date;
      managementFee?: number;
    }
  ): Array<{
    description: string;
    amountInCents: number;
    quantity?: number;
  }> {
    const lineItems = [];

    // Monthly rent — pro-rated on first payment when tenant moves in mid-month
    if (fees.monthly.rent > 0) {
      let rentAmount = fees.monthly.rent;
      let rentDescription = 'Monthly Rent';

      if (options?.isFirstPayment && options?.startDate) {
        const proRated = calculateProRatedAmount(fees.monthly.rent, options.startDate);
        if (!proRated.isFullMonth) {
          rentAmount = proRated.amount;
          const start = new Date(options.startDate);
          const monthName = start.toLocaleString('en-US', { month: 'short' });
          rentDescription = `Pro-rated Rent (${monthName}: ${proRated.daysCharged} of ${proRated.daysInMonth} days)`;
        }
      }

      lineItems.push({ description: rentDescription, amountInCents: rentAmount });
    }

    // Pet fee (if applicable)
    if (fees.monthly.petFee > 0) {
      lineItems.push({
        description: 'Pet Fee',
        amountInCents: fees.monthly.petFee,
      });
    }

    // Management fee (if applicable — sourced from property, billed when lease opts in)
    if (options?.managementFee && options.managementFee > 0) {
      lineItems.push({
        description: 'Management Fee',
        amountInCents: options.managementFee,
      });
    }

    // Late fee (if applicable)
    if (fees.late.fee > 0) {
      const lateFeeDesc =
        fees.late.type === 'percentage'
          ? `Late Fee (${fees.late.percentage}% - ${fees.late.daysLate} days late)`
          : `Late Fee (${fees.late.daysLate} days late)`;

      lineItems.push({
        description: lateFeeDesc,
        amountInCents: fees.late.fee,
      });
    }

    // Security deposit — collected once with the first payment
    if (options?.isFirstPayment && fees.deposits.security > 0) {
      lineItems.push({
        description: 'Security Deposit',
        amountInCents: fees.deposits.security,
      });
    }

    // Pet deposit — collected once with the first payment
    if (options?.isFirstPayment && fees.deposits.pet > 0) {
      lineItems.push({
        description: 'Pet Deposit',
        amountInCents: fees.deposits.pet,
      });
    }

    // Validate we have at least one line item
    if (lineItems.length === 0) {
      throw new Error('No valid fees found on lease');
    }

    return lineItems;
  }

  /**
   * Webhook handler: invoice.payment_succeeded
   * Updates payment status when tenant pays rent invoice
   *
   * @param invoiceId - Stripe invoice ID (stored in Payment.gatewayPaymentId)
   * @param invoiceData - Full invoice object from Stripe webhook
   */
  async handleInvoicePaymentSucceeded(
    invoiceId: string,
    invoiceData: IStripeInvoiceWebhookData
  ): IPromiseReturnedData<void> {
    try {
      const payment = await this.paymentDAO.findFirst({
        gatewayPaymentId: invoiceId,
        deletedAt: null,
      });

      if (!payment) {
        this.log.warn('Payment not found for invoice', { invoiceId });
        return {
          success: false,
          data: undefined,
          message: 'Payment record not found',
        };
      }

      if (payment.status === PaymentRecordStatus.PAID) {
        this.log.info('Payment already marked as paid', { invoiceId, pytuid: payment.pytuid });
        return {
          success: true,
          data: undefined,
          message: 'Payment already paid',
        };
      }

      const chargeId = invoiceData.charge;
      if (!chargeId) {
        this.log.warn('No charge ID found in invoice', { invoiceId });
      }

      const hostedInvoiceUrl = invoiceData.hosted_invoice_url || null;

      await this.paymentDAO.update(
        { _id: payment._id, cuid: payment.cuid },
        {
          $set: {
            status: PaymentRecordStatus.PAID,
            paidAt: new Date(),
            gatewayChargeId: chargeId,
            ...(hostedInvoiceUrl && { 'receipt.url': hostedInvoiceUrl }),
          },
        }
      );

      this.log.info('Payment marked as paid', {
        pytuid: payment.pytuid,
        invoiceId,
        chargeId,
      });

      this.emitterService.emit(EventTypes.PAYMENT_SUCCEEDED, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        invoiceId,
        amount: payment.baseAmount,
        paidAt: new Date(),
      });

      return {
        success: true,
        data: undefined,
        message: 'Payment updated successfully',
      };
    } catch (error: any) {
      this.log.error('Error handling invoice payment succeeded', { invoiceId, error });
      throw error;
    }
  }

  /**
   * Webhook handler: invoice.payment_failed
   * Updates payment status when tenant's payment fails
   *
   * @param invoiceId - Stripe invoice ID
   * @param invoiceData - Full invoice object from Stripe webhook
   */
  async handleInvoicePaymentFailed(
    invoiceId: string,
    invoiceData: IStripeInvoiceWebhookData
  ): IPromiseReturnedData<void> {
    try {
      const payment = await this.paymentDAO.findFirst({
        gatewayPaymentId: invoiceId,
        deletedAt: null,
      });

      if (!payment) {
        this.log.warn('Payment not found for failed invoice', { invoiceId });
        return {
          success: false,
          data: undefined,
          message: 'Payment record not found',
        };
      }

      const attemptCount = invoiceData.attempt_count || 0;
      const nextPaymentAttempt = invoiceData.next_payment_attempt
        ? new Date(invoiceData.next_payment_attempt * 1000)
        : undefined;

      await this.paymentDAO.update(
        { _id: payment._id, cuid: payment.cuid },
        {
          $set: {
            status: PaymentRecordStatus.FAILED,
            'failure.reason': invoiceData.last_payment_error?.message,
            'failure.lastFailedAt': new Date(),
          },
        }
      );

      this.log.warn('Payment marked as failed', {
        pytuid: payment.pytuid,
        invoiceId,
        attemptCount,
        nextPaymentAttempt,
      });

      this.emitterService.emit(EventTypes.PAYMENT_FAILED, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        invoiceId,
      });

      return {
        success: true,
        data: undefined,
        message: 'Payment marked as failed',
      };
    } catch (error: any) {
      this.log.error('Error handling invoice payment failed', { invoiceId, error });
      throw error;
    }
  }

  /**
   * Webhook handler: charge.refunded
   * Updates payment status when rent payment is refunded
   *
   * @param chargeId - Stripe charge ID
   * @param chargeData - Full charge object from Stripe webhook
   */
  async handleChargeRefunded(
    chargeId: string,
    chargeData: IStripeChargeWebhookData
  ): IPromiseReturnedData<void> {
    try {
      const payment = await this.paymentDAO.findFirst({
        gatewayChargeId: chargeId,
        deletedAt: null,
      });

      if (!payment) {
        this.log.warn('Payment not found for refunded charge', { chargeId });
        return {
          success: false,
          data: undefined,
          message: 'Payment record not found',
        };
      }

      const refundAmountInCents = chargeData.amount_refunded || 0;

      await this.paymentDAO.update(
        { _id: payment._id, cuid: payment.cuid },
        {
          $set: {
            status: PaymentRecordStatus.REFUNDED,
            'refund.refundedAt': new Date(),
            'refund.amount': refundAmountInCents,
          },
        }
      );

      this.log.info('Payment refund processed via webhook', {
        pytuid: payment.pytuid,
        chargeId,
        refundAmount: refundAmountInCents,
      });

      this.emitterService.emit(EventTypes.PAYMENT_REFUNDED, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        chargeId,
        refundAmount: refundAmountInCents,
      });

      return {
        success: true,
        data: undefined,
        message: 'Refund processed successfully',
      };
    } catch (error: any) {
      this.log.error('Error handling charge refunded', { chargeId, error });
      throw error;
    }
  }

  async refundPayment(
    cuid: string,
    pytuid: string,
    requestingUserSub: string,
    data: IRefundPaymentData
  ): IPromiseReturnedData<IPaymentDocument> {
    try {
      if (!cuid || !pytuid) {
        throw new BadRequestError({ message: 'Client ID and payment ID are required' });
      }

      const payment = await this.paymentDAO.findFirst({ pytuid, cuid, deletedAt: null });
      if (!payment) {
        throw new NotFoundError({ message: 'Payment not found' });
      }

      // Prevent conflict of interest: cannot refund a payment where you are the tenant
      const tenantProfile = await this.profileDAO.findFirst({ _id: payment.tenant });
      preventTenantConflict(requestingUserSub, tenantProfile?.user);

      if (payment.status !== PaymentRecordStatus.PAID) {
        throw new BadRequestError({
          message: `Cannot refund a payment with status: ${payment.status}`,
        });
      }

      if (!payment.gatewayChargeId) {
        throw new BadRequestError({
          message: 'Refunds are only available for online payments processed through Stripe',
        });
      }

      if (data.amount && data.amount > payment.baseAmount) {
        throw new BadRequestError({
          message: `Refund amount cannot exceed the original payment amount of ${payment.baseAmount}`,
        });
      }

      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor?.accountId) {
        throw new BadRequestError({ message: 'Payment processor not configured for this account' });
      }

      await this.paymentGatewayService.createRefund(IPaymentGatewayProvider.STRIPE, {
        chargeId: payment.gatewayChargeId,
        amountInCents: data.amount,
        reason: data.reason,
      });

      const updated = await this.paymentDAO.updateById(payment._id.toString(), {
        status: PaymentRecordStatus.REFUNDED,
        'refund.refundedAt': new Date(),
        'refund.amount': data.amount || payment.baseAmount,
        'refund.reason': data.reason,
      });

      this.log.info('Payment refund initiated', {
        pytuid: payment.pytuid,
        refundAmount: data.amount || payment.baseAmount,
        isPartial: !!data.amount && data.amount < payment.baseAmount,
      });

      return { success: true, data: updated as IPaymentDocument };
    } catch (error: any) {
      this.log.error({ error: error.message, cuid, pytuid }, 'Error refunding payment');
      throw error;
    }
  }

  /**
   * Webhook handler: account.updated
   * Updates PaymentProcessor when PM's Stripe Connect account changes
   *
   * @param accountId - Stripe Connect account ID
   * @param accountData - Full account object from Stripe webhook
   */
  async handleAccountUpdated(
    accountId: string,
    accountData: IStripeAccountWebhookData
  ): IPromiseReturnedData<null> {
    try {
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({
        accountId,
      });

      if (!paymentProcessor) {
        this.log.warn('PaymentProcessor not found for account', { accountId });
        return {
          success: false,
          data: null,
          message: 'PaymentProcessor record not found',
        };
      }

      const justVerified = !paymentProcessor.payoutsEnabled && accountData.payouts_enabled;

      const updateData: Record<string, unknown> = {
        chargesEnabled: accountData.charges_enabled || false,
        payoutsEnabled: accountData.payouts_enabled || false,
        detailsSubmitted: accountData.details_submitted || false,
        ...(justVerified && { onboardedAt: new Date() }),
      };

      if (accountData.requirements) {
        updateData.requirements = {
          currentlyDue: accountData.requirements.currently_due || [],
          eventuallyDue: accountData.requirements.eventually_due || [],
          pastDue: accountData.requirements.past_due || [],
          disabledReason: accountData.requirements.disabled_reason,
        };
      }

      await this.paymentProcessorDAO.update({ _id: paymentProcessor._id }, { $set: updateData });

      this.log.info('PaymentProcessor updated from webhook', {
        accountId,
        justVerified,
        chargesEnabled: updateData.chargesEnabled,
        payoutsEnabled: updateData.payoutsEnabled,
        detailsSubmitted: updateData.detailsSubmitted,
      });

      if (justVerified) {
        this.emitterService.emit(EventTypes.PAYMENT_PROCESSOR_VERIFIED, {
          cuid: paymentProcessor.cuid,
          accountId,
          verifiedAt: new Date(),
        });
      }

      return {
        data: null,
        success: true,
        message: 'PaymentProcessor updated successfully',
      };
    } catch (error: any) {
      this.log.error('Error handling account updated', { accountId, error });
      throw error;
    }
  }

  /**
   * Webhook handler: checkout.session.completed (Connect)
   * Stores the confirmed payment method ID on the tenant's profile so we know
   * a bank account is on file without relying on the browser return redirect.
   */
  async handleSetupSessionCompleted(
    session: {
      mode: string;
      id: string;
      customer?: string | null;
      metadata?: Record<string, string> | null;
      setup_intent?: string | null;
    },
    _source: string
  ): Promise<void> {
    if (session.mode !== 'setup') return;

    const tenantId = session.metadata?.tenantId;
    const cuid = session.metadata?.cuid;
    if (!tenantId || !cuid) {
      this.log.warn(
        { sessionId: session.id },
        'Setup session completed with no metadata — skipping'
      );
      return;
    }

    if (!session.setup_intent) {
      this.log.warn({ sessionId: session.id }, 'Setup session has no setup_intent — skipping');
      return;
    }

    const setupIntentResult = await this.paymentGatewayService.retrieveSetupIntent(
      IPaymentGatewayProvider.STRIPE,
      session.setup_intent
    );

    if (!setupIntentResult.success || !setupIntentResult.data?.paymentMethodId) {
      this.log.warn(
        { sessionId: session.id },
        'Could not retrieve payment method from setup intent'
      );
      return;
    }

    const { paymentMethodId, mandateId } = setupIntentResult.data;
    await this.saveTenantSetupPaymentMethod({
      tenantId,
      cuid,
      customerId: session.customer ?? null,
      paymentMethodId,
      mandateId,
      sourceId: session.id,
      sourceType: 'checkout.session.completed',
    });
  }

  async handleSetupIntentSucceeded(setupIntent: {
    id: string;
    metadata?: Record<string, string> | null;
    customer?: string | { id?: string } | null;
    payment_method?: string | { id?: string } | null;
    mandate?: string | { id?: string } | null;
  }): Promise<void> {
    const tenantId = setupIntent.metadata?.tenantId;
    const cuid = setupIntent.metadata?.cuid;
    const paymentMethodId =
      typeof setupIntent.payment_method === 'string'
        ? setupIntent.payment_method
        : (setupIntent.payment_method?.id ?? '');
    const mandateId =
      typeof setupIntent.mandate === 'string'
        ? setupIntent.mandate
        : (setupIntent.mandate?.id ?? null);
    const customerId =
      typeof setupIntent.customer === 'string'
        ? setupIntent.customer
        : (setupIntent.customer?.id ?? null);

    if (!tenantId || !cuid || !paymentMethodId) {
      this.log.warn(
        { setupIntentId: setupIntent.id, hasTenantId: !!tenantId, hasCuid: !!cuid },
        'Setup intent succeeded without required metadata or payment method — skipping'
      );
      return;
    }

    await this.saveTenantSetupPaymentMethod({
      tenantId,
      cuid,
      customerId,
      paymentMethodId,
      mandateId,
      sourceId: setupIntent.id,
      sourceType: 'setup_intent.succeeded',
    });
  }

  private async saveTenantSetupPaymentMethod(input: {
    tenantId: string;
    cuid: string;
    customerId?: string | null;
    paymentMethodId: string;
    mandateId?: string | null;
    sourceId: string;
    sourceType: string;
  }): Promise<void> {
    const { tenantId, cuid, customerId, paymentMethodId, mandateId, sourceId, sourceType } = input;

    const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
    const pmAccountId = paymentProcessor?.accountId;
    if (!pmAccountId) {
      this.log.warn(
        { sourceId, sourceType, cuid },
        'No payment processor found for cuid — skipping'
      );
      return;
    }

    const paymentMethodResult = await this.paymentGatewayService.retrievePaymentMethod(
      IPaymentGatewayProvider.STRIPE,
      paymentMethodId
    );
    const bankDebitTypes = new Set(['us_bank_account', 'acss_debit', 'sepa_debit', 'bacs_debit']);

    if (
      paymentMethodResult.data?.type &&
      bankDebitTypes.has(paymentMethodResult.data.type) &&
      !mandateId
    ) {
      this.log.warn(
        {
          sourceId,
          sourceType,
          paymentMethodId,
          paymentMethodType: paymentMethodResult.data.type,
        },
        'Setup flow produced a bank debit payment method without a mandate — not saving'
      );
      return;
    }

    // Keyed by PM's accountId so tenants renting from multiple PMs have separate methods
    const profileUpdate: Record<string, any> = {
      [`tenantInfo.paymentMethods.${pmAccountId}`]: paymentMethodId,
    };
    if (mandateId) {
      profileUpdate[`tenantInfo.paymentMandates.${pmAccountId}`] = mandateId;
    }

    await this.profileDAO.update({ user: new Types.ObjectId(tenantId) }, { $set: profileUpdate });

    if (customerId) {
      await this.paymentGatewayService.updateCustomerDefaultPaymentMethod(
        IPaymentGatewayProvider.STRIPE,
        customerId,
        paymentMethodId
      );
    }

    this.log.info(
      { tenantId, cuid, paymentMethodId, mandateId, pmAccountId, sourceType },
      'Tenant payment method saved from webhook'
    );

    this.emitterService.emit(EventTypes.PAYMENT_METHOD_SETUP_COMPLETED, {
      tenantId,
      cuid,
      paymentMethodId,
      pmAccountId,
    });
  }

  /**
   * Webhook handler: charge.dispute.created
   * Reverses the transfer to recover disputed funds from PM, then notifies PM.
   */
  async handleDisputeCreated(
    disputeId: string,
    disputeData: IStripeDisputeWebhookData
  ): IPromiseReturnedData<void> {
    try {
      const chargeId =
        typeof disputeData.charge === 'string' ? disputeData.charge : disputeData.charge?.id;
      if (!chargeId) {
        this.log.warn('No charge ID in dispute data', { disputeId });
        return { success: false, data: undefined, message: 'No charge ID in dispute data' };
      }
      const amount: number = disputeData.amount;
      const currency: string = disputeData.currency;
      const reason: string = disputeData.reason || 'unknown';

      const payment = await this.paymentDAO.findFirst({
        gatewayChargeId: chargeId,
        deletedAt: null,
      });
      if (!payment) {
        this.log.warn('Payment not found for disputed charge', { chargeId, disputeId });
        return { success: false, data: undefined, message: 'Payment record not found' };
      }

      // Get the original charge to find the transfer ID, then reverse it
      const chargeResult = await this.paymentGatewayService.getCharge(
        IPaymentGatewayProvider.STRIPE,
        chargeId
      );
      const transferRaw = chargeResult.data?.transfer;
      const transfer = transferRaw as string | { id: string } | undefined;
      const transferId = typeof transfer === 'string' ? transfer : transfer?.id;

      if (transferId) {
        try {
          await this.paymentGatewayService.createTransferReversal(
            IPaymentGatewayProvider.STRIPE,
            transferId,
            amount
          );
          this.log.info('Transfer reversed for dispute', { disputeId, transferId, amount });
        } catch (reversalError: any) {
          this.log.error('Transfer reversal failed — blocking payouts', {
            disputeId,
            transferId,
            error: reversalError,
          });
          await this.paymentProcessorDAO.update(
            { cuid: payment.cuid },
            {
              $set: {
                payoutsBlocked: true,
                payoutsBlockedReason: `Transfer reversal failed for dispute ${disputeId}`,
                payoutsBlockedAt: new Date(),
              },
            }
          );
          this.emitterService.emit(EventTypes.PAYMENT_DISPUTE_REVERSAL_FAILED, {
            cuid: payment.cuid,
            pytuid: payment.pytuid,
            disputeId,
            transferId,
            amount,
            currency,
          });
        }
      } else {
        this.log.warn('No transfer on charge — skipping reversal', { chargeId, disputeId });
      }

      await this.paymentDAO.update(
        { _id: payment._id },
        {
          $set: {
            'dispute.disputeId': disputeId,
            'dispute.amount': amount,
            'dispute.reason': reason,
            'dispute.disputedAt': new Date(),
            'dispute.status': 'open',
          },
        }
      );

      // Increment dispute stats on the payment processor
      await this.paymentProcessorDAO.update(
        { cuid: payment.cuid },
        {
          $inc: { 'disputeStats.total': 1, 'disputeStats.open': 1 },
          $set: { 'disputeStats.lastDisputeAt': new Date() },
        }
      );

      this.emitterService.emit(EventTypes.PAYMENT_DISPUTE_CREATED, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        disputeId,
        invoiceNumber: payment.invoiceNumber,
        chargeId,
        amount,
        currency,
        reason,
      });

      this.log.info('Dispute handled — transfer reversed, PM notified', {
        disputeId,
        chargeId,
        pytuid: payment.pytuid,
      });
      return { success: true, data: undefined, message: 'Dispute handled' };
    } catch (error: any) {
      this.log.error('Error handling dispute created', { disputeId, error });
      throw error;
    }
  }

  /**
   * Webhook handler: charge.dispute.funds_reinstated
   * Platform won the dispute — re-transfer funds back to PM.
   */
  async handleDisputeWon(
    disputeId: string,
    disputeData: IStripeDisputeWebhookData
  ): IPromiseReturnedData<void> {
    try {
      const chargeId =
        typeof disputeData.charge === 'string' ? disputeData.charge : disputeData.charge?.id;
      if (!chargeId) {
        this.log.warn('No charge ID in dispute data', { disputeId });
        return { success: false, data: undefined, message: 'No charge ID in dispute data' };
      }
      const amount: number = disputeData.amount;
      const currency: string = disputeData.currency;

      const payment = await this.paymentDAO.findFirst({
        gatewayChargeId: chargeId,
        deletedAt: null,
      });
      if (!payment) {
        this.log.warn('Payment not found for won dispute charge', { chargeId, disputeId });
        return { success: false, data: undefined, message: 'Payment record not found' };
      }

      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid: payment.cuid });
      if (!paymentProcessor?.accountId) {
        this.log.warn('Payment processor not found for won dispute', {
          cuid: payment.cuid,
          disputeId,
        });
        return { success: false, data: undefined, message: 'Payment processor not found' };
      }

      // Re-transfer the disputed amount back to the PM
      await this.paymentGatewayService.createTransfer(IPaymentGatewayProvider.STRIPE, {
        amountInCents: amount,
        currency,
        destination: paymentProcessor.accountId,
        metadata: { disputeId, reason: 'dispute_won', invoiceNumber: payment.invoiceNumber },
      });

      await this.paymentDAO.update(
        { _id: payment._id },
        { $set: { 'dispute.status': 'won', 'dispute.resolvedAt': new Date() } }
      );

      // Decrement open dispute count
      await this.paymentProcessorDAO.update(
        { cuid: payment.cuid, 'disputeStats.open': { $gt: 0 } },
        { $inc: { 'disputeStats.open': -1 } }
      );

      this.emitterService.emit(EventTypes.PAYMENT_DISPUTE_WON, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        disputeId,
        invoiceNumber: payment.invoiceNumber,
        chargeId,
        amount,
        currency,
      });

      this.log.info('Dispute won — PM re-transferred and notified', {
        disputeId,
        chargeId,
        pytuid: payment.pytuid,
      });
      return { success: true, data: undefined, message: 'Dispute won handled' };
    } catch (error: any) {
      this.log.error('Error handling dispute won', { disputeId, error });
      throw error;
    }
  }

  /**
   * Webhook handler: charge.dispute.closed (status=lost)
   * Blocks PM payouts — platform is liable for the disputed amount.
   */
  async handleDisputeLost(
    disputeId: string,
    disputeData: IStripeDisputeWebhookData
  ): IPromiseReturnedData<void> {
    try {
      const chargeId =
        typeof disputeData.charge === 'string' ? disputeData.charge : disputeData.charge?.id;
      if (!chargeId) {
        this.log.warn('No charge ID in dispute data', { disputeId });
        return { success: false, data: undefined, message: 'No charge ID in dispute data' };
      }
      const amount: number = disputeData.amount;
      const currency: string = disputeData.currency;

      const payment = await this.paymentDAO.findFirst({
        gatewayChargeId: chargeId,
        deletedAt: null,
      });
      if (!payment) {
        this.log.warn('Payment not found for lost dispute charge', { chargeId, disputeId });
        return { success: false, data: undefined, message: 'Payment record not found' };
      }

      await this.paymentProcessorDAO.update(
        { cuid: payment.cuid },
        {
          $set: {
            payoutsBlocked: true,
            payoutsBlockedReason: `Dispute ${disputeId} lost — funds debited from platform account`,
            payoutsBlockedAt: new Date(),
          },
        }
      );

      // Decrement open dispute count
      await this.paymentProcessorDAO.update(
        { cuid: payment.cuid, 'disputeStats.open': { $gt: 0 } },
        { $inc: { 'disputeStats.open': -1 } }
      );

      await this.paymentDAO.update(
        { _id: payment._id },
        { $set: { 'dispute.status': 'lost', 'dispute.resolvedAt': new Date() } }
      );

      this.emitterService.emit(EventTypes.PAYMENT_DISPUTE_LOST, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        disputeId,
        invoiceNumber: payment.invoiceNumber,
        chargeId,
        amount,
        currency,
      });

      this.log.info('Dispute lost — payouts blocked, PM notified', {
        disputeId,
        chargeId,
        pytuid: payment.pytuid,
      });
      return { success: true, data: undefined, message: 'Dispute lost handled' };
    } catch (error: any) {
      this.log.error('Error handling dispute lost', { disputeId, error });
      throw error;
    }
  }

  /**
   * Get payment statistics
   * Calculates stats on-demand from payment records for current month
   */
  async getPaymentStats(
    cuid: string,
    context?: IRequestContext,
    tenantId?: string
  ): IPromiseReturnedData<{
    expectedRevenue: number;
    collected: number;
    pending: number;
    overdue: number;
    refunded: number;
    collectionRate: number;
    currency: string;
  }> {
    try {
      const client = await this.clientDAO.findFirst({ cuid });
      if (!client) {
        throw new NotFoundError({ message: 'Client not found' });
      }

      // Tenant role: always scope to own payments — ignore any caller-supplied tenantId
      // Non-tenant (PM/admin): use provided tenantId to filter stats for a specific tenant
      const daoFilters: Record<string, any> = {};
      if (context?.currentuser?.client?.role === 'tenant') {
        const profile = await this.profileDAO.findFirst({
          user: new Types.ObjectId(context.currentuser.sub),
        });
        if (profile) {
          daoFilters.tenantId = profile._id.toString();
        }
      } else if (tenantId) {
        daoFilters.tenantId = tenantId;
      }

      // Fetch ALL payments for this client across all time (no date filter).
      // Overdue payments from past months are still outstanding and relevant —
      // restricting to current month would hide unpaid historical debt.
      const result = await this.paymentDAO.findByCuid(cuid, daoFilters, { limit: 10000 });
      const allPayments = result.items || [];

      // Running totals — all values are in cents (e.g. 150000 = $1,500.00)
      let expectedRevenue = 0; // PAID + PENDING + OVERDUE (excludes CANCELLED, FAILED, REFUNDED)
      let collected = 0; // Sum of all PAID payments (baseAmount)
      let pending = 0; // Sum of all PENDING payments (baseAmount)
      let overdue = 0; // Sum of all OVERDUE payments (baseAmount)
      let refunded = 0; // Sum of all REFUNDED amounts (refundAmount if partial, else baseAmount)

      // Collection rate is rent-specific: how much expected rent has been collected.
      // Maintenance charges, late fees, and deposits skew this metric if included.
      let rentExpected = 0;
      let rentCollected = 0;

      allPayments.forEach((payment) => {
        // baseAmount is stored in cents. Guard against missing values on legacy records.
        const amount = payment.baseAmount ?? 0;
        const isRent = payment.paymentType === PaymentRecordType.RENT;

        switch (payment.status) {
          // CANCELLED and FAILED payments are excluded from all stats —
          // they were never collected and are no longer expected.
          case PaymentRecordStatus.CANCELLED:
          case PaymentRecordStatus.FAILED:
            break;

          // REFUNDED: use refundAmount (partial refund) or full baseAmount (full refund).
          // Refunded payments are excluded from expectedRevenue since the money was returned.
          case PaymentRecordStatus.REFUNDED:
            refunded += payment.refund?.amount || amount;
            break;

          // PENDING: payment is due but not yet collected.
          // Counts toward expectedRevenue because it is expected to be paid.
          case PaymentRecordStatus.PENDING:
            expectedRevenue += amount;
            pending += amount;
            if (isRent) rentExpected += amount;
            break;

          // OVERDUE: payment is past its due date and still unpaid.
          // Counts toward expectedRevenue — the money is owed and tracked.
          case PaymentRecordStatus.OVERDUE:
            expectedRevenue += amount;
            overdue += amount;
            if (isRent) rentExpected += amount;
            break;

          // PAID: payment was successfully collected.
          // Counts toward both expectedRevenue and collected.
          case PaymentRecordStatus.PAID:
            expectedRevenue += amount;
            collected += amount;
            if (isRent) {
              rentExpected += amount;
              rentCollected += amount;
            }
            break;

          default:
            this.log.warn('Unknown payment status encountered', {
              status: payment.status,
              pytuid: payment.pytuid,
            });
            break;
        }
      });

      // collectionRate = rent collected / rent expected × 100.
      // Scoped to RENT-only so maintenance charges and late fees don't skew the metric.
      const collectionRate = calcCollectionRate(rentCollected, rentExpected);

      return {
        success: true,
        data: {
          expectedRevenue, // PAID + PENDING + OVERDUE (in cents)
          collected, // PAID only (in cents)
          pending, // PENDING only (in cents)
          overdue, // OVERDUE only (in cents)
          refunded, // REFUNDED amounts (in cents)
          collectionRate, // percentage (0–100)
          currency: allPayments[0]?.currency ?? 'USD',
        },
      };
    } catch (error: any) {
      this.log.error('Error getting payment stats', error);
      throw error;
    }
  }

  async cancelPayment(
    cuid: string,
    pytuid: string,
    reason?: string
  ): IPromiseReturnedData<IPaymentDocument> {
    try {
      if (!cuid || !pytuid) {
        throw new BadRequestError({ message: 'Client ID and payment ID are required' });
      }

      const client = await this.clientDAO.findFirst({ cuid });
      if (!client) {
        throw new NotFoundError({ message: 'Client not found' });
      }

      const payment = await this.paymentDAO.findFirst({
        pytuid,
        cuid,
        deletedAt: null,
      });
      if (!payment) {
        throw new NotFoundError({ message: 'Payment not found' });
      }

      if (
        payment.status === PaymentRecordStatus.PAID ||
        payment.status === PaymentRecordStatus.CANCELLED
      ) {
        throw new BadRequestError({
          message: `Cannot cancel a payment with status: ${payment.status}`,
        });
      }

      if (payment.gatewayPaymentId) {
        const voidResult = await this.paymentGatewayService.voidInvoice(
          IPaymentGatewayProvider.STRIPE,
          payment.gatewayPaymentId
        );
        if (!voidResult.success) {
          this.log.warn(
            { pytuid, invoiceId: payment.gatewayPaymentId, message: voidResult.message },
            'Failed to void Stripe invoice — proceeding with local cancellation'
          );
        }
      }

      const updated = await this.paymentDAO.updateById(payment._id.toString(), {
        status: PaymentRecordStatus.CANCELLED,
        $unset: { gatewayPaymentId: 1 },
        ...(reason
          ? {
              $push: {
                notes: { text: `Cancelled: ${reason}`, createdAt: new Date(), author: 'system' },
              },
            }
          : {}),
      });

      try {
        const tenantProfile = await this.profileDAO.findById(payment.tenant.toString());
        if (tenantProfile?.user) {
          this.emitterService.emit(EventTypes.PAYMENT_CANCELLED, {
            tenantUserId: tenantProfile.user.toString(),
            amountInCents: payment.baseAmount,
            reason,
            pytuid,
            cuid,
          });
        }
      } catch (emitError) {
        this.log.error('Failed to emit payment cancelled event', { emitError, pytuid, cuid });
      }

      return { success: true, data: updated as IPaymentDocument };
    } catch (error: any) {
      this.log.error({ error: error.message, cuid, pytuid }, 'Error cancelling payment');
      throw error;
    }
  }

  /**
   * Map a lease's acceptedPaymentMethod string to the PaymentMethod enum.
   * Only called for non-auto-debit leases (auto-debit goes through Stripe).
   */
  /**
   * Queue a payment-request notification email to the tenant.
   * Called from all createRentPayment exit paths when notifyByEmail is true.
   */
  private async queuePaymentRequestEmail(opts: {
    cuid: string;
    tenantId: string;
    lease: ILeaseDocument;
    amountInCents: number;
    currency: string;
    paymentType: PaymentRecordType;
    dueDate: Date | string;
    description?: string;
  }): Promise<void> {
    try {
      const profile = (await this.profileDAO.findFirst(
        { user: opts.tenantId },
        { populate: ['user'] }
      )) as IProfileWithUser | null;
      const tenantEmail = profile?.user?.email;
      if (!tenantEmail) {
        this.log.warn(
          { tenantId: opts.tenantId },
          'Cannot send payment request email — no email found for tenant'
        );
        return;
      }

      const tenantName =
        `${profile?.personalInfo?.firstName ?? ''} ${profile?.personalInfo?.lastName ?? ''}`.trim() ||
        tenantEmail;

      const addr = opts.lease.property?.address;
      const propertyAddress =
        (typeof addr === 'string' ? addr : addr?.fullAddress) ?? 'your property';
      const unitNumber = opts.lease.property?.unitNumber ?? '';
      const paymentTypeLabel =
        opts.paymentType === PaymentRecordType.LATE_FEE ? 'Late Fee' : 'Rent';

      const emailQueue = this.queueFactory.getQueue('emailQueue');
      await emailQueue.addJobToQueue(JOB_NAME.PAYMENT_REQUEST_EMAIL_JOB, {
        emailType: MailType.PAYMENT_REQUEST_CREATED,
        subject: '',
        to: tenantEmail,
        data: {
          tenantName,
          propertyAddress,
          unitNumber,
          paymentType: paymentTypeLabel,
          amountDue: MoneyUtils.formatCurrency(opts.amountInCents, opts.currency),
          dueDate: opts.dueDate instanceof Date ? opts.dueDate.toISOString() : opts.dueDate,
          description: opts.description || '',
          paymentUrl: `${envVariables.FRONTEND.URL}/tenants/${opts.cuid}/${profile?.user?._id?.toString()}/payments`,
        },
      });
      this.log.info({ tenantEmail }, 'Payment request email queued');
    } catch (err) {
      this.log.warn({ err }, 'Failed to queue payment request email');
    }
  }

  private static mapLeasePaymentMethod(acceptedPaymentMethod: string | undefined): PaymentMethod {
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

  /**
   * Create a PENDING payment tracking record without any Stripe/gateway interaction.
   * Used for cash, check, and e-transfer leases so the dashboard reflects expected
   * revenue even when online payments are not configured.
   *
   * Reusable for RENT, MAINTENANCE, or any other PaymentRecordType — callers compute
   * the amount and supply the correct PaymentMethod.
   */
  private async createManualTrackingPayment(data: {
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

  private handleLeaseActivated = async (payload: {
    leaseId: string;
    luid: string;
    cuid: string;
    tenantId: string;
  }): Promise<void> => {
    const { leaseId, luid, cuid, tenantId } = payload;
    try {
      const lease = await this.leaseDAO.findFirst({
        _id: new Types.ObjectId(leaseId),
        cuid,
        deletedAt: null,
      });
      if (!lease) return;

      const startDate = new Date(lease.duration.startDate);
      const period = { month: startDate.getMonth() + 1, year: startDate.getFullYear() };

      if (lease.fees?.acceptedPaymentMethod === 'auto-debit') {
        await this.createRentPayment(cuid, {
          paymentType: PaymentRecordType.RENT,
          leaseId: luid,
          tenantId,
          dueDate: startDate,
          period,
        });
      } else {
        const { totalMonthlyRent } = computeLeaseMonthlyFees(lease);
        await this.createManualTrackingPayment({
          cuid,
          tenantId,
          dueDate: startDate,
          baseAmount: totalMonthlyRent,
          paymentType: PaymentRecordType.RENT,
          paymentMethod: PaymentService.mapLeasePaymentMethod(lease.fees?.acceptedPaymentMethod),
          leaseId: lease._id.toString(),
          period,
          currency: lease.fees?.currency,
        });
      }
      this.log.info(
        { luid, cuid, method: lease.fees?.acceptedPaymentMethod },
        'Auto-generated first month payment on lease activation'
      );
    } catch (error: any) {
      // Never block lease activation — log and continue
      this.log.error(
        { error: error.message, leaseId, luid, cuid },
        'Failed to auto-generate first month payment on lease activation'
      );
    }
  };

  private handleMaintenanceInvoiceApproved = async (
    payload: MaintenanceInvoiceApprovedPayload
  ): Promise<void> => {
    try {
      await this.recordMaintenanceExpense(payload);

      if (payload.isBillable && payload.tenantId) {
        await this.createMaintenanceCharge(payload);
      }
    } catch (err: unknown) {
      this.log.error(
        { err, mruid: payload.mruid, cuid: payload.cuid },
        '[PaymentService] Failed to record maintenance expense'
      );
    }
  };

  async recordMaintenanceExpense(payload: MaintenanceInvoiceApprovedPayload): Promise<void> {
    const { cuid, mruid, title, vendorId, amount, approvedBy } = payload;

    const vendorProfile = vendorId ? await this.profileDAO.getProfileByUserId(vendorId) : null;

    if (!vendorProfile) {
      this.log.warn(
        { mruid, vendorId },
        '[PaymentService] Skipping maintenance expense record: vendor profile not found'
      );
      return;
    }

    await this.paymentDAO.insert({
      cuid,
      paymentType: PaymentRecordType.MAINTENANCE,
      paymentMethod: PaymentMethod.OTHER,
      status: PaymentRecordStatus.PENDING,
      tenant: vendorProfile._id,
      vendorId: new Types.ObjectId(vendorId!),
      maintenanceRequestUid: mruid,
      baseAmount: amount,
      processingFee: 0,
      description: `[${mruid}] ${title || 'Maintenance expense'}`,
      isManualEntry: true,
      recordedBy: approvedBy ? new Types.ObjectId(approvedBy) : undefined,
      dueDate: new Date(),
    });

    this.log.info({ mruid, amount, cuid }, '[PaymentService] Maintenance expense recorded');
  }

  /**
   * Creates a PENDING payment record for the tenant when a maintenance invoice
   * is approved as billable. The tenant has 5 days to pay manually before
   * auto-charge kicks in via cron.
   */
  private async createMaintenanceCharge(payload: MaintenanceInvoiceApprovedPayload): Promise<void> {
    const { cuid, mruid, tenantId, amount, approvedBy } = payload;

    const tenantProfile = await this.profileDAO.getProfileByUserId(tenantId!);
    if (!tenantProfile) {
      this.log.warn(
        { mruid, tenantId },
        '[PaymentService] Skipping maintenance charge: tenant profile not found'
      );
      return;
    }

    const activeLease = await this.leaseDAO.getActiveLeaseByTenant(cuid, tenantId!);
    const currency = activeLease?.fees?.currency ?? 'USD';

    const GRACE_PERIOD_DAYS = 5;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + GRACE_PERIOD_DAYS);

    await this.paymentDAO.insert({
      cuid,
      paymentType: PaymentRecordType.MAINTENANCE,
      paymentMethod: PaymentMethod.ONLINE,
      status: PaymentRecordStatus.PENDING,
      tenant: tenantProfile._id,
      maintenanceRequestUid: mruid,
      baseAmount: amount,
      currency,
      processingFee: 0,
      description: `Maintenance charge for request ${mruid}`,
      isManualEntry: false,
      recordedBy: approvedBy ? new Types.ObjectId(approvedBy) : undefined,
      dueDate,
    });

    this.log.info(
      { mruid, amount, cuid, dueDate },
      '[PaymentService] Maintenance charge created for tenant — due in %d days',
      GRACE_PERIOD_DAYS
    );
  }

  /**
   * PM-initiated charge: creates a PENDING payment record linking the tenant to
   * a specific maintenance request. Called explicitly by a property manager from
   * the UI, as opposed to the event-driven createMaintenanceCharge() path.
   */
  async chargeForMaintenance(
    cuid: string,
    currentUserId: string,
    body: { mruid: string; tenantId: string; amount: number; description?: string }
  ): IPromiseReturnedData<IPaymentDocument> {
    const { mruid, tenantId, amount, description } = body;

    const client = await this.clientDAO.findFirst({ cuid });
    if (!client) {
      throw new NotFoundError({ message: 'Client not found' });
    }

    const subscription = await this.subscriptionDAO.findFirst({ cuid, deletedAt: null });
    if (!subscription) {
      throw new BadRequestError({ message: 'No subscription found' });
    }
    if (subscription.status !== ISubscriptionStatus.ACTIVE) {
      this.log.warn(
        'Subscription not active — maintenance charge will be collected but payouts are paused',
        {
          cuid,
          subscriptionStatus: subscription.status,
        }
      );
    }

    const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
    if (paymentProcessor?.payoutsBlocked) {
      throw new ForbiddenError({
        message:
          paymentProcessor.payoutsBlockedReason ||
          'Payouts are currently blocked for this account.',
      });
    }

    const tenantProfile = await this.profileDAO.getProfileByUserId(tenantId);
    if (!tenantProfile) {
      throw new NotFoundError({ message: 'Tenant profile not found' });
    }

    const activeLease = await this.leaseDAO.getActiveLeaseByTenant(cuid, tenantId);
    const currency = activeLease?.fees?.currency ?? 'USD';

    const GRACE_PERIOD_DAYS = 5;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + GRACE_PERIOD_DAYS);

    const payment = await this.paymentDAO.insert({
      cuid,
      paymentType: PaymentRecordType.MAINTENANCE,
      paymentMethod: PaymentMethod.ONLINE,
      status: PaymentRecordStatus.PENDING,
      tenant: tenantProfile._id,
      maintenanceRequestUid: mruid,
      baseAmount: amount,
      currency,
      processingFee: 0,
      description: description || `Maintenance charge for request ${mruid}`,
      isManualEntry: false,
      recordedBy: new Types.ObjectId(currentUserId),
      dueDate,
    });

    this.log.info(
      { mruid, amount, cuid, dueDate },
      '[PaymentService] PM-initiated maintenance charge created'
    );

    return { success: true, data: payment };
  }

  /**
   * Transfer funds from the PM's Stripe Connect account to the vendor's Stripe Connect account.
   * Finds the PENDING maintenance expense record for the given mruid, creates a Stripe transfer,
   * then marks the record PAID and emits MAINTENANCE_VENDOR_PAID so the MR document is updated.
   *
   * Guards:
   * - Expense record must exist and be PENDING (idempotent — throws if already PAID)
   * - PM must have a verified Connect account (chargesEnabled)
   * - Vendor must have completed Stripe Connect onboarding (payoutsEnabled)
   */
  async payVendor(cuid: string, mruid: string): IPromiseReturnedData<IPaymentDocument> {
    try {
      // 1. Resolve the vendor expense payment record
      const payment = await this.paymentDAO.findFirst({
        maintenanceRequestUid: mruid,
        paymentType: PaymentRecordType.MAINTENANCE,
        vendorId: { $exists: true, $ne: null },
        cuid,
        deletedAt: null,
      });
      if (!payment) {
        throw new NotFoundError({
          message: 'No expense record found for this maintenance request.',
        });
      }
      if (payment.status === PaymentRecordStatus.PAID) {
        throw new BadRequestError({
          message: 'Vendor has already been paid for this request.',
        });
      }

      // 2. Resolve PM's Stripe Connect account
      const pmProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!pmProcessor?.accountId || !pmProcessor.chargesEnabled) {
        throw new BadRequestError({
          message: 'Payment account not configured or charges not enabled.',
        });
      }

      // 3. Resolve vendor's Stripe Connect account via their user UID
      const vendorUser = await this.userDAO.findFirst({
        _id: payment.vendorId,
        deletedAt: null,
      });
      if (!vendorUser?.uid) {
        throw new NotFoundError({ message: 'Vendor user record not found.' });
      }
      const vendorProcessor = await this.paymentProcessorDAO.findByVuid(vendorUser.uid, cuid);
      if (!vendorProcessor?.accountId) {
        throw new BadRequestError({
          message:
            'Vendor has not set up their payout account. Ask them to complete Stripe Connect onboarding.',
        });
      }
      if (!vendorProcessor.payoutsEnabled) {
        throw new BadRequestError({
          message:
            'Vendor payout account is not yet verified. Ask them to complete their Stripe Connect setup.',
        });
      }

      // 4. Create Stripe transfer from PM's balance to vendor's Connect account
      const currency = (payment.currency ?? 'usd').toLowerCase();
      const transferResult = await this.paymentGatewayService.createTransfer(
        IPaymentGatewayProvider.STRIPE,
        {
          amountInCents: payment.baseAmount,
          currency,
          destination: vendorProcessor.accountId,
          metadata: {
            cuid,
            mruid,
            pytuid: payment.pytuid,
          },
        }
      );
      if (!transferResult.success || !transferResult.data) {
        throw new Error(transferResult.message || 'Failed to transfer funds to vendor.');
      }

      // 5. Mark expense record as PAID
      const updated = await this.paymentDAO.updateById(payment._id.toString(), {
        status: PaymentRecordStatus.PAID,
        paidAt: new Date(),
        gatewayPaymentId: transferResult.data.transferId,
      });

      // 6. Emit event — ServiceRequestService listens and updates MR invoice.vendorPayoutStatus
      this.emitterService.emit(EventTypes.MAINTENANCE_VENDOR_PAID, {
        transferId: transferResult.data.transferId,
        amountInCents: payment.baseAmount,
        vendorId: payment.vendorId!.toString(),
        pytuid: payment.pytuid,
        mruid,
        cuid,
      });

      this.log.info(
        { mruid, pytuid: payment.pytuid, transferId: transferResult.data.transferId, cuid },
        '[PaymentService] Vendor paid — transfer created'
      );

      return {
        success: true,
        data: updated as IPaymentDocument,
        message: 'Vendor paid successfully.',
      };
    } catch (error: any) {
      this.log.error({ error: error.message, cuid, mruid }, 'Error paying vendor');
      throw error;
    }
  }

  /**
   * Charges tenant's CC on file for a pending maintenance payment.
   * Creates a Stripe invoice → finalizes (auto-charges) → updates payment record with gateway ID.
   * Status stays PENDING until webhook confirms PAID.
   */
  async payPendingCharge(
    cuid: string,
    pytuid: string,
    tenantUserId: string
  ): IPromiseReturnedData<IPaymentDocument> {
    try {
      const payment = await this.paymentDAO.findFirst({ pytuid, cuid, deletedAt: null });
      if (!payment) {
        throw new NotFoundError({ message: 'Payment not found' });
      }

      if (
        payment.status !== PaymentRecordStatus.PENDING &&
        payment.status !== PaymentRecordStatus.FAILED
      ) {
        throw new BadRequestError({
          message: `Cannot pay a charge with status: ${payment.status}`,
        });
      }

      // Retry: reset a previously-failed payment so a fresh invoice is created
      if (payment.status === PaymentRecordStatus.FAILED) {
        const MAX_RETRIES = 3;
        if ((payment.failure?.retryCount ?? 0) >= MAX_RETRIES) {
          throw new BadRequestError({
            message: 'Maximum retry attempts reached. Please contact your property manager.',
          });
        }
        const nextRetryCount = (payment.failure?.retryCount ?? 0) + 1;
        await this.paymentDAO.updateById(payment._id.toString(), {
          status: PaymentRecordStatus.PENDING,
          gatewayPaymentId: null,
          'failure.retryCount': nextRetryCount,
        });
        payment.status = PaymentRecordStatus.PENDING;
        payment.gatewayPaymentId = undefined;
        payment.failure = { ...payment.failure, retryCount: nextRetryCount };
      }

      if (
        payment.paymentType !== PaymentRecordType.MAINTENANCE &&
        payment.paymentType !== PaymentRecordType.RENT &&
        payment.paymentType !== PaymentRecordType.LATE_FEE
      ) {
        throw new BadRequestError({
          message: 'Only rent, maintenance, or late fee charges can be paid this way',
        });
      }

      const tenantProfile = await this.profileDAO.findFirst({
        user: new Types.ObjectId(tenantUserId),
      });
      if (!tenantProfile || !payment.tenant.equals(tenantProfile._id)) {
        throw new BadRequestError({ message: 'You do not have permission to pay this charge' });
      }

      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor?.accountId || !paymentProcessor.chargesEnabled) {
        throw new BadRequestError({
          message: 'Payment account not configured or not ready for charges',
        });
      }

      if (payment.paymentType === PaymentRecordType.RENT) {
        let activeInvoiceId = payment.gatewayPaymentId;
        const mandateId = tenantProfile.tenantInfo?.paymentMandates?.get(
          paymentProcessor.accountId
        );
        const paymentMethodId = tenantProfile.tenantInfo?.paymentMethods?.get(
          paymentProcessor.accountId
        );

        if (paymentMethodId && !mandateId) {
          const paymentMethodResult = await this.paymentGatewayService.retrievePaymentMethod(
            IPaymentGatewayProvider.STRIPE,
            paymentMethodId
          );
          const bankDebitTypes = new Set([
            'us_bank_account',
            'acss_debit',
            'sepa_debit',
            'bacs_debit',
          ]);

          if (paymentMethodResult.data?.type && bankDebitTypes.has(paymentMethodResult.data.type)) {
            if (activeInvoiceId) {
              const voidResult = await this.paymentGatewayService.voidInvoice(
                IPaymentGatewayProvider.STRIPE,
                activeInvoiceId
              );
              if (!voidResult.success) {
                this.log.warn(
                  { pytuid, invoiceId: activeInvoiceId, message: voidResult.message },
                  '[PaymentService] Failed to void invoice for bank method without mandate'
                );
              }
            }

            await this.profileDAO.update(
              { user: new Types.ObjectId(tenantUserId) },
              {
                $unset: {
                  [`tenantInfo.paymentMethods.${paymentProcessor.accountId}`]: '',
                  [`tenantInfo.paymentMandates.${paymentProcessor.accountId}`]: '',
                },
              }
            );

            if (activeInvoiceId) {
              await this.paymentDAO.updateById(payment._id.toString(), {
                gatewayPaymentId: null,
              });
            }

            throw new BadRequestError({
              message:
                'Your bank account must be re-authorized before rent can be paid. Please set up your payment method again.',
            });
          }
        }

        // ── ACSS per-transaction limit check ────────────────────────────────────
        // mandateId presence means this connected account uses ACSS debit (PAD).
        // Mandates are only collected for ACSS in this system's setup flow.
        // If the charge exceeds Stripe's per-transaction cap, signal the frontend
        // to present the card payment option instead. Never throw — return structured
        // response so the caller can route without an error boundary.
        if (mandateId) {
          const acssLimitCents = envVariables.STRIPE.ACSS_PER_TXN_LIMIT_CAD;
          if (payment.baseAmount > acssLimitCents) {
            this.log.warn(
              { pytuid, amountCents: payment.baseAmount, limitCents: acssLimitCents },
              '[PaymentService] ACSS per-txn limit exceeded — routing to card'
            );
            return {
              success: false,
              data: null as unknown as IPaymentDocument,
              routeToCard: true,
              message:
                'Bank debit is unavailable for this payment amount — please use a card instead.',
            };
          }
        }

        if (!activeInvoiceId) {
          // PM-initiated request created a PENDING record without a Stripe invoice.
          // Lazily create + finalize it now so we can charge immediately.
          if (!payment.lineItems?.length) {
            throw new BadRequestError({
              message:
                'No line items found for this payment. Please contact your property manager.',
            });
          }

          const tenantCustomerId =
            tenantProfile.tenantInfo?.paymentGatewayCustomers?.get('platform');
          if (!tenantCustomerId) {
            throw new BadRequestError({
              message: 'No payment method on file. Please contact property management.',
            });
          }

          const subscription = await this.subscriptionDAO.findFirst({ cuid, deletedAt: null });
          const transactionFeePercent = subscription
            ? this.subscriptionPlanConfig.getTransactionFeePercent(subscription.planName)
            : 0;
          const feeBreakdown = this.calculateRentFees(payment.baseAmount, transactionFeePercent);

          const invoiceResult = await this.paymentGatewayService.createInvoice(
            IPaymentGatewayProvider.STRIPE,
            {
              tenantCustomerId,
              connectedAccountId: paymentProcessor.accountId,
              applicationFeeAmountInCents: feeBreakdown.applicationFee,
              currency: (payment.currency ?? 'USD').toLowerCase(),
              description: payment.description || `Rent payment ${pytuid}`,
              autoChargeDueDate: new Date(),
              lineItems: payment.lineItems as { description: string; amountInCents: number }[],
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
          activeInvoiceId,
          paymentMethodId ? { paymentMethod: paymentMethodId } : undefined
        );

        if (!payResult.success) {
          throw new BadRequestError({ message: payResult.message || 'Failed to initiate payment' });
        }

        this.log.info(
          { pytuid, cuid, invoiceId: activeInvoiceId },
          '[PaymentService] Tenant-initiated rent payment submitted'
        );

        return {
          success: true,
          data: payment as IPaymentDocument,
          message: 'Payment initiated — your bank account will be debited shortly',
        };
      }

      const tenantCustomerId = tenantProfile.tenantInfo?.paymentGatewayCustomers?.get('platform');
      if (!tenantCustomerId) {
        throw new BadRequestError({
          message: 'No payment method on file. Please contact property management.',
        });
      }

      const paymentMethodId = tenantProfile.tenantInfo?.paymentMethods?.get(
        paymentProcessor.accountId
      );
      if (!paymentMethodId) {
        throw new BadRequestError({
          message: 'No payment method on file. Please contact property management.',
        });
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
            autoChargeDueDate: new Date(),
            lineItems: [
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

      const updated = await this.paymentDAO.findFirst({ pytuid, cuid, deletedAt: null });

      const payResult = await this.paymentGatewayService.payInvoice(
        IPaymentGatewayProvider.STRIPE,
        activeInvoiceId!,
        { paymentMethod: paymentMethodId }
      );

      if (!payResult.success) {
        throw new BadRequestError({ message: payResult.message || 'Failed to initiate payment' });
      }

      this.log.info(
        { pytuid, cuid, invoiceId: activeInvoiceId, paymentType: payment.paymentType },
        '[PaymentService] Pending charge submitted for payment'
      );

      return {
        success: true,
        data: updated as IPaymentDocument,
        message: 'Payment submitted for processing',
      };
    } catch (error: any) {
      this.log.error({ error: error.message, cuid, pytuid }, 'Error paying pending charge');
      throw error;
    }
  }

  /**
   * Daily cron (1 AM): flip PENDING → OVERDUE for all payment types where dueDate has passed.
   * Runs before the auto-charge cron so overdue maintenance payments are already flagged.
   */
  private async markOverduePayments(): Promise<void> {
    try {
      const { items: pastDuePayments } = await this.paymentDAO.findOverduePayments();

      if (pastDuePayments.length === 0) {
        this.log.info('[Cron] No payments to mark overdue');
        return;
      }

      // Skip auto-debit payments (non-manual with a gateway ID already set) —
      // those are handled by the auto-charge cron, not status-flipping.
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
   * Daily cron: auto-charges tenant for non-rent charges past their grace period.
   * Handles both not-yet-submitted records and already-created open invoices.
   */
  private async autoChargeOverdueMaintenancePayments(): Promise<void> {
    const now = new Date();

    const { items: overduePayments } = await this.paymentDAO.list(
      {
        status: PaymentRecordStatus.PENDING,
        paymentType: { $in: [PaymentRecordType.MAINTENANCE, PaymentRecordType.LATE_FEE] },
        isManualEntry: false,
        gatewayChargeId: { $exists: false },
        dueDate: { $lte: now },
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

        // Resolve tenant User._id from Profile
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

        await this.payPendingCharge(payment.cuid, payment.pytuid, tenantUserId);
        charged++;
      } catch (err: any) {
        this.log.error(
          { err: err.message, pytuid: payment.pytuid, cuid: payment.cuid },
          '[Cron] Failed to auto-charge maintenance payment'
        );
        failed++;
      }
    }

    this.log.info(
      { charged, failed, total: overduePayments.length },
      '[Cron] Auto-charge overdue maintenance payments complete'
    );
  }

  /**
   * Daily cron (6 AM UTC): triggers Stripe collection for rent payments whose due date
   * has arrived. Only targets PENDING/OVERDUE rent payments that already have a
   * gatewayPaymentId (invoice created by the weekly/safety-net cron) and have not yet
   * been charged (no gatewayChargeId). Calls payInvoice directly — no tenant ownership
   * check needed for an internal cron. Tenants that manually clicked Pay Now before 6 AM
   * will already be PAID/in-progress in Stripe and are skipped via invoice_already_paid.
   */
  private async autoChargeDueRentPayments(): Promise<void> {
    const now = new Date();

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
    // Cache per cuid to avoid redundant DB lookups across multiple payments
    const onlinePaymentsEnabled = new Map<string, boolean>();
    const processorAccountIds = new Map<string, string>();

    for (const payment of duePayments) {
      try {
        // ── Online payments feature flag ──────────────────────────────────────
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

        // ── Resolve Stripe connected account ──────────────────────────────────
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

        // StripeService.payInvoice already handles invoice_already_paid gracefully.
        // Non-null asserted: query filters ensure gatewayPaymentId is present.
        await this.paymentGatewayService.payInvoice(
          IPaymentGatewayProvider.STRIPE,
          payment.gatewayPaymentId!
        );
        charged++;
      } catch (err: any) {
        this.log.error(
          { err: err.message, pytuid: payment.pytuid, cuid: payment.cuid },
          '[Cron] Failed to auto-charge due rent payment'
        );
        failed++;
      }
    }

    this.log.info(
      { charged, failed, total: duePayments.length },
      '[Cron] Auto-charge due rent payments complete'
    );
  }

  private calculateRentFees(
    totalAmount: number,
    transactionFeePercent: number,
    provider: string = 'stripe'
  ): {
    baseAmount: number;
    applicationFee: number;
    gatewayProcessingFee: number;
    platformNetRevenue: number;
  } {
    const { applicationFee, gatewayFee, platformRevenue } = calcApplicationFeeSplit(
      totalAmount,
      transactionFeePercent,
      (amount) => this.subscriptionPlanConfig.calculatePaymentGatewayFee(amount, provider)
    );

    return {
      baseAmount: totalAmount,
      gatewayProcessingFee: gatewayFee,
      platformNetRevenue: platformRevenue,
      applicationFee,
    };
  }

  async getTenantPaymentHistory(
    cuid: string,
    tenantUserId: string,
    filters: { status?: string; from?: string; to?: string; page?: number; limit?: number }
  ): IPromiseReturnedData<any> {
    try {
      const tenantProfile = await this.profileDAO.findFirst({
        user: new Types.ObjectId(tenantUserId),
      });
      if (!tenantProfile) throw new NotFoundError({ message: 'Tenant profile not found' });

      const query: FilterQuery<IPaymentDocument> = {
        cuid,
        tenant: tenantProfile._id,
        deletedAt: null,
      };
      if (filters.status) query.status = filters.status;
      if (filters.from || filters.to) {
        query.dueDate = {};
        if (filters.from) query.dueDate.$gte = new Date(filters.from);
        if (filters.to) query.dueDate.$lte = new Date(filters.to);
      }

      const limit = filters.limit || 20;
      const skip = ((filters.page || 1) - 1) * limit;
      const result = await this.paymentDAO.list(
        query,
        {
          sort: { dueDate: -1 },
          limit,
          skip,
          populate: [{ path: 'lease', select: 'leaseNumber luid property' }],
          projection:
            'pytuid invoiceNumber status paymentType paymentMethod baseAmount processingFee applicationFee dueDate paidAt period description receipt lease',
        },
        true
      );

      const items = (result.items as unknown as IPaymentPopulated[]).map((p) => ({
        pytuid: p.pytuid,
        invoiceNumber: p.invoiceNumber,
        status: p.status,
        paymentType: p.paymentType,
        paymentMethod: p.paymentMethod,
        baseAmount: p.baseAmount,
        processingFee: p.processingFee || 0,
        applicationFee: p.applicationFee || 0,
        totalAmount: p.baseAmount + (p.processingFee || 0),
        dueDate: p.dueDate,
        paidAt: p.paidAt,
        description: p.description,
        period: p.period,
        hasReceipt: !!p.receipt?.url,
        leaseNumber: p.lease?.leaseNumber,
      }));

      return {
        success: true,
        data: { ...result, items },
        message: 'Payment history retrieved',
      };
    } catch (error) {
      this.log.error('Error fetching tenant payment history', error);
      throw error;
    }
  }

  async getTenantPaymentById(
    pytuid: string,
    cuid: string,
    tenantUserId: string
  ): IPromiseReturnedData<any> {
    try {
      const tenantProfile = await this.profileDAO.findFirst({
        user: new Types.ObjectId(tenantUserId),
      });
      if (!tenantProfile) throw new NotFoundError({ message: 'Tenant profile not found' });

      const payment = await this.paymentDAO.findFirst(
        { pytuid, cuid, tenant: tenantProfile._id, deletedAt: null },
        { populate: [{ path: 'lease', select: 'leaseNumber luid' }] }
      );
      if (!payment) throw new NotFoundError({ message: 'Payment not found' });

      return { success: true, data: payment, message: 'Payment retrieved' };
    } catch (error) {
      this.log.error('Error fetching tenant payment', error);
      throw error;
    }
  }

  async generateTenantReceipt(
    pytuid: string,
    cuid: string,
    tenantUserId: string
  ): Promise<{ buffer: Buffer; filename: string }> {
    try {
      const tenantProfile = await this.profileDAO.findFirst(
        { user: new Types.ObjectId(tenantUserId) },
        { populate: { path: 'user', select: 'email' } }
      );
      if (!tenantProfile) throw new NotFoundError({ message: 'Tenant profile not found' });

      const payment = await this.paymentDAO.findFirst(
        { pytuid, cuid, tenant: tenantProfile._id, deletedAt: null },
        { populate: [{ path: 'lease', select: 'leaseNumber property' }] }
      );
      if (!payment) throw new NotFoundError({ message: 'Payment not found' });
      if ((payment.status as string) !== PaymentRecordStatus.PAID) {
        throw new BadRequestError({ message: 'Receipt only available for paid payments' });
      }

      const tenantName =
        `${tenantProfile.personalInfo?.firstName || ''} ${tenantProfile.personalInfo?.lastName || ''}`.trim() ||
        'Tenant';
      const lease = (payment as unknown as IPaymentPopulated).lease;
      const propertyAddress =
        typeof lease?.property?.address === 'string'
          ? lease.property.address
          : lease?.property?.address?.fullAddress || '';

      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Helvetica, Arial, sans-serif; font-size: 12px; color: #1a1a1a; margin: 40px; }
    .header { border-bottom: 2px solid #1a1a1a; padding-bottom: 16px; margin-bottom: 24px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .meta { color: #666; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    td { padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
    td:last-child { text-align: right; font-weight: 600; }
    .total td { border-top: 2px solid #1a1a1a; border-bottom: none; font-weight: 700; font-size: 14px; }
    .badge { display: inline-block; background: #dcfce7; color: #166534; padding: 3px 10px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Payment Receipt</h1>
    <div class="meta">Invoice #${payment.invoiceNumber} &nbsp;·&nbsp; <span class="badge">PAID</span></div>
  </div>
  <table>
    <tr><td>Tenant</td><td>${tenantName}</td></tr>
    <tr><td>Property</td><td>${propertyAddress}</td></tr>
    <tr><td>Lease</td><td>${lease?.leaseNumber || '—'}</td></tr>
    <tr><td>Payment Type</td><td>${payment.paymentType.replace(/_/g, ' ')}</td></tr>
    ${payment.period ? `<tr><td>Period</td><td>${payment.period.month}/${payment.period.year}</td></tr>` : ''}
    <tr><td>Due Date</td><td>${payment.dueDate.toLocaleDateString()}</td></tr>
    <tr><td>Paid On</td><td>${payment.paidAt?.toLocaleDateString() || '—'}</td></tr>
    <tr><td>Rent Amount</td><td>$${MoneyUtils.centsToDisplay(payment.baseAmount)}</td></tr>
    ${payment.processingFee > 0 ? `<tr><td>Processing Fee</td><td>$${MoneyUtils.centsToDisplay(payment.processingFee)}</td></tr>` : ''}
    <tr class="total"><td>Total Paid</td><td>$${MoneyUtils.centsToDisplay(payment.baseAmount + (payment.processingFee || 0))}</td></tr>
  </table>
  <p style="color:#888; font-size:10px; margin-top:40px;">Generated ${new Date().toLocaleDateString()} · This is an official payment receipt.</p>
</body>
</html>`;

      const result = await this.pdfGeneratorService.generatePdf(html, {
        format: 'A4',
        printBackground: true,
        margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
        displayHeaderFooter: false,
      });

      if (!result.success || !result.buffer) throw new Error('Failed to generate receipt PDF');

      return { buffer: result.buffer, filename: `receipt-${payment.invoiceNumber}.pdf` };
    } catch (error) {
      this.log.error('Error generating tenant receipt', error);
      throw error;
    }
  }
}
