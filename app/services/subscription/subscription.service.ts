import dayjs from 'dayjs';
import { ClientDAO } from '@dao/clientDAO';
import { createLogger } from '@utils/index';
import { StripeService } from '@services/external';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { EventEmitterService } from '@services/eventEmitter';
import { ValidationRequestError } from '@shared/customErrors';
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
    >
  ): IPromiseReturnedData<ISubscriptionDocument | null> {
    try {
      const { planName, planId, planLookUpKey, billingInterval = 'monthly' } = data;

      if (!planName || !planId || !planLookUpKey) {
        throw new ValidationRequestError({ message: 'Missing required subscription data' });
      }

      const client = await this.clientDAO.findById(clientId);
      if (!client) {
        throw new ValidationRequestError({ message: 'Client not found for subscription' });
      }

      const stripePrice = await this.stripeService.getProductPrice(planId);
      const config = subscriptionPlanConfig.getConfig(planName as PlanName);

      let startDate, endDate;
      if (billingInterval === 'monthly') {
        startDate = new Date();
        endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);
      } else if (billingInterval === 'annual') {
        startDate = new Date();
        endDate = new Date();
        endDate.setDate(endDate.getDate() + 365);
      }

      const isPaidPlan = planName !== 'personal';
      const status = isPaidPlan ? ISubscriptionStatus.PENDING_PAYMENT : ISubscriptionStatus.ACTIVE;

      // Set pending downgrade for 48 hours from now if paid plan
      const pendingDowngradeAt = isPaidPlan ? dayjs().add(48, 'hour').toDate() : undefined;

      // Get price from config based on billing interval
      const totalMonthlyPrice =
        stripePrice.unit_amount || config.pricing[billingInterval].priceInCents;
      const _subscriptionData = {
        client: client._id,
        planName,
        status,
        startDate,
        endDate,
        billingInterval,
        paymentGateway: {
          id: isPaidPlan ? '' : 'none', // filled after Stripe customer creation webhook
          provider: isPaidPlan ? IPaymentGatewayProvider.STRIPE : IPaymentGatewayProvider.NONE,
          planId: planId || 'none',
          planLookUpKey: planLookUpKey,
        },
        totalMonthlyPrice,
        currentSeats: config.seatPricing.includedSeats,
        pendingDowngradeAt,
      };

      // const subscription = await this.subscriptionDAO.insert(subscriptionData);

      return { data: null, success: true };
    } catch (error) {
      this.log.error({ error, data }, 'Error creating subscription');
      return { success: false, message: 'Failed to create subscription', data: null };
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
