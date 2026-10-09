import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { InvoiceDAO } from '@dao/invoiceDAO';
import { UserCache } from '@caching/user.cache';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { SMSService } from '@services/smsService/sms.service';
import { IPromiseReturnedData } from '@interfaces/utils.interface';
import { StripeService } from '@services/external/stripe/stripe.service';
import { MAX_CHARGE_ATTEMPTS, createLogger, MoneyUtils } from '@utils/index';
import { TenantPaymentStatus, InvoiceStatus } from '@interfaces/invoice.interface';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
import { PaymentProcessorDAO, SubscriptionDAO, PaymentDAO, ProfileDAO } from '@dao/index';
import { SubscriptionPlanConfig } from '@services/subscription/subscription_plans.config';
import {
  IPaymentGatewayProvider,
  PaymentRecordStatus,
  PaymentRecordType,
  IPaymentDocument,
  SMSMessageType,
  PaymentMethod,
} from '@interfaces/index';

/**
 * Fields read from the Stripe Invoice object in webhook payloads. Charge and
 * PaymentIntent ids are not read from the payload (they moved in basil+);
 * use `paymentGatewayService.getInvoicePaymentDetails()` instead.
 */
export interface IStripeInvoiceWebhookData {
  metadata?: Record<string, string>;
  default_payment_method?: string;
  next_payment_attempt?: number;
  hosted_invoice_url?: string;
  attempt_count?: number;
  subscription?: string;
  period_start?: number;
  amount_due?: number;
  currency?: string;
  customer?: string;
  status?: string;
  id?: string;
}

/**
 * Charge webhook payload. `invoice` exists on acacia endpoint versions only —
 * basil+ payloads omit it, so the invoice is resolved via `payment_intent`.
 */
interface IStripeChargeWebhookData {
  refunds?: {
    data?: Array<{ id: string; amount?: number; reason?: string | null }>;
  };
  payment_method_details?: { type?: string; card?: { last4?: string | null } } | null;
  previous_attributes?: { amount_refunded?: number };
  payment_intent?: string | { id?: string } | null;
  invoice?: string | { id?: string } | null;
  amount_refunded?: number;
  refunded?: boolean;
  currency?: string;
  amount?: number;
}

interface IConstructor {
  subscriptionPlanConfig: SubscriptionPlanConfig;
  paymentGatewayService: PaymentGatewayService;
  paymentProcessorDAO: PaymentProcessorDAO;
  emitterService: EventEmitterService;
  subscriptionDAO: SubscriptionDAO;
  stripeService: StripeService;
  smsService: SMSService;
  invoiceDAO: InvoiceDAO;
  profileDAO: ProfileDAO;
  paymentDAO: PaymentDAO;
  userCache: UserCache;
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

interface IStripeDisputeWebhookData {
  evidence_details?: { due_by?: number };
  charge?: string | { id: string };
  currency: string;
  reason?: string;
  status?: string;
  amount: number;
}

const SETTLED_PAYMENT_STATUSES = new Set<PaymentRecordStatus>([
  PaymentRecordStatus.PENDING_REFUND,
  PaymentRecordStatus.CANCELLED,
  PaymentRecordStatus.REFUNDED,
  PaymentRecordStatus.PAID,
]);

const STRIPE_DISPUTE_STATUS_MAP: Record<string, 'needs_response' | 'under_review'> = {
  warning_needs_response: 'needs_response',
  warning_under_review: 'under_review',
  needs_response: 'needs_response',
  under_review: 'under_review',
};

interface ICardRetryResult {
  cardLast4?: string;
  retried: boolean;
  amount: number;
}

export class PaymentWebhookService {
  private readonly log: Logger;
  private readonly paymentGatewayService: PaymentGatewayService;
  private readonly paymentProcessorDAO: PaymentProcessorDAO;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly emitterService: EventEmitterService;
  private readonly stripeService: StripeService;
  private readonly invoiceDAO: InvoiceDAO;
  private readonly smsService: SMSService;
  private readonly userCache: UserCache;
  private readonly profileDAO: ProfileDAO;
  private readonly subscriptionPlanConfig: SubscriptionPlanConfig;
  private readonly paymentDAO: PaymentDAO;

  constructor({
    paymentGatewayService,
    paymentProcessorDAO,
    subscriptionPlanConfig,
    subscriptionDAO,
    emitterService,
    stripeService,
    smsService,
    userCache,
    invoiceDAO,
    profileDAO,
    paymentDAO,
  }: IConstructor) {
    this.log = createLogger('PaymentWebhookService');
    this.paymentGatewayService = paymentGatewayService;
    this.paymentProcessorDAO = paymentProcessorDAO;
    this.subscriptionPlanConfig = subscriptionPlanConfig;
    this.subscriptionDAO = subscriptionDAO;
    this.emitterService = emitterService;
    this.stripeService = stripeService;
    this.smsService = smsService;
    this.userCache = userCache;
    this.invoiceDAO = invoiceDAO;
    this.profileDAO = profileDAO;
    this.paymentDAO = paymentDAO;
  }

  async handleInvoicePaymentSucceeded(
    invoiceId: string,
    invoiceData: IStripeInvoiceWebhookData
  ): IPromiseReturnedData<void> {
    try {
      const payment = await this.paymentDAO.findFirst({
        $or: [{ gatewayPaymentId: invoiceId }, { 'splitInvoices.invoiceId': invoiceId }],
        deletedAt: null,
      });

      if (!payment) {
        this.log.warn('Payment not found for invoice', { invoiceId });
        return { success: false, data: undefined, message: 'Payment record not found' };
      }

      if (payment.status === PaymentRecordStatus.PAID) {
        this.log.info('Payment already marked as paid', { invoiceId, pytuid: payment.pytuid });
        return { success: true, data: undefined, message: 'Payment already paid' };
      }

      if (SETTLED_PAYMENT_STATUSES.has(payment.status)) {
        this.log.error('Invoice paid for a payment that is no longer collectable — not updating', {
          invoiceId,
          pytuid: payment.pytuid,
          status: payment.status,
        });
        return {
          success: true,
          data: undefined,
          message: `Payment is ${payment.status} — status not changed`,
        };
      }

      const paymentDetails = await this.fetchInvoicePaymentDetails(invoiceId);
      const chargeId = paymentDetails.chargeId;
      if (!chargeId) {
        this.log.warn('No charge ID found for invoice', { invoiceId });
      }

      const hostedInvoiceUrl = invoiceData.hosted_invoice_url || null;

      // Handle split invoice payments
      if (payment.splitInvoices?.length) {
        const splitIndex = payment.splitInvoices.findIndex((si) => si.invoiceId === invoiceId);
        if (splitIndex >= 0) {
          await this.paymentDAO.update(
            { _id: payment._id, cuid: payment.cuid },
            {
              $set: {
                [`splitInvoices.${splitIndex}.status`]: 'paid',
                [`splitInvoices.${splitIndex}.chargeId`]: chargeId,
                [`splitInvoices.${splitIndex}.paidAt`]: dayjs().toDate(),
              },
            }
          );

          // Re-fetch to check if all splits are paid
          const refreshed = await this.paymentDAO.findFirst({ _id: payment._id });
          const allPaid = refreshed?.splitInvoices?.every((si) => si.status === 'paid');

          if (allPaid) {
            await this.paymentDAO.update(
              { _id: payment._id, cuid: payment.cuid },
              {
                $set: {
                  status: PaymentRecordStatus.PAID,
                  paidAt: dayjs().toDate(),
                  gatewayChargeId: chargeId,
                  ...(paymentDetails.paymentMethodType && {
                    stripePaymentMethodType: paymentDetails.paymentMethodType,
                  }),
                  ...(payment.paymentMethod === PaymentMethod.OTHER && {
                    paymentMethod: PaymentMethod.ONLINE,
                  }),
                  ...(hostedInvoiceUrl && { 'receipt.url': hostedInvoiceUrl }),
                },
              }
            );
            this.log.info('All split invoices paid — payment marked as PAID', {
              pytuid: payment.pytuid,
              invoiceId,
            });
          } else {
            // Ensure parent is PROCESSING while partial
            if (payment.status !== PaymentRecordStatus.PROCESSING) {
              await this.paymentDAO.update(
                { _id: payment._id },
                { $set: { status: PaymentRecordStatus.PROCESSING } }
              );
            }
            this.log.info('Split invoice paid (partial)', {
              pytuid: payment.pytuid,
              invoiceId,
              paidCount: refreshed?.splitInvoices?.filter((si) => si.status === 'paid').length,
              totalCount: refreshed?.splitInvoices?.length,
            });
            return {
              success: true,
              data: undefined,
              message: 'Split invoice partial payment recorded',
            };
          }
        }
      } else {
        // Non-split: direct update
        await this.paymentDAO.update(
          { _id: payment._id, cuid: payment.cuid },
          {
            $set: {
              status: PaymentRecordStatus.PAID,
              paidAt: dayjs().toDate(),
              gatewayChargeId: chargeId,
              ...(paymentDetails.paymentMethodType && {
                stripePaymentMethodType: paymentDetails.paymentMethodType,
              }),
              ...(payment.paymentMethod === PaymentMethod.OTHER && {
                paymentMethod: PaymentMethod.ONLINE,
              }),
              ...(hostedInvoiceUrl && { 'receipt.url': hostedInvoiceUrl }),
            },
          }
        );
      }

      this.log.info('Payment marked as paid', { pytuid: payment.pytuid, invoiceId, chargeId });

      // Reconcile fee fields based on actual payment method used.
      // The original fees may have been estimated for ACSS but the payment
      // could have been collected via card (retry or tenant checkout).
      await this.reconcilePaymentFees(payment, paymentDetails.paymentMethodType);

      const tenantUserId = await this.resolveTenantUserId(payment);

      this.emitterService.emit(EventTypes.PAYMENT_SUCCEEDED, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        invoiceId,
        amount: payment.baseAmount,
        currency: payment.currency,
        paidAt: dayjs().toDate(),
        tenantId: tenantUserId,
        receiptUrl: hostedInvoiceUrl ?? undefined,
        paymentType: payment.paymentType,
      });

      // SMS notification to tenant
      if (tenantUserId) {
        this.smsService
          .sendToUser(
            payment.cuid,
            tenantUserId,
            `Payment of ${MoneyUtils.formatCurrency(payment.baseAmount, payment.currency || 'USD')} received successfully.`,
            SMSMessageType.SYSTEM
          )
          .catch((err: any) => {
            this.log.warn({ err }, 'SMS send failed (fire-and-forget)');
          });
      }

      await this.markMaintenanceChargePaid(
        payment,
        chargeId ?? undefined,
        hostedInvoiceUrl ?? undefined
      );

      return { success: true, data: undefined, message: 'Payment updated successfully' };
    } catch (error: any) {
      this.log.error('Error handling invoice payment succeeded', { invoiceId, error });
      throw error;
    }
  }

