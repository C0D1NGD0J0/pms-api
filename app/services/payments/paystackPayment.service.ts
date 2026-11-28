import dayjs from 'dayjs';
import Logger from 'bunyan';
import { t } from '@shared/languages';
import { FinancialCalculator } from '@utils/financial';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { createPaystackReference } from '@utils/paystackReference';
import { IPaymentProcessorDocument } from '@interfaces/paymentProcessor.interface';
import { PaymentProcessorDAO, SubscriptionDAO, PaymentDAO, ProfileDAO } from '@dao/index';
import { SubscriptionPlanConfig } from '@services/subscription/subscription_plans.config';
import { IPaystackWebhookEvent, IPaystackTransaction } from '@interfaces/paystack.interface';
import {
  ServiceUnavailableError,
  InternalServerError,
  BadRequestError,
} from '@shared/customErrors';
import {
  PAYSTACK_REFERENCE_PREFIX,
  PaymentGatewayService,
} from '@services/paymentGateway/paymentGateway.service';
import {
  CircuitBreakerOpenError,
  readPaystackSavedCard,
  CHARGEABLE_STATUSES,
  createLogger,
} from '@utils/index';
import {
  PaymentRecordStatus,
  PaymentRecordType,
  IPaymentDocument,
  PaymentMethod,
} from '@interfaces/payments.interface';

import { PaymentWebhookService } from './paymentWebhook.service';

/** What happened when the app tried to charge a tenant's saved card. */
export type PaystackAutoChargeOutcome =
  | 'paid' // charged and recorded
  | 'processing' // Paystack is still working on it; the webhook or reconcile settles it
  | 'needs_review' // charged, but the money doesn't match the charge; managers are alerted
  | 'unavailable' // Paystack couldn't be reached and nothing was charged; try again later
  | 'no_saved_card' // nothing to charge: the tenant hasn't paid by card yet (or not NGN)
  | 'declined'; // the card was refused

/** What happened when a Paystack transaction was checked against its charge. */
export type PaystackSettleOutcome =
  | 'paid' // marked paid now
  | 'already_paid' // this same transaction was already recorded
  | 'refunded_duplicate' // the charge was already settled another way, so the money went back
  | 'not_successful' // pending, failed or abandoned at Paystack — nothing to record
  | 'needs_review' // amount, currency or destination doesn't match the charge
  | 'not_found'; // no charge matches the transaction's metadata

interface IConstructor {
  subscriptionPlanConfig: SubscriptionPlanConfig;
  paymentWebhookService: PaymentWebhookService;
  paymentGatewayService: PaymentGatewayService;
  paymentProcessorDAO: PaymentProcessorDAO;
  emitterService: EventEmitterService;
  subscriptionDAO: SubscriptionDAO;
  paymentDAO: PaymentDAO;
  profileDAO: ProfileDAO;
}

// PROCESSING is an in-flight automatic card charge, which settles like any other
const PAYABLE_STATUSES = [
  PaymentRecordStatus.PENDING,
  PaymentRecordStatus.OVERDUE,
  PaymentRecordStatus.FAILED,
  PaymentRecordStatus.PROCESSING,
];

/**
 * Hours a still-pending automatic card charge is given before it's reopened as failed. The daily
 * reconcile starts checking charges after a day: paid ones are recorded and failed ones reopened
 * straight away; only one Paystack still reports as pending waits for this.
 */
const STALE_CARD_CHARGE_HOURS = 72;

/**
 * Tenant card payments for accounts that collect through Paystack (Nigeria).
 *
 * Money flow: rent and late fees settle straight to the landlord's subaccount, with the platform
 * fee kept as `transaction_charge` (the platform bears Paystack's fee). Maintenance charges stay
 * in the platform balance so the vendor can be paid from it (P4b).
 *
 * A charge is identified by the metadata the API sets when the checkout starts (pytuid, cuid,
 * tenant uid), never by the reference alone. Every settlement re-reads the transaction from
 * Paystack, so the webhook and the tenant's return page share one path and can't double-record.
 */
