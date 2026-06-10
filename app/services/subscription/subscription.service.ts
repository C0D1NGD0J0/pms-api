import dayjs from 'dayjs';
import Decimal from 'decimal.js';
import { UserDAO } from '@dao/userDAO';
import { ClientSession } from 'mongodb';
import { AuthCache } from '@caching/index';
import { ClientDAO } from '@dao/clientDAO';
import { Subscription } from '@models/index';
import { PropertyDAO } from '@dao/propertyDAO';
import { MoneyUtils } from '@utils/money.utils';
import { EmailQueue } from '@queues/email.queue';
import { createLogger, msToDays } from '@utils/index';
import { SSEService } from '@services/sse/sse.service';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { EventEmitterService } from '@services/eventEmitter';
import { PaymentProcessorDAO } from '@dao/paymentProcessorDAO';
import { PaymentGatewayService } from '@services/paymentGateway';
import { calcAnnualToMonthly, calcSeatCost } from '@utils/financial.utils';
import { InternalServerError, BadRequestError } from '@shared/customErrors';
import {
  ISubscriptionEntitlements,
  ISubscriptionPlanResponse,
  IPaymentGatewayProvider,
  ISubscriptionPlanUsage,
  ISubscriptionDocument,
  IPromiseReturnedData,
  ISubscriptionStatus,
  IRequestContext,
  ISubscription,
  EventTypes,
  PlanName,
} from '@interfaces/index';

import { subscriptionPlanConfig } from './subscription_plans.config';
import { SubscriptionWebhookService } from './subscriptionWebhook.service';

interface IConstructor {
  subscriptionWebhookService: SubscriptionWebhookService;
  paymentGatewayService: PaymentGatewayService;
  paymentProcessorDAO: PaymentProcessorDAO;
  emitterService: EventEmitterService;
  subscriptionDAO: SubscriptionDAO;
  propertyUnitDAO: PropertyUnitDAO;
  propertyDAO: PropertyDAO;
  sseService: SSEService;
  emailQueue: EmailQueue;
  clientDAO: ClientDAO;
  authCache: AuthCache;
  userDAO: UserDAO;
}

export class SubscriptionService {
  private userDAO: UserDAO;
  private clientDAO: ClientDAO;
  private authCache: AuthCache;
  private sseService: SSEService;
  private emailQueue: EmailQueue;
  private emitterService: EventEmitterService;
  private log: ReturnType<typeof createLogger>;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly paymentProcessorDAO: PaymentProcessorDAO;
  private readonly paymentGatewayService: PaymentGatewayService;
  private readonly subscriptionWebhookService: SubscriptionWebhookService;

