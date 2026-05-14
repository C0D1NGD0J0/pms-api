import dayjs from 'dayjs';
import Logger from 'bunyan';
import { JOB_NAME } from '@utils/constants';
import { InvoiceDAO } from '@dao/invoiceDAO';
import { envVariables } from '@shared/config';
import { FilterQuery, Types } from 'mongoose';
import { QueueFactory } from '@services/queue';
import { MoneyUtils } from '@utils/money.utils';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { PdfGeneratorService } from '@services/pdfGenerator';
import { InvoiceStatus } from '@interfaces/invoice.interface';
import { SubscriptionPlanConfig } from '@services/subscription';
import { calcApplicationFeeSplit } from '@utils/financial.utils';
import { ICronProvider, ICronJob } from '@interfaces/cron.interface';
import { IPayoutSchedule } from '@interfaces/paymentGateway.interface';
import { StripeService } from '@services/external/stripe/stripe.service';
import { InvoiceTemplateRenderer, InvoiceRenderData } from '@services/invoice';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import { preventTenantConflict, calcCollectionRate, createLogger } from '@utils/index';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
import { IVendorEarningsResponse, IVendorEarningItem } from '@interfaces/payments.interface';
import { calculateProRatedAmount, computeLeaseMonthlyFees } from '@services/lease/leaseHelpers';
import {
  IPromiseReturnedData,
  IPaginateResult,
  IRequestContext,
  MailType,
} from '@interfaces/utils.interface';
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
  PaymentSource,
  PaymentMethod,
  LeaseStatus,
} from '@interfaces/index';

import { PaymentCronService } from './paymentCron.service';
import { PayoutAccountService } from './payoutAccount.service';
import { PaymentWebhookService } from './paymentWebhook.service';
import { MaintenancePaymentService } from './maintenancePayment.service';

interface IConstructor {
  maintenancePaymentService: MaintenancePaymentService;
  invoiceTemplateRenderer: InvoiceTemplateRenderer;
  subscriptionPlanConfig: SubscriptionPlanConfig;
  paymentGatewayService: PaymentGatewayService;
  paymentWebhookService: PaymentWebhookService;
  payoutAccountService: PayoutAccountService;
  pdfGeneratorService: PdfGeneratorService;
  paymentProcessorDAO: PaymentProcessorDAO;
  paymentCronService: PaymentCronService;
  emitterService: EventEmitterService;
  subscriptionDAO: SubscriptionDAO;
  stripeService: StripeService;
  queueFactory: QueueFactory;
  invoiceDAO: InvoiceDAO;
  paymentDAO: PaymentDAO;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  leaseDAO: LeaseDAO;
  userDAO: UserDAO;
}

interface IStripePayoutWebhookData {
  status: 'paid' | 'pending' | 'in_transit' | 'canceled' | 'failed';
  failure_message?: string;
  failure_reason?: string;
  failure_code?: string;
  arrival_date: number;
  destination: string;
  currency: string;
  amount: number;
  id: string;
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

interface IStripeDisputeWebhookData {
  evidence_details?: { due_by?: number };
  charge?: string | { id: string };
  currency: string;
  reason?: string;
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
  private readonly invoiceDAO: InvoiceDAO;
  private readonly paymentProcessorDAO: PaymentProcessorDAO;
  private readonly paymentGatewayService: PaymentGatewayService;
  private readonly stripeService: StripeService;
  private readonly pdfGeneratorService: PdfGeneratorService;
  private readonly invoiceTemplateRenderer: InvoiceTemplateRenderer;
  private readonly subscriptionPlanConfig: SubscriptionPlanConfig;
  private readonly payoutAccountService: PayoutAccountService;
  private readonly paymentWebhookService: PaymentWebhookService;
  private readonly paymentCronService: PaymentCronService;
  private readonly maintenancePaymentService: MaintenancePaymentService;

