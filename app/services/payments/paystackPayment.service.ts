import dayjs from 'dayjs';
import Logger from 'bunyan';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { FinancialCalculator } from '@utils/financial';
import { BadRequestError } from '@shared/customErrors';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { createPaystackReference } from '@utils/paystackReference';
import { IPaymentProcessorDocument } from '@interfaces/paymentProcessor.interface';
import { PaymentProcessorDAO, SubscriptionDAO, PaymentDAO, ProfileDAO } from '@dao/index';
import { SubscriptionPlanConfig } from '@services/subscription/subscription_plans.config';
import { IPaystackWebhookEvent, IPaystackTransaction } from '@interfaces/paystack.interface';
import {
  PAYSTACK_REFERENCE_PREFIX,
  PaymentGatewayService,
} from '@services/paymentGateway/paymentGateway.service';
import {
  PaymentRecordStatus,
  PaymentRecordType,
  IPaymentDocument,
  PaymentMethod,
} from '@interfaces/payments.interface';

import { PaymentWebhookService } from './paymentWebhook.service';

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

const PAYABLE_STATUSES = [
  PaymentRecordStatus.PENDING,
  PaymentRecordStatus.OVERDUE,
  PaymentRecordStatus.FAILED,
];

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
    const isMaintenance = payment.paymentType === PaymentRecordType.MAINTENANCE;

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
      // Maintenance money stays in the platform balance until the vendor is paid
      ...(!isMaintenance && {
        subaccount: processor.accountId,
        bearer: 'account' as const,
        ...(input.applicationFee > 0 && { transaction_charge: input.applicationFee }),
      }),
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
      return 'not_found';
    }

    if (payment.gatewayPaymentId === reference) {
      return 'already_paid';
    }

    const processor = await this.paymentProcessorDAO.findFirst({
      cuid: payment.cuid,
      ownerType: 'client',
      deletedAt: null,
    });
    const mismatch = this.findMismatch(payment, transaction, processor);
    if (mismatch) {
      this.log.error(
        { reference, pytuid: payment.pytuid, cuid: payment.cuid, mismatch },
        'Card transaction does not match its charge — left for review'
      );
      return 'needs_review';
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

    const outcome = await this.settleTransaction(reference);
    const current = await this.paymentDAO.findFirst({ _id: payment._id });
    return { outcome, status: (current?.status ?? payment.status) as PaymentRecordStatus };
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
              'refund.failureReason': 'The refund failed at the payment provider',
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
   * plan's rate (what checkout sent as transaction_charge); maintenance keeps its stored fee.
   */
  private async calculateFees(
    payment: IPaymentDocument,
    transaction: IPaystackTransaction
  ): Promise<{ processingFee: number; applicationFee: number; platformRevenue: number }> {
    const processingFee =
      transaction.fees ??
      this.subscriptionPlanConfig.calculatePaymentGatewayFee(payment.baseAmount, 'paystack');

    let applicationFee = payment.applicationFee ?? 0;
    if (payment.paymentType !== PaymentRecordType.MAINTENANCE) {
      const subscription = await this.subscriptionDAO.findFirst({ cuid: payment.cuid });
      if (subscription?.planName) {
        applicationFee = FinancialCalculator.percentOf(
          payment.baseAmount,
          this.subscriptionPlanConfig.getTransactionFeePercent(subscription.planName)
        );
      }
    }

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
    if (!refund.success) {
      this.log.error(
        { reference: transaction.reference, pytuid: payment.pytuid, message: refund.message },
        'Duplicate card payment could not be refunded — refund it manually'
      );
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