  constructor({
    userDAO,
    clientDAO,
    authCache,
    sseService,
    emailQueue,
    emitterService,
    subscriptionDAO,
    propertyDAO,
    propertyUnitDAO,
    paymentProcessorDAO,
    paymentGatewayService,
    subscriptionWebhookService,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.clientDAO = clientDAO;
    this.authCache = authCache;
    this.sseService = sseService;
    this.emailQueue = emailQueue;
    this.emitterService = emitterService;
    this.subscriptionDAO = subscriptionDAO;
    this.propertyDAO = propertyDAO;
    this.propertyUnitDAO = propertyUnitDAO;
    this.paymentProcessorDAO = paymentProcessorDAO;
    this.paymentGatewayService = paymentGatewayService;
    this.subscriptionWebhookService = subscriptionWebhookService;
    this.log = createLogger('SubscriptionService');
    this.setupEventListeners();
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

  async getSubscriptionPlans(): IPromiseReturnedData<ISubscriptionPlanResponse[]> {
    const STRIPE_PLANS_CACHE_KEY = 'subscription:stripe:plans';
    const STRIPE_PLANS_CACHE_TTL = 60 * 60; // 1 hour

    let stripePriceMap: Map<
      string,
      {
        monthly: { priceId: string; amount: number; lookUpKey: string | null };
        annual: { priceId: string; amount: number; lookUpKey: string | null };
      }
    > = new Map();

    try {
      const cached = await this.authCache.client.GET(STRIPE_PLANS_CACHE_KEY);
      if (cached) {
        stripePriceMap = new Map(JSON.parse(cached));
        this.log.info('Returning cached Stripe products');
      } else {
        stripePriceMap = await this.paymentGatewayService.getProductsWithPrices(
          IPaymentGatewayProvider.STRIPE
        );
        await this.authCache.client.SETEX(
          STRIPE_PLANS_CACHE_KEY,
          STRIPE_PLANS_CACHE_TTL,
          JSON.stringify(Array.from(stripePriceMap.entries()))
        );
      }
    } catch (error) {
      this.log.error({ error }, 'Error fetching plans from payment gateway');
      this.log.warn('Falling back to config prices');
    }

    const plans = subscriptionPlanConfig.getAllPlans().map((planName) => {
      const config = subscriptionPlanConfig.getConfig(planName);
      const stripeData = stripePriceMap.get(config.name.toLowerCase());
      const completeFeatures = subscriptionPlanConfig.getCompleteFeatureList(planName);

      const monthlyPriceInCents = stripeData?.monthly.amount ?? config.pricing.monthly.priceInCents;
      const annualPriceInCents = stripeData?.annual.amount ?? config.pricing.annual.priceInCents;

      return {
        planName: config.planName,
        name: config.name,
        description: config.description,
        trialDays: config.trialDays,
        ctaText: config.ctaText,
        isFeatured: config.isFeatured,
        featuredBadge: config.featuredBadge,
        displayOrder: config.displayOrder,
        transactionFeePercent: config.transactionFeePercent,
        achPercentRate: subscriptionPlanConfig.getAchPercentRate(),
        isCustomPricing: config.isCustomPricing,
        seatPricing: config.seatPricing,
        limits: config.limits,
        featureList: completeFeatures.enabled,
        disabledFeatures: completeFeatures.disabled,
        pricing: {
          monthly: {
            priceId: stripeData?.monthly.priceId || config.pricing.monthly.priceId,
            priceInCents: monthlyPriceInCents,
            displayPrice: this.formatPrice(monthlyPriceInCents || 0),
            lookUpKey: stripeData?.monthly.lookUpKey || null,
          },
          annual: {
            priceId: stripeData?.annual.priceId || config.pricing.annual.priceId,
            priceInCents: annualPriceInCents,
            displayPrice: this.formatPrice(annualPriceInCents || 0),
            savingsPercent: config.pricing.annual.savingsPercent,
            savingsDisplay: `Save ${config.pricing.annual.savingsPercent}%`,
            lookUpKey: stripeData?.annual.lookUpKey || null,
          },
        },
      };
    });

    return {
      data: plans,
      success: true,
    };
  }

  async createSubscription(
    clientId: string,
    data: Partial<
      {
        planLookUpKey?: string;
        planId?: string;
        billingInterval?: 'monthly' | 'annual';
      } & ISubscription
    >,
    session?: ClientSession
  ): IPromiseReturnedData<ISubscriptionDocument | null> {
    try {
      const { planName, planId, planLookUpKey, billingInterval = 'monthly' } = data;
      const isPaidPlan = planName !== 'essential';

      if (!planName || !planId) {
        throw new BadRequestError({ message: 'Missing required subscription data' });
      }

      const client = await this.clientDAO.findById(clientId, session as any);
      if (!client) {
        throw new BadRequestError({ message: 'Client not found for subscription' });
      }

      const config = subscriptionPlanConfig.getConfig(planName as PlanName);
      let actualBilledAmount: number = config.pricing[billingInterval].priceInCents;
      if (planName !== 'essential') {
        try {
          const stripePrice = await this.paymentGatewayService.getProductPrice(
            IPaymentGatewayProvider.STRIPE,
            planId
          );
          actualBilledAmount = stripePrice.unit_amount || 0;
        } catch (error) {
          this.log.warn(
            { error, planId },
            'Failed to fetch price from payment gateway, using config fallback'
          );
        }
      }

      const monthlyEquivalent =
        billingInterval === 'annual' ? calcAnnualToMonthly(actualBilledAmount) : actualBilledAmount;

      const status = isPaidPlan ? ISubscriptionStatus.PENDING_PAYMENT : ISubscriptionStatus.ACTIVE;
      const pendingDowngradeAt = isPaidPlan ? dayjs().add(48, 'hour').toDate() : undefined;
      const totalMonthlyPrice = monthlyEquivalent;

      const subscriptionData = {
        client: client._id,
        cuid: client.cuid,
        planName,
        status,
        startDate: new Date(),
        endDate: undefined,
        billingInterval,
        entitlements: config.features,
        billing: {
          customerId: 'none', // placeholder; will be updated when a Stripe customer is created
          provider: isPaidPlan ? IPaymentGatewayProvider.STRIPE : IPaymentGatewayProvider.NONE,
          planId: planId || 'none',
          planLookUpKey: planLookUpKey,
        },
        totalMonthlyPrice,
        currentSeats: config.seatPricing.includedSeats,
        pendingDowngradeAt,
      };

      const subscription = await this.subscriptionDAO.insert(subscriptionData, session as any);

      return { data: subscription, success: true };
    } catch (error) {
      this.log.error({ error, data }, 'Error creating subscription');
      return { success: false, message: error.message, data: null };
    }
  }

  private async createCheckoutSession(data: {
    subscriptionId: string;
    email: string;
    name?: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
  }): IPromiseReturnedData<{ sessionId: string; checkoutUrl: string }> {
    const session = await this.subscriptionDAO.startSession();

    try {
      const result = await this.subscriptionDAO.withTransaction(session, async (cxtsession) => {
        const { subscriptionId, email, priceId, successUrl, cancelUrl } = data;

        if (!this.paymentGatewayService) {
          this.log.error('Payment gateway service not initialized');
          throw new InternalServerError({ message: 'Internal system error' });
        }

        const subscription = await this.subscriptionDAO.findById(subscriptionId, cxtsession);
        if (!subscription) {
          throw new BadRequestError({ message: 'Client subscription not found' });
        }

        const clientId = subscription.client.toString();
        const client = await this.clientDAO.findById(clientId, cxtsession);
        if (!client) {
          throw new BadRequestError({ message: 'Client not found' });
        }

        let customerName: string | undefined;
        if (client.accountType.category === 'business' && client.companyProfile?.legalEntityName) {
          customerName = client.companyProfile.legalEntityName;
        } else if (client.displayName) {
          customerName = client.displayName;
        } else if (data.name) {
          customerName = data.name;
        }

        let customerId = subscription.billing?.customerId;
        const hasValidCustomer = customerId && customerId !== 'none' && customerId !== '';

        if (!hasValidCustomer) {
          const customerResult = await this.paymentGatewayService.createCustomer({
            provider: IPaymentGatewayProvider.STRIPE,
            email,
            name: customerName,
            metadata: {
              clientId,
              subscriptionId,
              planName: subscription.planName,
            },
          });

          if (!customerResult.success || !customerResult.data) {
            throw new BadRequestError({
              message: customerResult.message || 'Failed to create customer',
            });
          }

          customerId = customerResult.data.customerId;

          await this.subscriptionDAO.update(
            { _id: subscription._id },
            {
              $set: {
                'billing.customerId': customerId,
                'billing.subscriberId': undefined,
                'billing.planId': priceId,
              },
            },
            undefined,
            cxtsession
          );
        }

        const sessionResult = await this.paymentGatewayService.createCheckoutSession({
          provider: IPaymentGatewayProvider.STRIPE,
          customerId,
          priceId,
          successUrl,
          cancelUrl,
          metadata: {
            subscriptionId,
            clientId,
            planName: subscription.planName,
          },
        });

        if (!sessionResult.success || !sessionResult.data) {
          throw new BadRequestError({
            message: sessionResult.message || 'Failed to create checkout session',
          });
        }

        const checkoutSession = sessionResult.data;
        return {
          sessionId: checkoutSession.sessionId,
          checkoutUrl: checkoutSession.redirectUrl,
        };
      });

      return { data: result, success: true };
    } catch (error) {
      this.log.error({ error, data }, 'Error creating checkout session');
      throw error;
    }
  }

  async cancelSubscription(ctx: IRequestContext): IPromiseReturnedData<ISubscriptionDocument> {
    const session = await this.subscriptionDAO.startSession();

    try {
      const result = await this.subscriptionDAO.withTransaction(session, async (cxtsession) => {
        const { currentuser } = ctx;
        const cuid = currentuser!.client.cuid;

        const subscription = await this.subscriptionDAO.findFirst(
          { cuid },
          undefined,
          undefined,
          cxtsession
        );
        if (!subscription) {
          throw new BadRequestError({ message: 'Subscription not found' });
        }

        if (subscription.status === ISubscriptionStatus.INACTIVE && subscription.canceledAt) {
          throw new BadRequestError({ message: 'Subscription already canceled' });
        }

        const isPaidSubscription =
          subscription.billing?.subscriberId && subscription.planName !== 'essential';

        if (isPaidSubscription) {
          this.log.info(
            { cuid, stripeSubscriptionId: subscription.billing.subscriberId },
            'Scheduling Stripe subscription cancellation at period end'
          );

          const cancelResult = await this.paymentGatewayService.cancelSubscription(
            IPaymentGatewayProvider.STRIPE,
            subscription.billing.subscriberId!
          );

          if (!cancelResult.success) {
            throw new BadRequestError({
              message: cancelResult.message || 'Failed to cancel subscription in payment gateway',
            });
          }

          const updatedSubscription = await this.subscriptionDAO.update(
            { _id: subscription._id },
            {
              $set: {
                canceledAt: new Date(),
              },
            },
            undefined,
            cxtsession
          );

          if (!updatedSubscription) {
            throw new BadRequestError({ message: 'Failed to update subscription' });
          }

          return updatedSubscription;
        } else {
          this.log.info({ cuid, planName: subscription.planName }, 'Canceling free subscription');

          // For free subscriptions: Mark inactive immediately (no billing period)
          const updatedSubscription = await this.subscriptionDAO.update(
            { _id: subscription._id },
            {
              $set: {
                status: ISubscriptionStatus.INACTIVE,
                canceledAt: new Date(),
              },
            },
            undefined,
            cxtsession
          );

          if (!updatedSubscription) {
            throw new BadRequestError({ message: 'Failed to cancel subscription' });
          }

          await this.syncPayoutSchedule(cuid, ISubscriptionStatus.INACTIVE);

          return updatedSubscription;
        }
      });

      // Notify account admin with appropriate message
      const isPaid = result.billing?.subscriberId && result.planName !== 'essential';
      const message = isPaid
        ? `Your subscription will cancel at the end of your billing period (${result.endDate?.toLocaleDateString()}). You'll retain access until then.`
        : 'Your subscription has been canceled successfully';

      await this.notifyAccountAdminViaSSE(result.cuid, {
        type: 'subscription_canceled',
        subscription: {
          plan: result.planName,
          status: result.status,
          endDate: result.endDate,
        },
        message,
      });

      return { data: result, success: true, message: 'Subscription canceled successfully' };
    } catch (error) {
      this.log.error({ error }, 'Error canceling subscription');
      throw error;
    }
  }

  async getSubscriptionEntitlements(
    cuid: string,
    userRole?: string
  ): IPromiseReturnedData<ISubscriptionEntitlements | null> {
    try {
      const subscription = await this.subscriptionDAO.findFirst({
        cuid,
      });

      if (!subscription) {
        this.log.warn({ cuid }, 'No subscription record found for client — entitlements not set');
        return { success: true, data: null };
      }

      const config = subscriptionPlanConfig.getConfig(subscription.planName);
      const now = new Date();
      let requiresPayment = false;
      let reason: 'pending_signup' | 'expired' | 'grace_period' | 'past_due' | null = null;
      let gracePeriodEndsAt: Date | null = null;
      let daysUntilDowngrade: number | null = null;

      const isSuperAdmin = userRole === 'super-admin';

      if (isSuperAdmin && subscription.status === ISubscriptionStatus.PENDING_PAYMENT) {
        requiresPayment = true;
        reason = 'pending_signup';
        gracePeriodEndsAt = subscription.pendingDowngradeAt || null;

        if (subscription.pendingDowngradeAt) {
          const msUntilDowngrade = subscription.pendingDowngradeAt.getTime() - now.getTime();
          daysUntilDowngrade = msToDays(msUntilDowngrade);

          if (daysUntilDowngrade <= 1) {
            reason = 'grace_period';
          }
        }
      }

      if (isSuperAdmin && subscription.status === ISubscriptionStatus.PAST_DUE) {
        requiresPayment = true;
        reason = 'past_due';
        gracePeriodEndsAt = subscription.pendingDowngradeAt || null;

        if (subscription.pendingDowngradeAt) {
          const msUntilDowngrade = subscription.pendingDowngradeAt.getTime() - now.getTime();
          daysUntilDowngrade = msToDays(msUntilDowngrade);
        }
      }

      if (
        isSuperAdmin &&
        subscription.status === ISubscriptionStatus.ACTIVE &&
        subscription.endDate &&
        subscription.endDate < now &&
        subscription.planName !== 'essential'
      ) {
        requiresPayment = true;
        reason = 'expired';
      }

      const entitlements: ISubscriptionEntitlements = {
        plan: {
          name: subscription.planName,
          status: subscription.status,
          billingInterval: subscription.billingInterval,
        },
        entitlements: config.features,
        ...(requiresPayment && {
          paymentFlow: {
            requiresPayment,
            reason,
            gracePeriodEndsAt,
            daysUntilDowngrade,
          },
        }),
      };

      return { data: entitlements, success: true };
    } catch (error) {
      this.log.error({ error }, 'Error getting subscription access control');
      return { data: null, success: false, error: error.message };
    }
  }

  private async syncUsageCounters(
    subscription: ISubscriptionDocument,
    cuid: string
  ): Promise<void> {
    const [actualProperties, actualUnits, actualEmployees] = await Promise.all([
      this.propertyDAO.countDocuments({ cuid, deletedAt: null }),
      this.propertyUnitDAO.countDocuments({ cuid, deletedAt: null }),
      this.userDAO.list({
        'cuids.cuid': cuid,
        'cuids.isConnected': true,
        'cuids.roles': { $in: ['super-admin', 'admin', 'manager', 'staff'] },
        deletedAt: null,
      }),
    ]);

    const actualSeats = actualEmployees.items?.length || 0;

    const drift = {
      properties: actualProperties !== subscription.currentProperties,
      units: actualUnits !== subscription.currentUnits,
      seats: actualSeats !== subscription.currentSeats,
    };

    if (drift.properties || drift.units || drift.seats) {
      this.log.warn(
        {
          cuid,
          stored: {
            properties: subscription.currentProperties,
            units: subscription.currentUnits,
            seats: subscription.currentSeats,
          },
          actual: { properties: actualProperties, units: actualUnits, seats: actualSeats },
        },
        'Usage counters out of sync — auto-correcting'
      );

      const $set: Record<string, number> = {};
      if (drift.properties) $set.currentProperties = actualProperties;
      if (drift.units) $set.currentUnits = actualUnits;
      if (drift.seats) $set.currentSeats = actualSeats;

      await this.subscriptionDAO.update({ _id: subscription._id }, { $set });

      subscription.currentProperties = actualProperties;
      subscription.currentUnits = actualUnits;
      subscription.currentSeats = actualSeats;

      // Bust the currentUser cache so the frontend picks up corrected counters
      await this.notifyAccountAdminViaSSE(cuid, {
        type: 'subscription_updated',
        subscription: { plan: subscription.planName, status: subscription.status },
        message: 'Subscription usage counters updated',
      });
    }
  }

  async getSubscriptionPlanUsage(
    ctx: IRequestContext
  ): IPromiseReturnedData<ISubscriptionPlanUsage | null> {
    try {
      const cuid = ctx.request.params.cuid;
      const subscription = await this.subscriptionDAO.findFirst({
        cuid,
      });
      if (!subscription) {
        this.log.warn({ cuid }, 'No subscription record found for client — returning null usage');
        return { success: true, data: null };
      }

      await this.syncUsageCounters(subscription, cuid);

      // Fetch client for verification status
      const client = await this.clientDAO.findFirst({ cuid });
      if (!client) {
        throw new BadRequestError({ message: 'Client not found' });
      }

      // Calculate verification status and grace period
      const daysSinceCreation = Math.floor(
        (Date.now() - new Date(client.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      );
      const gracePeriodExpired = !client.isVerified && daysSinceCreation > 5;
      const daysRemaining = client.isVerified ? null : Math.max(0, 5 - daysSinceCreation);

      const config = subscriptionPlanConfig.getConfig(subscription.planName);
      const maxAllowedSeats = config.seatPricing.includedSeats + subscription.additionalSeatsCount;
      const isLimitReached = {
        properties: subscription.currentProperties >= config.limits.maxProperties,
        units: subscription.currentUnits >= config.limits.maxUnits,
        seats: subscription.currentSeats >= maxAllowedSeats,
      };

      const planUsage: ISubscriptionPlanUsage = {
        plan: {
          name: subscription.planName,
          status: subscription.status,
          billingInterval: subscription.billingInterval,
          startDate: subscription?.startDate,
          endDate: subscription?.endDate || null,
        },
        limits: {
          properties: config.limits.maxProperties,
          units: config.limits.maxUnits,
          seats: maxAllowedSeats,
        },
        usage: {
          properties: subscription.currentProperties,
          units: subscription.currentUnits,
          seats: subscription.currentSeats,
        },
        isLimitReached,
        seatInfo: {
          includedSeats: config.seatPricing.includedSeats,
          additionalSeats: subscription.additionalSeatsCount,
          totalAllowed: maxAllowedSeats,
          maxAdditionalSeats: config.seatPricing.maxAdditionalSeats,
          additionalSeatPriceCents: config.seatPricing.additionalSeatPriceCents,
          availableForPurchase:
            config.seatPricing.maxAdditionalSeats - subscription.additionalSeatsCount,
        },
        verification: {
          isVerified: client.isVerified,
          requiresVerification: !client.isVerified,
          gracePeriodExpired,
          daysRemaining,
          accountCreatedAt: client.createdAt,
        },
        manualRecords: (() => {
          const count = subscription.manualRecords?.countThisPeriod ?? 0;
          const quota = subscriptionPlanConfig.getManualRecordQuota(subscription.planName);
          const feeCents = subscriptionPlanConfig.getManualRecordOverageFeeCents();
          const overageCount = Math.max(0, count - quota);
          return {
            countThisPeriod: count,
            quota,
            remaining: Math.max(0, quota - count),
            overageFeeCents: feeCents,
            overageCount,
            projectedOverageCents: overageCount * feeCents,
          };
        })(),
      };

      return { data: planUsage, success: true };
    } catch (error) {
      this.log.error({ error }, 'Error getting subscription plan usage');
      throw error;
    }
  }

  async getBillingHistory(cuid: string): Promise<any[]> {
    const cacheKey = `billing_history:${cuid}`;

    try {
      const cached = await this.authCache.client.GET(cacheKey);
      if (cached) {
        this.log.info({ cuid }, 'Returning cached billing history');
        return JSON.parse(cached);
      }

      const subscription = await this.subscriptionDAO.findFirst({ cuid });
      if (!subscription?.billing?.customerId || subscription.planName === 'essential') {
        return [];
      }

      const result = await this.paymentGatewayService.getInvoices(
        IPaymentGatewayProvider.STRIPE,
        subscription.billing.customerId,
        12
      );

      if (!result.success || !result.data) {
        return [];
      }

      const billingHistory = result.data.map((inv) => ({
        invoiceId: inv.id,
        number: inv.number,
        amountPaid: MoneyUtils.fromCents(inv.amount_paid),
        currency: inv.currency.toUpperCase(),
        paidAt: inv.status_transitions?.paid_at
          ? new Date(inv.status_transitions.paid_at * 1000)
          : null,
        period: {
          start: new Date(inv.period_start * 1000),
          end: new Date(inv.period_end * 1000),
        },
        pdfUrl: inv.invoice_pdf,
        hostedUrl: inv.hosted_invoice_url,
      }));

      // Cache for 2 hours
      await this.authCache.client.SETEX(cacheKey, 7200, JSON.stringify(billingHistory));

      this.log.info({ cuid, count: billingHistory.length }, 'Cached billing history for 2 hours');

      return billingHistory;
    } catch (error) {
      this.log.error({ error, cuid }, 'Error getting billing history');
      return []; // Don't break response on error
    }
  }

  /**
   * Get available seats for a client's subscription
   * Returns how many more seats can be used before hitting limit
   */
  async getAvailableSeats(cuid: string): Promise<{
    availableSeats: number;
    currentSeats: number;
    totalAllowed: number;
    includedSeats: number;
    additionalSeats: number;
    canPurchaseMore: boolean;
    maxAdditionalSeats: number;
  }> {
    const subscription = await this.subscriptionDAO.findFirst({ cuid });
    if (!subscription) {
      throw new BadRequestError({ message: 'Subscription not found' });
    }

    const config = subscriptionPlanConfig.getConfig(subscription.planName);
    const totalAllowed = config.seatPricing.includedSeats + subscription.additionalSeatsCount;
    const availableSeats = totalAllowed - subscription.currentSeats;
    const canPurchaseMore =
      subscription.additionalSeatsCount < config.seatPricing.maxAdditionalSeats;

    return {
      availableSeats: Math.max(0, availableSeats),
      currentSeats: subscription.currentSeats,
      totalAllowed,
      includedSeats: config.seatPricing.includedSeats,
      additionalSeats: subscription.additionalSeatsCount,
      canPurchaseMore,
      maxAdditionalSeats: config.seatPricing.maxAdditionalSeats,
    };
  }

  /**
   * Update additional seat count (purchase or remove)
   * Positive delta = purchase seats, negative delta = remove seats
   *
   * BILLING STRUCTURE:
   * - Purchased seats are PERSISTENT (carry over month-to-month)
   * - additionalSeatsCount is stored in subscription document
   * - additionalSeatsCost and totalMonthlyPrice are updated
   *
   * STRIPE INTEGRATION:
   * - Uses subscription items API (e.g., 'growth_seats', 'portfolio_seats')
   * - First purchase: Creates new subscription item
   * - Subsequent changes: Updates existing subscription item quantity
   * - Delta to zero: Deletes subscription item entirely
   * - Stripe handles automatic proration for current billing cycle
   * - Future renewals automatically include seat costs
   *
   * @param cuid - Client unique identifier
   * @param seatDelta - Number of seats to add (positive) or remove (negative)
   * @returns Updated subscription with new seat count and pricing
   */
  async updateAdditionalSeats(
    cuid: string,
    seatDelta: number
  ): IPromiseReturnedData<ISubscriptionDocument> {
    if (seatDelta === 0) {
      throw new BadRequestError({ message: 'Seat change cannot be zero' });
    }

    const session = await this.subscriptionDAO.startSession();

    try {
      const result = await this.subscriptionDAO.withTransaction(session, async (cxtsession) => {
        const subscription = await this.subscriptionDAO.findFirst(
          { cuid },
          undefined,
          undefined,
          cxtsession
        );
        if (!subscription) {
          throw new BadRequestError({ message: 'Subscription not found' });
        }

        if (subscription.planName === 'essential') {
          throw new BadRequestError({
            message:
              'Cannot manage seats on Essential plan. Please upgrade to Growth or Portfolio.',
          });
        }

        const config = subscriptionPlanConfig.getConfig(subscription.planName);
        const newAdditionalCount = subscription.additionalSeatsCount + seatDelta;

        // Validate new count is within allowed range
        if (newAdditionalCount < 0) {
          throw new BadRequestError({
            message: `Cannot remove ${Math.abs(seatDelta)} seats. You only have ${subscription.additionalSeatsCount} additional seats.`,
          });
        }

        if (newAdditionalCount > config.seatPricing.maxAdditionalSeats) {
          throw new BadRequestError({
            message: `Cannot ${seatDelta > 0 ? 'purchase' : 'have'} ${Math.abs(seatDelta)} seats. Your ${subscription.planName} plan allows a maximum of ${config.seatPricing.maxAdditionalSeats} additional seats. You currently have ${subscription.additionalSeatsCount} additional seats.`,
          });
        }

        // If removing seats, check current usage won't exceed new limit
        if (seatDelta < 0) {
          const maxAllowedAfterRemoval = config.seatPricing.includedSeats + newAdditionalCount;
          if (subscription.currentSeats > maxAllowedAfterRemoval) {
            const needToArchive = subscription.currentSeats - maxAllowedAfterRemoval;
            throw new BadRequestError({
              message: `Cannot remove ${Math.abs(seatDelta)} seats. You currently have ${subscription.currentSeats} active users but would only have ${maxAllowedAfterRemoval} seats allowed. Please archive ${needToArchive} user(s) first.`,
            });
          }
        }

        // Stripe integration - Add, update, or delete subscription item
        let seatItemId: string | undefined = subscription.billing?.seatItemId;

        if (subscription.billing?.subscriberId && subscription.billing.provider === 'stripe') {
          try {
            // Choose correct lookup key based on subscription's billing interval
            const seatLookupKey =
              subscription.billingInterval === 'annual'
                ? config.seatPricing.lookUpKeys?.annual || config.seatPricing.lookUpKey
                : config.seatPricing.lookUpKeys?.monthly || config.seatPricing.lookUpKey;

            // PROACTIVE VALIDATION: Verify billing interval match BEFORE calling payment gateway
            if (newAdditionalCount > 0) {
              const stripePrice = await this.paymentGatewayService.getPriceByLookupKey(
                IPaymentGatewayProvider.STRIPE,
                seatLookupKey
              );

              if (!stripePrice) {
                const intervalName =
                  subscription.billingInterval === 'annual' ? 'annual' : 'monthly';
                throw new BadRequestError({
                  message: `Cannot add seats to your ${intervalName} subscription. The seat price configuration is missing in Stripe. Please contact support to enable seat purchases for ${intervalName} billing.`,
                });
              }

              // Validate interval match
              const priceInterval = stripePrice.recurring?.interval; // 'month' or 'year'
              const subInterval = subscription.billingInterval; // 'monthly' or 'annual'

              const intervalsMatch =
                (priceInterval === 'month' && subInterval === 'monthly') ||
                (priceInterval === 'year' && subInterval === 'annual');

              if (!intervalsMatch) {
                const priceIntervalName = priceInterval === 'month' ? 'monthly' : 'yearly';
                const subIntervalName = subInterval === 'monthly' ? 'monthly' : 'yearly';
                throw new BadRequestError({
                  message: `Cannot add seats to your ${subIntervalName} subscription. The seat price (${seatLookupKey}) is configured for ${priceIntervalName} billing, but your subscription is billed ${subIntervalName}. Please contact support to resolve this billing interval mismatch.`,
                });
              }

              this.log.info(
                { seatLookupKey, priceInterval, subInterval },
                'Billing interval validation passed'
              );
            }

            // Get subscription with items to check if seat item exists
            const stripeSubResult = await this.paymentGatewayService.getSubscriptionWithItems(
              IPaymentGatewayProvider.STRIPE,
              subscription.billing.subscriberId
            );

            if (!stripeSubResult.success || !stripeSubResult.data) {
              throw new InternalServerError({ message: 'Failed to fetch Stripe subscription' });
            }

            const stripeSubscription = stripeSubResult.data;

            // Find existing seat item (check both new and old lookup keys for backward compatibility)
            const seatItem = stripeSubscription.items?.data?.find(
              (item: any) =>
                item.price?.lookup_key === seatLookupKey ||
                item.price?.lookup_key === config.seatPricing.lookUpKey
            );

            if (newAdditionalCount === 0) {
              // Remove all seats - delete subscription item if it exists
              if (seatItem) {
                this.log.info(
                  { itemId: seatItem.id },
                  'Deleting seat item from Stripe (removing all additional seats)'
                );

                const deleteResult = await this.paymentGatewayService.deleteSubscriptionItem(
                  IPaymentGatewayProvider.STRIPE,
                  seatItem.id
                );

                if (!deleteResult.success) {
                  throw new BadRequestError({
                    message: deleteResult.message || 'Failed to delete seat item from Stripe',
                  });
                }

                this.log.info('Seat item deleted from Stripe successfully');
              }
              seatItemId = undefined;
            } else if (!seatItem) {
              this.log.info(
                { cuid, lookupKey: seatLookupKey, quantity: newAdditionalCount },
                'Adding seat subscription item'
              );

              const addResult = await this.paymentGatewayService.addSubscriptionItem(
                IPaymentGatewayProvider.STRIPE,
                subscription.billing.subscriberId,
                seatLookupKey,
                newAdditionalCount
              );

              if (!addResult.success || !addResult.data) {
                throw new BadRequestError({
                  message: addResult.message || 'Failed to add seats to Stripe subscription',
                });
              }

              seatItemId = addResult.data.id;
              this.log.info(
                { seatItemId, quantity: newAdditionalCount },
                'Seat item created in Stripe'
              );
            } else {
              this.log.info(
                {
                  itemId: seatItem.id,
                  oldQuantity: seatItem.quantity,
                  newQuantity: newAdditionalCount,
                },
                'Updating seat item quantity in Stripe'
              );

              const updateResult = await this.paymentGatewayService.updateSubscriptionItemQuantity(
                IPaymentGatewayProvider.STRIPE,
                seatItem.id,
                newAdditionalCount
              );

              if (!updateResult.success) {
                throw new BadRequestError({
                  message: updateResult.message || 'Failed to update seat quantity in Stripe',
                });
              }

              seatItemId = seatItem.id;
              this.log.info(
                { seatItemId, newQuantity: newAdditionalCount },
                'Seat item quantity updated'
              );
            }
          } catch (stripeError) {
            this.log.error(
              { error: stripeError, cuid },
              'Stripe integration failed for seat update'
            );
            // If it's already a BadRequestError with a user-friendly message, rethrow it
            if (stripeError instanceof BadRequestError) {
              throw stripeError;
            }

            // Otherwise, wrap in user-friendly error
            const errorMessage =
              stripeError instanceof Error ? stripeError.message : 'Unknown error';
            throw new BadRequestError({
              message: `Unable to update seats. ${errorMessage}. Please try again or contact support if the issue persists.`,
            });
          }
        }

        // Calculate new pricing — all values in cents to stay consistent with totalMonthlyPrice
        const newAdditionalCost = calcSeatCost(
          newAdditionalCount,
          config.seatPricing.additionalSeatPriceCents
        );
        const monthlyCostChange = calcSeatCost(
          seatDelta,
          config.seatPricing.additionalSeatPriceCents
        );
        const currentMonthlyPrice = subscription.totalMonthlyPrice ?? 0;

        const updateFields: any = {
          $inc: { additionalSeatsCount: seatDelta },
          $set: {
            additionalSeatsCost: newAdditionalCost,
            totalMonthlyPrice: new Decimal(currentMonthlyPrice).plus(monthlyCostChange).toNumber(),
          },
        };

        // Store or clear seat item ID
        if (seatItemId) {
          updateFields.$set['billing.seatItemId'] = seatItemId;
        } else if (newAdditionalCount === 0) {
          updateFields.$unset = { 'billing.seatItemId': '' };
        }

        const updatedSubscription = await this.subscriptionDAO.update(
          { _id: subscription._id },
          updateFields,
          { new: true },
          cxtsession
        );

        if (!updatedSubscription) {
          throw new BadRequestError({ message: 'Failed to update subscription' });
        }

        this.log.info(
          {
            cuid,
            seatDelta,
            newTotal: newAdditionalCount,
            costPerSeat: MoneyUtils.fromCents(config.seatPricing.additionalSeatPriceCents),
            monthlyCostChange,
            seatItemId,
          },
          `Seats ${seatDelta > 0 ? 'purchased' : 'removed'} successfully`
        );

        return updatedSubscription;
      });

      // Send SSE notification
      const action = seatDelta > 0 ? 'purchased' : 'removed';
      await this.notifyAccountAdminViaSSE(result.cuid, {
        type: 'seats_purchased',
        subscription: {
          plan: result.planName,
          additionalSeats: result.additionalSeatsCount,
          totalMonthlyCost: result.totalMonthlyPrice,
        },
        message: `Successfully ${action} ${Math.abs(seatDelta)} seat${Math.abs(seatDelta) > 1 ? 's' : ''}`,
      });

      return { data: result, success: true };
    } catch (error) {
      this.log.error({ error, cuid, seatDelta }, 'Error updating seat count');
      throw error;
    }
  }

  async initSubscriptionPayment(
    ctx: IRequestContext,
    checkoutData: {
      successUrl?: string;
      cancelUrl?: string;
      billingInterval?: 'monthly' | 'annual';
      lookUpKey?: string;
      planName?: string;
      priceId: string;
    }
  ): IPromiseReturnedData<{
    checkoutUrl?: string;
    sessionId?: string;
    message?: string;
    activated?: boolean;
  }> {
    try {
      const { currentuser } = ctx;
      const cuid = currentuser!.client.cuid;

      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        throw new BadRequestError({ message: 'Client not found' });
      }

      let subscription = await this.subscriptionDAO.findFirst({ cuid });
      if (!subscription) {
        // Subscription record missing (e.g. DB was reset). Auto-create it from checkout data.
        if (!checkoutData.planName || !checkoutData.billingInterval) {
          throw new BadRequestError({ message: 'Subscription not found' });
        }

        const createResult = await this.createSubscription(client._id.toString(), {
          planName: checkoutData.planName as PlanName,
          planId: checkoutData.priceId,
          planLookUpKey: checkoutData.lookUpKey,
          billingInterval: checkoutData.billingInterval,
        });
        if (!createResult.success || !createResult.data) {
          throw new BadRequestError({
            message: createResult.message || 'Failed to initialize subscription',
          });
        }
        subscription = createResult.data;
      }

      // Free plan: activate directly without Stripe checkout
      if (checkoutData.planName === 'essential') {
        await this.subscriptionDAO.activateEssentialPlan(subscription._id.toString());
        await this.notifyAccountAdminViaSSE(cuid, {
          type: 'subscription_activated',
          subscription: { plan: 'essential', status: 'active' },
          message: 'Essential plan activated',
        });
        return { data: { activated: true }, success: true };
      }

      const hasActiveStripeSubscription = !!subscription.billing?.subscriberId;
      // INACTIVE subscriptions need a new checkout session (reactivation flow).
      // Treat them the same as PENDING_PAYMENT — redirect through Stripe checkout.
      const isInitialPayment =
        subscription.status === ISubscriptionStatus.PENDING_PAYMENT ||
        subscription.status === ISubscriptionStatus.INACTIVE ||
        !hasActiveStripeSubscription;
      const isUpdate =
        subscription.status === ISubscriptionStatus.ACTIVE && hasActiveStripeSubscription;

      const priceId = checkoutData.priceId || subscription.billing.planId;
      if (!priceId) {
        throw new InternalServerError({ message: 'Plan pricing not configured' });
      }

      if (isInitialPayment) {
        const checkoutResult = await this.createCheckoutSession({
          subscriptionId: subscription._id.toString(),
          email: currentuser!.email,
          name: currentuser!.displayName || currentuser!.fullname || undefined,
          priceId,
          successUrl: checkoutData.successUrl!,
          cancelUrl: checkoutData.cancelUrl!,
        });

        if (!checkoutResult.success || !checkoutResult.data) {
          throw new BadRequestError({
            message: checkoutResult.message || 'Failed to create checkout session',
          });
        }

        return {
          data: checkoutResult.data,
          success: true,
          message: 'Checkout session created successfully',
        };
      }

      if (isUpdate) {
        const stripeSubscriptionId = subscription.billing?.subscriberId;
        if (!stripeSubscriptionId) {
          throw new BadRequestError({ message: 'No active Stripe subscription found' });
        }

        const session = await this.subscriptionDAO.startSession();
        try {
          const result = await this.subscriptionDAO.withTransaction(session, async (cxtsession) => {
            const updateResult = await this.paymentGatewayService.updateSubscription(
              IPaymentGatewayProvider.STRIPE,
              stripeSubscriptionId,
              priceId
            );

            if (!updateResult.success) {
              throw new BadRequestError({
                message: updateResult.message || 'Failed to update subscription in Stripe',
              });
            }

            // Get plan config to update entitlements
            const planConfig = subscriptionPlanConfig.getConfig(subscription.planName);

            // Update local DB (endDate will be updated by Stripe webhook)
            const updatedSubscription = await this.subscriptionDAO.update(
              { _id: subscription._id },
              {
                $set: {
                  billingInterval: checkoutData.billingInterval,
                  entitlements: planConfig.features,
                  'billing.planId': priceId,
                  'billing.planLookUpKey': checkoutData.lookUpKey,
                },
              },
              undefined,
              cxtsession
            );

            if (!updatedSubscription) {
              throw new BadRequestError({ message: 'Failed to update subscription' });
            }

            return updatedSubscription;
          });

          // Invalidate cache
          try {
            const cacheKey = `billing_history:${result.cuid}`;
            await this.authCache.client.DEL(cacheKey);
          } catch (error) {
            this.log.warn({ error }, 'Failed to invalidate billing history cache');
          }

          // Notify
          await this.notifyAccountAdminViaSSE(result.cuid, {
            type: 'subscription_updated',
            subscription: {
              plan: result.planName,
              status: result.status,
              endDate: result.endDate,
            },
            message:
              'Subscription updated. You were charged immediately with credit for unused time.',
          });

          return {
            data: { message: 'Subscription updated successfully' }, // NO checkoutUrl
            success: true,
            message: 'Subscription updated successfully',
          };
        } catch (error) {
          this.log.error({ error }, 'Error updating subscription');
          throw error;
        }
      }

      throw new InternalServerError({ message: 'Unexpected subscription status' });
    } catch (error) {
      this.log.error({ error }, 'Error initiating subscription payment');
      throw error;
    }
  }

  private formatPrice(priceInCents: number): string {
    if (priceInCents === 0) return '$0';
    return `$${MoneyUtils.centsToDisplay(priceInCents)}`;
  }

  // WEBHOOKS — delegated to SubscriptionWebhookService
  async handleSubscriptionCreated(data: {
    stripeSubscriptionId: string;
    stripeCustomerId: string;
  }): Promise<void> {
    return this.subscriptionWebhookService.handleSubscriptionCreated(data);
  }

  async handlePaymentFailed(data: {
    stripeSubscriptionId: string;
    invoiceId: string;
    attemptCount?: number;
  }): IPromiseReturnedData<ISubscriptionDocument> {
    return this.subscriptionWebhookService.handlePaymentFailed(data);
  }

  async handleInvoicePaid(rawInvoice: any): Promise<void> {
    return this.subscriptionWebhookService.handleInvoicePaid(rawInvoice);
  }

  async handleInvoicePaymentFailed(rawInvoice: any): Promise<void> {
    return this.subscriptionWebhookService.handleInvoicePaymentFailed(rawInvoice);
  }

  async handleSubscriptionUpdated(data: {
    stripeSubscriptionId: string;
    stripeCustomerId?: string;
    status: string;
    currentPeriodStart?: number;
    currentPeriodEnd?: number;
    items?: any[];
  }): IPromiseReturnedData<ISubscriptionDocument> {
    return this.subscriptionWebhookService.handleSubscriptionUpdated(data);
  }

  async handleSubscriptionCanceled(data: {
    stripeSubscriptionId: string;
    canceledAt: number;
  }): IPromiseReturnedData<ISubscriptionDocument> {
    return this.subscriptionWebhookService.handleSubscriptionCanceled(data);
  }

  async processExpiredSubscriptions(): Promise<void> {
    try {
      const now = new Date();

      const expiredSubscriptions = await Subscription.find({
        status: ISubscriptionStatus.ACTIVE,
        endDate: { $lt: now },
        planName: { $ne: 'essential' },
      });

      const gracePeriodExpired = await Subscription.find({
        status: ISubscriptionStatus.PAST_DUE,
        pendingDowngradeAt: { $lt: now },
        planName: { $ne: 'essential' },
      });

      const toDeactivate = [...expiredSubscriptions, ...gracePeriodExpired];

      if (toDeactivate.length === 0) {
        this.log.info('No expired or past-due subscriptions found');
        return;
      }

      this.log.info(
        {
          expiredCount: expiredSubscriptions.length,
          gracePeriodExpiredCount: gracePeriodExpired.length,
        },
        'Processing subscriptions to deactivate'
      );

      for (const subscription of toDeactivate) {
        try {
          const isPastDue = subscription.status === ISubscriptionStatus.PAST_DUE;

          await this.subscriptionDAO.update(
            { _id: subscription._id },
            { $set: { status: ISubscriptionStatus.INACTIVE } }
          );

          await this.syncPayoutSchedule(subscription.cuid, ISubscriptionStatus.INACTIVE);

          await this.notifyAccountAdminViaSSE(subscription.cuid, {
            type: isPastDue ? 'subscription_expired' : 'subscription_updated',
            subscription: {
              plan: subscription.planName,
              status: ISubscriptionStatus.INACTIVE,
              endDate: subscription.endDate,
            },
            message: isPastDue
              ? 'Your grace period has ended. Please renew your subscription to restore access.'
              : 'Your subscription has expired. Please renew to continue using premium features.',
          });

          this.log.info(
            { subscriptionId: subscription._id, cuid: subscription.cuid, wasPastDue: isPastDue },
            'Marked subscription as inactive'
          );
        } catch (error) {
          this.log.error(
            { error, subscriptionId: subscription._id },
            'Failed to process expired subscription'
          );
        }
      }
    } catch (error) {
      this.log.error({ error }, 'Error in processExpiredSubscriptions cron job');
      throw error;
    }
  }

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
   * Admin utility: pull live subscription data from Stripe and overwrite endDate
   * (and status) in the DB. Useful when a webhook was missed and the billing date
   * is stale. Returns the updated subscription document.
   */
  async syncFromStripe(cuid: string): IPromiseReturnedData<ISubscriptionDocument> {
    try {
      const subscription = await this.subscriptionDAO.findFirst({ cuid });
      if (!subscription) {
        throw new BadRequestError({ message: 'Subscription not found for this client' });
      }

      const stripeSubscriptionId = subscription.billing?.subscriberId;
      if (!stripeSubscriptionId) {
        throw new BadRequestError({ message: 'No Stripe subscription ID linked to this record' });
      }

      const stripeResult = await this.paymentGatewayService.getSubscriptionWithItems(
        IPaymentGatewayProvider.STRIPE,
        stripeSubscriptionId
      );

      if (!stripeResult.success || !stripeResult.data) {
        throw new BadRequestError({ message: 'Failed to retrieve subscription from Stripe' });
      }

      const stripeSub = stripeResult.data;
      const updateData: Record<string, unknown> = {
        endDate: new Date(stripeSub.current_period_end * 1000),
        startDate: new Date(stripeSub.current_period_start * 1000),
      };

      if (stripeSub.status === 'active') {
        updateData.status = ISubscriptionStatus.ACTIVE;
      }

      const updated = await this.subscriptionDAO.update(
        { _id: subscription._id },
        { $set: updateData }
      );

      if (!updated) {
        throw new BadRequestError({ message: 'DB update failed during Stripe sync' });
      }

      this.log.info(
        { cuid, stripeSubscriptionId, newEndDate: updateData.endDate },
        'Subscription synced from Stripe'
      );

      return { success: true, data: updated };
    } catch (error) {
      this.log.error({ error, cuid }, 'syncFromStripe failed');
      throw error;
    }
  }

  getCronJobs() {
    return [
      {
        name: 'mark-expired-subscriptions',
        schedule: '0 2 * * *', // Daily at 2 AM UTC
        handler: this.processExpiredSubscriptions.bind(this),
        enabled: true,
        service: 'SubscriptionService',
        description: 'Mark subscriptions as inactive when past end date',
        timeout: 300000, // 5 minutes
      },
    ];
  }

  private setupEventListeners(): void {
    this.emitterService.on(EventTypes.UNIT_BATCH_CREATED, (p) => this.handleUnitBatchCreated(p));
    this.emitterService.on(EventTypes.INVITATION_SENT, (p) => this.handleInvitationSent(p));
    this.emitterService.on(EventTypes.INVITATION_ACCEPTED, (p) => this.handleInvitationAccepted(p));
    this.emitterService.on(EventTypes.INVITATION_EXPIRED, (p) => this.handleInvitationExpired(p));
    this.emitterService.on(EventTypes.INVITATION_REVOKED, (p) => this.handleInvitationRevoked(p));
    this.emitterService.on(EventTypes.USER_ARCHIVED, (p) => this.handleUserArchived(p));

    this.log.debug('Subscription service event listeners setup complete');
  }

  /**
   * Handle batch unit creation - increment cumulative unit counter
   * Note: Archived units still count toward limits to prevent gaming
   */
  private async handleUnitBatchCreated(payload: any): Promise<void> {
    try {
      const { cuid, unitsCreated } = payload;
      if (!cuid || unitsCreated === undefined) {
        this.log.warn('Unit batch created event missing required fields', { payload });
        return;
      }

      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        this.log.warn({ cuid }, 'Client not found for unit batch creation event');
        return;
      }

      if (unitsCreated > 0) {
        await this.subscriptionDAO.updateResourceCount('propertyUnit', client._id, unitsCreated);
        this.log.info({ cuid, clientId: client._id, unitsCreated }, 'Unit counter incremented');
      }
    } catch (error) {
      this.log.error({ error, payload }, 'Error handling unit batch created event');
    }
  }

  private isEmployeeRole(role: string): boolean {
    const EMPLOYEE_ROLES = ['super-admin', 'admin', 'manager', 'staff'];
    return EMPLOYEE_ROLES.includes(role);
  }

  /**
   * Handle invitation sent - increment seat counter for employee roles only
   * Validates against total allowed seats (includedSeats + additionalSeatsCount)
   */
  private async handleInvitationSent(payload: any): Promise<void> {
    try {
      const { cuid, role } = payload;
      if (!cuid || !role) return;

      if (!this.isEmployeeRole(role)) {
        this.log.debug({ cuid, role }, 'Skipping seat increment - not an employee role');
        return;
      }

      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) return;

      const subscription = await this.subscriptionDAO.findFirst({ client: client._id });
      if (!subscription) {
        this.log.warn({ cuid }, 'Subscription not found for seat increment');
        return;
      }

      const config = subscriptionPlanConfig.getConfig(subscription.planName);
      const maxAllowedSeats = config.seatPricing.includedSeats + subscription.additionalSeatsCount;

      const result = await this.subscriptionDAO.updateResourceCount(
        'seat',
        client._id,
        1,
        maxAllowedSeats
      );

      if (!result) {
        this.log.error(
          { cuid, currentSeats: subscription.currentSeats, maxAllowedSeats },
          'Seat limit reached - invitation should have been blocked'
        );
        throw new BadRequestError({
          message: `Seat limit reached. Your ${subscription.planName} plan allows ${maxAllowedSeats} seats (${config.seatPricing.includedSeats} included + ${subscription.additionalSeatsCount} additional).`,
        });
      }

      this.log.info({ cuid, role }, 'Seat counter incremented for invitation sent');
    } catch (error) {
      this.log.error({ error, payload }, 'Error handling invitation sent event');
      throw error;
    }
  }

  /**
   * Handle invitation accepted - seat already counted when sent, no action needed
   */
  private async handleInvitationAccepted(payload: any): Promise<void> {
    try {
      const { cuid, role } = payload;
      this.log.debug({ cuid, role }, 'Invitation accepted - seat already counted');
    } catch (error) {
      this.log.error({ error, payload }, 'Error handling invitation accepted event');
    }
  }

  /**
   * Handle invitation expired - decrement seat counter for employee roles
   */
  private async handleInvitationExpired(payload: any): Promise<void> {
    try {
      const { cuid, role } = payload;
      if (!cuid || !role) return;

      if (!this.isEmployeeRole(role)) {
        this.log.debug({ cuid, role }, 'Skipping seat decrement - not an employee role');
        return;
      }

      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) return;

      const result = await this.subscriptionDAO.updateResourceCount('seat', client._id, -1);
      if (!result) {
        this.log.warn(
          { cuid, role },
          'Failed to decrement seat counter - counter may already be at zero'
        );
        return;
      }
      this.log.info({ cuid, role }, 'Seat counter decremented for expired invitation');
    } catch (error) {
      this.log.error({ error, payload }, 'Error handling invitation expired event');
    }
  }

