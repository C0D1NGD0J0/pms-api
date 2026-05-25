import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { InvoiceDAO } from '@dao/invoiceDAO';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { SubscriptionPlanConfig } from '@services/subscription';
import { MAX_CHARGE_ATTEMPTS, createLogger } from '@utils/index';
import { IPromiseReturnedData } from '@interfaces/utils.interface';
import { TenantPaymentStatus } from '@interfaces/invoice.interface';
import { StripeService } from '@services/external/stripe/stripe.service';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
import { PaymentProcessorDAO, SubscriptionDAO, PaymentDAO, ProfileDAO } from '@dao/index';
import {
  IPaymentGatewayProvider,
  PaymentRecordStatus,
  PaymentRecordType,
  IPaymentDocument,
  PaymentMethod,
} from '@interfaces/index';

export interface IStripeInvoiceWebhookData {
  last_payment_error?: {
    message?: string;
    code?: string;
    type?: string;
    payment_method?: { type?: string };
  };
  next_payment_attempt?: number;
  hosted_invoice_url?: string;
  attempt_count?: number;
  charge?: string;
}

interface IConstructor {
  subscriptionPlanConfig: SubscriptionPlanConfig;
  paymentGatewayService: PaymentGatewayService;
  paymentProcessorDAO: PaymentProcessorDAO;
  emitterService: EventEmitterService;
  subscriptionDAO: SubscriptionDAO;
  stripeService: StripeService;
  invoiceDAO: InvoiceDAO;
  profileDAO: ProfileDAO;
  paymentDAO: PaymentDAO;
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
  amount: number;
}

interface IStripeChargeWebhookData {
  amount_refunded?: number;
}

export class PaymentWebhookService {
  private readonly log: Logger;
  private readonly paymentGatewayService: PaymentGatewayService;
  private readonly paymentProcessorDAO: PaymentProcessorDAO;
  private readonly subscriptionPlanConfig: SubscriptionPlanConfig;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly emitterService: EventEmitterService;
  private readonly stripeService: StripeService;
  private readonly invoiceDAO: InvoiceDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly paymentDAO: PaymentDAO;

