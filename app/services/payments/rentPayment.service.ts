import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { createLogger } from '@utils/index';
import { envVariables } from '@shared/config';
import { QueueFactory } from '@services/queue';
import { UserCache } from '@caching/user.cache';
import { MoneyUtils } from '@utils/money.utils';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { SubscriptionPlanConfig } from '@services/subscription';
import { MAX_CHARGE_ATTEMPTS, JOB_NAME } from '@utils/constants';
import { calcApplicationFeeSplit } from '@utils/financial.utils';
import { IPromiseReturnedData, MailType } from '@interfaces/utils.interface';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
import { calculateProRatedAmount, computeLeaseMonthlyFees } from '@services/lease/leaseHelpers';
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
  ISubscriptionStatus,
  PaymentRecordType,
  IPaymentDocument,
  IPaymentFormData,
  IProfileWithUser,
  ILeaseDocument,
  PaymentSource,
  PaymentMethod,
  LeaseStatus,
} from '@interfaces/index';

import { PaymentCronService } from './paymentCron.service';
import { PaymentWebhookService } from './paymentWebhook.service';

interface IConstructor {
  subscriptionPlanConfig: SubscriptionPlanConfig;
  paymentGatewayService: PaymentGatewayService;
  paymentWebhookService: PaymentWebhookService;
  paymentProcessorDAO: PaymentProcessorDAO;
  paymentCronService: PaymentCronService;
  emitterService: EventEmitterService;
  subscriptionDAO: SubscriptionDAO;
  queueFactory: QueueFactory;
  paymentDAO: PaymentDAO;
  profileDAO: ProfileDAO;
  userCache: UserCache;
  clientDAO: ClientDAO;
  leaseDAO: LeaseDAO;
}

export class RentPaymentService {
  private readonly log: Logger;
  private readonly subscriptionPlanConfig: SubscriptionPlanConfig;
  private readonly paymentGatewayService: PaymentGatewayService;
  private readonly paymentWebhookService: PaymentWebhookService;
  private readonly paymentProcessorDAO: PaymentProcessorDAO;
  private readonly emitterService: EventEmitterService;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly paymentCronService: PaymentCronService;
  private readonly queueFactory: QueueFactory;
  private readonly paymentDAO: PaymentDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly userCache: UserCache;
  private readonly clientDAO: ClientDAO;
  private readonly leaseDAO: LeaseDAO;

  constructor({
    subscriptionPlanConfig,
    paymentGatewayService,
    paymentWebhookService,
    paymentProcessorDAO,
    emitterService,
    subscriptionDAO,
    paymentCronService,
    queueFactory,
    paymentDAO,
    profileDAO,
    userCache,
    clientDAO,
    leaseDAO,
  }: IConstructor) {
    this.log = createLogger('RentPaymentService');
    this.subscriptionPlanConfig = subscriptionPlanConfig;
    this.paymentGatewayService = paymentGatewayService;
    this.paymentWebhookService = paymentWebhookService;
    this.paymentProcessorDAO = paymentProcessorDAO;
    this.emitterService = emitterService;
    this.subscriptionDAO = subscriptionDAO;
    this.paymentCronService = paymentCronService;
    this.queueFactory = queueFactory;
    this.paymentDAO = paymentDAO;
    this.profileDAO = profileDAO;
    this.userCache = userCache;
    this.clientDAO = clientDAO;
    this.leaseDAO = leaseDAO;
  }

  registerEventListeners(): void {
    this.emitterService.on(
      EventTypes.LEASE_ESIGNATURE_COMPLETED,
      this.handleLeaseActivated.bind(this)
    );
    this.emitterService.on(EventTypes.INSPECTION_APPROVED, this.handleDepositRefund.bind(this));
  }

  /**
   * Finds the lease's security deposit record. A renewal carries the original deposit forward
   * (it is never invoiced again), so when the lease has no deposit of its own this walks
   * `previousLeaseId` back to the lease that collected it.
   */
  async findLeaseDepositPayment(
    cuid: string,
    leaseId: string,
    statuses: PaymentRecordStatus[] = [PaymentRecordStatus.PAID]
  ): Promise<IPaymentDocument | null> {
    const visitedLeaseIds = new Set<string>();
    let currentLeaseId: string | undefined = leaseId;

    while (currentLeaseId && !visitedLeaseIds.has(currentLeaseId)) {
      visitedLeaseIds.add(currentLeaseId);

      const deposit = await this.paymentDAO.findFirst({
        lease: new Types.ObjectId(currentLeaseId),
        cuid,
        paymentType: PaymentRecordType.SECURITY_DEPOSIT,
        status: { $in: statuses },
        deletedAt: null,
      });
      if (deposit) return deposit;

      const lease = await this.leaseDAO.findFirst({
        _id: new Types.ObjectId(currentLeaseId),
        cuid,
      });
      currentLeaseId = lease?.previousLeaseId?.toString();
    }

    return null;
  }

  /**
   * The full refundable deposit (security + pet deposit, as collected) for a lease or the
   * lease it was renewed from. Null when no paid deposit exists.
   */
  async getRefundableDeposit(
    cuid: string,
    leaseId: string
  ): Promise<{ amount: number; currency: string; pytuid: string } | null> {
    const deposit = await this.findLeaseDepositPayment(cuid, leaseId);
    if (!deposit) return null;
    return { amount: deposit.baseAmount, currency: deposit.currency, pytuid: deposit.pytuid };
  }

