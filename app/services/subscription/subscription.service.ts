import dayjs from 'dayjs';
import { UserDAO } from '@dao/userDAO';
import { ClientSession } from 'mongodb';
import { AuthCache } from '@caching/index';
import { ClientDAO } from '@dao/clientDAO';
import { createLogger } from '@utils/index';
import { Subscription } from '@models/index';
import { StripeService } from '@services/external';
import { SSEService } from '@services/sse/sse.service';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { EventEmitterService } from '@services/eventEmitter';
import { PaymentGatewayService } from '@services/paymentGateway';
import { InternalServerError, UnauthorizedError, BadRequestError } from '@shared/customErrors';
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
  PlanName,
} from '@interfaces/index';

import { subscriptionPlanConfig } from './subscription_plans.config';

interface IConstructor {
  paymentGatewayService: PaymentGatewayService;
  emitterService: EventEmitterService;
  subscriptionDAO: SubscriptionDAO;
  stripeService: StripeService;
  sseService: SSEService;
  clientDAO: ClientDAO;
  authCache: AuthCache;
  userDAO: UserDAO;
}

export class SubscriptionService {
  private userDAO: UserDAO;
  private clientDAO: ClientDAO;
  private authCache: AuthCache;
  private sseService: SSEService;
  private emitterService: EventEmitterService;
  private log: ReturnType<typeof createLogger>;
  private readonly stripeService: StripeService;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly paymentGatewayService: PaymentGatewayService;

  constructor({
    userDAO,
    clientDAO,
    authCache,
    sseService,
    stripeService,
    emitterService,
    subscriptionDAO,
    paymentGatewayService,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.clientDAO = clientDAO;
    this.authCache = authCache;
    this.sseService = sseService;
    this.stripeService = stripeService;
    this.emitterService = emitterService;
    this.subscriptionDAO = subscriptionDAO;
    this.paymentGatewayService = paymentGatewayService;
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
        | 'subscription_updated';
      subscription: {
        plan: string;
        status: string;
        endDate?: Date;
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
      const cacheResult = await this.authCache.invalidateCurrentUser(accountAdminId);
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
        notificationPayload,
        'subscription_update'
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
    let stripePriceMap: Map<
      string,
      {
        monthly: { priceId: string; amount: number; lookUpKey: string | null };
        annual: { priceId: string; amount: number; lookUpKey: string | null };
      }
    > = new Map();

    try {
      stripePriceMap = await this.stripeService.getProductsWithPrices();
    } catch (error) {
      this.log.error({ error }, 'Error fetching plans from Stripe');
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

      const client = await this.clientDAO.findById(clientId);
      if (!client) {
        throw new BadRequestError({ message: 'Client not found for subscription' });
      }

      const config = subscriptionPlanConfig.getConfig(planName as PlanName);
      let actualBilledAmount: number = config.pricing[billingInterval].priceInCents;
      if (planName !== 'essential') {
        try {
          const stripePrice = await this.stripeService.getProductPrice(planId);
          actualBilledAmount = stripePrice.unit_amount || 0;
        } catch (error) {
          this.log.warn({ error, planId }, 'Failed to fetch Stripe price, using config fallback');
        }
      }

      const monthlyEquivalent =
        billingInterval === 'annual' ? Math.round(actualBilledAmount / 12) : actualBilledAmount;

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
        paymentGateway: {
          customerId: isPaidPlan ? '' : 'none', // will be handle via webhook after payment
          provider: isPaidPlan ? IPaymentGatewayProvider.STRIPE : IPaymentGatewayProvider.NONE,
          planId: planId || 'none',
          planLookUpKey: planLookUpKey,
        },
        totalMonthlyPrice,
        currentSeats: config.seatPricing.includedSeats,
        pendingDowngradeAt,
      };

      const subscription = await this.subscriptionDAO.insert(subscriptionData, session);

      return { data: subscription, success: true };
    } catch (error) {
      this.log.error({ error, data }, 'Error creating subscription');
      return { success: false, message: error.message, data: null };
    }
  }

  private async createCheckoutSession(data: {
    subscriptionId: string;
    email: string;
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

        const subscription = await this.subscriptionDAO.findById(subscriptionId);
        if (!subscription) {
          throw new BadRequestError({ message: 'Client subscription not found' });
        }

        const clientId = subscription.client.toString();
        const client = await this.clientDAO.findById(clientId);
        if (!client) {
          throw new BadRequestError({ message: 'Client not found' });
        }

        let customerName: string | undefined;
        if (client.accountType.category === 'business' && client.companyProfile?.legalEntityName) {
          customerName = client.companyProfile.legalEntityName;
        } else if (client.displayName) {
          customerName = client.displayName;
        }

        let customerId = subscription.paymentGateway?.customerId;
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
                'paymentGateway.customerId': customerId,
                'paymentGateway.subscriberId': undefined,
                'paymentGateway.planId': priceId,
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

        const subscription = await this.subscriptionDAO.findFirst({ cuid });
        if (!subscription) {
          throw new BadRequestError({ message: 'Subscription not found' });
        }

        if (subscription.status === ISubscriptionStatus.INACTIVE && subscription.canceledAt) {
          throw new BadRequestError({ message: 'Subscription already canceled' });
        }

        const isPaidSubscription =
          subscription.paymentGateway?.subscriberId && subscription.planName !== 'essential';

        if (isPaidSubscription) {
          this.log.info(
            { cuid, stripeSubscriptionId: subscription.paymentGateway.subscriberId },
            'Scheduling Stripe subscription cancellation at period end'
          );

          const cancelResult = await this.paymentGatewayService.cancelSubscription(
            IPaymentGatewayProvider.STRIPE,
            subscription.paymentGateway.subscriberId!
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

          return updatedSubscription;
        }
      });

      // Notify account admin with appropriate message
      const isPaid = result.paymentGateway?.subscriberId && result.planName !== 'essential';
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
        throw new UnauthorizedError({ message: 'Client subscription not found.' });
      }

      const config = subscriptionPlanConfig.getConfig(subscription.planName);
      const now = new Date();
      let requiresPayment = false;
      let reason: 'pending_signup' | 'expired' | 'grace_period' | null = null;
      let gracePeriodEndsAt: Date | null = null;
      let daysUntilDowngrade: number | null = null;

      const isSuperAdmin = userRole === 'super-admin';

      if (isSuperAdmin && subscription.status === ISubscriptionStatus.PENDING_PAYMENT) {
        requiresPayment = true;
        reason = 'pending_signup';
        gracePeriodEndsAt = subscription.pendingDowngradeAt || null;

        if (subscription.pendingDowngradeAt) {
          const msUntilDowngrade = subscription.pendingDowngradeAt.getTime() - now.getTime();
          daysUntilDowngrade = Math.ceil(msUntilDowngrade / (1000 * 60 * 60 * 24));

          if (daysUntilDowngrade <= 1) {
            reason = 'grace_period';
          }
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
        features: config.features,
        paymentFlow: {
          requiresPayment,
          reason,
          gracePeriodEndsAt,
          daysUntilDowngrade,
        },
      };

      return { data: entitlements, success: true };
    } catch (error) {
      this.log.error({ error }, 'Error getting subscription access control');
      return { data: null, success: false, error: error.message };
    }
  }