  constructor({
    paymentGatewayService,
    paymentProcessorDAO,
    subscriptionPlanConfig,
    subscriptionDAO,
    emitterService,
    stripeService,
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
        gatewayPaymentId: invoiceId,
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
            paidAt: dayjs().toDate(),
            gatewayChargeId: chargeId,
            ...(payment.paymentMethod === PaymentMethod.OTHER && {
              paymentMethod: PaymentMethod.ONLINE,
            }),
            ...(hostedInvoiceUrl && { 'receipt.url': hostedInvoiceUrl }),
          },
        }
      );

      this.log.info('Payment marked as paid', { pytuid: payment.pytuid, invoiceId, chargeId });

      this.emitterService.emit(EventTypes.PAYMENT_SUCCEEDED, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        invoiceId,
        amount: payment.baseAmount,
        paidAt: dayjs().toDate(),
      });

      if (
        payment.paymentType === PaymentRecordType.MAINTENANCE &&
        !payment.vendorId &&
        payment.maintenanceRequestUid
      ) {
        // Stamp the invoice so the funds-availability cron can pick it up
        await this.invoiceDAO.update(
          { mruid: payment.maintenanceRequestUid, cuid: payment.cuid, isDeleted: false },
          {
            $set: {
              tenantPaymentStatus: TenantPaymentStatus.PAID,
              ...(chargeId && { stripeChargeId: chargeId }),
            },
          }
        );

        this.emitterService.emit(EventTypes.MAINTENANCE_CHARGE_PAID, {
          cuid: payment.cuid,
          pytuid: payment.pytuid,
          mruid: payment.maintenanceRequestUid,
          amountInCents: payment.baseAmount,
          chargeId: chargeId ?? undefined,
        });
      }

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
        gatewayPaymentId: invoiceId,
        deletedAt: null,
      });

      if (!payment) {
        this.log.warn('Payment not found for failed invoice', { invoiceId });
        return { success: false, data: undefined, message: 'Payment record not found' };
      }

      // ── ACSS-specific failure: attempt card retry before standard failure logic ─
      // Primary signal: paymentMandates on the tenant profile (set only for ACSS/PAD).
      // last_payment_error is a PaymentIntent field and is absent on Invoice webhook payloads
      // unless payment_intent is expanded — use it only as a secondary / supplementary check.
      const [tenantProfile, processor] = await Promise.all([
        this.profileDAO.findFirst({ user: new Types.ObjectId(payment.tenant?.toString()) }),
        this.paymentProcessorDAO.findFirst({ cuid: payment.cuid }),
      ]);
      const mandateId = processor?.accountId
        ? tenantProfile?.tenantInfo?.paymentMandates?.get(processor.accountId)
        : null;

      const lastError = invoiceData.last_payment_error;
      const errorBasedAcss =
        lastError?.payment_method?.type === 'acss_debit' ||
        lastError?.code === 'amount_too_large' ||
        (lastError?.message ?? '').toLowerCase().includes('acss_debit');

      const isAcssFailure = !!mandateId || errorBasedAcss;

      if (isAcssFailure) {
        this.log.warn(
          { pytuid: payment.pytuid, invoiceId, mandateId, errorCode: lastError?.code },
          '[PaymentWebhookService] ACSS payment failure detected — attempting card retry'
        );
        const retried = await this.retryPaymentWithCard(payment, invoiceId);
        if (retried) {
          return {
            success: true,
            data: undefined,
            message: 'ACSS payment failed — retried with card',
          };
        }
        // No card available — mark failed with a clear reason for the PM
        await this.paymentDAO.update(
          { _id: payment._id, cuid: payment.cuid },
          {
            $set: {
              status: PaymentRecordStatus.FAILED,
              'failure.lastFailedAt': dayjs().toDate(),
              'failure.pmNotifiedAt': dayjs().toDate(),
              'failure.retryCount': (payment.failure?.retryCount ?? 0) + 1,
              'failure.reason':
                'Bank debit failed: payment amount exceeds per-transaction limit. Card payment required.',
            },
          }
        );
        this.emitterService.emit(EventTypes.PAYMENT_FAILED, {
          cuid: payment.cuid,
          pytuid: payment.pytuid,
          invoiceId,
          amount: payment.baseAmount,
          tenantId: payment.tenant?.toString(),
        });
        return { success: true, data: undefined, message: 'ACSS payment failed — no card on file' };
      }

      const attemptCount = invoiceData.attempt_count || 0;
      const stripeWillRetry = !!invoiceData.next_payment_attempt;
      const newRetryCount = (payment.failure?.retryCount ?? 0) + 1;
      const exhausted = !stripeWillRetry || newRetryCount >= MAX_CHARGE_ATTEMPTS;

      if (!exhausted) {
        await this.paymentDAO.update(
          { _id: payment._id, cuid: payment.cuid },
          {
            $set: {
              status: PaymentRecordStatus.OVERDUE,
              'failure.reason': invoiceData.last_payment_error?.message,
              'failure.lastFailedAt': dayjs().toDate(),
              'failure.retryCount': newRetryCount,
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
            'failure.reason': invoiceData.last_payment_error?.message,
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
        tenantId: payment.tenant?.toString(),
      });

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
  private async retryPaymentWithCard(
    payment: IPaymentDocument,
    failedInvoiceId: string
  ): Promise<boolean> {
    const { cuid } = payment;

    const [tenantProfile, processor] = await Promise.all([
      this.profileDAO.findFirst({ user: new Types.ObjectId(payment.tenant?.toString()) }),
      this.paymentProcessorDAO.findFirst({ cuid }),
    ]);

    if (!tenantProfile || !processor?.accountId) return false;

    const paymentMethodId = tenantProfile.tenantInfo?.paymentMethods?.get(processor.accountId);
    if (!paymentMethodId) return false;

    // Confirm this stored method is not itself ACSS (no fallback if it is)
    const pmResult = await this.paymentGatewayService.retrievePaymentMethod(
      IPaymentGatewayProvider.STRIPE,
      paymentMethodId
    );
    if (!pmResult.success || pmResult.data?.type === 'acss_debit') {
      this.log.warn(
        { pytuid: payment.pytuid, cuid, pmType: pmResult.data?.type },
        '[PaymentWebhookService] No non-ACSS payment method on file for card retry'
      );
      return false;
    }

    const tenantCustomerId = tenantProfile.tenantInfo?.paymentGatewayCustomers?.get('platform');
    if (!tenantCustomerId) return false;

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

    // Calculate application fee for the new invoice
    const subscription = await this.subscriptionDAO.findFirst({ cuid, deletedAt: null });
    const txFeePercent = subscription
      ? this.subscriptionPlanConfig.getTransactionFeePercent(subscription.planName)
      : 0;
    const applicationFeeCents = Math.round(payment.baseAmount * (txFeePercent / 100));

    const lineItems = payment.lineItems?.length
      ? (payment.lineItems as { description: string; amountInCents: number }[])
      : [
          {
            description: payment.description || 'Payment retry',
            amountInCents: payment.baseAmount,
          },
        ];

    const invoiceResult = await this.paymentGatewayService.createInvoice(
      IPaymentGatewayProvider.STRIPE,
      {
        tenantCustomerId,
        connectedAccountId: processor.accountId,
        applicationFeeAmountInCents: applicationFeeCents,
        currency: (payment.currency ?? 'USD').toLowerCase(),
        description: payment.description || `Card retry for ${payment.pytuid}`,
        autoChargeDueDate: dayjs().toDate(),
        lineItems,
        cuid,
        paymentMethodId,
      }
    );

    if (!invoiceResult.success || !invoiceResult.data) {
      this.log.error(
        { pytuid: payment.pytuid, message: invoiceResult.message },
        '[PaymentWebhookService] Failed to create card invoice for ACSS retry'
      );
      return false;
    }

    const finalizeResult = await this.paymentGatewayService.finalizeInvoice(
      IPaymentGatewayProvider.STRIPE,
      invoiceResult.data.invoiceId
    );

    if (!finalizeResult.success) {
      this.log.error(
        { pytuid: payment.pytuid },
        '[PaymentWebhookService] Failed to finalize card invoice for ACSS retry'
      );
      return false;
    }

    const payResult = await this.paymentGatewayService.payInvoice(
      IPaymentGatewayProvider.STRIPE,
      invoiceResult.data.invoiceId,
      { paymentMethod: paymentMethodId }
    );

    if (!payResult.success) {
      this.log.error(
        { pytuid: payment.pytuid },
        '[PaymentWebhookService] Failed to pay card invoice for ACSS retry'
      );
      return false;
    }

    await this.paymentDAO.update(
      { _id: payment._id, cuid: payment.cuid },
      {
        $set: {
          gatewayPaymentId: invoiceResult.data.invoiceId,
          status: PaymentRecordStatus.PROCESSING,
          paymentMethod: PaymentMethod.ONLINE,
        },
        $unset: { failure: '' },
      }
    );

    this.log.info(
      { pytuid: payment.pytuid, cuid, newInvoiceId: invoiceResult.data.invoiceId },
      '[PaymentWebhookService] ACSS payment retried with card successfully'
    );

    return true;
  }

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
        return { success: false, data: undefined, message: 'Payment record not found' };
      }

      const refundAmountInCents = chargeData.amount_refunded || 0;

      await this.paymentDAO.update(
        { _id: payment._id, cuid: payment.cuid },
        {
          $set: {
            status: PaymentRecordStatus.REFUNDED,
            'refund.refundedAt': dayjs().toDate(),
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

      return { success: true, data: undefined, message: 'Refund processed successfully' };
    } catch (error: any) {
      this.log.error('Error handling charge refunded', { chargeId, error });
      throw error;
    }
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
    if (!pytuid) {
      this.log.warn(
        { sessionId: session.id },
        'Card payment session has no pytuid metadata — skipping'
      );
      return;
    }

    const payment = await this.paymentDAO.findFirst({ pytuid, deletedAt: null });
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

    // Fetch the Stripe receipt URL and charge ID from the PaymentIntent (best-effort)
    let receiptUrl: string | null = null;
    let chargeId: string | null = null;
    if (paymentIntentId) {
      ({ chargeId, receiptUrl } =
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
      }
    );

    this.log.info(
      { pytuid, sessionId: session.id, paymentIntentId, hasReceipt: !!receiptUrl },
      'Payment marked as PAID via card checkout'
    );

    this.emitterService.emit(EventTypes.PAYMENT_SUCCEEDED, {
      cuid: payment.cuid,
      pytuid: payment.pytuid,
      invoiceId: paymentIntentId ?? session.id,
      amount: payment.baseAmount,
      paidAt: dayjs().toDate(),
    });

    if (
      payment.paymentType === PaymentRecordType.MAINTENANCE &&
      !payment.vendorId &&
      payment.maintenanceRequestUid
    ) {
      // Stamp the invoice so the funds-availability cron can pick it up
      await this.invoiceDAO.update(
        { mruid: payment.maintenanceRequestUid, cuid: payment.cuid, isDeleted: false },
        {
          $set: {
            tenantPaymentStatus: TenantPaymentStatus.PAID,
            ...(chargeId && { stripeChargeId: chargeId }),
          },
        }
      );

      this.emitterService.emit(EventTypes.MAINTENANCE_CHARGE_PAID, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        mruid: payment.maintenanceRequestUid,
        amountInCents: payment.baseAmount,
        chargeId: chargeId ?? undefined,
      });
    }
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
        }
      );

      await this.paymentProcessorDAO.update(
        { cuid: payment.cuid },
        {
          $inc: { 'disputeStats.total': 1, 'disputeStats.open': 1 },
          $set: { 'disputeStats.lastDisputeAt': dayjs().toDate() },
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

      if (payment.dispute?.status === 'won') {
        this.log.info('Dispute already marked won — skipping duplicate event', { disputeId });
        return { success: true, data: undefined, message: 'Dispute already won' };
      }

      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid: payment.cuid });
      if (!paymentProcessor?.accountId) {
        this.log.warn('Payment processor not found for won dispute', {
          cuid: payment.cuid,
          disputeId,
        });
        return { success: false, data: undefined, message: 'Payment processor not found' };
      }

      await this.paymentGatewayService.createTransfer(IPaymentGatewayProvider.STRIPE, {
        amountInCents: amount,
        currency,
        destination: paymentProcessor.accountId,
        metadata: { disputeId, reason: 'dispute_won', invoiceNumber: payment.invoiceNumber },
      });

      await this.paymentDAO.update(
        { _id: payment._id, cuid: payment.cuid },
        { $set: { 'dispute.status': 'won', 'dispute.resolvedAt': dayjs().toDate() } }
      );

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
            payoutsBlockedAt: dayjs().toDate(),
          },
        }
      );

      await this.paymentProcessorDAO.update(
        { cuid: payment.cuid, 'disputeStats.open': { $gt: 0 } },
        { $inc: { 'disputeStats.open': -1 } }
      );

      await this.paymentDAO.update(
        { _id: payment._id, cuid: payment.cuid },
        { $set: { 'dispute.status': 'lost', 'dispute.resolvedAt': dayjs().toDate() } }
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
    invoiceData: {
      amount_due?: number;
      currency?: string;
      customer?: string;
      subscription?: string;
    } & IStripeInvoiceWebhookData
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

  async handleInvoiceUpcoming(invoiceData: {
    id: string;
    subscription?: string;
    amount_due?: number;
    currency?: string;
    period_start?: number;
  }): IPromiseReturnedData<void> {
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