export class PaystackPaymentService {
  private readonly log: Logger;
  private readonly subscriptionPlanConfig: SubscriptionPlanConfig;
  private readonly paymentWebhookService: PaymentWebhookService;
  private readonly paymentGatewayService: PaymentGatewayService;
  private readonly paymentProcessorDAO: PaymentProcessorDAO;
  private readonly emitterService: EventEmitterService;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly paymentDAO: PaymentDAO;
  private readonly profileDAO: ProfileDAO;

  constructor({
    subscriptionPlanConfig,
    paymentWebhookService,
    paymentGatewayService,
    paymentProcessorDAO,
    emitterService,
    subscriptionDAO,
    paymentDAO,
    profileDAO,
  }: IConstructor) {
    this.log = createLogger('PaystackPaymentService');
    this.subscriptionPlanConfig = subscriptionPlanConfig;
    this.paymentWebhookService = paymentWebhookService;
    this.paymentGatewayService = paymentGatewayService;
    this.paymentProcessorDAO = paymentProcessorDAO;
    this.emitterService = emitterService;
    this.subscriptionDAO = subscriptionDAO;
    this.paymentDAO = paymentDAO;
    this.profileDAO = profileDAO;
  }

  /** Starts a hosted Paystack checkout. The caller has already checked the charge and the tenant. */
  async createCardCheckout(input: {
    processor: IPaymentProcessorDocument;
    payment: IPaymentDocument;
    applicationFee: number;
    customerEmail: string;
    successUrl: string;
    cancelUrl: string;
    tenantUid: string;
  }): Promise<{ checkoutUrl: string }> {
    const { payment, processor } = input;

    // Paystack checkouts here are naira only; other currencies are paid by bank transfer
    if (payment.currency?.toUpperCase() !== 'NGN') {
      throw new BadRequestError({ message: t('payment.errors.cardCheckoutCurrencyUnsupported') });
    }

    const reference = createPaystackReference();

    const checkout = await this.paymentGatewayService.initializeCardCheckout({
      email: input.customerEmail,
      amount: payment.baseAmount,
      currency: 'NGN',
      reference,
      callback_url: input.successUrl,
      metadata: {
        pytuid: payment.pytuid,
        cuid: payment.cuid,
        uid: input.tenantUid,
        type: 'card_payment',
        cancel_action: input.cancelUrl, // where Paystack sends the tenant if they cancel
      },
      ...this.splitFor(payment, processor, input.applicationFee),
    });

    // The open checkout's reference; an older one can still be paid, which settlement refunds
    await this.paymentDAO.updateById(payment._id.toString(), {
      $set: { cardCheckoutSessionId: reference },
    });

    this.log.info(
      { pytuid: payment.pytuid, cuid: payment.cuid, reference },
      'Card checkout started'
    );
    return { checkoutUrl: checkout.authorization_url };
  }

