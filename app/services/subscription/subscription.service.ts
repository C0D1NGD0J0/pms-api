import dayjs from 'dayjs';
import { ClientSession } from 'mongodb';
import { ClientDAO } from '@dao/clientDAO';
import { createLogger } from '@utils/index';
import { StripeService } from '@services/external';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { BadRequestError } from '@shared/customErrors';
import { EventEmitterService } from '@services/eventEmitter';
import {
  ISubscriptionPlanResponse,
  IPaymentGatewayProvider,
  ISubscriptionDocument,
  IPromiseReturnedData,
  ISubscriptionStatus,
  ISubscription,
  PlanName,
} from '@interfaces/index';

import { subscriptionPlanConfig } from './subscription_plans.config';

interface IConstructor {
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

  constructor({ subscriptionDAO, stripeService, clientDAO, emitterService }: IConstructor) {
    this.clientDAO = clientDAO;
    this.stripeService = stripeService;
    this.emitterService = emitterService;
    this.subscriptionDAO = subscriptionDAO;
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
          id: isPaidPlan ? '' : 'none',
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

  // async createCheckoutSession(
  //   subscriptionId: string,
  //   email: string,
  //   lookUpKey: string,
  //   successUrl: string,
  //   cancelUrl: string
  // ): IPromiseReturnedData<{ checkoutUrl: string }> {
  //   try {
  //     const subscription = await this.subscriptionDAO.findById(subscriptionId);
  //     if (!subscription) {
  //       return { success: false, message: 'Subscription not found' };
  //     }

  //     const clientId = subscription.client.toString();

  //     const session = await this.stripeService.createCheckoutSession(
  //       lookUpKey,
  //       clientId,
  //       email,
  //       successUrl,
  //       cancelUrl
  //     );

  //     this.log.info(
  //       { subscriptionId, sessionId: session.id, clientId },
  //       'Created Stripe checkout session'
  //     );

  //     return {
  //       data: { checkoutUrl: session.url || '' },
  //       success: true,
  //     };
  //   } catch (error) {
  //     this.log.error({ error, subscriptionId }, 'Error creating checkout session');
  //     return { success: false, message: 'Failed to create checkout session' };
  //   }
  // }

  // async handlePaymentSuccess(
  //   stripeCustomerId: string,
  //   stripeSubscriptionId: string,
  //   clientId: string
  // ): IPromiseReturnedData<ISubscriptionDocument> {
  //   try {
  //     // Find subscription by client ID
  //     const subscription = await this.subscriptionDAO.findFirst({ client: clientId });
  //     if (!subscription) {
  //       this.log.error({ clientId }, 'Subscription not found for payment success');
  //       return { success: false, message: 'Subscription not found' };
  //     }

  //     // Update subscription status and payment gateway info
  //     const updatedSubscription = await this.subscriptionDAO.update(
  //       { _id: subscription._id },
  //       {
  //         $set: {
  //           status: 'active',
  //           'paymentGateway.id': stripeCustomerId,
  //           pendingDowngradeAt: null,
  //         },
  //       }
  //     );

  //     if (!updatedSubscription) {
  //       return { success: false, message: 'Failed to update subscription' };
  //     }

  //     this.log.info(
  //       {
  //         subscriptionId: subscription._id,
  //         stripeCustomerId,
  //         stripeSubscriptionId,
  //         clientId,
  //       },
  //       'Payment successful - subscription activated'
  //     );

  //     return { data: updatedSubscription, success: true };
  //   } catch (error) {
  //     this.log.error({ error, stripeCustomerId, clientId }, 'Error handling payment success');
  //     return { success: false, message: 'Failed to handle payment success' };
  //   }
  // }

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