  async getSubscriptionPlanUsage(
    ctx: IRequestContext
  ): IPromiseReturnedData<ISubscriptionPlanUsage> {
    try {
      const cuid = ctx.request.params.cuid;
      const subscription = await this.subscriptionDAO.findFirst({
        cuid,
      });
      if (!subscription) {
        throw new BadRequestError({ message: 'Subscription not found for client' });
      }

      const config = subscriptionPlanConfig.getConfig(subscription.planName);
      const isLimitReached = {
        properties: subscription.currentProperties >= config.limits.maxProperties,
        units: subscription.currentUnits >= config.limits.maxUnits,
        seats:
          subscription.currentSeats >=
          config.seatPricing.includedSeats + config.seatPricing.maxAdditionalSeats,
      };

      const planUsage: ISubscriptionPlanUsage = {
        plan: {
          name: subscription.planName,
          status: subscription.status,
          billingInterval: subscription.billingInterval,
          startDate: subscription.startDate,
          endDate: subscription.endDate || null,
        },
        limits: {
          properties: config.limits.maxProperties,
          units: config.limits.maxUnits,
          seats: config.seatPricing.includedSeats + config.seatPricing.maxAdditionalSeats,
        },
        usage: {
          properties: subscription.currentProperties,
          units: subscription.currentUnits,
          seats: subscription.currentSeats,
        },
        isLimitReached,
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
      if (!subscription?.paymentGateway?.customerId || subscription.planName === 'essential') {
        return [];
      }

      const result = await this.paymentGatewayService.getInvoices(
        IPaymentGatewayProvider.STRIPE,
        subscription.paymentGateway.customerId,
        12
      );

      if (!result.success || !result.data) {
        return [];
      }

      const billingHistory = result.data.map((inv) => ({
        invoiceId: inv.id,
        number: inv.number,
        amountPaid: inv.amount_paid / 100,
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

  async initSubscriptionPayment(
    ctx: IRequestContext,
    checkoutData: {
      successUrl?: string;
      cancelUrl?: string;
      billingInterval?: 'monthly' | 'annual';
      lookUpKey?: string;
      priceId: string;
    }
  ): IPromiseReturnedData<{ checkoutUrl?: string; sessionId?: string; message?: string }> {
    try {
      const { currentuser } = ctx;
      const cuid = currentuser!.client.cuid;

      const subscription = await this.subscriptionDAO.findFirst({ cuid });
      if (!subscription) {
        throw new BadRequestError({ message: 'Subscription not found' });
      }

      // Block only inactive subscriptions
      if (subscription.status === ISubscriptionStatus.INACTIVE) {
        throw new BadRequestError({ message: 'Cannot update canceled/inactive subscription' });
      }

      const isInitialPayment = subscription.status === ISubscriptionStatus.PENDING_PAYMENT;
      const isUpdate = subscription.status === ISubscriptionStatus.ACTIVE;

      const priceId = checkoutData.priceId || subscription.paymentGateway.planId;
      if (!priceId) {
        throw new InternalServerError({ message: 'Plan pricing not configured' });
      }

      if (isInitialPayment) {
        const checkoutResult = await this.createCheckoutSession({
          subscriptionId: subscription._id.toString(),
          email: currentuser!.email,
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
        const stripeSubscriptionId = subscription.paymentGateway?.subscriberId;
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

            // Update local DB
            const updatedSubscription = await this.subscriptionDAO.update(
              { _id: subscription._id },
              {
                $set: {
                  billingInterval: checkoutData.billingInterval,
                  'paymentGateway.planId': priceId,
                  'paymentGateway.planLookUpKey': checkoutData.lookUpKey,
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
    return `$${Math.ceil(priceInCents / 100)}`;
  }

  // WEBHOOKS AND CRON JOBS
  async handlePaymentSuccess(data: {
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    currentPeriodStart: number;
    currentPeriodEnd: number;
    clientId: string;
    cardLast4?: string;
    cardBrand?: string;
  }): IPromiseReturnedData<ISubscriptionDocument> {
    const session = await this.subscriptionDAO.startSession();

    try {
      const result = await this.subscriptionDAO.withTransaction(session, async (cxtsession) => {
        const {
          stripeCustomerId,
          stripeSubscriptionId,
          currentPeriodStart,
          currentPeriodEnd,
          clientId,
          cardLast4,
          cardBrand,
        } = data;

        const subscription = await this.subscriptionDAO.findFirst({
          'paymentGateway.customerId': stripeCustomerId,
        });

        if (!subscription) {
          this.log.error({ stripeCustomerId, clientId }, 'Subscription not found for customer');
          throw new BadRequestError({ message: 'Subscription not found for customer' });
        }

        const updatedSubscription = await this.subscriptionDAO.update(
          { _id: subscription._id },
          {
            $set: {
              status: ISubscriptionStatus.ACTIVE,
              'paymentGateway.customerId': stripeCustomerId,
              'paymentGateway.subscriberId': stripeSubscriptionId,
              'paymentGateway.cardLast4': cardLast4,
              'paymentGateway.cardBrand': cardBrand,
              pendingDowngradeAt: null,
              startDate: new Date(currentPeriodStart * 1000),
              endDate: new Date(currentPeriodEnd * 1000),
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

      try {
        const billingCacheKey = `billing_history:${result.cuid}`;
        await this.authCache.client.DEL(billingCacheKey);
      } catch (error) {
        this.log.warn({ error }, 'Failed to invalidate billing history cache');
      }

      await this.notifyAccountAdminViaSSE(result.cuid, {
        type: 'subscription_activated',
        subscription: {
          plan: result.planName,
          status: result.status,
          endDate: result.endDate,
        },
        message: 'Your subscription has been activated successfully',
      });

      return { data: result, success: true };
    } catch (error) {
      this.log.error({ error, data }, 'Error handling payment success');
      throw error;
    }
  }

  async handleSubscriptionRenewal(data: {
    stripeSubscriptionId: string;
    currentPeriodStart: number;
    currentPeriodEnd: number;
  }): IPromiseReturnedData<ISubscriptionDocument> {
    const session = await this.subscriptionDAO.startSession();

    try {
      const result = await this.subscriptionDAO.withTransaction(session, async (cxtsession) => {
        const { stripeSubscriptionId, currentPeriodStart, currentPeriodEnd } = data;

        const subscription = await this.subscriptionDAO.findFirst({
          'paymentGateway.subscriberId': stripeSubscriptionId,
        });

        if (!subscription) {
          this.log.error({ stripeSubscriptionId }, 'Subscription not found for renewal');
          throw new BadRequestError({ message: 'Subscription not found' });
        }

        const updatedSubscription = await this.subscriptionDAO.update(
          { _id: subscription._id },
          {
            $set: {
              startDate: new Date(currentPeriodStart * 1000),
              endDate: new Date(currentPeriodEnd * 1000),
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
            newEndDate: new Date(currentPeriodEnd * 1000),
          },
          'Subscription renewed - billing period updated'
        );

        return updatedSubscription;
      });

      await this.notifyAccountAdminViaSSE(result.cuid, {
        type: 'subscription_renewed',
        subscription: {
          plan: result.planName,
          status: result.status,
          endDate: result.endDate,
        },
        message: 'Your subscription has been renewed successfully',
      });

      return { data: result, success: true };
    } catch (error) {
      this.log.error({ error, data }, 'Error handling subscription renewal');
      throw error;
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

        const subscription = await this.subscriptionDAO.findFirst({
          'paymentGateway.subscriberId': stripeSubscriptionId,
        });

        if (!subscription) {
          this.log.error({ stripeSubscriptionId }, 'Subscription not found for payment failure');
          throw new BadRequestError({ message: 'Subscription not found' });
        }

        const updatedSubscription = await this.subscriptionDAO.update(
          { _id: subscription._id },
          {
            $set: {
              status: ISubscriptionStatus.INACTIVE,
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
          },
          'Payment failed - subscription marked as inactive'
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

  async handleSubscriptionUpdated(data: {
    stripeSubscriptionId: string;
    status: string;
    currentPeriodEnd?: number;
  }): IPromiseReturnedData<ISubscriptionDocument> {
    try {
      const { stripeSubscriptionId, status, currentPeriodEnd } = data;

      const subscription = await this.subscriptionDAO.findFirst({
        'paymentGateway.subscriberId': stripeSubscriptionId,
      });

      if (!subscription) {
        this.log.error({ stripeSubscriptionId }, 'Subscription not found for update');
        throw new BadRequestError({ message: 'Subscription not found' });
      }

      const updateData: any = {};
      if (status === 'active') {
        updateData.status = ISubscriptionStatus.ACTIVE;
      } else if (status === 'canceled' || status === 'unpaid') {
        updateData.status = ISubscriptionStatus.INACTIVE;
      }

      if (currentPeriodEnd) {
        updateData.endDate = new Date(currentPeriodEnd * 1000);
      }

      const updatedSubscription = await this.subscriptionDAO.update(
        { _id: subscription._id },
        { $set: updateData }
      );

      if (!updatedSubscription) {
        throw new BadRequestError({ message: 'Failed to update subscription' });
      }

      this.log.info(
        {
          subscriptionId: subscription._id,
          stripeSubscriptionId,
          newStatus: status,
        },
        'Subscription updated from Stripe'
      );

      await this.notifyAccountAdminViaSSE(updatedSubscription.cuid, {
        type: 'subscription_updated',
        subscription: {
          plan: updatedSubscription.planName,
          status: updatedSubscription.status,
          endDate: updatedSubscription.endDate,
        },
        message: `Your subscription status has been updated to ${status}`,
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

        const subscription = await this.subscriptionDAO.findFirst({
          'paymentGateway.subscriberId': stripeSubscriptionId,
        });

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

  async processExpiredSubscriptions(): Promise<void> {
    try {
      const now = new Date();
      const expiredSubscriptions = await Subscription.find({
        status: ISubscriptionStatus.ACTIVE,
        endDate: { $lt: now },
        planName: { $ne: 'essential' },
      });

      if (expiredSubscriptions.length === 0) {
        this.log.info('No expired subscriptions found');
        return;
      }

      for (const subscription of expiredSubscriptions) {
        try {
          await this.subscriptionDAO.update(
            { _id: subscription._id },
            { $set: { status: ISubscriptionStatus.INACTIVE } }
          );

          // Notify account admin via SSE
          await this.notifyAccountAdminViaSSE(subscription.cuid, {
            type: 'subscription_updated',
            subscription: {
              plan: subscription.planName,
              status: ISubscriptionStatus.INACTIVE,
              endDate: subscription.endDate,
            },
            message:
              'Your subscription has expired. Please renew to continue using premium features.',
          });

          this.log.info(
            { subscriptionId: subscription._id, cuid: subscription.cuid },
            'Marked expired subscription as inactive'
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
    this.log.info('Subscription service event listeners setup');
  }

  cleanupEventListeners(): void {
    this.log.info('Subscription service event listeners removed');
  }
}