  private async handleDepositRefund(payload: {
    refundAmount?: number;
    leaseId: string;
    cuid: string;
  }): Promise<void> {
    if (!payload.refundAmount || payload.refundAmount <= 0) {
      // Warn if a paid deposit exists but no refund was requested — PM may have
      // accidentally approved with $0 refund
      const paidDeposit = await this.findLeaseDepositPayment(payload.cuid, payload.leaseId);
      if (paidDeposit) {
        this.log.warn(
          { leaseId: payload.leaseId, depositAmount: paidDeposit.baseAmount },
          'Inspection approved with $0 refund but a paid security deposit exists — no refund will be processed'
        );
      }
      return;
    }

    try {
      const depositPayment = await this.findLeaseDepositPayment(payload.cuid, payload.leaseId);

      if (!depositPayment) {
        this.log.info({ leaseId: payload.leaseId }, 'No paid deposit found — skipping refund');
        return;
      }

      const refundAmount = Math.min(payload.refundAmount, depositPayment.baseAmount);
      const stageForManagerRelease = (reason: string) =>
        this.paymentDAO.updateById(depositPayment._id.toString(), {
          $set: {
            status: PaymentRecordStatus.PENDING_REFUND,
            'refund.amount': refundAmount,
            'refund.refundedBy': 'system:inspection-approved',
            'refund.reason': reason,
          },
        });

      // Check client setting: if requireDepositRefundApproval is enabled, stage the
      // refund as PENDING_REFUND instead of hitting Stripe immediately. A PM/admin
      // must then call releaseDepositRefund to execute the actual Stripe refund.
      const client = await this.clientDAO.findFirst({ cuid: payload.cuid, deletedAt: null });
      if (client?.settings?.requireDepositRefundApproval) {
        await stageForManagerRelease('Move-out inspection deposit refund — awaiting PM approval');
        this.log.info(
          { leaseId: payload.leaseId, refundAmount },
          'Deposit refund staged as PENDING_REFUND — requireDepositRefundApproval is enabled'
        );
        return;
      }

      // Cash/cheque deposits have no gateway charge to refund. The money has to be paid back
      // outside the app, so a manager releases it (releaseDepositRefund) once that is done.
      if (!depositPayment.gatewayChargeId) {
        await stageForManagerRelease(
          'Move-out inspection deposit refund (offline) — awaiting manager release'
        );
        this.log.info(
          { leaseId: payload.leaseId, refundAmount },
          'Offline deposit refund staged as PENDING_REFUND for manager release'
        );
        return;
      }

      const refundResult = await this.paymentGatewayService.createRefund(
        IPaymentGatewayProvider.STRIPE,
        {
          chargeId: depositPayment.gatewayChargeId,
          amountInCents: refundAmount,
          reason: 'requested_by_customer',
          note: 'Move-out inspection — security deposit refund',
          idempotencyKey: `deposit-refund:${depositPayment.pytuid}:${depositPayment.refund?.failedAt?.getTime() ?? 0}`,
        }
      );

      if (refundResult.success) {
        await this.paymentDAO.updateById(depositPayment._id.toString(), {
          $set: {
            status: PaymentRecordStatus.REFUNDED,
            'refund.amount': refundAmount,
            'refund.refundedAt': new Date(),
            'refund.refundedBy': 'system:inspection-approved',
            'refund.reason': 'Move-out inspection deposit refund',
            'refund.gatewayRefundId': refundResult.data?.refundId,
          },
          $unset: { 'refund.failureReason': 1, 'refund.failedAt': 1 },
        });
        // refund.amount is already stored, so the charge.refunded webhook won't notify — do it here
        this.emitterService.emit(EventTypes.PAYMENT_REFUNDED, {
          cuid: payload.cuid,
          pytuid: depositPayment.pytuid,
          tenantId: depositPayment.tenant?.toString(),
          amount: refundAmount,
          totalRefunded: refundAmount,
          refundAmount,
          chargeId: depositPayment.gatewayChargeId,
          currency: depositPayment.currency,
          isPartial: refundAmount < depositPayment.baseAmount,
          reason: 'Move-out inspection deposit refund',
        });
        this.log.info(
          { leaseId: payload.leaseId, refundAmount },
          'Security deposit refund processed via Stripe'
        );
        return;
      }

      // Leave the refund staged so a manager can retry it (releaseDepositRefund), and tell them.
      const failureReason = refundResult.message || 'Stripe deposit refund failed';
      await this.paymentDAO.updateById(depositPayment._id.toString(), {
        $set: {
          status: PaymentRecordStatus.PENDING_REFUND,
          'refund.amount': refundAmount,
          'refund.refundedBy': 'system:inspection-approved',
          'refund.reason': 'Move-out inspection deposit refund — gateway refund failed',
          'refund.failureReason': failureReason,
          'refund.failedAt': new Date(),
        },
      });
      this.emitterService.emit(EventTypes.DEPOSIT_REFUND_FAILED, {
        cuid: payload.cuid,
        pytuid: depositPayment.pytuid,
        leaseId: payload.leaseId,
        amount: refundAmount,
        currency: depositPayment.currency,
        reason: failureReason,
      });
      this.log.error(
        { leaseId: payload.leaseId, pytuid: depositPayment.pytuid, error: failureReason },
        'Stripe deposit refund failed — staged as PENDING_REFUND for manager retry'
      );
    } catch (error) {
      this.log.error(
        { error, leaseId: payload.leaseId },
        'Failed to process deposit refund — non-blocking'
      );
    }
  }