  constructor({
    userDAO,
    profileDAO,
    clientDAO,
    paymentDAO,
    leaseDAO,
    emitterService,
    queueFactory,
    subscriptionDAO,
    invoiceDAO,
    paymentProcessorDAO,
    subscriptionPlanConfig,
    paymentGatewayService,
    stripeService,
    invoiceTemplateRenderer,
    pdfGeneratorService,
    payoutAccountService,
    paymentWebhookService,
    paymentCronService,
    maintenancePaymentService,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.leaseDAO = leaseDAO;
    this.clientDAO = clientDAO;
    this.profileDAO = profileDAO;
    this.paymentDAO = paymentDAO;
    this.invoiceDAO = invoiceDAO;
    this.emitterService = emitterService;
    this.queueFactory = queueFactory;
    this.subscriptionDAO = subscriptionDAO;
    this.log = createLogger('PaymentService');
    this.paymentProcessorDAO = paymentProcessorDAO;
    this.invoiceTemplateRenderer = invoiceTemplateRenderer;
    this.paymentGatewayService = paymentGatewayService;
    this.stripeService = stripeService;
    this.pdfGeneratorService = pdfGeneratorService;
    this.subscriptionPlanConfig = subscriptionPlanConfig;
    this.payoutAccountService = payoutAccountService;
    this.paymentWebhookService = paymentWebhookService;
    this.paymentCronService = paymentCronService;
    this.maintenancePaymentService = maintenancePaymentService;
    this.emitterService.on(
      EventTypes.LEASE_ESIGNATURE_COMPLETED,
      this.handleLeaseActivated.bind(this)
    );
  }

  getCronJobs(): ICronJob[] {
    return this.paymentCronService.getCronJobs();
  }

  async recordManualPayment(
    cuid: string,
    userId: string,
    requestingUserSub: string,
    data: IManualPaymentFormData,
    paymentSource?: PaymentSource
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
        ...(paymentSource ? { paymentSource } : {}),
        ...(data.receipt
          ? { receipt: { ...data.receipt, uploadedBy: new Types.ObjectId(userId) } }
          : {}),
      });

      // Track manual record usage for quota (fire-and-forget)
      this.incrementManualRecordCount(cuid).catch((err) => {
        this.log.error({ err, cuid }, 'Background manual record usage tracking failed');
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

  private async incrementManualRecordCount(cuid: string): Promise<void> {
    const subscription = await this.subscriptionDAO.findFirst({ cuid });
    if (!subscription) return;

    const now = dayjs();
    const periodStart = subscription.manualRecords?.periodStart
      ? dayjs(subscription.manualRecords.periodStart)
      : dayjs(subscription.startDate);

    const monthsElapsed =
      (now.year() - periodStart.year()) * 12 + (now.month() - periodStart.month());

    if (monthsElapsed >= 1) {
      await this.subscriptionDAO.update(
        { cuid },
        {
          $set: {
            'manualRecords.countThisPeriod': 1,
            'manualRecords.periodStart': now.toDate(),
          },
        }
      );
      return;
    }

    await this.subscriptionDAO.update({ cuid }, { $inc: { 'manualRecords.countThisPeriod': 1 } });
  }

  async createRentPayment(
    cuid: string,
    data: IPaymentFormData,
    options?: { createStripeInvoice?: boolean; paymentSource?: PaymentSource }
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
              deletedAt: dayjs().toDate(),
            });
          } else {
            const monthName = dayjs()
              .year(data.period.year)
              .month(data.period.month - 1)
              .startOf('month')
              .toDate()
              .toLocaleString('default', { month: 'long' });
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
          dueDate: dayjs(data.dueDate).toDate(),
          baseAmount: trackingAmount,
          paymentType: effectivePaymentType,
          paymentMethod: PaymentService.mapLeasePaymentMethod(acceptedPaymentMethod),
          leaseId: lease._id.toString(),
          period: data.period,
          description: data.description,
          currency: lease.fees?.currency,
          paymentSource: options?.paymentSource,
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
          dueDate: dayjs(data.dueDate).toDate(),
          baseAmount: totalAmountInCents,
          paymentType: effectivePaymentType,
          paymentMethod: PaymentMethod.ONLINE,
          leaseId: lease._id.toString(),
          period: data.period,
          description: data.description,
          currency: leaseFees.currency,
          paymentSource: options?.paymentSource,
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

      const isAch = lease.fees?.acceptedPaymentMethod === 'auto-debit';
      let feeBreakdown;
      if (isAch) {
        const achFee = this.subscriptionPlanConfig.calculateAchApplicationFee(totalAmountInCents);
        const gatewayFee = this.subscriptionPlanConfig.calculatePaymentGatewayFee(
          totalAmountInCents,
          'stripe',
          'auto-debit'
        );
        feeBreakdown = {
          baseAmount: totalAmountInCents,
          applicationFee: achFee,
          gatewayProcessingFee: gatewayFee,
          platformNetRevenue: achFee - gatewayFee,
        };
      } else {
        const transactionFeePercent = this.subscriptionPlanConfig.getTransactionFeePercent(
          subscription.planName
        );
        feeBreakdown = this.calculateRentFees(
          totalAmountInCents,
          transactionFeePercent,
          'stripe',
          lease.fees?.acceptedPaymentMethod
        );
      }

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
        platformRevenue: feeBreakdown.platformNetRevenue,
        gatewayPaymentId: invoiceResult.data.invoiceId,
        currency: leaseFees.currency,
        status: PaymentRecordStatus.PENDING,
        dueDate: data.dueDate,
        period: data.period,
        description: data.description,
        isManualEntry: false,
        paymentSource: options?.paymentSource,
        lineItems: lineItems.map(({ description, amountInCents }) => ({
          description,
          amountInCents,
        })),
        ...(hostedInvoiceUrl && { receipt: { url: hostedInvoiceUrl } }),
      });

