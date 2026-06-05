import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { createLogger } from '@utils/index';
import { envVariables } from '@shared/config';
import { QueueFactory } from '@services/queue';
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
    this.clientDAO = clientDAO;
    this.leaseDAO = leaseDAO;
    this.emitterService.on(
      EventTypes.LEASE_ESIGNATURE_COMPLETED,
      this.handleLeaseActivated.bind(this)
    );
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
          paymentMethod: RentPaymentService.mapLeasePaymentMethod(acceptedPaymentMethod),
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

      const { invoiceId, hostedInvoiceUrl } = await this.createAndFinalizeInvoice({
        tenantCustomerId,
        connectedAccountId: paymentProcessor.accountId,
        applicationFee: feeBreakdown.applicationFee,
        currency: leaseFees.currency.toLowerCase(),
        description: data.description || `Rent for ${data.period?.month}/${data.period?.year}`,
        dueDate: data.dueDate,
        lineItems,
        cuid,
        paymentMethodId,
        leaseUid: lease.luid,
      });

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

      if (
        payment.paymentType !== PaymentRecordType.MAINTENANCE &&
        payment.paymentType !== PaymentRecordType.RENT &&
        payment.paymentType !== PaymentRecordType.LATE_FEE
      ) {
        throw new BadRequestError({
          message: 'Only rent, maintenance, or late fee charges can be paid this way',
        });
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
          paymentMethodId ? { paymentMethod: paymentMethodId } : undefined
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
        { paymentMethod: paymentMethodId }
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
          paymentMethod: RentPaymentService.mapLeasePaymentMethod(
            lease.fees?.acceptedPaymentMethod
          ),
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
