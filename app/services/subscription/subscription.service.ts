import dayjs from 'dayjs';
import { UserDAO } from '@dao/userDAO';
import { ClientSession } from 'mongodb';
import { AuthCache } from '@caching/index';
import { ClientDAO } from '@dao/clientDAO';
import { createLogger } from '@utils/index';
import { StripeService } from '@services/external';
import { SSEService } from '@services/sse/sse.service';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { EventEmitterService } from '@services/eventEmitter';
import { PaymentGatewayService } from '@services/paymentGateway';
import { InternalServerError, UnauthorizedError, BadRequestError } from '@shared/customErrors';
import {
  ISubscriptionAccessControl,
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
    clientId: string,
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
      // clientId is actually the cuid, not MongoDB _id
      const client = await this.clientDAO.getClientByCuid(clientId);
      if (!client) {
        this.log.warn({ clientId }, 'Client not found for SSE notification');
        return;
      }

      if (!client.accountAdmin) {
        this.log.warn({ clientId }, 'No account admin found for client');
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
        clientId,
        notificationPayload,
        'subscription_update'
      );

      if (sent) {
        this.log.info(
          { clientId, accountAdminId, eventType: eventData.type },
          'SSE notification sent to account admin'
        );
      } else {
        this.log.debug(
          { clientId, accountAdminId },
          'Account admin not connected to SSE, cache invalidated'
        );
      }
    } catch (error) {
      this.log.error({ error, clientId }, 'Error sending SSE notification to account admin');
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

        // Check if customer already exists in subscription to prevent duplicates
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

  async handlePaymentSuccess(data: {
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    currentPeriodStart: number;
    currentPeriodEnd: number;
    clientId: string;
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

        this.log.info(
          {
            subscriptionId: subscription._id,
            stripeCustomerId,
            stripeSubscriptionId,
            clientId,
            startDate: new Date(currentPeriodStart * 1000),
            endDate: new Date(currentPeriodEnd * 1000),
          },
          'Payment successful - subscription activated with Stripe billing period in transaction'
        );

        return updatedSubscription;
      });

      // Notify account admin via SSE about subscription activation
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

      // Notify account admin via SSE about subscription renewal
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

      // Notify account admin via SSE about payment failure
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

      // Notify account admin via SSE about subscription update
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

      // Notify account admin via SSE about subscription cancellation
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

  async getSubscriptionAccessControl(
    cuid: string,
    userRole?: string
  ): IPromiseReturnedData<ISubscriptionAccessControl | null> {
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

      const accessControl: ISubscriptionAccessControl = {
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

      return { data: accessControl, success: true };
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

  async initSubscriptionPayment(
    ctx: IRequestContext,
    checkoutData: {
      successUrl: string;
      cancelUrl: string;
      billingInterval?: 'monthly' | 'annual';
      lookUpKey: string;
      priceId: string;
    }
  ): IPromiseReturnedData<{ checkoutUrl: string; sessionId: string }> {
    try {
      const { currentuser } = ctx;
      const cuid = currentuser!.client.cuid;

      const subscription = await this.subscriptionDAO.findFirst({ cuid });
      if (!subscription) {
        throw new BadRequestError({ message: 'Subscription not found' });
      }

      if (subscription.status !== ISubscriptionStatus.PENDING_PAYMENT) {
        throw new BadRequestError({
          message: 'Payment already completed or subscription not in pending state',
        });
      }

      const priceId = checkoutData.priceId || subscription.paymentGateway.planId;
      if (!priceId) {
        throw new InternalServerError({ message: 'Plan pricing not configured' });
      }

      const checkoutResult = await this.createCheckoutSession({
        subscriptionId: subscription._id.toString(),
        email: currentuser!.email,
        priceId,
        successUrl: checkoutData.successUrl,
        cancelUrl: checkoutData.cancelUrl,
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
    } catch (error) {
      this.log.error({ error }, 'Error initiating subscription payment');
      throw error;
    }
  }

  private formatPrice(priceInCents: number): string {
    if (priceInCents === 0) return '$0';
    return `$${Math.ceil(priceInCents / 100)}`;
  }

  private setupEventListeners(): void {
    this.log.info('Subscription service event listeners setup');
  }

  cleanupEventListeners(): void {
    this.log.info('Subscription service event listeners removed');
  }
}