      this.emitterService.emit(EventTypes.PAYMENT_REQUEST_CREATED, {
        tenantUserId: tenantProfile.user._id.toString(),
        amountInCents: totalAmountInCents,
        dueDate: dayjs(data.dueDate).toDate(),
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
      maintenanceRequestUid?: string;
      page?: number;
      limit?: number;
      sortDirection?: 'asc' | 'desc';
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
        // Support comma-separated multi-status filter: "pending,overdue" → $in query
        const statuses = filters.status
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        query.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
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

      if (filters?.maintenanceRequestUid) {
        query.maintenanceRequestUid = filters.maintenanceRequestUid;
      }

      // Exclude vendor expense records — these have vendorId set and are internal
      // accounting entries that surface in the Payouts tab, not the Payments list.
      query.vendorId = { $exists: false };

      const sortOrder = filters?.sortDirection === 'asc' ? 1 : -1;
      const result = await this.paymentDAO.list(
        query,
        {
          sort: { dueDate: sortOrder, createdAt: sortOrder },
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
            'pytuid paymentMethod paymentType baseAmount processingFee applicationFee platformRevenue status dueDate paidAt period failure receipt lineItems currency maintenanceRequestUid',
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
          property:
            payment.lease?.property?.name ||
            addressStr ||
            ((payment as any).maintenanceRequestUid
              ? `SR #${(payment as any).maintenanceRequestUid}`
              : 'Unknown Property'),
          amount: payment.baseAmount + (payment.processingFee || 0),
          baseAmount: payment.baseAmount,
          processingFee: payment.processingFee || 0,
          applicationFee: payment.applicationFee || 0,
          platformRevenue: (payment as any).platformRevenue || 0,
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
          maintenanceRequestUid: (payment as any).maintenanceRequestUid || undefined,
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

      // For vendor maintenance payments with no line items, backfill from the invoice document
      if (!paymentObj.lineItems?.length && paymentObj.maintenanceRequestUid) {
        const invoice = await this.invoiceDAO.findByMaintenanceRequest(
          paymentObj.maintenanceRequestUid,
          cuid
        );
        if (invoice?.lineItems?.length) {
          paymentObj.lineItems = invoice.lineItems.map((item) => ({
            description: item.description,
            amountInCents: item.amountInCents,
          }));
        }
      }

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
    return this.payoutAccountService.createConnectAccount(cuid, data);
  }

  async getKycOnboardingLink(
    cuid: string,
    urlOverrides?: { returnUrl?: string; refreshUrl?: string }
  ): IPromiseReturnedData<{ url: string }> {
    return this.payoutAccountService.getKycOnboardingLink(cuid, urlOverrides);
  }

  async getAccountUpdateLink(
    cuid: string,
    urlOverrides?: { returnUrl?: string; refreshUrl?: string }
  ): IPromiseReturnedData<{ url: string }> {
    return this.payoutAccountService.getAccountUpdateLink(cuid, urlOverrides);
  }

  async getExternalDashboardLoginLink(cuid: string): IPromiseReturnedData<{ url: string }> {
    return this.payoutAccountService.getExternalDashboardLoginLink(cuid);
  }

  async getPayoutBalance(cuid: string): IPromiseReturnedData<any> {
    return this.payoutAccountService.getPayoutBalance(cuid);
  }

  async getPayoutHistory(
    cuid: string,
    query: { limit?: number; cursor?: string }
  ): IPromiseReturnedData<any> {
    return this.payoutAccountService.getPayoutHistory(cuid, query);
  }

  async getPayoutSchedule(cuid: string): IPromiseReturnedData<IPayoutSchedule> {
    return this.payoutAccountService.getPayoutSchedule(cuid);
  }

  async updatePayoutSchedule(
    cuid: string,
    interval: 'daily' | 'weekly' | 'monthly',
    weeklyAnchor?: string
  ): IPromiseReturnedData<null> {
    return this.payoutAccountService.updatePayoutSchedule(cuid, interval, weeklyAnchor);
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
          const start = dayjs(options.startDate);
          const monthName = start.toDate().toLocaleString('en-US', { month: 'short' });
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
    return this.paymentWebhookService.handleInvoicePaymentSucceeded(invoiceId, invoiceData);
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
    return this.paymentWebhookService.handleInvoicePaymentFailed(invoiceId, invoiceData);
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
    return this.paymentWebhookService.handleChargeRefunded(chargeId, chargeData);
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
        'refund.refundedAt': dayjs().toDate(),
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
    return this.paymentWebhookService.handleAccountUpdated(accountId, accountData);
  }

  async handlePayoutPaid(
    payoutId: string,
    payoutData: IStripePayoutWebhookData,
    connectedAccountId: string
  ): IPromiseReturnedData<void> {
    return this.paymentWebhookService.handlePayoutPaid(payoutId, payoutData, connectedAccountId);
  }

  async handlePayoutFailed(
    payoutId: string,
    payoutData: IStripePayoutWebhookData,
    connectedAccountId: string
  ): IPromiseReturnedData<void> {
    return this.paymentWebhookService.handlePayoutFailed(payoutId, payoutData, connectedAccountId);
  }

  async handleInvoiceOverdue(
    invoiceId: string,
    invoiceData: { amount_due?: number; currency?: string } & IStripeInvoiceWebhookData
  ): IPromiseReturnedData<void> {
    return this.paymentWebhookService.handleInvoiceOverdue(invoiceId, invoiceData);
  }

  async handleInvoiceUpcoming(invoiceData: {
    id: string;
    subscription?: string;
    amount_due?: number;
    currency?: string;
    period_start?: number;
  }): IPromiseReturnedData<void> {
    return this.paymentWebhookService.handleInvoiceUpcoming(invoiceData);
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
    return this.paymentWebhookService.handleSetupSessionCompleted(session, _source);
  }

  /**
   * Creates a Stripe Checkout Session (mode: payment) so a tenant can pay a pending
   * charge with a debit or credit card. The card is charged once — no payment method
   * is saved. The existing bank auto-debit setup is left untouched.
   */
  async createCardPaymentSession(
    cuid: string,
    pytuid: string,
    tenantUserId: string,
    returnUrls?: { successUrl?: string; cancelUrl?: string }
  ): IPromiseReturnedData<{ checkoutUrl: string }> {
    try {
      const payment = await this.paymentDAO.findFirst({ pytuid, cuid, deletedAt: null });
      if (!payment) {
        throw new NotFoundError({ message: 'Payment not found' });
      }

      if (
        payment.status !== PaymentRecordStatus.PENDING &&
        payment.status !== PaymentRecordStatus.OVERDUE
      ) {
        throw new BadRequestError({
          message: `This payment cannot be paid — current status: ${payment.status}`,
        });
      }

      const tenantProfile = await this.profileDAO.findFirst({
        user: new Types.ObjectId(tenantUserId),
      });
      if (!tenantProfile || !payment.tenant.equals(tenantProfile._id)) {
        throw new BadRequestError({ message: 'You do not have permission to pay this charge' });
      }

      const paymentProcessor = await this.paymentProcessorDAO.findFirst({
        cuid,
        ownerType: 'client',
        deletedAt: null,
      });
      if (!paymentProcessor?.accountId || !paymentProcessor.chargesEnabled) {
        throw new BadRequestError({
          message: 'Payment account not configured or not ready for charges',
        });
      }

      const MONTH_NAMES = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ];
      const periodLabel =
        payment.period?.month && payment.period?.year
          ? `${MONTH_NAMES[(payment.period.month - 1) % 12]} ${payment.period.year}`
          : '';

      const paymentTypeLabelMap: Record<string, string> = {
        rent: 'Rent',
        maintenance: 'Maintenance',
        late_fee: 'Late Fee',
        security_deposit: 'Security Deposit',
        deposit_refund: 'Deposit Refund',
      };
      const typeLabel = paymentTypeLabelMap[payment.paymentType] ?? 'Payment';
      const itemName = periodLabel ? `${typeLabel} — ${periodLabel}` : typeLabel;

      const totalAmountCents = payment.baseAmount ?? 0;
      const currency = payment.currency ?? 'usd';

      const tenantUser = await this.userDAO.findFirst({
        _id: new Types.ObjectId(tenantUserId),
      });
      const customerEmail = tenantUser?.email ?? '';

      const uid = tenantUserId;
      const frontendUrl = process.env.FRONTEND_URL ?? '';

      // Validate that a caller-supplied URL belongs to this app before using it.
      const isSafeReturnUrl = (url: string) => url.startsWith(`${frontendUrl}/tenants/${cuid}/`);

      // Fall back to the specific payment-detail page so the user lands in the
      // right context and can see success / cancel state immediately.
      const defaultSuccessUrl = `${frontendUrl}/tenants/${cuid}/${uid}/payments/${pytuid}?payment_success=true`;
      const defaultCancelUrl = `${frontendUrl}/tenants/${cuid}/${uid}/payments/${pytuid}?payment_cancelled=true`;

      const successUrl =
        returnUrls?.successUrl && isSafeReturnUrl(returnUrls.successUrl)
          ? returnUrls.successUrl
          : defaultSuccessUrl;

      const cancelUrl =
        returnUrls?.cancelUrl && isSafeReturnUrl(returnUrls.cancelUrl)
          ? returnUrls.cancelUrl
          : defaultCancelUrl;

      const session = await this.stripeService.createPaymentCheckoutSession({
        customerEmail,
        lineItems: [
          {
            name: itemName,
            description: `Payment ID: ${pytuid}`,
            amountInCents: totalAmountCents,
            currency,
          },
        ],
        applicationFeeAmount: payment.applicationFee ?? 0,
        destinationAccountId: paymentProcessor.accountId,
        metadata: { pytuid, cuid, uid, type: 'card_payment' },
        successUrl,
        cancelUrl,
      });

      if (!session.url) {
        throw new Error('Stripe did not return a checkout URL');
      }

      this.log.info(
        { pytuid, cuid, sessionId: session.id },
        'Card payment checkout session created'
      );

      return {
        success: true,
        data: { checkoutUrl: session.url },
      };
    } catch (error: any) {
      this.log.error({ pytuid, cuid, error }, 'Error creating card payment checkout session');
      throw error;
    }
  }

  /**
   * Webhook handler: checkout.session.completed (mode: payment)
   * Marks the payment record as PAID after a successful card checkout.
   */
  async handleCardPaymentSessionCompleted(session: {
    id: string;
    payment_intent?: string | null;
    metadata?: Record<string, string> | null;
    payment_status?: string;
  }): Promise<void> {
    return this.paymentWebhookService.handleCardPaymentSessionCompleted(session);
  }

  async handleSetupIntentSucceeded(setupIntent: {
    id: string;
    metadata?: Record<string, string> | null;
    customer?: string | { id?: string } | null;
    payment_method?: string | { id?: string } | null;
    mandate?: string | { id?: string } | null;
  }): Promise<void> {
    return this.paymentWebhookService.handleSetupIntentSucceeded(setupIntent);
  }

  /**
   * Webhook handler: charge.dispute.created
   * Reverses the transfer to recover disputed funds from PM, then notifies PM.
   */
  async handleDisputeCreated(
    disputeId: string,
    disputeData: IStripeDisputeWebhookData
  ): IPromiseReturnedData<void> {
    return this.paymentWebhookService.handleDisputeCreated(disputeId, disputeData);
  }

  /**
   * Webhook handler: charge.dispute.funds_reinstated
   * Platform won the dispute — re-transfer funds back to PM.
   */
  async handleDisputeWon(
    disputeId: string,
    disputeData: IStripeDisputeWebhookData
  ): IPromiseReturnedData<void> {
    return this.paymentWebhookService.handleDisputeWon(disputeId, disputeData);
  }

  /**
   * Webhook handler: charge.dispute.closed (status=lost)
   * Blocks PM payouts — platform is liable for the disputed amount.
   */
  async handleDisputeLost(
    disputeId: string,
    disputeData: IStripeDisputeWebhookData
  ): IPromiseReturnedData<void> {
    return this.paymentWebhookService.handleDisputeLost(disputeId, disputeData);
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
                notes: {
                  text: `Cancelled: ${reason}`,
                  createdAt: dayjs().toDate(),
                  author: 'system',
                },
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
   * Delegates to PaymentCronService to avoid maintaining duplicate implementations.
   */
  private createManualTrackingPayment(
    data: Parameters<PaymentCronService['createManualTrackingPayment']>[0]
  ): Promise<IPaymentDocument> {
    return this.paymentCronService.createManualTrackingPayment(data);
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

      const startDate = dayjs(lease.duration.startDate);
      const period = { month: startDate.month() + 1, year: startDate.year() };

      if (lease.fees?.acceptedPaymentMethod === 'auto-debit') {
        await this.createRentPayment(
          cuid,
          {
            paymentType: PaymentRecordType.RENT,
            leaseId: luid,
            tenantId,
            dueDate: startDate.toDate(),
            period,
          },
          { paymentSource: 'cron' }
        );
      } else {
        const { totalMonthlyRent } = computeLeaseMonthlyFees(lease);
        await this.createManualTrackingPayment({
          cuid,
          tenantId,
          dueDate: startDate.toDate(),
          baseAmount: totalMonthlyRent,
          paymentType: PaymentRecordType.RENT,
          paymentMethod: PaymentService.mapLeasePaymentMethod(lease.fees?.acceptedPaymentMethod),
          leaseId: lease._id.toString(),
          period,
          currency: lease.fees?.currency,
          paymentSource: 'cron',
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
    return this.maintenancePaymentService.chargeForMaintenance(cuid, currentUserId, body);
  }

  /**
   * Transfer funds from the PM's Stripe Connect account to the vendor's Stripe Connect account.
   * Uses the approved Invoice as source of truth — no separate payment record needed.
   * Payout state (status, paidAt, transferId) is persisted on the Invoice document.
   *
   * Guards:
   * - Invoice must exist and be approved
   * - Invoice.vendorPayoutStatus must be 'pending' (throws if already 'paid')
   * - PM must have a verified Connect account (chargesEnabled)
   * - Vendor must have completed Stripe Connect onboarding (payoutsEnabled)
   */
  async payVendor(cuid: string, mruid: string): IPromiseReturnedData<null> {
    return this.maintenancePaymentService.payVendor(cuid, mruid);
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
        const MAX_RETRIES = 2;
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
              autoChargeDueDate: dayjs().toDate(),
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

  private calculateRentFees(
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
        if (filters.from) query.dueDate.$gte = dayjs(filters.from).toDate();
        if (filters.to) query.dueDate.$lte = dayjs(filters.to).toDate();
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

      const fmt = (cents: number) => `${payment.currency} ${MoneyUtils.centsToDisplay(cents)}`;
      const fmtDate = (d: Date) =>
        d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      const titleCase = (s: string) =>
        s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

      const total = payment.baseAmount + (payment.processingFee || 0);

      const referenceEntries: { key: string; value: string }[] = [];
      if (lease?.leaseNumber) referenceEntries.push({ key: 'Lease', value: lease.leaseNumber });
      if (payment.period)
        referenceEntries.push({
          key: 'Period',
          value: `${payment.period.month}/${payment.period.year}`,
        });
      referenceEntries.push({ key: 'Due Date', value: fmtDate(payment.dueDate) });
      if (payment.paidAt) referenceEntries.push({ key: 'Paid On', value: fmtDate(payment.paidAt) });

      const lineItems = [
        { description: titleCase(payment.paymentType as string), amount: fmt(payment.baseAmount) },
      ];
      if (payment.processingFee > 0) {
        lineItems.push({ description: 'Processing Fee', amount: fmt(payment.processingFee) });
      }

      const renderData: InvoiceRenderData = {
        companyName: 'Property Management',
        documentTitle: 'Payment Receipt',
        invoiceNumber: payment.invoiceNumber,
        statusLabel: 'PAID',
        statusKey: 'paid',
        billTo: {
          label: 'Tenant',
          name: tenantName,
          address: propertyAddress,
        },
        reference: {
          label: 'Payment Reference',
          entries: referenceEntries,
        },
        details: [{ key: 'Payment Type', value: titleCase(payment.paymentType as string) }],
        detailsTitle: 'Payment Details',
        lineItems,
        lineItemsTitle: 'Amount Breakdown',
        subtotals:
          payment.processingFee > 0 ? [{ label: 'Subtotal', amount: fmt(payment.baseAmount) }] : [],
        totalAmount: fmt(total),
        footerNote: 'This is an official payment receipt.',
        accentColor: '#16a34a',
        accentColorLight: '#4ade80',
      };

      const html = await this.invoiceTemplateRenderer.render(renderData);

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

  async getVendorEarnings(
    cuid: string,
    vendorUid: string,
    filters: { page?: number; limit?: number } = {}
  ): IPromiseReturnedData<IVendorEarningsResponse> {
    try {
      const page = filters.page ?? 1;
      const limit = filters.limit ?? 50;

      const vendor = await this.userDAO.findFirst({ uid: vendorUid, deletedAt: null });
      if (!vendor) {
        throw new NotFoundError({ message: 'Vendor not found.' });
      }

      // Vendor payout state lives on the Invoice document — query approved invoices directly.
      const result = await this.invoiceDAO.listByVendor(vendor._id.toString(), cuid, {
        status: InvoiceStatus.APPROVED,
        page,
        limit,
      });

      const invoices = result.items as any[];

      const items: IVendorEarningItem[] = invoices.map((inv) => ({
        invuid: inv.invuid,
        mruid: inv.mruid,
        title: inv.description,
        amountInCents: inv.amountInCents ?? 0,
        status:
          inv.vendorPayoutStatus === 'paid'
            ? PaymentRecordStatus.PAID
            : PaymentRecordStatus.PENDING,
        paidAt: inv.vendorPaidAt,
        createdAt: inv.createdAt,
      }));

      const paid = items.filter((i) => i.status === PaymentRecordStatus.PAID);
      const pending = items.filter((i) => i.status === PaymentRecordStatus.PENDING);

      const totalPaidInCents = paid.reduce((s, i) => s + i.amountInCents, 0);
      const pendingPayoutInCents = pending.reduce((s, i) => s + i.amountInCents, 0);

      return {
        success: true,
        data: {
          items,
          stats: {
            totalPaidInCents,
            pendingPayoutInCents,
            completedJobs: paid.length,
            expectedEarningsInCents: pendingPayoutInCents,
          },
          pagination: result.pagination
            ? {
                total: result.pagination.total,
                page: result.pagination.currentPage,
                limit: result.pagination.perPage,
                pages: result.pagination.totalPages,
              }
            : { total: items.length, page, limit, pages: 1 },
        },
        message: 'Vendor earnings retrieved successfully.',
      };
    } catch (error) {
      this.log.error('Error fetching vendor earnings', error);
      throw error;
    }
  }
}