  /** Records a Paystack transaction against its charge. Safe to call more than once. */
  async settleTransaction(reference: string): Promise<PaystackSettleOutcome> {
    const transaction = await this.paymentGatewayService.verifyPaystackTransaction(reference);
    if (transaction.status !== 'success') {
      return 'not_successful';
    }

    const metadata = this.readMetadata(transaction);
    const payment = metadata.pytuid
      ? await this.paymentDAO.findFirst({
          pytuid: metadata.pytuid,
          cuid: metadata.cuid,
          deletedAt: null,
        })
      : null;
    if (!payment) {
      this.log.error({ reference, metadata }, 'Paid card transaction has no matching charge');
      if (metadata.cuid) this.alertNeedsReview(metadata.cuid, transaction);
      return 'not_found';
    }

    if (payment.gatewayPaymentId === reference) {
      // Finishes the maintenance invoice if an earlier attempt failed after recording the payment
      await this.paymentWebhookService.markMaintenanceChargePaid(payment, String(transaction.id));
      return 'already_paid';
    }

    const processor = await this.paymentProcessorDAO.findFirst({
      cuid: payment.cuid,
      ownerType: 'client',
      deletedAt: null,
    });
    const mismatch = this.findMismatch(payment, transaction, processor);
    if (mismatch) {
      return this.flagForReview(payment, transaction, mismatch);
    }

    const fees = await this.calculateFees(payment, transaction);
    const paidAt = transaction.paid_at ? dayjs(transaction.paid_at).toDate() : dayjs().toDate();

    // Only a still-payable charge can be marked paid, so a webhook and the return page racing
    // each other record it once
    const updated = await this.paymentDAO.update(
      { _id: payment._id, cuid: payment.cuid, status: { $in: PAYABLE_STATUSES } },
      {
        $set: {
          status: PaymentRecordStatus.PAID,
          paidAt,
          paymentMethod: PaymentMethod.ONLINE,
          gatewayPaymentId: reference,
          gatewayChargeId: String(transaction.id),
          processingFee: fees.processingFee,
          applicationFee: fees.applicationFee,
          platformRevenue: fees.platformRevenue,
        },
        $unset: { cardCheckoutSessionId: '' },
      }
    );

    if (!updated) {
      const current = await this.paymentDAO.findFirst({ _id: payment._id });
      if (current?.gatewayPaymentId === reference) {
        return 'already_paid';
      }
      return this.refundDuplicate(payment, transaction);
    }

    this.log.info(
      { reference, pytuid: payment.pytuid, cuid: payment.cuid },
      'Card payment recorded'
    );

    if (processor?.accountId) {
      await this.saveCard(transaction, processor.accountId, payment);
    }

    this.emitterService.emit(EventTypes.PAYMENT_SUCCEEDED, {
      cuid: payment.cuid,
      pytuid: payment.pytuid,
      invoiceId: reference,
      amount: payment.baseAmount,
      currency: payment.currency,
      paidAt,
      // The tenant's profile id; the metadata uid is a short id the notification lookup can't use
      tenantId: payment.tenant.toString(),
      paymentType: payment.paymentType,
    });

    // A failure here is thrown so the webhook is retried; the retry's already_paid path finishes it
    await this.paymentWebhookService.markMaintenanceChargePaid(payment, String(transaction.id));
    return 'paid';
  }

  /**
   * The tenant's return page: confirms the checkout they just finished, so the charge shows as
   * paid even if the webhook is late. Only checks the charge's own open checkout reference.
   */
  async confirmCheckout(
    payment: IPaymentDocument,
    reference: string
  ): Promise<{ outcome: PaystackSettleOutcome; status: PaymentRecordStatus }> {
    const isThisChargesCheckout =
      reference === payment.cardCheckoutSessionId || reference === payment.gatewayPaymentId;
    if (!isThisChargesCheckout) {
      throw new BadRequestError({ message: t('payment.errors.checkoutNotFound') });
    }

    let outcome: PaystackSettleOutcome;
    try {
      outcome = await this.settleTransaction(reference);
    } catch (error) {
      // The tenant has paid: if the payment is recorded, a failed follow-up step (finished by the
      // webhook's retry) must not show them an error
      const recorded = await this.paymentDAO.findFirst({ _id: payment._id });
      if (recorded?.gatewayPaymentId !== reference) throw error;
      this.log.error(
        { error, reference, pytuid: payment.pytuid },
        'Card payment recorded, but a follow-up step failed — the webhook retry finishes it'
      );
      outcome = 'paid';
    }
    const current = await this.paymentDAO.findFirst({ _id: payment._id });
    return { outcome, status: (current?.status ?? payment.status) as PaymentRecordStatus };
  }