  async handleInvoicePaymentFailed(
    invoiceId: string,
    invoiceData: IStripeInvoiceWebhookData
  ): IPromiseReturnedData<void> {
    try {
      const payment = await this.paymentDAO.findFirst({
        $or: [{ gatewayPaymentId: invoiceId }, { 'splitInvoices.invoiceId': invoiceId }],
        deletedAt: null,
      });

      if (!payment) {
        this.log.warn('Payment not found for failed invoice', { invoiceId });
        return { success: false, data: undefined, message: 'Payment record not found' };
      }

      const ignoreReason = this.getFailedInvoiceIgnoreReason(payment, invoiceId);
      if (ignoreReason) {
        this.log.warn('Ignoring invoice.payment_failed', {
          invoiceId,
          pytuid: payment.pytuid,
          status: payment.status,
          ignoreReason,
        });
        return { success: true, data: undefined, message: ignoreReason };
      }

      // Mark the specific split invoice as failed if this is a split payment
      if (payment.splitInvoices?.length) {
        const splitIndex = payment.splitInvoices.findIndex((si) => si.invoiceId === invoiceId);
        if (splitIndex >= 0) {
          await this.paymentDAO.update(
            { _id: payment._id },
            { $set: { [`splitInvoices.${splitIndex}.status`]: 'failed' } }
          );
        }
      }

      // ── Detect bank-debit (ACSS) failure and attempt card retry ────────────────
      // The invoice's default_payment_method type is the most reliable signal —
      // Stripe often rejects ACSS before creating a PaymentIntent.
      const { paymentMethodType, stripeFailureMessage } = await this.getInvoiceFailureDetails(
        invoiceId,
        invoiceData
      );
      const isAcssFailure = paymentMethodType === 'acss_debit';
      const failureReason = isAcssFailure
        ? t('payment.errors.paymentMethodFailed')
        : (stripeFailureMessage ?? 'Payment failed');
      const currency = payment.currency ?? invoiceData.currency?.toUpperCase();
      const tenantUserId = await this.resolveTenantUserId(payment);
      const tenantId = tenantUserId ?? payment.tenant?.toString();

      if (isAcssFailure) {
        this.log.warn(
          { pytuid: payment.pytuid, invoiceId },
          '[PaymentWebhookService] ACSS/bank-debit failure detected — attempting card retry'
        );
        const cardRetry = await this.attemptCardRetry(payment, invoiceId);
        if (cardRetry.retried) {
          // Not a failure from the PM's perspective — tell the tenant their card was used.
          this.emitterService.emit(EventTypes.PAYMENT_RETRIED_WITH_CARD, {
            cuid: payment.cuid,
            pytuid: payment.pytuid,
            tenantId: tenantId ?? '',
            amount: cardRetry.amount,
            currency: currency ?? 'USD',
            cardLast4: cardRetry.cardLast4,
            failureReason,
          });
          return {
            success: true,
            data: undefined,
            message: t('payment.errors.paymentFailedRetried'),
          };
        }
        // Card retry not possible or failed — mark failed with a clear reason for the PM
        const noFallbackReason = t('payment.errors.paymentMethodFailedCardRequired');
        await this.paymentDAO.update(
          { _id: payment._id, cuid: payment.cuid },
          {
            $set: {
              status: PaymentRecordStatus.FAILED,
              'failure.lastFailedAt': dayjs().toDate(),
              'failure.pmNotifiedAt': dayjs().toDate(),
              'failure.retryCount': (payment.failure?.retryCount ?? 0) + 1,
              'failure.reason': noFallbackReason,
            },
          }
        );
        this.emitterService.emit(EventTypes.PAYMENT_FAILED, {
          cuid: payment.cuid,
          pytuid: payment.pytuid,
          invoiceId,
          amount: payment.baseAmount,
          currency,
          tenantId,
          failureReason: noFallbackReason,
          hostedInvoiceUrl: invoiceData.hosted_invoice_url ?? payment.receipt?.url,
        });
        return {
          success: true,
          data: undefined,
          message: t('payment.errors.paymentFailedNoFallback'),
        };
      }

      // Invoices are created with auto_advance:false, so Stripe never retries them —
      // exhaustion is driven by our own retry counter (the auto-charge cron retries).
      const attemptCount = invoiceData.attempt_count || 0;
      const newRetryCount = (payment.failure?.retryCount ?? 0) + 1;
      const exhausted = newRetryCount >= MAX_CHARGE_ATTEMPTS;

      if (!exhausted) {
        await this.paymentDAO.update(
          { _id: payment._id, cuid: payment.cuid },
          {
            $set: {
              status: PaymentRecordStatus.OVERDUE,
              'failure.reason': failureReason,
              'failure.lastFailedAt': dayjs().toDate(),
              'failure.retryCount': newRetryCount,
              overdueAt: payment.overdueAt ?? dayjs().toDate(),
            },
          }
        );
        this.log.warn('Payment charge failed — will retry', {
          pytuid: payment.pytuid,
          invoiceId,
          attemptCount,
          newRetryCount,
        });
        return { success: true, data: undefined, message: 'Payment will be retried' };
      }

      await this.paymentDAO.update(
        { _id: payment._id, cuid: payment.cuid },
        {
          $set: {
            status: PaymentRecordStatus.FAILED,
            'failure.pmNotifiedAt': dayjs().toDate(),
            'failure.retryCount': newRetryCount,
            'failure.lastFailedAt': dayjs().toDate(),
            'failure.reason': failureReason,
          },
        }
      );

      this.log.warn('Payment marked as failed — retries exhausted', {
        pytuid: payment.pytuid,
        invoiceId,
        attemptCount,
        newRetryCount,
      });

      this.emitterService.emit(EventTypes.PAYMENT_FAILED, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        invoiceId,
        amount: payment.baseAmount,
        currency,
        tenantId,
        failureReason,
        hostedInvoiceUrl: invoiceData.hosted_invoice_url ?? payment.receipt?.url,
      });

      // SMS notification to tenant
      if (tenantId) {
        this.smsService
          .sendToUser(
            payment.cuid,
            tenantId,
            'Your payment could not be processed. Please check your payment method.',
            SMSMessageType.SYSTEM
          )
          .catch((err: any) => {
            this.log.warn({ err }, 'SMS send failed (fire-and-forget)');
          });
      }

      return { success: true, data: undefined, message: 'Payment marked as failed' };
    } catch (error: any) {
      this.log.error('Error handling invoice payment failed', { invoiceId, error });
      throw error;
    }
  }

  /**
   * Attempts to retry a failed ACSS payment using the tenant's card on file.
   * Voids the failed invoice, creates a new card invoice, and pays it.
   * Returns true if the retry succeeded, false if no card was available or the retry failed.
   */
  async retryPaymentWithCard(payment: IPaymentDocument, failedInvoiceId: string): Promise<boolean> {
    const { retried } = await this.attemptCardRetry(payment, failedInvoiceId);
    return retried;
  }

  private async attemptCardRetry(
    payment: IPaymentDocument,
    failedInvoiceId: string
  ): Promise<ICardRetryResult> {
    const { cuid } = payment;
    // For split payments, scope the retry to only the failed split's amount
    const failedSplit = payment.splitInvoices?.find((si) => si.invoiceId === failedInvoiceId);
    const retryAmount = failedSplit?.amount ?? payment.baseAmount;
    const notRetried: ICardRetryResult = { retried: false, amount: retryAmount };

    const markFailed = async (reason: string) => {
      await this.paymentDAO.update(
        { _id: payment._id, cuid },
        {
          $set: {
            status: PaymentRecordStatus.FAILED,
            'failure.reason': reason,
            'failure.lastFailedAt': dayjs().toDate(),
            'failure.pmNotifiedAt': dayjs().toDate(),
            'failure.retryCount': (payment.failure?.retryCount ?? 0) + 1,
          },
        }
      );
      this.log.warn(
        { pytuid: payment.pytuid, cuid, reason },
        '[PaymentWebhookService] Card retry failed'
      );
    };

    const [tenantProfile, processor] = await Promise.all([
      this.profileDAO.findFirst({ _id: new Types.ObjectId(payment.tenant?.toString()) }),
      this.paymentProcessorDAO.findFirst({ cuid }),
    ]);

    if (!tenantProfile || !processor?.accountId) {
      await markFailed(t('payment.errors.retryFailedMissingInfo'));
      return notRetried;
    }

    // Check for a saved card first, then fall back to the primary payment method
    const paymentMethodId =
      tenantProfile.tenantInfo?.cardPaymentMethods?.get(processor.accountId) ||
      tenantProfile.tenantInfo?.paymentMethods?.get(processor.accountId);
    if (!paymentMethodId) {
      await markFailed(t('payment.errors.paymentFailedAddPaymentMethod'));
      return notRetried;
    }

    // Confirm this stored method is not itself ACSS (no fallback if it is)
    const pmResult = await this.paymentGatewayService.retrievePaymentMethod(
      IPaymentGatewayProvider.STRIPE,
      paymentMethodId
    );
    if (!pmResult.success || pmResult.data?.type === 'acss_debit') {
      await markFailed(t('payment.errors.paymentFailedAddPaymentMethod'));
      return notRetried;
    }

    const tenantCustomerId = tenantProfile.tenantInfo?.paymentGatewayCustomers?.get('platform');
    if (!tenantCustomerId) {
      await markFailed(
        t('common.errors.operationFailedContact', { action: 'process payment retry' })
      );
      return notRetried;
    }

    // Void the failed ACSS invoice so Stripe stops retrying it
    const voidResult = await this.paymentGatewayService.voidInvoice(
      IPaymentGatewayProvider.STRIPE,
      failedInvoiceId
    );
    if (!voidResult.success) {
      this.log.warn(
        { pytuid: payment.pytuid, invoiceId: failedInvoiceId },
        '[PaymentWebhookService] Could not void failed ACSS invoice — proceeding with card retry anyway'
      );
    }

    // Recalculate application fee for card rates since the original fee was
    // computed for ACH/ACSS. Card processing costs are higher (2.9% + $0.30 vs
    // flat $0.80), so the platform needs a higher application fee to cover them.
    // For split retries, each split carries the fee computed from its own amount.
    let cardApplicationFee = failedSplit
      ? (failedSplit.applicationFee ?? 0)
      : (payment.applicationFee ?? 0);
    try {
      const subscription = await this.subscriptionDAO.findFirst({ cuid });
      if (subscription?.planName) {
        const cardTxFeePercent = this.subscriptionPlanConfig.getTransactionFeePercent(
          subscription.planName
        );
        const recalculated = Math.round(retryAmount * (cardTxFeePercent / 100));
        if (recalculated > cardApplicationFee) {
          cardApplicationFee = recalculated;
          this.log.info(
            {
              pytuid: payment.pytuid,
              cuid,
              originalFee: payment.applicationFee,
              cardFee: cardApplicationFee,
            },
            'Recalculated application fee for card retry'
          );
        }
      }
    } catch (feeError: any) {
      this.log.warn(
        { pytuid: payment.pytuid, cuid, error: feeError.message },
        'Failed to recalculate card application fee for retry — using original'
      );
    }

    // For split retries, filter lineItems to only the failed split's category
    let lineItems: { description: string; amountInCents: number }[];
    if (failedSplit && payment.lineItems?.length) {
      const allItems = payment.lineItems as { description: string; amountInCents: number }[];
      lineItems =
        failedSplit.category === 'rent'
          ? allItems.filter((li) => li.description.toLowerCase().includes('rent'))
          : allItems.filter((li) => !li.description.toLowerCase().includes('rent'));
    } else if (payment.lineItems?.length) {
      lineItems = payment.lineItems as { description: string; amountInCents: number }[];
    } else {
      lineItems = [
        { description: payment.description || 'Payment retry', amountInCents: retryAmount },
      ];
    }

    const invoiceResult = await this.paymentGatewayService.createInvoice(
      IPaymentGatewayProvider.STRIPE,
      {
        tenantCustomerId,
        connectedAccountId: processor.accountId,
        applicationFeeAmountInCents: cardApplicationFee,
        currency: (payment.currency ?? 'USD').toLowerCase(),
        description: payment.description || `Card retry for ${payment.pytuid}`,
        autoChargeDueDate: dayjs().toDate(),
        lineItems,
        cuid,
        paymentMethodId,
      }
    );
    if (!invoiceResult.success || !invoiceResult.data) {
      await markFailed(t('common.errors.operationFailed', { action: 'process payment retry' }));
      return notRetried;
    }

    const finalizeResult = await this.paymentGatewayService.finalizeInvoice(
      IPaymentGatewayProvider.STRIPE,
      invoiceResult.data.invoiceId
    );
    if (!finalizeResult.success) {
      await markFailed(t('common.errors.operationFailed', { action: 'process payment retry' }));
      return notRetried;
    }

    const payResult = await this.paymentGatewayService.payInvoice(
      IPaymentGatewayProvider.STRIPE,
      invoiceResult.data.invoiceId,
      { paymentMethod: paymentMethodId }
    );

    if (!payResult.success) {
      await markFailed(t('common.errors.operationFailed', { action: 'process payment' }));
      return notRetried;
    }

    const updateOps: any = {
      $set: {
        status: PaymentRecordStatus.PROCESSING,
        paymentMethod: PaymentMethod.ONLINE,
      },
      $unset: { failure: '' },
    };

    if (payment.splitInvoices?.length) {
      // For split retries, only update the failed split's invoiceId — don't overwrite parent gatewayPaymentId
      const splitIndex = payment.splitInvoices.findIndex((si) => si.invoiceId === failedInvoiceId);
      if (splitIndex >= 0) {
        updateOps.$set[`splitInvoices.${splitIndex}.invoiceId`] = invoiceResult.data.invoiceId;
        updateOps.$set[`splitInvoices.${splitIndex}.status`] = 'pending';
      }
    } else {
      updateOps.$set.gatewayPaymentId = invoiceResult.data.invoiceId;
    }

    await this.paymentDAO.update({ _id: payment._id, cuid: payment.cuid }, updateOps);

    this.log.info(
      { pytuid: payment.pytuid, cuid, newInvoiceId: invoiceResult.data.invoiceId },
      '[PaymentWebhookService] ACSS payment retried with card successfully'
    );

    return { retried: true, amount: retryAmount, cardLast4: pmResult.data?.last4 };
  }

  /**
   * Handles charge.pending events — fires when a bank debit (ACSS/ACH) is
   * initiated but not yet settled. Marks the payment PROCESSING. For Canadian
   * PAD (acss_debit) the tenant is told the debit is now processing; the Rule H1
   * pre-debit notice itself is sent in advance by the cron.
   */
  async handleChargePending(
    chargeId: string,
    chargeData: IStripeChargeWebhookData
  ): IPromiseReturnedData<void> {
    try {
      const paymentIntentId = this.extractStripeId(chargeData.payment_intent);
      const invoiceId = await this.resolveChargeInvoiceId(chargeData);
      const gatewayIds = [invoiceId, paymentIntentId].filter((id): id is string => !!id);
      if (!gatewayIds.length) {
        this.log.warn('charge.pending: no invoice or payment_intent on charge', { chargeId });
        return { success: false, data: undefined, message: 'No gateway reference' };
      }

      const payment = await this.paymentDAO.findFirst({
        $or: [
          { gatewayPaymentId: { $in: gatewayIds } },
          { 'splitInvoices.invoiceId': { $in: gatewayIds } },
        ],
        deletedAt: null,
      });

      if (!payment) {
        this.log.info('charge.pending: no matching payment record', { chargeId, gatewayIds });
        return { success: false, data: undefined, message: 'Payment record not found' };
      }

      if (SETTLED_PAYMENT_STATUSES.has(payment.status)) {
        this.log.info('charge.pending: payment already settled — not updating', {
          pytuid: payment.pytuid,
          status: payment.status,
          chargeId,
        });
        return { success: true, data: undefined, message: `Payment already ${payment.status}` };
      }

      const paymentMethodType = chargeData.payment_method_details?.type;
      const splitIndex =
        payment.splitInvoices?.findIndex((si) => gatewayIds.includes(si.invoiceId)) ?? -1;
      const chargeIdField =
        splitIndex >= 0 ? `splitInvoices.${splitIndex}.chargeId` : 'gatewayChargeId';

      await this.paymentDAO.update(
        { _id: payment._id, cuid: payment.cuid },
        {
          $set: {
            status: PaymentRecordStatus.PROCESSING,
            chargedAt: dayjs().toDate(),
            [chargeIdField]: chargeId,
            ...(paymentMethodType && { stripePaymentMethodType: paymentMethodType }),
          },
        }
      );

      this.log.info('Payment marked as PROCESSING via charge.pending', {
        pytuid: payment.pytuid,
        chargeId,
        paymentMethodType,
      });

      if (paymentMethodType === 'acss_debit') {
        const tenantUserId = await this.resolveTenantUserId(payment);
        this.emitterService.emit(EventTypes.PAD_DEBIT_INITIATED, {
          cuid: payment.cuid,
          pytuid: payment.pytuid,
          tenantId: tenantUserId ?? payment.tenant?.toString() ?? '',
          amount: chargeData.amount ?? payment.baseAmount,
          currency: payment.currency ?? chargeData.currency?.toUpperCase() ?? 'CAD',
        });
      }

      return { success: true, data: undefined, message: 'Payment marked as processing' };
    } catch (error: any) {
      this.log.error('Error handling charge.pending', { chargeId, error });
      throw error;
    }
  }

  /**
   * Handles charge.refunded. Stripe's `amount_refunded` is cumulative, so it is
   * stored as-is in refund.amount. The record only becomes REFUNDED once the
   * charge is fully refunded; partial refunds leave the status unchanged.
   */
  async handleChargeRefunded(
    chargeId: string,
    chargeData: IStripeChargeWebhookData
  ): IPromiseReturnedData<void> {
    try {
      const payment = await this.findPaymentForRefundedCharge(chargeId, chargeData);

      if (!payment) {
        this.log.warn('Payment not found for refunded charge', { chargeId });
        return { success: false, data: undefined, message: 'Payment record not found' };
      }

      const totalRefunded = chargeData.amount_refunded ?? 0;
      if (totalRefunded <= 0) {
        this.log.warn('charge.refunded without a refunded amount — ignoring', {
          chargeId,
          pytuid: payment.pytuid,
        });
        return { success: true, data: undefined, message: 'Nothing refunded' };
      }

      // API-initiated refunds record refund.amount (and notify) before Stripe confirms.
      if (payment.refund?.amount === totalRefunded) {
        this.log.info('Refund already recorded — skipping duplicate refund notification', {
          chargeId,
          pytuid: payment.pytuid,
          totalRefunded,
        });
        return { success: true, data: undefined, message: 'Refund already recorded' };
      }

      const latestRefund = chargeData.refunds?.data?.[0];
      const thisRefundAmount = this.getLatestRefundAmount(payment, chargeData, totalRefunded);
      const amountCharged = chargeData.amount ?? payment.baseAmount;
      const isFullyRefunded = chargeData.refunded ?? totalRefunded >= amountCharged;
      const refundReason = latestRefund?.reason ?? payment.refund?.reason ?? undefined;
      const currency = payment.currency ?? chargeData.currency?.toUpperCase();

      await this.paymentDAO.update(
        { _id: payment._id, cuid: payment.cuid },
        {
          $set: {
            ...(isFullyRefunded && { status: PaymentRecordStatus.REFUNDED }),
            ...(!payment.gatewayChargeId && { gatewayChargeId: chargeId }),
            'refund.refundedAt': dayjs().toDate(),
            ...(!payment.refund?.refundedBy && { 'refund.refundedBy': 'system:stripe-webhook' }),
            'refund.amount': totalRefunded,
            ...(latestRefund?.id && { 'refund.gatewayRefundId': latestRefund.id }),
          },
        }
      );

      this.log.info('Payment refund processed via webhook', {
        pytuid: payment.pytuid,
        chargeId,
        thisRefundAmount,
        totalRefunded,
        isFullyRefunded,
      });

      const tenantUserId = await this.resolveTenantUserId(payment);
      this.emitterService.emit(EventTypes.PAYMENT_REFUNDED, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        chargeId,
        tenantId: tenantUserId ?? payment.tenant?.toString(),
        amount: thisRefundAmount,
        refundAmount: thisRefundAmount,
        totalRefunded,
        currency,
        isPartial: !isFullyRefunded,
        reason: refundReason,
      });

      return { success: true, data: undefined, message: 'Refund processed successfully' };
    } catch (error: any) {
      this.log.error('Error handling charge refunded', { chargeId, error });
      throw error;
    }
  }

  /**
   * Cents refunded by the refund that triggered this event. Prefers the refund
   * object, then the event's previous_attributes, then the stored cumulative total.
   */
  private getLatestRefundAmount(
    payment: IPaymentDocument,
    chargeData: IStripeChargeWebhookData,
    totalRefunded: number
  ): number {
    const latestRefundAmount = chargeData.refunds?.data?.[0]?.amount;
    if (typeof latestRefundAmount === 'number') return latestRefundAmount;

    const previousTotal = chargeData.previous_attributes?.amount_refunded;
    if (typeof previousTotal === 'number') return totalRefunded - previousTotal;

    const storedTotal = payment.refund?.amount ?? 0;
    return storedTotal < totalRefunded ? totalRefunded - storedTotal : totalRefunded;
  }

  private async findPaymentForRefundedCharge(
    chargeId: string,
    chargeData: IStripeChargeWebhookData
  ): Promise<IPaymentDocument | null> {
    const byCharge = await this.paymentDAO.findFirst({
      gatewayChargeId: chargeId,
      deletedAt: null,
    });
    if (byCharge) return byCharge;

    // gatewayChargeId may never have been stored — fall back to the charge's invoice.
    const invoiceId = await this.resolveChargeInvoiceId(chargeData);
    if (!invoiceId) return null;
    return this.paymentDAO.findFirst({ gatewayPaymentId: invoiceId, deletedAt: null });
  }

  /**
   * Invoice id for a Charge payload. acacia payloads carry `invoice`; basil+
   * payloads do not, so it is resolved from the PaymentIntent.
   */
  private async resolveChargeInvoiceId(
    chargeData: IStripeChargeWebhookData
  ): Promise<string | null> {
    const invoiceId = this.extractStripeId(chargeData.invoice);
    if (invoiceId) return invoiceId;

    const paymentIntentId = this.extractStripeId(chargeData.payment_intent);
    if (!paymentIntentId) return null;

    const result = await this.paymentGatewayService.getInvoiceIdForPaymentIntent(
      IPaymentGatewayProvider.STRIPE,
      paymentIntentId
    );
    return result.success ? (result.data ?? null) : null;
  }

  async handleAccountUpdated(
    accountId: string,
    accountData: IStripeAccountWebhookData
  ): IPromiseReturnedData<null> {
    try {
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ accountId });

      if (!paymentProcessor) {
        this.log.warn('PaymentProcessor not found for account', { accountId });
        return { success: false, data: null, message: 'PaymentProcessor record not found' };
      }

      const justVerified = !paymentProcessor.payoutsEnabled && accountData.payouts_enabled;

      const updateData: Record<string, unknown> = {
        chargesEnabled: accountData.charges_enabled || false,
        payoutsEnabled: accountData.payouts_enabled || false,
        detailsSubmitted: accountData.details_submitted || false,
        ...(justVerified && { onboardedAt: dayjs().toDate() }),
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
      });

      if (justVerified) {
        this.emitterService.emit(EventTypes.PAYMENT_PROCESSOR_VERIFIED, {
          cuid: paymentProcessor.cuid,
          accountId,
          verifiedAt: dayjs().toDate(),
          ownerType: paymentProcessor.ownerType ?? null,
          vuid: paymentProcessor.vuid,
        });
      }

      return { data: null, success: true, message: 'PaymentProcessor updated successfully' };
    } catch (error: any) {
      this.log.error('Error handling account updated', { accountId, error });
      throw error;
    }
  }

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

  async handleCardPaymentSessionCompleted(session: {
    id: string;
    payment_intent?: string | null;
    metadata?: Record<string, string> | null;
    payment_status?: string;
  }): Promise<void> {
    const pytuid = session.metadata?.pytuid;
    const sessionCuid = session.metadata?.cuid;
    if (!pytuid || !sessionCuid) {
      this.log.warn(
        { sessionId: session.id },
        'Card payment session missing pytuid or cuid metadata — skipping'
      );
      return;
    }

    const payment = await this.paymentDAO.findFirst({ pytuid, cuid: sessionCuid, deletedAt: null });
    if (!payment) {
      this.log.warn(
        { sessionId: session.id, pytuid },
        'Payment not found for card checkout session'
      );
      return;
    }

    if (payment.status === PaymentRecordStatus.PAID) {
      this.log.info(
        { sessionId: session.id, pytuid },
        'Payment already paid — skipping card session webhook'
      );
      return;
    }

    const paymentIntentId =
      typeof session.payment_intent === 'string' ? session.payment_intent : null;

    // Fetch charge ID, receipt URL, and payment method ID from the PaymentIntent
    let receiptUrl: string | null = null;
    let chargeId: string | null = null;
    let paymentMethodId: string | null = null;
    if (paymentIntentId) {
      ({ chargeId, receiptUrl, paymentMethodId } =
        await this.stripeService.getPaymentIntentChargeInfo(paymentIntentId));
    }

    await this.paymentDAO.update(
      { _id: payment._id, cuid: payment.cuid },
      {
        $set: {
          status: PaymentRecordStatus.PAID,
          paidAt: dayjs().toDate(),
          paymentMethod: PaymentMethod.ONLINE,
          ...(paymentIntentId && { gatewayPaymentId: paymentIntentId }),
          ...(chargeId && { gatewayChargeId: chargeId }),
          ...(receiptUrl && { 'receipt.url': receiptUrl }),
        },
        $unset: { cardCheckoutSessionId: '' },
      }
    );

    this.log.info(
      { pytuid, sessionId: session.id, paymentIntentId, hasReceipt: !!receiptUrl },
      'Payment marked as PAID via card checkout'
    );

    // Card checkout always uses card — reconcile fees accordingly.
    await this.reconcilePaymentFees(payment, 'card');

    // Save the card to a separate field so the bank account (primary) is not
    // overwritten. This card is used by retryPaymentWithCard for ACSS fallback
    // and can also be used for maintenance payments.
    const tenantId = session.metadata?.uid;
    const cuid = session.metadata?.cuid;
    if (paymentMethodId && tenantId && cuid) {
      try {
        const processor = await this.paymentProcessorDAO.findFirst({ cuid });
        if (processor?.accountId) {
          await this.profileDAO.update(
            { user: new Types.ObjectId(tenantId) },
            { $set: { [`tenantInfo.cardPaymentMethods.${processor.accountId}`]: paymentMethodId } }
          );
          this.log.info(
            { pytuid, paymentMethodId },
            'Card saved to tenant profile for future payments'
          );
          const tenantProfile = await this.profileDAO.findFirst(
            { user: new Types.ObjectId(tenantId) },
            { populate: ['user'] }
          );
          if ((tenantProfile as any)?.user?.uid) {
            await this.userCache.invalidateUserDetail(cuid, (tenantProfile as any).user.uid);
          }
        }
      } catch (err) {
        this.log.warn({ err, pytuid }, 'Could not save card — payment still succeeded');
      }
    }

    this.emitterService.emit(EventTypes.PAYMENT_SUCCEEDED, {
      cuid: payment.cuid,
      pytuid: payment.pytuid,
      invoiceId: paymentIntentId ?? session.id,
      amount: payment.baseAmount,
      paidAt: dayjs().toDate(),
      tenantId: session.metadata?.uid,
      receiptUrl: receiptUrl ?? undefined,
      paymentType: payment.paymentType,
    });

    await this.markMaintenanceChargePaid(payment, chargeId ?? undefined, receiptUrl ?? undefined);
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
    const paymentMethodId = this.extractStripeId(setupIntent.payment_method) ?? '';
    const mandateId = this.extractStripeId(setupIntent.mandate);
    const customerId = this.extractStripeId(setupIntent.customer);

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

  async handleDisputeCreated(
    disputeId: string,
    disputeData: IStripeDisputeWebhookData
  ): IPromiseReturnedData<void> {
    try {
      const result = await this.findPaymentByDispute(disputeData, disputeId);
      if (!result) {
        return {
          success: false,
          data: undefined,
          message: 'No charge ID or payment record not found',
        };
      }
      const { payment, chargeId, amount, currency } = result;
      const reason: string = disputeData.reason || 'unknown';

      const chargeResult = await this.paymentGatewayService.getCharge(
        IPaymentGatewayProvider.STRIPE,
        chargeId
      );
      const transferId = this.extractStripeId(
        chargeResult.data?.transfer as string | { id?: string } | undefined
      );

      if (transferId) {
        // Tagged with the dispute ID so a won dispute re-transfers exactly what was reversed.
        const reversal = await this.paymentGatewayService.createTransferReversal(
          IPaymentGatewayProvider.STRIPE,
          transferId,
          amount,
          { metadata: { disputeId }, idempotencyKey: `dispute-reversal:${disputeId}` }
        );
        if (reversal.success) {
          this.log.info('Transfer reversed for dispute', { disputeId, transferId, amount });
        } else {
          this.log.error('Transfer reversal failed — blocking payouts', {
            disputeId,
            transferId,
            error: reversal.message,
          });
          await this.paymentProcessorDAO.update(
            { cuid: payment.cuid },
            {
              $set: {
                payoutsBlocked: true,
                payoutsBlockedReason: `Transfer reversal failed for dispute ${disputeId}`,
                payoutsBlockedAt: dayjs().toDate(),
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

      const session = await this.paymentDAO.startSession();
      await this.paymentDAO.withTransaction(session, async (txSession) => {
        await this.paymentDAO.update(
          { _id: payment._id, cuid: payment.cuid },
          {
            $set: {
              'dispute.disputeId': disputeId,
              'dispute.amount': amount,
              'dispute.reason': reason,
              'dispute.disputedAt': dayjs().toDate(),
              'dispute.status': 'open',
            },
          },
          undefined,
          txSession
        );

        await this.paymentProcessorDAO.update(
          { cuid: payment.cuid },
          {
            $inc: { 'disputeStats.total': 1, 'disputeStats.open': 1 },
            $set: { 'disputeStats.lastDisputeAt': dayjs().toDate() },
          },
          undefined,
          txSession
        );
      });

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

  /** Amount reversed from the charge's transfer for this dispute (0 if none). Throws on lookup failure. */
  private async getDisputeReversedAmount(chargeId: string, disputeId: string): Promise<number> {
    const chargeResult = await this.paymentGatewayService.getCharge(
      IPaymentGatewayProvider.STRIPE,
      chargeId
    );
    const transferId = this.extractStripeId(
      chargeResult.data?.transfer as string | { id?: string } | undefined
    );
    if (!transferId) return 0;

    const reversed = await this.paymentGatewayService.getDisputeReversedAmount(
      IPaymentGatewayProvider.STRIPE,
      transferId,
      disputeId
    );
    if (!reversed.success) {
      throw new Error(`Could not read transfer reversals for dispute ${disputeId}`);
    }
    return reversed.data ?? 0;
  }

  async handleDisputeWon(
    disputeId: string,
    disputeData: IStripeDisputeWebhookData
  ): IPromiseReturnedData<void> {
    try {
      return await this.closeDisputeInPmFavour(disputeId, disputeData, 'won');
    } catch (error: any) {
      this.log.error('Error handling dispute won', { disputeId, error });
      throw error;
    }
  }

  /**
   * An inquiry (warning) closed without escalating to a chargeback. The funds
   * reversed from the PM when it opened are returned, as for a won dispute.
   */
  async handleDisputeWarningClosed(
    disputeId: string,
    disputeData: IStripeDisputeWebhookData
  ): IPromiseReturnedData<void> {
    try {
      return await this.closeDisputeInPmFavour(disputeId, disputeData, 'closed');
    } catch (error: any) {
      this.log.error('Error handling dispute warning closed', { disputeId, error });
      throw error;
    }
  }

  /** Keeps dispute.status in sync while a dispute is still in progress (charge.dispute.updated). */
  async handleDisputeUpdated(
    disputeId: string,
    disputeData: IStripeDisputeWebhookData
  ): IPromiseReturnedData<void> {
    try {
      const mappedStatus = disputeData.status
        ? STRIPE_DISPUTE_STATUS_MAP[disputeData.status]
        : undefined;
      if (!mappedStatus) {
        // won / lost / warning_closed are handled by charge.dispute.closed
        return { success: true, data: undefined, message: 'Dispute status not tracked here' };
      }

      const result = await this.findPaymentByDispute(disputeData, disputeId);
      if (!result) {
        return {
          success: false,
          data: undefined,
          message: 'No charge ID or payment record not found',
        };
      }
      const { payment } = result;

      const currentStatus = payment.dispute?.status;
      if (currentStatus && ['closed', 'lost', 'won'].includes(currentStatus)) {
        this.log.info('Dispute already resolved — ignoring update', { disputeId, currentStatus });
        return { success: true, data: undefined, message: 'Dispute already resolved' };
      }
      if (currentStatus === mappedStatus) {
        return { success: true, data: undefined, message: 'Dispute status unchanged' };
      }

      await this.paymentDAO.update(
        { _id: payment._id, cuid: payment.cuid },
        {
          $set: {
            'dispute.status': mappedStatus,
            ...(!payment.dispute?.disputeId && { 'dispute.disputeId': disputeId }),
          },
        }
      );

      this.log.info('Dispute status updated', {
        disputeId,
        pytuid: payment.pytuid,
        from: currentStatus,
        to: mappedStatus,
      });
      return { success: true, data: undefined, message: 'Dispute status updated' };
    } catch (error: any) {
      this.log.error('Error handling dispute updated', { disputeId, error });
      throw error;
    }
  }

  private async closeDisputeInPmFavour(
    disputeId: string,
    disputeData: IStripeDisputeWebhookData,
    resolution: 'won' | 'closed'
  ): IPromiseReturnedData<void> {
    const result = await this.findPaymentByDispute(disputeData, disputeId);
    if (!result) {
      return {
        success: false,
        data: undefined,
        message: 'No charge ID or payment record not found',
      };
    }
    const { payment, chargeId, amount, currency } = result;

    if (payment.dispute?.status === resolution) {
      this.log.info(`Dispute already marked ${resolution} — skipping duplicate event`, {
        disputeId,
      });
      return { success: true, data: undefined, message: `Dispute already ${resolution}` };
    }

    const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid: payment.cuid });
    if (!paymentProcessor?.accountId) {
      this.log.warn('Payment processor not found for resolved dispute', {
        cuid: payment.cuid,
        disputeId,
        resolution,
      });
      return { success: false, data: undefined, message: 'Payment processor not found' };
    }

    // Return only what was actually pulled back from the PM for this dispute. If the
    // reversal failed when the dispute opened, the PM kept the funds and is owed nothing.
    const reversedAmount = await this.getDisputeReversedAmount(chargeId, disputeId);
    if (reversedAmount > 0) {
      const transfer = await this.paymentGatewayService.createTransfer(
        IPaymentGatewayProvider.STRIPE,
        {
          amountInCents: reversedAmount,
          currency,
          destination: paymentProcessor.accountId,
          metadata: {
            disputeId,
            reason: resolution === 'won' ? 'dispute_won' : 'dispute_warning_closed',
            invoiceNumber: payment.invoiceNumber,
          },
          idempotencyKey: `dispute-won:${disputeId}`,
        }
      );
      if (!transfer.success) {
        // Throw so the webhook is released and Stripe redelivers it.
        throw new Error(
          `Re-transfer to PM failed for ${resolution} dispute ${disputeId}: ${transfer.message}`
        );
      }
    } else {
      this.log.warn('Resolved dispute had no reversal to return — skipping re-transfer', {
        disputeId,
        chargeId,
        resolution,
      });
    }

    const session = await this.paymentDAO.startSession();
    await this.paymentDAO.withTransaction(session, async (txSession) => {
      await this.paymentDAO.update(
        { _id: payment._id, cuid: payment.cuid },
        { $set: { 'dispute.status': resolution, 'dispute.resolvedAt': dayjs().toDate() } },
        undefined,
        txSession
      );

      await this.paymentProcessorDAO.update(
        { cuid: payment.cuid, 'disputeStats.open': { $gt: 0 } },
        { $inc: { 'disputeStats.open': -1 } },
        undefined,
        txSession
      );
    });

    if (resolution === 'won') {
      this.emitterService.emit(EventTypes.PAYMENT_DISPUTE_WON, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        disputeId,
        invoiceNumber: payment.invoiceNumber,
        chargeId,
        amount,
        currency,
      });
    }

    this.log.info(`Dispute ${resolution} — PM re-transferred`, {
      disputeId,
      chargeId,
      pytuid: payment.pytuid,
    });
    return { success: true, data: undefined, message: `Dispute ${resolution} handled` };
  }

  async handleDisputeLost(
    disputeId: string,
    disputeData: IStripeDisputeWebhookData
  ): IPromiseReturnedData<void> {
    try {
      const result = await this.findPaymentByDispute(disputeData, disputeId);
      if (!result) {
        return {
          success: false,
          data: undefined,
          message: 'No charge ID or payment record not found',
        };
      }
      const { payment, chargeId, amount, currency } = result;

      if (payment.dispute?.status === 'lost') {
        this.log.info('Dispute already marked lost — skipping duplicate event', { disputeId });
        return { success: true, data: undefined, message: 'Dispute already lost' };
      }

      // The PM's share was reversed when the dispute opened. Only when that reversal
      // failed is the platform out of pocket — then hold the PM's payouts.
      const unrecoveredAmount = await this.getUnrecoveredDisputeAmount(chargeId, disputeId, amount);
      const shouldBlockPayouts = unrecoveredAmount > 0;

      const session = await this.paymentDAO.startSession();
      await this.paymentDAO.withTransaction(session, async (txSession) => {
        if (shouldBlockPayouts) {
          await this.paymentProcessorDAO.update(
            { cuid: payment.cuid },
            {
              $set: {
                payoutsBlocked: true,
                payoutsBlockedReason: `Dispute ${disputeId} lost — ${unrecoveredAmount} cents not recovered from connected account`,
                payoutsBlockedAt: dayjs().toDate(),
              },
            },
            undefined,
            txSession
          );
        }

        await this.paymentProcessorDAO.update(
          { cuid: payment.cuid, 'disputeStats.open': { $gt: 0 } },
          { $inc: { 'disputeStats.open': -1 } },
          undefined,
          txSession
        );

        await this.paymentDAO.update(
          { _id: payment._id, cuid: payment.cuid },
          { $set: { 'dispute.status': 'lost', 'dispute.resolvedAt': dayjs().toDate() } },
          undefined,
          txSession
        );
      });

      this.emitterService.emit(EventTypes.PAYMENT_DISPUTE_LOST, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        disputeId,
        invoiceNumber: payment.invoiceNumber,
        chargeId,
        amount,
        currency,
      });

      this.log.info('Dispute lost — PM notified', {
        disputeId,
        chargeId,
        pytuid: payment.pytuid,
        payoutsBlocked: shouldBlockPayouts,
        unrecoveredAmount,
      });
      return { success: true, data: undefined, message: 'Dispute lost handled' };
    } catch (error: any) {
      this.log.error('Error handling dispute lost', { disputeId, error });
      throw error;
    }
  }

  /**
   * Disputed cents that were NOT pulled back from the PM's connected account.
   * Charges without a transfer never paid the PM, so nothing is owed back.
   * If the reversal lookup fails, the whole amount is treated as unrecovered.
   */
  private async getUnrecoveredDisputeAmount(
    chargeId: string,
    disputeId: string,
    disputedAmount: number
  ): Promise<number> {
    try {
      const chargeResult = await this.paymentGatewayService.getCharge(
        IPaymentGatewayProvider.STRIPE,
        chargeId
      );
      if (!chargeResult.success) return disputedAmount;
      const transferId = this.extractStripeId(
        chargeResult.data?.transfer as string | { id?: string } | undefined
      );
      if (!transferId) return 0;

      const reversed = await this.paymentGatewayService.getDisputeReversedAmount(
        IPaymentGatewayProvider.STRIPE,
        transferId,
        disputeId
      );
      if (!reversed.success) return disputedAmount;
      return Math.max(disputedAmount - (reversed.data ?? 0), 0);
    } catch (err) {
      this.log.warn({ err, disputeId }, 'Could not verify dispute reversal — treating as failed');
      return disputedAmount;
    }
  }

  private async fetchInvoicePaymentDetails(invoiceId: string): Promise<{
    chargeId?: string;
    paymentMethodType?: string;
    lastPaymentError?: { message?: string; code?: string };
  }> {
    const result = await this.paymentGatewayService.getInvoicePaymentDetails(
      IPaymentGatewayProvider.STRIPE,
      invoiceId
    );
    return result.success && result.data ? result.data : {};
  }

  /**
   * Returns why an invoice.payment_failed event must not touch this record, or
   * null when it should be processed. Late or out-of-order failures (record already
   * settled, or the invoice was replaced e.g. by a card retry) are ignored so they
   * cannot flip PAID → FAILED or trigger a second card charge.
   */
  private getFailedInvoiceIgnoreReason(
    payment: IPaymentDocument,
    invoiceId: string
  ): string | null {
    if (SETTLED_PAYMENT_STATUSES.has(payment.status)) {
      return `Payment already ${payment.status}`;
    }

    const split = payment.splitInvoices?.find((si) => si.invoiceId === invoiceId);
    const isCurrentInvoice = payment.gatewayPaymentId === invoiceId || !!split;
    if (!isCurrentInvoice) {
      return 'Invoice is no longer the current invoice for this payment';
    }
    if (split?.status === 'paid') {
      return 'Split invoice already paid';
    }
    return null;
  }

  private async getInvoiceFailureDetails(
    invoiceId: string,
    invoiceData: IStripeInvoiceWebhookData
  ): Promise<{ paymentMethodType?: string; stripeFailureMessage?: string }> {
    let paymentMethodType: string | undefined;
    if (invoiceData.default_payment_method) {
      try {
        const pmResult = await this.paymentGatewayService.retrievePaymentMethod(
          IPaymentGatewayProvider.STRIPE,
          invoiceData.default_payment_method
        );
        paymentMethodType = pmResult.success ? pmResult.data?.type : undefined;
      } catch (err) {
        this.log.warn({ err, invoiceId }, 'Could not retrieve payment method type');
      }
    }

    let stripeFailureMessage: string | undefined;
    try {
      const details = await this.fetchInvoicePaymentDetails(invoiceId);
      stripeFailureMessage = details.lastPaymentError?.message;
    } catch (err) {
      this.log.warn({ err, invoiceId }, 'Could not retrieve invoice failure details');
    }

    return { paymentMethodType, stripeFailureMessage };
  }

  /** Payments reference the tenant Profile; notifications want the User _id. */
  private async resolveTenantUserId(payment: IPaymentDocument): Promise<string | undefined> {
    if (!payment.tenant) return undefined;
    try {
      const tenantProfile = await this.profileDAO.findFirst({
        _id: new Types.ObjectId(payment.tenant.toString()),
      });
      return tenantProfile?.user?.toString();
    } catch (err) {
      this.log.warn({ err, pytuid: payment.pytuid }, 'Could not resolve tenant user ID');
      return undefined;
    }
  }

  private extractStripeId(obj: string | { id?: string } | null | undefined): string | null {
    if (!obj) return null;
    return typeof obj === 'string' ? obj : (obj.id ?? null);
  }

  private async findPaymentByDispute(
    disputeData: IStripeDisputeWebhookData,
    disputeId: string
  ): Promise<{
    payment: IPaymentDocument;
    chargeId: string;
    amount: number;
    currency: string;
  } | null> {
    const chargeId = this.extractStripeId(disputeData.charge);
    if (!chargeId) {
      this.log.warn('No charge ID in dispute data', { disputeId });
      return null;
    }

    const payment = await this.paymentDAO.findFirst({
      gatewayChargeId: chargeId,
      deletedAt: null,
    });
    if (!payment) {
      this.log.warn('Payment not found for dispute charge', { chargeId, disputeId });
      return null;
    }

    return {
      payment,
      chargeId,
      amount: disputeData.amount,
      currency: disputeData.currency,
    };
  }

  /**
   * Reconcile processingFee, applicationFee, and platformRevenue on a payment
   * record based on the actual payment method used. The original values may have
   * been estimated for ACSS but the actual charge went through on a card.
   */
  private async reconcilePaymentFees(
    payment: IPaymentDocument,
    actualPaymentMethodType?: string
  ): Promise<void> {
    try {
      const { cuid } = payment;
      const isAcss =
        actualPaymentMethodType === 'acss_debit' || actualPaymentMethodType === 'us_bank_account';
      const isCard =
        actualPaymentMethodType === 'card' ||
        (!actualPaymentMethodType && payment.paymentMethod === PaymentMethod.ONLINE);

      // Determine actual gateway fee
      const gatewayFeeType = isAcss ? 'auto-debit' : undefined;
      const actualGatewayFee = this.subscriptionPlanConfig.calculatePaymentGatewayFee(
        payment.baseAmount,
        'stripe',
        gatewayFeeType
      );

      // Determine actual application fee
      let actualApplicationFee = payment.applicationFee ?? 0;
      if (isCard && !isAcss) {
        // Card payment — use plan's card transaction fee rate
        const subscription = await this.subscriptionDAO.findFirst({ cuid });
        if (subscription?.planName) {
          const cardTxFeePercent = this.subscriptionPlanConfig.getTransactionFeePercent(
            subscription.planName
          );
          actualApplicationFee = Math.round(payment.baseAmount * (cardTxFeePercent / 100));
        }
      } else if (isAcss) {
        // ACSS payment — use ACH application fee rate
        actualApplicationFee = this.subscriptionPlanConfig.calculateAchApplicationFee(
          payment.baseAmount
        );
      }

      const actualPlatformRevenue = actualApplicationFee - actualGatewayFee;

      // Only update if values differ from what's stored
      const feeChanged =
        actualGatewayFee !== (payment.processingFee ?? 0) ||
        actualApplicationFee !== (payment.applicationFee ?? 0) ||
        actualPlatformRevenue !== (payment.platformRevenue ?? 0);

      if (feeChanged) {
        await this.paymentDAO.update(
          { _id: payment._id, cuid },
          {
            $set: {
              processingFee: actualGatewayFee,
              applicationFee: actualApplicationFee,
              platformRevenue: actualPlatformRevenue,
            },
          }
        );

        this.log.info(
          {
            pytuid: payment.pytuid,
            cuid,
            actualPaymentMethodType,
            old: {
              processingFee: payment.processingFee,
              applicationFee: payment.applicationFee,
              platformRevenue: payment.platformRevenue,
            },
            new: {
              processingFee: actualGatewayFee,
              applicationFee: actualApplicationFee,
              platformRevenue: actualPlatformRevenue,
            },
          },
          'Reconciled payment fees based on actual payment method'
        );
      }
    } catch (error: any) {
      // Fee reconciliation is non-critical — log but don't fail the webhook
      this.log.error(
        { pytuid: payment.pytuid, cuid: payment.cuid, error: error.message },
        'Failed to reconcile payment fees'
      );
    }
  }

  private async markMaintenanceChargePaid(
    payment: IPaymentDocument,
    chargeId?: string,
    receiptUrl?: string
  ): Promise<void> {
    if (
      payment.paymentType === PaymentRecordType.MAINTENANCE &&
      !payment.vendorId &&
      payment.maintenanceRequestUid
    ) {
      // A request can have several invoices (rejected/resubmitted) — the tenant
      // charge belongs to the newest approved one.
      const approvedInvoice = await this.invoiceDAO.findFirst(
        {
          mruid: payment.maintenanceRequestUid,
          cuid: payment.cuid,
          status: InvoiceStatus.APPROVED,
          isDeleted: false,
        },
        { sort: { createdAt: -1 } }
      );

      if (approvedInvoice) {
        await this.invoiceDAO.update(
          { _id: approvedInvoice._id, cuid: payment.cuid },
          {
            $set: {
              tenantPaymentStatus: TenantPaymentStatus.PAID,
              ...(chargeId && { stripeChargeId: chargeId }),
              ...(receiptUrl && { stripeReceiptUrl: receiptUrl }),
            },
          }
        );
      } else {
        this.log.warn('No approved invoice found for paid maintenance charge', {
          pytuid: payment.pytuid,
          mruid: payment.maintenanceRequestUid,
        });
      }

      this.emitterService.emit(EventTypes.MAINTENANCE_CHARGE_PAID, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        mruid: payment.maintenanceRequestUid,
        amountInCents: payment.baseAmount,
        chargeId: chargeId ?? undefined,
      });
    }
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
    const pmType = paymentMethodResult.data?.type;
    const isCard = pmType === 'card';

    if (pmType && bankDebitTypes.has(pmType) && !mandateId) {
      this.log.warn(
        {
          sourceId,
          sourceType,
          paymentMethodId,
          paymentMethodType: pmType,
        },
        'Setup flow produced a bank debit payment method without a mandate — not saving'
      );
      return;
    }

    const profileUpdate: Record<string, any> = {};

    if (isCard) {
      // Save card to the separate cardPaymentMethods map so it does not overwrite
      // the primary bank debit method used for recurring rent charges.
      profileUpdate[`tenantInfo.cardPaymentMethods.${pmAccountId}`] = paymentMethodId;
    } else {
      profileUpdate[`tenantInfo.paymentMethods.${pmAccountId}`] = paymentMethodId;
      if (mandateId) {
        profileUpdate[`tenantInfo.paymentMandates.${pmAccountId}`] = mandateId;
      }
    }

    // For ACSS debit (PAD), store mandate details for Rule H1 compliance
    if (pmType === 'acss_debit' && mandateId) {
      profileUpdate[`tenantInfo.padMandateDetails.${pmAccountId}`] = {
        mandateId,
        startDate: new Date(),
        confirmedAt: new Date(),
        frequency: 'monthly',
        amount: 0, // Will be populated by notification handler from lease data
      };
    }

    // checkout.session.completed and setup_intent.succeeded both deliver the same
    // PAD mandate. Only the first write for a mandate matches this filter, so the
    // confirmation notice is sent once.
    const isPadMandate = pmType === 'acss_debit' && !!mandateId;
    const profileFilter = {
      user: new Types.ObjectId(tenantId),
      ...(isPadMandate && {
        [`tenantInfo.padMandateDetails.${pmAccountId}.mandateId`]: { $ne: mandateId },
      }),
    };
    const updatedProfile = await this.profileDAO.update(profileFilter, { $set: profileUpdate });
    if (isPadMandate && !updatedProfile) {
      this.log.info(
        { tenantId, cuid, mandateId, pmAccountId, sourceType },
        'PAD mandate already saved — skipping duplicate setup notification'
      );
      return;
    }

    try {
      const tenantProfile = await this.profileDAO.findFirst(
        { user: new Types.ObjectId(tenantId) },
        { populate: ['user'] }
      );
      if ((tenantProfile as any)?.user?.uid) {
        await this.userCache.invalidateUserDetail(cuid, (tenantProfile as any).user.uid);
      }
    } catch (err) {
      this.log.warn(
        { err, tenantId, cuid },
        'Could not invalidate user cache after payment method save'
      );
    }

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

    // Emit PAD mandate confirmed event for Rule H1 confirmation notification
    if (isPadMandate && mandateId) {
      this.emitterService.emit(EventTypes.PAD_MANDATE_CONFIRMED, {
        tenantId,
        cuid,
        mandateId,
        pmAccountId,
      });
    }
  }

  async handlePayoutPaid(
    payoutId: string,
    payoutData: IStripePayoutWebhookData,
    connectedAccountId: string
  ): IPromiseReturnedData<void> {
    try {
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({
        accountId: connectedAccountId,
      });

      if (!paymentProcessor) {
        this.log.warn('PaymentProcessor not found for paid payout', {
          payoutId,
          connectedAccountId,
        });
        return { success: false, data: undefined, message: 'PaymentProcessor record not found' };
      }

      this.log.info('Vendor payout successfully deposited to bank', {
        payoutId,
        cuid: paymentProcessor.cuid,
        accountId: connectedAccountId,
        amountInCents: payoutData.amount,
        arrivalDate: new Date(payoutData.arrival_date * 1000),
      });

      this.emitterService.emit(EventTypes.PAYOUT_PAID, {
        cuid: paymentProcessor.cuid,
        payoutId,
        accountId: connectedAccountId,
        amountInCents: payoutData.amount,
        currency: payoutData.currency,
        arrivalDate: new Date(payoutData.arrival_date * 1000),
      });

      return { success: true, data: undefined, message: 'Payout paid handled' };
    } catch (error: any) {
      this.log.error('Error handling payout paid', { payoutId, error });
      throw error;
    }
  }

  async handlePayoutFailed(
    payoutId: string,
    payoutData: IStripePayoutWebhookData,
    connectedAccountId: string
  ): IPromiseReturnedData<void> {
    try {
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({
        accountId: connectedAccountId,
      });

      if (!paymentProcessor) {
        this.log.warn('PaymentProcessor not found for failed payout', {
          payoutId,
          connectedAccountId,
        });
        return { success: false, data: undefined, message: 'PaymentProcessor record not found' };
      }

      this.log.warn('Vendor payout failed', {
        payoutId,
        cuid: paymentProcessor.cuid,
        failureCode: payoutData.failure_code,
        failureReason: payoutData.failure_reason,
        amountInCents: payoutData.amount,
      });

      const CRITICAL_FAILURE_CODES = ['account_closed', 'account_frozen'];
      if (payoutData.failure_code && CRITICAL_FAILURE_CODES.includes(payoutData.failure_code)) {
        await this.paymentProcessorDAO.update(
          { _id: paymentProcessor._id },
          {
            $set: {
              payoutsBlocked: true,
              payoutsBlockedReason: `Payout failed: ${payoutData.failure_reason || payoutData.failure_code}`,
              payoutsBlockedAt: dayjs().toDate(),
            },
          }
        );
      }

      this.emitterService.emit(EventTypes.PAYOUT_FAILED, {
        cuid: paymentProcessor.cuid,
        payoutId,
        accountId: connectedAccountId,
        amountInCents: payoutData.amount,
        currency: payoutData.currency,
        failureCode: payoutData.failure_code,
        reason: payoutData.failure_reason || payoutData.failure_message,
      });

      return { success: true, data: undefined, message: 'Payout failed handled' };
    } catch (error: any) {
      this.log.error('Error handling payout failed', { payoutId, error });
      throw error;
    }
  }

  async handleInvoiceOverdue(
    invoiceId: string,
    invoiceData: IStripeInvoiceWebhookData
  ): IPromiseReturnedData<void> {
    try {
      const payment = await this.paymentDAO.findFirst({
        gatewayPaymentId: invoiceId,
        deletedAt: null,
      });

      if (!payment) {
        this.log.info('No payment record for overdue invoice — likely a subscription invoice', {
          invoiceId,
        });
        return { success: false, data: undefined, message: 'Payment record not found' };
      }

      this.log.warn('Rent invoice overdue', {
        invoiceId,
        pytuid: payment.pytuid,
        cuid: payment.cuid,
        amountDue: invoiceData.amount_due,
      });

      this.emitterService.emit(EventTypes.INVOICE_OVERDUE, {
        cuid: payment.cuid,
        invoiceId,
        pytuid: payment.pytuid,
        amount: invoiceData.amount_due ?? payment.baseAmount,
        currency: invoiceData.currency ?? 'usd',
        tenantId: payment.tenant?.toString(),
      });

      return { success: true, data: undefined, message: 'Invoice overdue handled' };
    } catch (error: any) {
      this.log.error('Error handling invoice overdue', { invoiceId, error });
      throw error;
    }
  }

  async handleInvoiceUpcoming(invoiceData: IStripeInvoiceWebhookData): IPromiseReturnedData<void> {
    try {
      const stripeSubscriptionId = invoiceData.subscription;
      if (!stripeSubscriptionId) {
        this.log.info('invoice.upcoming has no subscription ID — skipping', {
          invoiceId: invoiceData.id,
        });
        return { success: false, data: undefined, message: 'No subscription ID' };
      }

      const subscription = await this.subscriptionDAO.findByPaymentGatewayId(stripeSubscriptionId);
      if (!subscription) {
        this.log.info('No subscription record for upcoming invoice — likely free plan', {
          stripeSubscriptionId,
        });
        return { success: false, data: undefined, message: 'Subscription not found' };
      }

      const renewalDate = invoiceData.period_start
        ? new Date(invoiceData.period_start * 1000)
        : new Date();

      this.emitterService.emit(EventTypes.SUBSCRIPTION_RENEWAL_UPCOMING, {
        cuid: subscription.cuid,
        stripeSubscriptionId,
        planName: subscription.planName,
        amountInCents: invoiceData.amount_due ?? 0,
        currency: invoiceData.currency ?? 'usd',
        renewalDate,
      });

      return { success: true, data: undefined, message: 'Invoice upcoming handled' };
    } catch (error: any) {
      this.log.error('Error handling invoice upcoming', { invoiceData, error });
      throw error;
    }
  }
}
