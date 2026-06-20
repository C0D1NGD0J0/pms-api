import dayjs from 'dayjs';
import Decimal from 'decimal.js';
import { Types } from 'mongoose';
import { UserDAO } from '@dao/userDAO';
import { AuthCache } from '@caching/index';
import { ClientDAO } from '@dao/clientDAO';
import { createLogger } from '@utils/index';
import { MoneyUtils } from '@utils/money.utils';
import { EmailQueue } from '@queues/email.queue';
import { calcSeatCost } from '@utils/financial.utils';
import { SSEService } from '@services/sse/sse.service';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { BadRequestError } from '@shared/customErrors';
import { PaymentProcessorDAO } from '@dao/paymentProcessorDAO';
import { PaymentGatewayService } from '@services/paymentGateway';
import {
  IPaymentGatewayProvider,
  ISubscriptionDocument,
  IPromiseReturnedData,
  ISubscriptionStatus,
  MailType,
} from '@interfaces/index';

import { subscriptionPlanConfig, SubscriptionPlanConfig } from './subscription_plans.config';

interface IConstructor {
  subscriptionPlanConfig: SubscriptionPlanConfig;
  paymentGatewayService: PaymentGatewayService;
  paymentProcessorDAO: PaymentProcessorDAO;
  subscriptionDAO: SubscriptionDAO;
  sseService: SSEService;
  emailQueue: EmailQueue;
  clientDAO: ClientDAO;
  authCache: AuthCache;
  userDAO: UserDAO;
}

export class SubscriptionWebhookService {
  private userDAO: UserDAO;
  private clientDAO: ClientDAO;
  private authCache: AuthCache;
  private sseService: SSEService;
  private emailQueue: EmailQueue;
  private log: ReturnType<typeof createLogger>;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly paymentProcessorDAO: PaymentProcessorDAO;
  private readonly paymentGatewayService: PaymentGatewayService;
  private readonly subscriptionPlanConfig: SubscriptionPlanConfig;