  /**
   * Charges the tenant's saved card for a charge that's due (the auto-charge cron, or the tenant's
   * "pay now"). Never throws for a declined card or an outage — the caller decides how to record
   * those. A charge whose result is unknown is left PROCESSING, so it's never charged twice.
   */
  async chargeSavedCard(payment: IPaymentDocument): Promise<PaystackAutoChargeOutcome> {
    const processor = await this.paymentProcessorDAO.findFirst({
      cuid: payment.cuid,
      ownerType: 'client',
      deletedAt: null,
    });
    if (!processor?.accountId || payment.currency?.toUpperCase() !== 'NGN') {
      return 'no_saved_card';
    }

    // Saved cards are hidden by default: the authorization code can charge the card
    const profile = await this.profileDAO.findFirst({ _id: payment.tenant }, {
      select: '+tenantInfo.paystackCards',
    } as any);
    const card = readPaystackSavedCard(profile?.tenantInfo?.paystackCards, processor.accountId);
    if (!card) return 'no_saved_card';

    // A new reference per attempt; it is the open checkout until the charge settles
    const reference = createPaystackReference();
    const claimed = await this.paymentDAO.update(
      { _id: payment._id, status: { $in: CHARGEABLE_STATUSES }, deletedAt: null },
      { $set: { cardCheckoutSessionId: reference, chargedAt: dayjs().toDate() } }
    );
    if (!claimed) return 'no_saved_card'; // paid or closed meanwhile

    const applicationFee = await this.platformFeeFor(payment);
    let transaction: IPaystackTransaction;
    try {
      transaction = await this.paymentGatewayService.chargeSavedCard({
        authorization_code: card.authorizationCode,
        email: card.email,
        amount: payment.baseAmount,
        currency: 'NGN',
        reference,
        // charge_authorization takes metadata as a JSON string
        metadata: JSON.stringify({
          pytuid: payment.pytuid,
          cuid: payment.cuid,
          type: 'auto_charge',
        }),
        ...this.splitFor(payment, processor, applicationFee),
      });
    } catch (error) {
      return this.handleChargeRequestError(payment, reference, error);
    }

    if (transaction.status === 'success') {
      return this.recordSavedCardCharge(payment, reference);
    }

    if (transaction.status === 'failed' || transaction.status === 'abandoned') {
      this.log.warn(
        { pytuid: payment.pytuid, reference, gatewayResponse: transaction.gateway_response },
        'Saved card was declined'
      );
      await this.releaseChargeClaim(payment);
      return 'declined';
    }

    // pending, ongoing, queued…: settled later by the charge.success webhook or reconcile
    await this.markProcessing(payment);
    return 'processing';
  }

  /**
   * The charge request failed. An open circuit or a refused API key means the card was never
   * charged, so the charge is reopened to try again later. Any other outage (a timeout, a server
   * error) may still have charged the card, so it's left PROCESSING for the reconcile to check.
   * A rejected request was never charged either; its error is passed on as a failed attempt.
   */
  private async handleChargeRequestError(
    payment: IPaymentDocument,
    reference: string,
    error: unknown
  ): Promise<PaystackAutoChargeOutcome> {
    const neverSent =
      error instanceof InternalServerError ||
      (error instanceof ServiceUnavailableError &&
        error.originalError instanceof CircuitBreakerOpenError);

    if (neverSent) {
      this.log.warn(
        { pytuid: payment.pytuid, reference },
        'Card charge not sent — Paystack unavailable'
      );
      await this.releaseChargeClaim(payment);
      return 'unavailable';
    }

    if (error instanceof ServiceUnavailableError) {
      this.log.warn(
        { error, pytuid: payment.pytuid, reference },
        'Card charge result unknown — left for the reconcile to check'
      );
      await this.markProcessing(payment);
      return 'processing';
    }

    await this.releaseChargeClaim(payment);
    throw error;
  }

  /**
   * Records a saved-card charge Paystack accepted. The card has been charged, so anything short of
   * "recorded" keeps the charge PROCESSING — out of the auto-charge — until it's settled.
   */
  private async recordSavedCardCharge(
    payment: IPaymentDocument,
    reference: string
  ): Promise<PaystackAutoChargeOutcome> {
    let outcome: PaystackSettleOutcome;
    try {
      outcome = await this.settleTransaction(reference);
    } catch (error) {
      const recorded = await this.paymentDAO.findFirst({ _id: payment._id });
      if (recorded?.gatewayPaymentId === reference) {
        this.log.error(
          { error, pytuid: payment.pytuid, reference },
          'Card payment recorded, but a follow-up step failed — the webhook retry finishes it'
        );
        return 'paid';
      }
      // The charge.success webhook (or the reconcile) records it once the problem clears
      this.log.error(
        { error, pytuid: payment.pytuid, reference },
        'Card was charged but recording it failed — left for the webhook to settle'
      );
      await this.markProcessing(payment);
      return 'processing';
    }

    // refunded_duplicate: the charge was already settled another way and this money went back
    if (outcome === 'paid' || outcome === 'already_paid' || outcome === 'refunded_duplicate') {
      return 'paid';
    }
    await this.markProcessing(payment);
    return outcome === 'not_successful' ? 'processing' : 'needs_review';
  }

