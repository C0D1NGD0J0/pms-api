import dayjs from 'dayjs';
import { Types } from 'mongoose';
import { ClientSession } from 'mongodb';
import { ClientDAO } from '@dao/clientDAO';
import { createLogger } from '@utils/index';
import { StripeService } from '@services/external';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { EventEmitterService } from '@services/eventEmitter';
import { PaymentGatewayService } from '@services/paymentGateway';
import { UnauthorizedError, BadRequestError } from '@shared/customErrors';
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
  clientDAO: ClientDAO;
}

export class SubscriptionService {
  private clientDAO: ClientDAO;
  private emitterService: EventEmitterService;
  private log: ReturnType<typeof createLogger>;
  private readonly stripeService: StripeService;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly paymentGatewayService: PaymentGatewayService;

  constructor({
    clientDAO,
    stripeService,
    emitterService,
    subscriptionDAO,
    paymentGatewayService,
  }: IConstructor) {
    this.clientDAO = clientDAO;
    this.stripeService = stripeService;
    this.emitterService = emitterService;
    this.subscriptionDAO = subscriptionDAO;
    this.paymentGatewayService = paymentGatewayService;
    this.log = createLogger('SubscriptionService');
    this.setupEventListeners();
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
      const isPaidPlan = planName !== 'starter';

      if (!planName || !planId) {
        throw new BadRequestError({ message: 'Missing required subscription data' });
      }

      const client = await this.clientDAO.findById(clientId);
      if (!client) {
        throw new BadRequestError({ message: 'Client not found for subscription' });
      }

      const config = subscriptionPlanConfig.getConfig(planName as PlanName);
      let actualBilledAmount: number = config.pricing[billingInterval].priceInCents;
      if (planName !== 'starter') {
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

  async createCheckoutSession(data: {
    subscriptionId: string;
    email: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
  }): IPromiseReturnedData<{ sessionId: string; checkoutUrl: string }> {
    const session = await this.subscriptionDAO.startSession();

    try {
      const result = await this.subscriptionDAO.withTransaction(session, async (txSession) => {
        const { subscriptionId, email, priceId, successUrl, cancelUrl } = data;

        if (!this.paymentGatewayService) {
          this.log.error('Payment gateway service not initialized');
          throw new BadRequestError({ message: 'Internal system error' });
        }

        const subscription = await this.subscriptionDAO.findById(subscriptionId);
        if (!subscription) {
          throw new BadRequestError({ message: 'Client subscription not found' });
        }

        const clientId = subscription.client.toString();

        // Create customer via payment gateway (external API - before transaction commit)
        const customerResult = await this.paymentGatewayService.createCustomer({
          provider: IPaymentGatewayProvider.STRIPE,
          email,
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

        const customer = customerResult.data;

        // Update subscription with customer ID (within transaction)
        await this.subscriptionDAO.update(
          { _id: subscription._id },
          {
            $set: {
              'paymentGateway.id': customer.customerId,
            },
          },
          txSession
        );

        // Create checkout session via payment gateway (external API - before transaction commit)
        const sessionResult = await this.paymentGatewayService.createCheckoutSession({
          provider: IPaymentGatewayProvider.STRIPE,
          customerId: customer.customerId,
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

        this.log.info(
          {
            subscriptionId,
            sessionId: checkoutSession.sessionId,
            customerId: customer.customerId,
          },
          'Created checkout session via payment gateway with transaction'
        );

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
      const result = await this.subscriptionDAO.withTransaction(session, async (txSession) => {
        const {
          stripeCustomerId,
          stripeSubscriptionId,
          currentPeriodStart,
          currentPeriodEnd,
          clientId,
        } = data;

        const subscription = await this.subscriptionDAO.findFirst({
          client: new Types.ObjectId(clientId),
        });
        if (!subscription) {
          throw new BadRequestError({ message: 'Subscription not found for client' });
        }

        // Update subscription status and dates (within transaction)
        const updatedSubscription = await this.subscriptionDAO.update(
          { _id: subscription._id },
          {
            $set: {
              status: ISubscriptionStatus.ACTIVE,
              'paymentGateway.id': stripeCustomerId,
              pendingDowngradeAt: null,
              startDate: new Date(currentPeriodStart * 1000),
              endDate: new Date(currentPeriodEnd * 1000),
            },
          },
          txSession
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

      return { data: result, success: true };
    } catch (error) {
      this.log.error({ error, data }, 'Error handling payment success');
      throw error;
    }
  }

  async getSubscriptionAccessControl(
    cuid: string
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

      if (subscription.status === ISubscriptionStatus.PENDING_PAYMENT) {
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
        subscription.status === ISubscriptionStatus.ACTIVE &&
        subscription.endDate &&
        subscription.endDate < now &&
        subscription.planName !== 'starter'
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