  constructor({
    userDAO,
    clientDAO,
    authCache,
    sseService,
    emailQueue,
    subscriptionDAO,
    paymentProcessorDAO,
    paymentGatewayService,
    subscriptionPlanConfig,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.clientDAO = clientDAO;
    this.authCache = authCache;
    this.sseService = sseService;
    this.emailQueue = emailQueue;
    this.subscriptionDAO = subscriptionDAO;
    this.paymentProcessorDAO = paymentProcessorDAO;
    this.paymentGatewayService = paymentGatewayService;
    this.subscriptionPlanConfig = subscriptionPlanConfig;
    this.log = createLogger('SubscriptionWebhookService');
  }

  /**
   * Webhook handler: customer.subscription.created
   * Links the Stripe subscriberId to our subscription record.
   * Status/period updates are handled exclusively by customer.subscription.updated.
   */
  async handleSubscriptionCreated(data: {
    stripeSubscriptionId: string;
    stripeCustomerId: string;
  }): Promise<void> {
    const subscription = await this.subscriptionDAO.findFirst({
      'billing.customerId': data.stripeCustomerId,
    });

    if (!subscription) {
      this.log.warn(
        data,
        'customer.subscription.created: no local subscription found for customer'
      );
      return;
    }

    if (!subscription.billing?.subscriberId) {
      await this.subscriptionDAO.update(
        { _id: subscription._id },
        { $set: { 'billing.subscriberId': data.stripeSubscriptionId } }
      );
      this.log.info(
        { ...data, subscriptionId: subscription._id },
        'Linked Stripe subscriberId via customer.subscription.created'
      );
    }
  }

  async handlePaymentFailed(data: {
    stripeSubscriptionId: string;
    invoiceId: string;
    attemptCount?: number;
  }): IPromiseReturnedData<ISubscriptionDocument> {
    const session = await this.subscriptionDAO.startSession();

    try {
      const result = await this.subscriptionDAO.withTransaction(session, async (cxtsession) => {
        const { stripeSubscriptionId, invoiceId, attemptCount } = data;

        const subscription = await this.subscriptionDAO.findFirst(
          { 'billing.subscriberId': stripeSubscriptionId },
          undefined,
          undefined,
          cxtsession
        );

        if (!subscription) {
          this.log.error({ stripeSubscriptionId }, 'Subscription not found for payment failure');
          throw new BadRequestError({ message: 'Subscription not found' });
        }

        const gracePeriodEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        const updatedSubscription = await this.subscriptionDAO.update(
          { _id: subscription._id },
          {
            $set: {
              status: ISubscriptionStatus.PAST_DUE,
              pendingDowngradeAt: gracePeriodEndsAt,
            },
          },
          undefined,
          cxtsession
        );

        if (!updatedSubscription) {
          throw new BadRequestError({ message: 'Failed to update subscription' });
        }

        this.log.warn(
          {
            subscriptionId: subscription._id,
            stripeSubscriptionId,
            invoiceId,
            attemptCount,
            gracePeriodEndsAt,
          },
          'Payment failed - subscription marked past_due with 7-day grace period'
        );

        return updatedSubscription;
      });

      await this.notifyAccountAdminViaSSE(result.cuid, {
        type: 'payment_failed',
        subscription: {
          plan: result.planName,
          status: result.status,
          endDate: result.endDate,
        },
        message: 'Payment failed - please update your payment method',
      });

      return { data: result, success: true };
    } catch (error) {
      this.log.error({ error, data }, 'Error handling payment failure');
      throw error;
    }
  }

  /**
   * Webhook handler: invoice.paid
   * Saves card details to the subscription on first payment.
   * Status and period updates are handled exclusively by customer.subscription.updated.
   * Non-subscription invoices (rent) are silently ignored.
   */
  async handleInvoicePaid(rawInvoice: any): Promise<void> {
    const stripeSubscriptionId = this.extractSubscriptionId(rawInvoice);

    // Non-subscription invoice (e.g. rent) — handled elsewhere
    if (!stripeSubscriptionId) return;

    const billingReason: string = rawInvoice.billing_reason ?? '';
    if (billingReason !== 'subscription_cycle' && billingReason !== 'subscription_create') return;

    const subscription = await this.subscriptionDAO.findFirst({
      'billing.subscriberId': stripeSubscriptionId,
    });

    if (!subscription) {
      this.log.warn({ stripeSubscriptionId }, 'invoice.paid: subscription not found');
      return;
    }

    const updateData: Record<string, any> = {};

    // Advance endDate when Stripe provides it (renewal cycle primary source; also present on first invoice)
    if (rawInvoice.period_end) {
      const newEndDate = new Date(rawInvoice.period_end * 1000);
      // Only overwrite if newer than what we have, to avoid racing customer.subscription.updated
      if (!subscription.endDate || subscription.endDate < newEndDate) {
        updateData.endDate = newEndDate;
      }
    }

    // Resilience: a successful payment is proof Stripe considers the subscription active.
    // Activate locally if customer.subscription.updated was missed (e.g. Railway sandbox sleep).
    if (subscription.status !== ISubscriptionStatus.ACTIVE) {
      updateData.status = ISubscriptionStatus.ACTIVE;
      if (!subscription.billing?.subscriberId) {
        updateData['billing.subscriberId'] = stripeSubscriptionId;
      }
    }

    // Save / refresh card details from the charge on every paid invoice.
    // Since Stripe API v2025-03-31, `charge` and `latest_charge` were removed
    // from the Invoice top-level — retrieve via payments sub-object expansion.
    try {
      const invoicePaymentDetails = await this.paymentGatewayService.getInvoicePaymentDetails(
        IPaymentGatewayProvider.STRIPE,
        rawInvoice.id
      );
      const rawChargeId = invoicePaymentDetails.data?.chargeId;
      if (rawChargeId) {
        const chargeResult = await this.paymentGatewayService.getCharge(
          IPaymentGatewayProvider.STRIPE,
          rawChargeId
        );
        if (chargeResult.data?.payment_method_details?.card) {
          const { last4, brand } = chargeResult.data.payment_method_details.card;
          if (last4) updateData['billing.cardLast4'] = last4;
          if (brand) updateData['billing.cardBrand'] = brand;
        }
      }
    } catch (err) {
      this.log.warn({ err }, 'invoice.paid: failed to fetch card details from charge');
    }

    if (Object.keys(updateData).length > 0) {
      await this.subscriptionDAO.update({ _id: subscription._id }, { $set: updateData });
      this.log.info(
        { stripeSubscriptionId, billingReason, updateData },
        'invoice.paid: subscription synced'
      );
    }

    // Always bust cache and notify on successful renewal — even when
    // customer.subscription.updated already advanced the DB fields, the
    // cached currentUser may still hold stale subscription data.
    await this.notifyAccountAdminViaSSE(subscription.cuid, {
      type: 'subscription_renewed',
      subscription: {
        plan: subscription.planName,
        status: updateData.status ?? subscription.status,
        endDate: updateData.endDate ?? subscription.endDate,
      },
      message: 'Your subscription has been renewed',
    });

    if (Object.keys(updateData).length > 0) {
      // Queue subscription renewal receipt email to account admin
      if (billingReason === 'subscription_cycle') {
        try {
          const accountAdminId = await this.getAccountAdminId(subscription.cuid);

          if (accountAdminId) {
            const adminUser = await this.userDAO.findFirst({
              _id: new Types.ObjectId(accountAdminId),
              deletedAt: null,
            });
            if (adminUser?.email) {
              const adminName =
                adminUser.profile?.personalInfo?.firstName || adminUser.fullname || adminUser.email;
              const amount = rawInvoice.amount_paid
                ? MoneyUtils.formatCurrency(rawInvoice.amount_paid, rawInvoice.currency || 'usd')
                : undefined;
              const nextBillingDate = updateData.endDate
                ? new Date(updateData.endDate).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })
                : undefined;

              this.emailQueue.addToEmailQueue('subscriptionRenewalReceipt', {
                to: adminUser.email,
                emailType: MailType.SUBSCRIPTION_RENEWAL_RECEIPT,
                subject: '',
                data: {
                  adminName,
                  planName:
                    subscription.planName.charAt(0).toUpperCase() + subscription.planName.slice(1),
                  amount: amount || 'your plan rate',
                  nextBillingDate: nextBillingDate || 'N/A',
                },
              });
            }
          }
        } catch (err) {
          this.log.error({ err }, 'Failed to queue subscription renewal receipt email');
        }
      }
    }
  }

  /**
   * Webhook handler: invoice.payment_failed
   * Handles subscription payment failures only; silently ignores rent invoices.
   */
  async handleInvoicePaymentFailed(rawInvoice: any): Promise<void> {
    const stripeSubscriptionId = this.extractSubscriptionId(rawInvoice);

    if (!stripeSubscriptionId) {
      return;
    }

    await this.handlePaymentFailed({
      stripeSubscriptionId,
      invoiceId: rawInvoice.id,
      attemptCount: rawInvoice.attempt_count,
    });
  }

  async handleSubscriptionUpdated(data: {
    stripeSubscriptionId: string;
    stripeCustomerId?: string;
    status: string;
    currentPeriodStart?: number;
    currentPeriodEnd?: number;
    items?: any[];
  }): IPromiseReturnedData<ISubscriptionDocument> {
    try {
      const {
        stripeSubscriptionId,
        stripeCustomerId,
        status,
        currentPeriodStart,
        currentPeriodEnd,
        items,
      } = data;

      let subscription = await this.subscriptionDAO.findFirst({
        'billing.subscriberId': stripeSubscriptionId,
      });

      // Fallback: subscription may not have subscriberId linked yet (e.g. first activation)
      if (!subscription && stripeCustomerId) {
        subscription = await this.subscriptionDAO.findFirst({
          'billing.customerId': stripeCustomerId,
        });
      }

      if (!subscription) {
        this.log.error({ stripeSubscriptionId }, 'Subscription not found for update');
        throw new BadRequestError({ message: 'Subscription not found' });
      }

      const wasFirstActivation = subscription.status === ISubscriptionStatus.PENDING_PAYMENT;
      const updateData: any = {};
      if (status === 'active') {
        updateData.status = ISubscriptionStatus.ACTIVE;
        updateData.pendingDowngradeAt = null;
        // Ensure subscriberId is linked (in case customer.subscription.created was missed)
        if (!subscription.billing?.subscriberId) {
          updateData['billing.subscriberId'] = stripeSubscriptionId;
        }

        // Guard: if Stripe omits currentPeriodEnd on this event and the stored endDate is
        // already in the past, set it to 30 days from now so the frontend never sees
        // status=active + expired endDate simultaneously (which causes a redirect loop).
        if (!currentPeriodEnd && (!subscription.endDate || subscription.endDate < new Date())) {
          updateData.endDate = dayjs().add(30, 'day').toDate();
        }
      } else if (status === 'past_due') {
        updateData.status = ISubscriptionStatus.PAST_DUE;
        if (!subscription.pendingDowngradeAt) {
          updateData.pendingDowngradeAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        }
      } else if (status === 'canceled' || status === 'unpaid') {
        updateData.status = ISubscriptionStatus.INACTIVE;
      }

      if (currentPeriodStart) {
        updateData.startDate = new Date(currentPeriodStart * 1000);

        // Charge overage for manual payment records from the previous period
        const quota = subscriptionPlanConfig.getManualRecordQuota(subscription.planName);
        const previousCount = subscription.manualRecords?.countThisPeriod ?? 0;

        if (previousCount > quota && subscription.billing?.customerId) {
          const overageCount = previousCount - quota;
          const feeCents = subscriptionPlanConfig.getManualRecordOverageFeeCents();
          const totalCents = overageCount * feeCents;

          try {
            await this.paymentGatewayService.createInvoiceItem(IPaymentGatewayProvider.STRIPE, {
              customerId: subscription.billing.customerId,
              amountInCents: totalCents,
              currency: 'usd',
              description: `Manual payment record overage: ${overageCount} record(s) over ${quota} free @ $${(feeCents / 100).toFixed(2)} each`,
            });
            this.log.info(
              { cuid: subscription.cuid, overageCount, totalCents },
              'Manual record overage invoice item created'
            );
          } catch (err) {
            this.log.error(
              { err, cuid: subscription.cuid },
              'Failed to create manual record overage invoice item'
            );
          }
        }

        // Reset counter for new billing period
        updateData['manualRecords.countThisPeriod'] = 0;
        updateData['manualRecords.periodStart'] = new Date(currentPeriodStart * 1000);
      }

      // Only advance endDate — never allow a stale webhook retry to roll it back
      if (currentPeriodEnd) {
        const newEndDate = new Date(currentPeriodEnd * 1000);
        if (!subscription.endDate || subscription.endDate < newEndDate) {
          updateData.endDate = newEndDate;
        }
      }

      // Sync seat count directly from webhook items — no extra Stripe API call needed
      const webhookItems: any[] = items ?? [];
      if (webhookItems.length > 0) {
        const config = subscriptionPlanConfig.getConfig(subscription.planName);
        const seatLookupKeys = [
          config.seatPricing.lookUpKeys?.monthly,
          config.seatPricing.lookUpKeys?.annual,
          config.seatPricing.lookUpKey,
        ].filter(Boolean);

        const seatItem = webhookItems.find((item: any) =>
          seatLookupKeys.includes(item.price?.lookup_key)
        );

        if (seatItem) {
          const newSeatQuantity = seatItem.quantity || 0;
          if (newSeatQuantity !== subscription.additionalSeatsCount) {
            this.log.info(
              {
                stripeSubscriptionId,
                oldQuantity: subscription.additionalSeatsCount,
                newQuantity: newSeatQuantity,
              },
              'Seat quantity changed in Stripe, syncing to database'
            );

            const newAdditionalCost = calcSeatCost(
              newSeatQuantity,
              config.seatPricing.additionalSeatPriceCents
            );
            const priceDifference = new Decimal(newAdditionalCost)
              .minus(subscription.additionalSeatsCost ?? 0)
              .toNumber();

            updateData.additionalSeatsCount = newSeatQuantity;
            updateData.additionalSeatsCost = newAdditionalCost;
            updateData.totalMonthlyPrice = new Decimal(subscription.totalMonthlyPrice ?? 0)
              .plus(priceDifference)
              .toNumber();

            if (seatItem.id && !subscription.billing?.seatItemId) {
              updateData['billing.seatItemId'] = seatItem.id;
            }
          }
        } else if (subscription.additionalSeatsCount > 0) {
          this.log.warn(
            {
              stripeSubscriptionId,
              dbSeatCount: subscription.additionalSeatsCount,
            },
            'Seat item not found in webhook items but DB has seats, syncing to zero'
          );

          updateData.additionalSeatsCount = 0;
          updateData.additionalSeatsCost = 0;
          updateData.totalMonthlyPrice = new Decimal(subscription.totalMonthlyPrice ?? 0)
            .minus(subscription.additionalSeatsCost ?? 0)
            .toNumber();
        }
      }

      const updatedSubscription = await this.subscriptionDAO.update(
        { _id: subscription._id },
        { $set: updateData }
      );

      if (!updatedSubscription) {
        throw new BadRequestError({ message: 'Failed to update subscription' });
      }

      // Toggle payouts based on new subscription status
      if (updateData.status) {
        await this.syncPayoutSchedule(updatedSubscription.cuid, updateData.status);
      }

      this.log.info(
        {
          subscriptionId: subscription._id,
          stripeSubscriptionId,
          newStatus: status,
          seatsUpdated: updateData.additionalSeatsCount !== undefined,
        },
        'Subscription updated from Stripe'
      );

      // Invalidate billing history cache
      try {
        const billingCacheKey = `billing_history:${updatedSubscription.cuid}`;
        await this.authCache.client.DEL(billingCacheKey);
      } catch (error) {
        this.log.warn({ error }, 'Failed to invalidate billing history cache');
      }

      // Notify user with appropriate message
      const notificationMessage =
        updateData.additionalSeatsCount !== undefined
          ? `Your subscription has been updated. Seats: ${updateData.additionalSeatsCount}`
          : `Your subscription status has been updated to ${status}`;

      await this.notifyAccountAdminViaSSE(updatedSubscription.cuid, {
        type:
          wasFirstActivation && status === 'active'
            ? 'subscription_activated'
            : 'subscription_updated',
        subscription: {
          plan: updatedSubscription.planName,
          status: updatedSubscription.status,
          endDate: updatedSubscription.endDate,
          additionalSeats: updatedSubscription.additionalSeatsCount,
          totalMonthlyCost: updatedSubscription.totalMonthlyPrice,
        },
        message: notificationMessage,
      });

      return { data: updatedSubscription, success: true };
    } catch (error) {
      this.log.error({ error, data }, 'Error handling subscription update');
      throw error;
    }
  }

  async handleSubscriptionCanceled(data: {
    stripeSubscriptionId: string;
    canceledAt: number;
  }): IPromiseReturnedData<ISubscriptionDocument> {
    const session = await this.subscriptionDAO.startSession();

    try {
      const result = await this.subscriptionDAO.withTransaction(session, async (cxtsession) => {
        const { stripeSubscriptionId, canceledAt } = data;

        const subscription = await this.subscriptionDAO.findFirst(
          { 'billing.subscriberId': stripeSubscriptionId },
          undefined,
          undefined,
          cxtsession
        );

        if (!subscription) {
          this.log.error({ stripeSubscriptionId }, 'Subscription not found for cancellation');
          throw new BadRequestError({ message: 'Subscription not found' });
        }

        const updatedSubscription = await this.subscriptionDAO.update(
          { _id: subscription._id },
          {
            $set: {
              status: ISubscriptionStatus.INACTIVE,
              canceledAt: new Date(canceledAt * 1000),
            },
          },
          undefined,
          cxtsession
        );

        if (!updatedSubscription) {
          throw new BadRequestError({ message: 'Failed to update subscription' });
        }

        this.log.info(
          {
            subscriptionId: subscription._id,
            stripeSubscriptionId,
            canceledAt: new Date(canceledAt * 1000),
          },
          'Subscription canceled'
        );

        return updatedSubscription;
      });

      await this.notifyAccountAdminViaSSE(result.cuid, {
        type: 'subscription_canceled',
        subscription: {
          plan: result.planName,
          status: result.status,
          endDate: result.endDate,
        },
        message: 'Your subscription has been canceled',
      });

      return { data: result, success: true };
    } catch (error) {
      this.log.error({ error, data }, 'Error handling subscription cancellation');
      throw error;
    }
  }

  /**
   * Notifies account admin about subscription changes via SSE
   * Only the super-admin (accountAdmin) receives billing notifications for privacy
   * Invalidates only the account admin's cache to force fresh data fetch
   */
  private async notifyAccountAdminViaSSE(
    cuid: string,
    eventData: {
      type:
        | 'subscription_activated'
        | 'subscription_renewed'
        | 'payment_failed'
        | 'subscription_canceled'
        | 'subscription_updated'
        | 'subscription_expired'
        | 'seats_purchased';
      subscription: {
        plan: string;
        status?: string;
        endDate?: Date;
        additionalSeats?: number;
        totalMonthlyCost?: number;
      };
      message: string;
    }
  ): Promise<void> {
    try {
      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        this.log.warn({ cuid }, 'Client not found for SSE notification');
        return;
      }

      if (!client.accountAdmin) {
        this.log.warn({ cuid }, 'No account admin found for client');
        return;
      }

      const accountAdminId = client.accountAdmin.toString();
      const cacheResult = await this.authCache.invalidateCurrentUser(accountAdminId, cuid);
      if (!cacheResult.success) {
        this.log.error(
          { userId: accountAdminId, error: cacheResult.error },
          'Failed to invalidate account admin cache'
        );
      }

      const notificationPayload = {
        action: 'REFETCH_CURRENT_USER',
        eventType: eventData.type,
        subscription: {
          plan: eventData.subscription.plan,
          status: eventData.subscription.status,
          endDate: eventData.subscription.endDate?.toISOString(),
        },
        message: eventData.message,
        timestamp: new Date().toISOString(),
      };

      const sent = await this.sseService.sendToUser(
        accountAdminId,
        cuid,
        { ...notificationPayload, resource: 'subscription' },
        'resource-event'
      );

      if (sent) {
        this.log.info(
          { cuid, accountAdminId, eventType: eventData.type },
          'SSE notification sent to account admin'
        );
      } else {
        this.log.debug(
          { cuid, accountAdminId },
          'Account admin not connected to SSE, cache invalidated'
        );
      }
    } catch (error) {
      this.log.error({ error, cuid }, 'Error sending SSE notification to account admin');
      // Don't throw - notification failure shouldn't break webhook processing
    }
  }

  /**
   * Sync payout schedule based on subscription status changes
   */
  private async syncPayoutSchedule(cuid: string, newStatus: ISubscriptionStatus): Promise<void> {
    try {
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor?.accountId) return;

      if (
        newStatus === ISubscriptionStatus.INACTIVE ||
        newStatus === ISubscriptionStatus.PAST_DUE
      ) {
        if (paymentProcessor.payoutsPaused) return; // already paused

        await this.paymentGatewayService.updatePayoutSchedule(
          IPaymentGatewayProvider.STRIPE,
          paymentProcessor.accountId,
          'manual'
        );
        await this.paymentProcessorDAO.update(
          { cuid },
          {
            $set: {
              payoutsPaused: true,
              payoutsPausedReason: `Subscription ${newStatus}`,
              payoutsPausedAt: new Date(),
            },
          }
        );
        this.log.info({ cuid, newStatus }, 'Payouts paused — subscription not active');
      } else if (newStatus === ISubscriptionStatus.ACTIVE && paymentProcessor.payoutsPaused) {
        await this.paymentGatewayService.updatePayoutSchedule(
          IPaymentGatewayProvider.STRIPE,
          paymentProcessor.accountId,
          'weekly',
          'monday'
        );
        await this.paymentProcessorDAO.update(
          { cuid },
          {
            $set: { payoutsPaused: false },
            $unset: { payoutsPausedReason: '', payoutsPausedAt: '' },
          }
        );
        this.log.info({ cuid }, 'Payouts resumed — subscription reactivated');
      }
    } catch (error) {
      this.log.error({ error, cuid, newStatus }, 'Failed to sync payout schedule — non-blocking');
    }
  }

  /**
   * Resolves the account admin user ID for a given cuid
   */
  private async getAccountAdminId(cuid: string): Promise<string | null> {
    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client?.accountAdmin) return null;

    return client.accountAdmin._id
      ? client.accountAdmin._id.toString()
      : client.accountAdmin.toString();
  }

  /**
   * Extracts the Stripe subscription ID from an invoice event payload.
   * Handles both older API versions (string) and newer versions (expanded object).
   */
  private extractSubscriptionId(rawInvoice: any): string | undefined {
    const rawSub = rawInvoice.subscription ?? rawInvoice.parent?.subscription_details?.subscription;
    if (!rawSub) return undefined;
    return typeof rawSub === 'string' ? rawSub : rawSub?.id;
  }
}