  private async markProcessing(payment: IPaymentDocument): Promise<void> {
    await this.paymentDAO.update(
      { _id: payment._id, status: { $in: CHARGEABLE_STATUSES } },
      { $set: { status: PaymentRecordStatus.PROCESSING } }
    );
  }

  private async releaseChargeClaim(payment: IPaymentDocument): Promise<void> {
    await this.paymentDAO.update({ _id: payment._id }, { $unset: { cardCheckoutSessionId: '' } });
  }

  /**
   * Resolves an automatic card charge still PROCESSING (the reconcile cron): records it if Paystack
   * says it succeeded, or reopens the charge as OVERDUE when it failed or has hung too long.
   */
  async reconcileProcessingCharge(
    payment: IPaymentDocument
  ): Promise<'paid' | 'reopened' | 'waiting' | 'needs_review'> {
    const reference = payment.cardCheckoutSessionId;
    if (!reference) return 'waiting';

    let transaction: IPaystackTransaction | null;
    try {
      transaction = await this.paymentGatewayService.verifyPaystackTransaction(reference);
    } catch (error) {
      // Paystack rejects a reference it has never seen: the charge request never reached it.
      // Outages are passed on, and the next run checks again.
      if (!(error instanceof BadRequestError)) throw error;
      transaction = null;
    }

    if (transaction?.status === 'success') {
      const outcome = await this.settleTransaction(reference);
      return outcome === 'needs_review' || outcome === 'not_found' ? 'needs_review' : 'paid';
    }

    if (!transaction) {
      // Not the tenant's fault, so it doesn't count as a failed attempt
      await this.reopenCardCharge(payment, t('payment.errors.serviceUnavailable'), false);
      return 'reopened';
    }

    const hasFailed = ['abandoned', 'reversed', 'failed'].includes(transaction.status);
    const isStale =
      dayjs().diff(dayjs(payment.chargedAt ?? payment.dueDate), 'hour') >= STALE_CARD_CHARGE_HOURS;
    if (!hasFailed && !isStale) return 'waiting';

    await this.reopenCardCharge(payment, t('payment.errors.cardDeclined'), true);
    return 'reopened';
  }

  private async reopenCardCharge(
    payment: IPaymentDocument,
    reason: string,
    countsAsAttempt: boolean
  ): Promise<void> {
    await this.paymentDAO.update(
      { _id: payment._id, status: PaymentRecordStatus.PROCESSING },
      {
        $set: {
          status: PaymentRecordStatus.OVERDUE,
          'failure.reason': reason,
          'failure.lastFailedAt': dayjs().toDate(),
        },
        ...(countsAsAttempt && { $inc: { 'failure.retryCount': 1 } }),
        $unset: { cardCheckoutSessionId: '' },
      }
    );
    this.log.warn(
      { pytuid: payment.pytuid, reference: payment.cardCheckoutSessionId, reason },
      'Card charge reopened'
    );
  }

  /** Handles a webhook event whose signature has already been checked. */
  async handleWebhookEvent(event: IPaystackWebhookEvent): Promise<void> {
    const data = event.data as Record<string, any>;

    switch (event.event) {
      case 'charge.success': {
        const reference = typeof data?.reference === 'string' ? data.reference : '';
        // Transactions this app didn't start (e.g. made in the Paystack dashboard) are ignored
        if (!reference.startsWith(PAYSTACK_REFERENCE_PREFIX)) return;
        const outcome = await this.settleTransaction(reference);
        this.log.info({ reference, outcome }, 'Card payment webhook handled');
        return;
      }

      case 'refund.failed': {
        const reference = data?.transaction_reference ?? data?.transaction?.reference;
        if (typeof reference !== 'string') return;
        const payment = await this.paymentDAO.update(
          { gatewayPaymentId: reference },
          {
            $set: {
              'refund.failureReason': t('payment.errors.refundFailed'),
              'refund.failedAt': dayjs().toDate(),
            },
          }
        );
        this.log.error({ reference }, 'Card refund failed — needs follow-up');
        if (payment) this.notifyRefundFailed(payment, data?.amount);
        return;
      }

      default:
        this.log.info({ event: event.event }, 'Unhandled card payment webhook event');
    }
  }