  private async getProfileOrThrow(userId: string | Types.ObjectId, msg?: string): Promise<any> {
    const profile = await this.profileDAO.findFirst({
      user: typeof userId === 'string' ? new Types.ObjectId(userId) : userId,
    });
    if (!profile) throw new NotFoundError({ message: msg || 'Profile not found' });
    return profile;
  }

  private async getActiveProcessorOrThrow(cuid: string) {
    const processor = await this.paymentProcessorDAO.findFirst({ cuid });
    if (!processor?.accountId || !processor.chargesEnabled) {
      throw new BadRequestError({
        message: 'Payment account not configured or not ready for charges',
      });
    }
    return processor;
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

  async createRentPayment(
    cuid: string,
    data: IPaymentFormData,
    options?: {
      createStripeInvoice?: boolean;
      paymentSource?: PaymentSource;
      /** Prefix for Stripe idempotency keys — stable across retries of the same job. */
      idempotencyKey?: string;
      /**
       * Also invoice the security + pet deposit. Only lease activation sets this (and never for a
       * renewal, which carries the original deposit forward).
       */
      invoiceDeposit?: boolean;
    }
  ): IPromiseReturnedData<IPaymentDocument> {
    try {
      if (!data.leaseId) {
        throw new BadRequestError({ message: 'Lease ID is required for rent payments' });
      }
      if (
        data.paymentType === PaymentRecordType.DEPOSIT_REFUND ||
        data.paymentType === PaymentRecordType.SECURITY_DEPOSIT
      ) {
        throw new BadRequestError({
          message:
            'Deposits are invoiced when the lease is activated and refunded through the move-out inspection — they cannot be created as a payment request.',
        });
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

      // The lease (already scoped to this client) is the source of truth for who is billed.
      const tenantUserId = lease.tenantId.toString();
      if (data.tenantId && data.tenantId !== tenantUserId) {
        throw new BadRequestError({ message: 'Tenant does not match the lease tenant' });
      }

      const effectiveEndDate = lease.duration.terminationDate || lease.duration.endDate;
      if (effectiveEndDate && data.dueDate && new Date(data.dueDate) > new Date(effectiveEndDate)) {
        throw new BadRequestError({ message: 'Cannot create payment after lease end date' });
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
            // Both are dead-end states — a replacement record is the next step.
            // Void the old invoice(s) first so the tenant can't pay a charge we no longer track.
            await this.voidOpenInvoices(existingForPeriod);
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
        let trackingLineItems: { description: string; amountInCents: number }[] | undefined;
        if (effectivePaymentType === PaymentRecordType.LATE_FEE) {
          const fees = lease.calculateFees({ daysLate: data.daysLate ?? 0 });
          trackingAmount = fees.late.fee;
          if (trackingAmount <= 0) {
            throw new BadRequestError({
              message: 'No late fee is applicable — the payment is still within the grace period.',
            });
          }
        } else {
          trackingLineItems = this.buildRentLineItems(lease, {
            period: data.period,
            dueDate: data.dueDate,
          });
          trackingAmount = RentPaymentService.sumLineItems(trackingLineItems);
        }
        const payment = await this.createManualTrackingPayment({
          cuid,
          tenantId: tenantUserId,
          dueDate: dayjs(data.dueDate).toDate(),
          baseAmount: trackingAmount,
          paymentType: effectivePaymentType,
          paymentMethod: RentPaymentService.mapLeasePaymentMethod(acceptedPaymentMethod),
          leaseId: lease._id.toString(),
          period: data.period,
          description: data.description,
          currency: lease.fees?.currency,
          paymentSource: options?.paymentSource,
          lineItems: trackingLineItems,
        });
        if (data.notifyByEmail) {
          await this.queuePaymentRequestEmail({
            cuid,
            tenantId: tenantUserId,
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

      // Late fees are only ever billed as their own LATE_FEE charge (the overdue crons queue
      // them); a rent invoice created after its due date never carries one.
      let lateFeeDaysLate = 0;
      if (effectivePaymentType === PaymentRecordType.LATE_FEE) {
        if (data.daysLate !== undefined) {
          lateFeeDaysLate = data.daysLate;
        } else if (data.dueDate) {
          lateFeeDaysLate = Math.max(0, dayjs().diff(dayjs(data.dueDate), 'day'));
        }
      }

      const leaseFees = lease.calculateFees({ daysLate: lateFeeDaysLate });
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
        lineItems = this.buildRentLineItems(lease, { period: data.period, dueDate: data.dueDate });
      }
      const totalAmountInCents = RentPaymentService.sumLineItems(lineItems);

      if (!options?.createStripeInvoice) {
        const payment = await this.createManualTrackingPayment({
          cuid,
          tenantId: tenantUserId,
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
            tenantId: tenantUserId,
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
        feeBreakdown = this.calculateAchFees(totalAmountInCents);
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
        { user: new Types.ObjectId(tenantUserId) },
        {
          populate: ['user'],
        }
      )) as IProfileWithUser | null;
      if (!tenantProfile) {
        throw new NotFoundError({ message: 'Tenant profile not found' });
      }
      const tenantClientLinks = (tenantProfile.user as { cuids?: { cuid: string }[] }).cuids;
      if (Array.isArray(tenantClientLinks) && !tenantClientLinks.some((c) => c.cuid === cuid)) {
        throw new BadRequestError({ message: 'Tenant does not belong to this client' });
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
        await this.userCache.invalidateUserDetail(cuid, tenantProfile.user.uid);
      }

      const paymentMethodId = tenantProfile.tenantInfo?.paymentMethods?.get(
        paymentProcessor.accountId
      );

      // Split ACSS payments that exceed the per-transaction limit into rent vs fees, so each
      // bank debit stays under the limit. When the rent alone is over the limit a split can't
      // help, so one invoice is created: the bank rejects the debit at charge time and the
      // existing ACSS-limit handling (payPendingCharge → retryPaymentWithCard) moves it to card.
      const acssLimit = envVariables.STRIPE.ACSS_PER_TXN_LIMIT;
      const rentItems = lineItems.filter((li) => li.description.toLowerCase().includes('rent'));
      const feeItems = lineItems.filter((li) => !li.description.toLowerCase().includes('rent'));
      const rentSplitAmount = RentPaymentService.sumLineItems(rentItems);
      const feesSplitAmount = RentPaymentService.sumLineItems(feeItems);
      const needsSplit =
        isAch &&
        totalAmountInCents > acssLimit &&
        rentItems.length > 0 &&
        feeItems.length > 0 &&
        rentSplitAmount <= acssLimit &&
        feesSplitAmount <= acssLimit;
      if (isAch && totalAmountInCents > acssLimit && !needsSplit) {
        this.log.warn(
          { cuid, luid: lease.luid, totalAmountInCents, acssLimit },
          'Rent exceeds the ACSS per-transaction limit and cannot be split under it — a bank debit will fall back to card'
        );
      }

      let invoiceId: string;
      let hostedInvoiceUrl: string | undefined;
      let splitInvoices: typeof payment.splitInvoices;

      const invoiceOpts = {
        tenantCustomerId,
        connectedAccountId: paymentProcessor.accountId,
        currency: leaseFees.currency.toLowerCase(),
        dueDate: data.dueDate,
        cuid,
        paymentMethodId,
        leaseUid: lease.luid,
      };
      const invoiceKey = (part: string) =>
        options?.idempotencyKey ? `${options.idempotencyKey}:${part}` : undefined;

      if (needsSplit) {
        // Each invoice carries the application fee for its own amount — a fee computed on the
        // full total can exceed the smaller fees invoice, which Stripe rejects.
        const rentSplitFees = this.calculateAchFees(rentSplitAmount);
        const feesSplitFees = this.calculateAchFees(feesSplitAmount);
        feeBreakdown = {
          baseAmount: totalAmountInCents,
          applicationFee: rentSplitFees.applicationFee + feesSplitFees.applicationFee,
          gatewayProcessingFee:
            rentSplitFees.gatewayProcessingFee + feesSplitFees.gatewayProcessingFee,
          platformNetRevenue: rentSplitFees.platformNetRevenue + feesSplitFees.platformNetRevenue,
        };

        const rentInvoice = await this.createAndFinalizeInvoice({
          ...invoiceOpts,
          applicationFee: rentSplitFees.applicationFee,
          description: `Rent for ${data.period?.month}/${data.period?.year}`,
          lineItems: rentItems,
          idempotencyKey: invoiceKey('rent'),
        });

        const feesInvoice = await this.createAndFinalizeInvoice({
          ...invoiceOpts,
          applicationFee: feesSplitFees.applicationFee,
          description: `Fees for ${data.period?.month}/${data.period?.year}`,
          lineItems: feeItems,
          idempotencyKey: invoiceKey('fees'),
        });

        invoiceId = rentInvoice.invoiceId;
        hostedInvoiceUrl = rentInvoice.hostedInvoiceUrl;
        splitInvoices = [
          {
            invoiceId: rentInvoice.invoiceId,
            amount: rentSplitAmount,
            applicationFee: rentSplitFees.applicationFee,
            category: 'rent' as const,
            status: 'pending' as const,
          },
          {
            invoiceId: feesInvoice.invoiceId,
            amount: feesSplitAmount,
            applicationFee: feesSplitFees.applicationFee,
            category: 'fees' as const,
            status: 'pending' as const,
          },
        ];
      } else {
        const result = await this.createAndFinalizeInvoice({
          ...invoiceOpts,
          applicationFee: feeBreakdown.applicationFee,
          description: data.description || `Rent for ${data.period?.month}/${data.period?.year}`,
          lineItems,
          idempotencyKey: invoiceKey('full'),
        });
        invoiceId = result.invoiceId;
        hostedInvoiceUrl = result.hostedInvoiceUrl;
      }

      const payment = await this.paymentDAO.insert({
        cuid,
        paymentType: effectivePaymentType,
        paymentMethod: PaymentMethod.ONLINE,
        lease: lease._id,
        tenant: tenantProfile._id,
        baseAmount: totalAmountInCents,
        processingFee: feeBreakdown.gatewayProcessingFee,
        applicationFee: feeBreakdown.applicationFee,
        platformRevenue: feeBreakdown.platformNetRevenue,
        gatewayPaymentId: invoiceId,
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
        ...(splitInvoices && { splitInvoices }),
      });

      this.emitterService.emit(EventTypes.PAYMENT_REQUEST_CREATED, {
        tenantUserId: tenantProfile.user._id.toString(),
        amountInCents: totalAmountInCents,
        dueDate: dayjs(data.dueDate).toDate(),
        pytuid: payment.pytuid,
        cuid,
        currency: leaseFees.currency,
        paymentType: effectivePaymentType,
        acceptedPaymentMethod: lease.fees?.acceptedPaymentMethod,
      });

      // Create a separate deposit invoice (own chargeId for independent refund)
      if (options?.invoiceDeposit && leaseFees.deposits.total > 0) {
        try {
          await this.createDepositInvoice({
            ...invoiceOpts,
            leaseId: lease._id.toString(),
            tenantProfileId: tenantProfile._id,
            deposits: leaseFees.deposits,
            idempotencyKey: invoiceKey('deposit'),
          });
        } catch (depositError) {
          this.log.error(
            { error: depositError, cuid, leaseId: lease._id },
            'Failed to create deposit invoice — rent payment succeeded'
          );
        }
      }

      if (data.notifyByEmail) {
        await this.queuePaymentRequestEmail({
          cuid,
          tenantId: tenantUserId,
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
        payment.status !== PaymentRecordStatus.OVERDUE &&
        payment.status !== PaymentRecordStatus.FAILED
      ) {
        throw new BadRequestError({
          message: `Cannot pay a charge with status: ${payment.status}`,
        });
      }

      if (!RentPaymentService.TENANT_PAYABLE_TYPES.has(payment.paymentType)) {
        throw new BadRequestError({
          message: 'Only rent, maintenance, late fee or deposit charges can be paid this way',
        });
      }

      // Retry: reset a previously-failed payment so a fresh invoice is created
      if (payment.status === PaymentRecordStatus.FAILED) {
        if ((payment.failure?.retryCount ?? 0) >= MAX_CHARGE_ATTEMPTS) {
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

      const tenantProfile = await this.getProfileOrThrow(tenantUserId, 'Tenant profile not found');
      if (!payment.tenant.equals(tenantProfile._id)) {
        throw new BadRequestError({ message: 'You do not have permission to pay this charge' });
      }

      const paymentProcessor = await this.getActiveProcessorOrThrow(cuid);

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
                  '[RentPaymentService] Failed to void invoice for bank method without mandate'
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

            const tenantWithUser = (await this.profileDAO.findFirst(
              { user: new Types.ObjectId(tenantUserId) },
              { populate: ['user'] }
            )) as IProfileWithUser | null;
            if (tenantWithUser?.user?.uid) {
              await this.userCache.invalidateUserDetail(cuid, tenantWithUser.user.uid);
            }

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

          const { invoiceId, hostedInvoiceUrl: hostedUrl } = await this.createAndFinalizeInvoice({
            tenantCustomerId,
            connectedAccountId: paymentProcessor.accountId,
            applicationFee: feeBreakdown.applicationFee,
            currency: (payment.currency ?? 'USD').toLowerCase(),
            description: payment.description || `Rent payment ${pytuid}`,
            dueDate: dayjs().toDate(),
            lineItems: payment.lineItems as { description: string; amountInCents: number }[],
            cuid,
            paymentMethodId,
          });

          activeInvoiceId = invoiceId;

          await this.paymentDAO.updateById(payment._id.toString(), {
            gatewayPaymentId: activeInvoiceId,
            ...(hostedUrl && { 'receipt.url': hostedUrl }),
          });
        }

        const payResult = await this.paymentGatewayService.payInvoice(
          IPaymentGatewayProvider.STRIPE,
          activeInvoiceId,
          paymentMethodId
            ? { paymentMethod: paymentMethodId, ...(mandateId && { mandate: mandateId }) }
            : undefined
        );

        if (!payResult.success) {
          // If the bank debit failed (e.g. ACSS per-transaction limit), automatically
          // retry with the tenant's card on file instead of throwing to the frontend.
          const errMsg = (payResult.message ?? '').toLowerCase();
          const isAcssError =
            errMsg.includes('acss_debit') ||
            (errMsg.includes('amount') && errMsg.includes('limit'));

          if (isAcssError) {
            this.log.warn(
              { pytuid, invoiceId: activeInvoiceId, error: payResult.message },
              '[RentPaymentService] ACSS payment rejected — attempting card retry'
            );
            const retried = await this.paymentWebhookService.retryPaymentWithCard(
              payment,
              activeInvoiceId
            );
            if (retried) {
              return {
                success: true,
                data: payment as IPaymentDocument,
                message:
                  'Bank debit unavailable for this amount — your card has been charged instead.',
              };
            }
          }
          throw new BadRequestError({ message: payResult.message || 'Failed to initiate payment' });
        }

        this.log.info(
          { pytuid, cuid, invoiceId: activeInvoiceId },
          '[RentPaymentService] Tenant-initiated rent payment submitted'
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

      const mandateId = tenantProfile.tenantInfo?.paymentMandates?.get(paymentProcessor.accountId);

      // Bank debit without a mandate cannot proceed — same guard as the rent path
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
          throw new BadRequestError({
            message:
              'Your bank account must be re-authorized before this charge can be paid. Please set up your payment method again, or pay with card.',
          });
        }
      }

      const subscription = await this.subscriptionDAO.findFirst({ cuid, deletedAt: null });
      const transactionFeePercent = subscription
        ? this.subscriptionPlanConfig.getTransactionFeePercent(subscription.planName)
        : 0;
      const feeBreakdown = this.calculateRentFees(payment.baseAmount, transactionFeePercent);
      const isDeposit = payment.paymentType === PaymentRecordType.SECURITY_DEPOSIT;

      let activeInvoiceId = payment.gatewayPaymentId;

      if (!activeInvoiceId) {
        const { invoiceId, hostedInvoiceUrl: hostedUrl } = await this.createAndFinalizeInvoice({
          tenantCustomerId,
          connectedAccountId: paymentProcessor.accountId,
          // Deposits are held for the tenant and refunded in full — the platform takes no fee.
          applicationFee: isDeposit ? 0 : feeBreakdown.applicationFee,
          currency: (payment.currency ?? 'USD').toLowerCase(),
          description:
            payment.description ||
            (isDeposit ? 'Security & Pet Deposit' : `Maintenance charge ${pytuid}`),
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

      const updated = await this.paymentDAO.findFirst({ pytuid, cuid, deletedAt: null });

      const payResult = await this.paymentGatewayService.payInvoice(
        IPaymentGatewayProvider.STRIPE,
        activeInvoiceId!,
        {
          paymentMethod: paymentMethodId,
          ...(mandateId && { mandate: mandateId }),
        }
      );

      if (!payResult.success) {
        throw new BadRequestError({ message: payResult.message || 'Failed to initiate payment' });
      }

      this.log.info(
        { pytuid, cuid, invoiceId: activeInvoiceId, paymentType: payment.paymentType },
        '[RentPaymentService] Pending charge submitted for payment'
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
   * Build invoice line items from pre-calculated lease fees
   * Accepts already-calculated fees to avoid redundant calculations
   *
   * @param fees - Pre-calculated fees from lease.calculateFees()
   * @returns Array of line items with amounts in cents
   */
  private buildLineItemsFromFees(
    fees: {
      monthly: { rent: number; petFee: number };
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

    // Late fees are never added here — they are billed as their own LATE_FEE charge.
    // Security deposit and pet deposit are handled as a separate invoice
    // (see createDepositInvoice) to enable independent refund via Stripe.

    // Validate we have at least one line item
    if (lineItems.length === 0) {
      throw new Error('No valid fees found on lease');
    }

    return lineItems;
  }

  // TODO: Security and pet deposits are combined into a single SECURITY_DEPOSIT payment record.
  // If partial refund is needed (e.g., non-refundable pet deposit), consider splitting into
  // separate payment records per deposit type.
  private static buildDepositLineItems(deposits: {
    security: number;
    pet: number;
  }): { description: string; amountInCents: number }[] {
    const depositLineItems: { description: string; amountInCents: number }[] = [];
    if (deposits.security > 0) {
      depositLineItems.push({ description: 'Security Deposit', amountInCents: deposits.security });
    }
    if (deposits.pet > 0) {
      depositLineItems.push({ description: 'Pet Deposit', amountInCents: deposits.pet });
    }
    return depositLineItems;
  }

  private async leaseHasDepositRecord(cuid: string, leaseId: string): Promise<boolean> {
    const existing = await this.paymentDAO.findFirst({
      cuid,
      lease: new Types.ObjectId(leaseId),
      paymentType: PaymentRecordType.SECURITY_DEPOSIT,
      status: { $ne: PaymentRecordStatus.CANCELLED },
      deletedAt: null,
    });
    return !!existing;
  }

  /**
   * Deposit record without a Stripe invoice, used when the activation invoice could not be
   * created (e.g. onboarding unfinished). The tenant pays it through payPendingCharge, which
   * creates the invoice on demand.
   */
  private async createDepositTrackingRecord(opts: {
    cuid: string;
    leaseId: string;
    tenantUserId: string;
    dueDate: Date;
    currency?: string;
    deposits: { security: number; pet: number; total: number };
  }): Promise<void> {
    const depositLineItems = RentPaymentService.buildDepositLineItems(opts.deposits);
    if (depositLineItems.length === 0) return;
    if (await this.leaseHasDepositRecord(opts.cuid, opts.leaseId)) return;

    await this.createManualTrackingPayment({
      cuid: opts.cuid,
      tenantId: opts.tenantUserId,
      dueDate: opts.dueDate,
      baseAmount: opts.deposits.total,
      paymentType: PaymentRecordType.SECURITY_DEPOSIT,
      paymentMethod: PaymentMethod.ONLINE,
      leaseId: opts.leaseId,
      description: 'Security & Pet Deposit',
      currency: opts.currency,
      lineItems: depositLineItems,
      paymentSource: 'cron',
    });
  }

  private async createDepositInvoice(opts: {
    tenantCustomerId: string;
    connectedAccountId: string;
    currency: string;
    dueDate: string | Date;
    cuid: string;
    leaseId: string;
    tenantProfileId: Types.ObjectId;
    paymentMethodId?: string;
    leaseUid?: string;
    deposits: { security: number; pet: number; total: number };
    idempotencyKey?: string;
  }): Promise<void> {
    const depositLineItems = RentPaymentService.buildDepositLineItems(opts.deposits);
    if (depositLineItems.length === 0) return;
    if (await this.leaseHasDepositRecord(opts.cuid, opts.leaseId)) {
      this.log.info(
        { cuid: opts.cuid, leaseId: opts.leaseId },
        'Deposit already recorded for lease — not invoicing again'
      );
      return;
    }

    const { invoiceId, hostedInvoiceUrl } = await this.createAndFinalizeInvoice({
      tenantCustomerId: opts.tenantCustomerId,
      connectedAccountId: opts.connectedAccountId,
      applicationFee: 0,
      currency: opts.currency,
      description: 'Security & Pet Deposit',
      dueDate: dayjs(opts.dueDate).toDate(),
      lineItems: depositLineItems,
      cuid: opts.cuid,
      paymentMethodId: opts.paymentMethodId,
      leaseUid: opts.leaseUid,
      idempotencyKey: opts.idempotencyKey,
    });

    await this.paymentDAO.insert({
      cuid: opts.cuid,
      paymentType: PaymentRecordType.SECURITY_DEPOSIT,
      paymentMethod: PaymentMethod.ONLINE,
      lease: new Types.ObjectId(opts.leaseId),
      tenant: opts.tenantProfileId,
      baseAmount: opts.deposits.total,
      processingFee: 0,
      applicationFee: 0,
      platformRevenue: 0,
      gatewayPaymentId: invoiceId,
      currency: opts.currency,
      status: PaymentRecordStatus.PENDING,
      dueDate: dayjs(opts.dueDate).toDate(),
      description: 'Security & Pet Deposit',
      isManualEntry: false,
      lineItems: depositLineItems,
      ...(hostedInvoiceUrl && { receipt: { url: hostedInvoiceUrl } }),
    });

    this.log.info(
      { cuid: opts.cuid, leaseId: opts.leaseId, amount: opts.deposits.total },
      'Security deposit invoice created'
    );
  }

  async createAndFinalizeInvoice(opts: {
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
    idempotencyKey?: string;
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
        idempotencyKey: opts.idempotencyKey,
      }
    );
    if (!invoiceResult.success || !invoiceResult.data) {
      throw new Error(invoiceResult.message || 'Failed to create invoice');
    }

    const finalizeResult = await this.paymentGatewayService.finalizeInvoice(
      IPaymentGatewayProvider.STRIPE,
      invoiceResult.data.invoiceId,
      opts.idempotencyKey && `${opts.idempotencyKey}:finalize`
    );
    if (!finalizeResult.success) {
      throw new Error(finalizeResult.message || 'Failed to finalize invoice');
    }

    return {
      invoiceId: invoiceResult.data.invoiceId,
      hostedInvoiceUrl: finalizeResult.data?.hostedInvoiceUrl,
    };
  }

  private static readonly TENANT_PAYABLE_TYPES = new Set<PaymentRecordType>([
    PaymentRecordType.SECURITY_DEPOSIT,
    PaymentRecordType.MAINTENANCE,
    PaymentRecordType.LATE_FEE,
    PaymentRecordType.RENT,
  ]);

  private static sumLineItems(lineItems: { amountInCents: number }[]): number {
    return lineItems.reduce((sum, item) => sum + item.amountInCents, 0);
  }

  /** True when the billed period (or, without one, the due date) is the lease's first month. */
  private static isLeaseFirstMonth(
    lease: ILeaseDocument,
    billing: { period?: { month: number; year: number }; dueDate?: Date | string }
  ): boolean {
    const start = dayjs(lease.duration.startDate);
    const billedMonth =
      billing.period ??
      (billing.dueDate
        ? { month: dayjs(billing.dueDate).month() + 1, year: dayjs(billing.dueDate).year() }
        : undefined);
    if (!billedMonth) return false;
    return billedMonth.month === start.month() + 1 && billedMonth.year === start.year();
  }

  /**
   * Monthly rent line items for a lease (rent, pet fee, management fee). The lease's first
   * month is pro-rated the same way for every payment method.
   */
  private buildRentLineItems(
    lease: ILeaseDocument,
    billing: { period?: { month: number; year: number }; dueDate?: Date | string }
  ): { description: string; amountInCents: number }[] {
    const { baseRent, petMonthlyFee, managementFee } = computeLeaseMonthlyFees(lease);
    return this.buildLineItemsFromFees(
      { monthly: { rent: baseRent, petFee: petMonthlyFee } },
      {
        isFirstPayment: RentPaymentService.isLeaseFirstMonth(lease, billing),
        startDate: lease.duration.startDate,
        managementFee,
      }
    );
  }

  /** Auto-debit (ACSS/ACH) fees for one invoice; the application fee never exceeds its amount. */
  private calculateAchFees(amountInCents: number): {
    baseAmount: number;
    applicationFee: number;
    gatewayProcessingFee: number;
    platformNetRevenue: number;
  } {
    const applicationFee = Math.min(
      this.subscriptionPlanConfig.calculateAchApplicationFee(amountInCents),
      amountInCents
    );
    const gatewayFee = this.subscriptionPlanConfig.calculatePaymentGatewayFee(
      amountInCents,
      'stripe',
      'auto-debit'
    );
    return {
      baseAmount: amountInCents,
      applicationFee,
      gatewayProcessingFee: gatewayFee,
      platformNetRevenue: applicationFee - gatewayFee,
    };
  }

  /**
   * Voids every Stripe invoice still attached to a record that is about to be replaced, so the
   * tenant can no longer pay a charge we stop tracking. An invoice that can't be voided is
   * usually already void (e.g. after a card retry); it is logged for reconciliation in case it
   * was paid instead, and the replacement still goes ahead so the month is billed.
   */
  private async voidOpenInvoices(payment: IPaymentDocument): Promise<void> {
    const invoiceIds = [
      ...new Set(
        [payment.gatewayPaymentId, ...(payment.splitInvoices ?? []).map((s) => s.invoiceId)].filter(
          (id): id is string => !!id && id.startsWith('in_')
        )
      ),
    ];
    for (const invoiceId of invoiceIds) {
      const voidResult = await this.paymentGatewayService.voidInvoice(
        IPaymentGatewayProvider.STRIPE,
        invoiceId
      );
      if (!voidResult.success) {
        this.log.error(
          { pytuid: payment.pytuid, invoiceId, message: voidResult.message },
          'Could not void the invoice of the payment being replaced — check it was not paid'
        );
      }
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

  handleLeaseActivated = async (payload: {
    leaseId: string;
    luid: string;
    cuid: string;
    tenantId: string;
  }): Promise<void> => {
    const { leaseId, luid, cuid, tenantId } = payload;
    try {
      const lease = await this.leaseDAO.findFirst(
        { _id: new Types.ObjectId(leaseId), cuid, deletedAt: null },
        { populate: ['property.id'] }
      );
      if (!lease) return;

      const startDate = dayjs(lease.duration.startDate);
      const period = { month: startDate.month() + 1, year: startDate.year() };
      // A renewal carries the original deposit forward — only a new tenancy is invoiced for it.
      const invoiceDeposit = !lease.previousLeaseId;

      if (lease.fees?.acceptedPaymentMethod === 'auto-debit') {
        await this.createAutoDebitFirstMonth(lease, { tenantId, period, invoiceDeposit });
      } else {
        const lineItems = this.buildRentLineItems(lease, { period });
        await this.createManualTrackingPayment({
          cuid,
          tenantId,
          dueDate: startDate.toDate(),
          baseAmount: RentPaymentService.sumLineItems(lineItems),
          paymentType: PaymentRecordType.RENT,
          paymentMethod: RentPaymentService.mapLeasePaymentMethod(
            lease.fees?.acceptedPaymentMethod
          ),
          leaseId: lease._id.toString(),
          period,
          currency: lease.fees?.currency,
          paymentSource: 'cron',
          lineItems,
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
   * First month of an auto-debit lease: a real Stripe invoice the tenant can pay right away
   * (the auto-charge cron charges it if still unpaid when due), plus the deposit invoice for a
   * new tenancy. If the invoice can't be created yet (e.g. payment onboarding unfinished), the
   * charges are recorded without an invoice so they stay visible and payable — payPendingCharge
   * creates the invoice when the tenant pays.
   */
  private async createAutoDebitFirstMonth(
    lease: ILeaseDocument,
    opts: { tenantId: string; period: { month: number; year: number }; invoiceDeposit: boolean }
  ): Promise<void> {
    const dueDate = dayjs(lease.duration.startDate).toDate();
    try {
      await this.createRentPayment(
        lease.cuid,
        {
          paymentType: PaymentRecordType.RENT,
          leaseId: lease.luid,
          tenantId: opts.tenantId,
          dueDate,
          period: opts.period,
        },
        {
          createStripeInvoice: true,
          paymentSource: 'cron',
          idempotencyKey: `lease-activation:${lease._id.toString()}`,
          invoiceDeposit: opts.invoiceDeposit,
        }
      );
      return;
    } catch (error: any) {
      this.log.warn(
        { error: error.message, luid: lease.luid, cuid: lease.cuid },
        'First-month invoice could not be created — recording the charges without an invoice'
      );
    }

    const lineItems = this.buildRentLineItems(lease, { period: opts.period });
    await this.createManualTrackingPayment({
      cuid: lease.cuid,
      tenantId: opts.tenantId,
      dueDate,
      baseAmount: RentPaymentService.sumLineItems(lineItems),
      paymentType: PaymentRecordType.RENT,
      paymentMethod: PaymentMethod.ONLINE,
      leaseId: lease._id.toString(),
      period: opts.period,
      currency: lease.fees?.currency,
      paymentSource: 'cron',
      lineItems,
    });

    if (opts.invoiceDeposit) {
      const { securityDeposit, petDeposit } = computeLeaseMonthlyFees(lease);
      await this.createDepositTrackingRecord({
        cuid: lease.cuid,
        leaseId: lease._id.toString(),
        tenantUserId: opts.tenantId,
        dueDate,
        currency: lease.fees?.currency,
        deposits: {
          security: securityDeposit,
          pet: petDeposit,
          total: securityDeposit + petDeposit,
        },
      });
    }
  }

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
          isAutoDebit: opts.lease.fees?.acceptedPaymentMethod === 'auto-debit',
          paymentUrl: `${envVariables.FRONTEND.URL}/tenants/${opts.cuid}/${profile?.user?.uid}/payments`,
        },
      });
      this.log.info({ tenantEmail }, 'Payment request email queued');
    } catch (err) {
      this.log.warn({ err }, 'Failed to queue payment request email');
    }
  }

  /**
   * Map a lease's acceptedPaymentMethod string to the PaymentMethod enum.
   * Only called for non-auto-debit leases (auto-debit goes through Stripe).
   */
  static mapLeasePaymentMethod(acceptedPaymentMethod: string | undefined): PaymentMethod {
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