  /**
   * Handle invitation revoked - decrement seat counter for employee roles
   */
  private async handleInvitationRevoked(payload: any): Promise<void> {
    try {
      const { cuid, role } = payload;
      if (!cuid || !role) return;

      if (!this.isEmployeeRole(role)) {
        this.log.debug({ cuid, role }, 'Skipping seat decrement - not an employee role');
        return;
      }

      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) return;

      const result = await this.subscriptionDAO.updateResourceCount('seat', client._id, -1);
      if (!result) {
        this.log.warn(
          { cuid, role },
          'Failed to decrement seat counter - counter may already be at zero'
        );
        return;
      }
      this.log.info({ cuid, role }, 'Seat counter decremented for revoked invitation');
    } catch (error) {
      this.log.error({ error, payload }, 'Error handling invitation revoked event');
    }
  }

  /**
   * Handle user archival - decrement seat counter for employee roles only
   * Frees up seat capacity when employees are removed from the organization
   */
  private async handleUserArchived(payload: any): Promise<void> {
    try {
      const { cuid, roles } = payload;
      if (!cuid || !roles) {
        this.log.warn('User archived event missing required fields', { payload });
        return;
      }

      // Check if user has any employee role
      const hasEmployeeRole = roles.some((role: string) => this.isEmployeeRole(role));
      if (!hasEmployeeRole) {
        this.log.debug({ cuid, roles }, 'Skipping seat decrement - not an employee role');
        return;
      }

      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        this.log.warn({ cuid }, 'Client not found for user archived event');
        return;
      }

      const result = await this.subscriptionDAO.updateResourceCount('seat', client._id, -1);
      if (!result) {
        this.log.warn(
          { cuid, roles },
          'Failed to decrement seat counter - counter may already be at zero'
        );
        return;
      }
      this.log.info({ cuid, roles }, 'Seat counter decremented for archived employee');
    } catch (error) {
      this.log.error({ error, payload }, 'Error handling user archived event');
    }
  }

  cleanupEventListeners(): void {
    this.emitterService.removeAllListeners(EventTypes.UNIT_BATCH_CREATED);
    this.emitterService.removeAllListeners(EventTypes.INVITATION_SENT);
    this.emitterService.removeAllListeners(EventTypes.INVITATION_ACCEPTED);
    this.emitterService.removeAllListeners(EventTypes.INVITATION_EXPIRED);
    this.emitterService.removeAllListeners(EventTypes.INVITATION_REVOKED);
    this.emitterService.removeAllListeners(EventTypes.USER_ARCHIVED);
    this.log.info('Subscription service event listeners removed');
  }
}