  /**
   * Money arrived that doesn't match its charge. It's left unrecorded, and the charge is marked
   * so managers are alerted once — not again each time the reconcile re-checks it.
   */
  private async flagForReview(
    payment: IPaymentDocument,
    transaction: IPaystackTransaction,
    mismatch: string
  ): Promise<PaystackSettleOutcome> {
    this.log.error(
      { reference: transaction.reference, pytuid: payment.pytuid, cuid: payment.cuid, mismatch },
      'Card transaction does not match its charge — left for review'
    );
    const reviewReason = t('payment.errors.needsReview');
    const firstTime = await this.paymentDAO.update(
      { _id: payment._id, 'failure.reason': { $ne: reviewReason } },
      { $set: { 'failure.reason': reviewReason, 'failure.lastFailedAt': dayjs().toDate() } }
    );
    if (firstTime) this.alertNeedsReview(payment.cuid, transaction, payment.pytuid);
    return 'needs_review';
  }

  private alertNeedsReview(cuid: string, transaction: IPaystackTransaction, pytuid?: string): void {
    this.emitterService.emit(EventTypes.PAYMENT_NEEDS_REVIEW, {
      cuid,
      pytuid,
      reference: transaction.reference,
      amount: transaction.amount,
      currency: transaction.currency,
    });
  }

  /** Tells managers the tenant's money did not go back (deposits use the deposit alert + email). */
  private notifyRefundFailed(payment: IPaymentDocument, refundAmount?: number): void {
    const amount = typeof refundAmount === 'number' ? refundAmount : payment.baseAmount;
    if (payment.paymentType === PaymentRecordType.SECURITY_DEPOSIT && payment.lease) {
      this.emitterService.emit(EventTypes.DEPOSIT_REFUND_FAILED, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        leaseId: payment.lease.toString(),
        amount,
        currency: payment.currency,
        reason: t('payment.errors.refundFailed'),
      });
      return;
    }
    this.emitterService.emit(EventTypes.PAYMENT_REFUND_FAILED, {
      cuid: payment.cuid,
      pytuid: payment.pytuid,
      amount,
      currency: payment.currency,
    });
  }

  /**
   * Where the money goes. Rent and late fees settle to the landlord's subaccount, with the
   * platform fee as transaction_charge; deposits too, without a fee. Maintenance stays in the
   * platform balance until the vendor is paid.
   */
  private splitFor(
    payment: IPaymentDocument,
    processor: IPaymentProcessorDocument,
    applicationFee: number
  ) {
    if (payment.paymentType === PaymentRecordType.MAINTENANCE) return {};
    const takesPlatformFee = payment.paymentType !== PaymentRecordType.SECURITY_DEPOSIT;
    return {
      subaccount: processor.accountId,
      bearer: 'account' as const,
      ...(takesPlatformFee && applicationFee > 0 && { transaction_charge: applicationFee }),
    };
  }

  /** The plan's platform fee for rent and late fees; other charges keep their stored fee. */
  private async platformFeeFor(payment: IPaymentDocument): Promise<number> {
    const usesPlanRate =
      payment.paymentType === PaymentRecordType.RENT ||
      payment.paymentType === PaymentRecordType.LATE_FEE;
    if (!usesPlanRate) return payment.applicationFee ?? 0;

    const subscription = await this.subscriptionDAO.findFirst({ cuid: payment.cuid });
    if (!subscription?.planName) return payment.applicationFee ?? 0;
    return FinancialCalculator.percentOf(
      payment.baseAmount,
      this.subscriptionPlanConfig.getTransactionFeePercent(subscription.planName)
    );
  }

  private readMetadata(transaction: IPaystackTransaction): {
    pytuid?: string;
    cuid?: string;
    uid?: string;
  } {
    let metadata: unknown = transaction.metadata;
    if (typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch {
        metadata = null;
      }
    }
    const fields = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<
      string,
      unknown
    >;
    const read = (key: string) =>
      typeof fields[key] === 'string' ? (fields[key] as string) : undefined;
    return { pytuid: read('pytuid'), cuid: read('cuid'), uid: read('uid') };
  }

  /** Why the transaction can't be recorded against this charge, or null when it matches. */
  private findMismatch(
    payment: IPaymentDocument,
    transaction: IPaystackTransaction,
    processor: IPaymentProcessorDocument | null
  ): string | null {
    if (transaction.currency?.toUpperCase() !== payment.currency?.toUpperCase()) return 'currency';
    if (transaction.amount !== payment.baseAmount) return 'amount';

    const isMaintenance = payment.paymentType === PaymentRecordType.MAINTENANCE;
    const settledTo = transaction.subaccount?.subaccount_code;
    if (!isMaintenance && settledTo !== processor?.accountId) return 'destination';
    return null;
  }

  /**
   * Paystack's actual fee when it reports one, otherwise the estimate. The platform fee is the
   * plan's rate for rent and late fees (what was sent as transaction_charge); other charges keep
   * their stored fee.
   */
  private async calculateFees(
    payment: IPaymentDocument,
    transaction: IPaystackTransaction
  ): Promise<{ processingFee: number; applicationFee: number; platformRevenue: number }> {
    const processingFee =
      transaction.fees ??
      this.subscriptionPlanConfig.calculatePaymentGatewayFee(payment.baseAmount, 'paystack');

    const applicationFee = await this.platformFeeFor(payment);

    // The model doesn't allow negative revenue; a loss on a tiny payment is recorded as zero
    const platformRevenue = Math.max(0, applicationFee - processingFee);
    return { processingFee, applicationFee, platformRevenue };
  }

  /** The charge was already settled (or closed) another way, so this money goes straight back. */
  private async refundDuplicate(
    payment: IPaymentDocument,
    transaction: IPaystackTransaction
  ): Promise<PaystackSettleOutcome> {
    const refund = await this.paymentGatewayService.createRefund(
      this.paymentGatewayService.providerForPayment({ gatewayPaymentId: transaction.reference }),
      {
        chargeId: String(transaction.id),
        amountInCents: transaction.amount,
        note: 'Duplicate payment for a charge that was already settled',
      }
    );
    // An outage is thrown instead, so the webhook is retried and the refund tried again
    if (!refund.success) {
      this.log.error(
        { reference: transaction.reference, pytuid: payment.pytuid, message: refund.message },
        'Duplicate card payment could not be refunded — refund it manually'
      );
      this.notifyRefundFailed(payment, transaction.amount);
      return 'needs_review';
    }

    this.log.warn(
      { reference: transaction.reference, pytuid: payment.pytuid, status: payment.status },
      'Duplicate card payment refunded'
    );
    this.emitterService.emit(EventTypes.PAYMENT_REFUNDED, {
      cuid: payment.cuid,
      pytuid: payment.pytuid,
      chargeId: String(transaction.id),
      tenantId: payment.tenant.toString(),
      amount: transaction.amount,
      refundAmount: transaction.amount,
      totalRefunded: transaction.amount,
      currency: transaction.currency,
      isPartial: false,
      reason: 'duplicate_payment',
    });
    return 'refunded_duplicate';
  }

  /** Keeps a reusable card for later automatic charges. Best effort: the payment already counts. */
  private async saveCard(
    transaction: IPaystackTransaction,
    subaccountCode: string,
    payment: IPaymentDocument
  ): Promise<void> {
    const authorization = transaction.authorization;
    const email = transaction.customer?.email;
    if (!authorization?.reusable || authorization.channel !== 'card' || !email) {
      return;
    }

    try {
      // MongoDB cannot $set nested paths through a null parent (tenantInfo starts as null)
      await this.profileDAO.update(
        { _id: payment.tenant, tenantInfo: null },
        { $set: { tenantInfo: {} } }
      );
      await this.profileDAO.update(
        { _id: payment.tenant },
        {
          $set: {
            [`tenantInfo.paystackCards.${subaccountCode}`]: {
              authorizationCode: authorization.authorization_code,
              email,
              brand: authorization.card_type?.trim(),
              last4: authorization.last4,
              expMonth: authorization.exp_month,
              expYear: authorization.exp_year,
              savedAt: dayjs().toDate(),
            },
          },
        }
      );
    } catch (error) {
      this.log.warn({ error, reference: transaction.reference }, 'Could not save the card');
    }
  }
}
