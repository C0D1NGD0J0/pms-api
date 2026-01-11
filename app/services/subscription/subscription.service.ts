import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { StripeService } from '@services/external';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { ISubscriptionPlanResponse, IPromiseReturnedData } from '@interfaces/index';

import { subscriptionPlanConfig } from './subscription_plans.config';

interface IConstructor {
  subscriptionDAO: SubscriptionDAO;
  stripeService: StripeService;
}

export class SubscriptionService {
  private readonly log: Logger;
  private readonly stripeService: StripeService;
  private readonly subscriptionDAO: SubscriptionDAO;

  constructor({ subscriptionDAO, stripeService }: IConstructor) {
    this.stripeService = stripeService;
    this.subscriptionDAO = subscriptionDAO;
    this.log = createLogger('SubscriptionService');
    this.log.info('SubscriptionService initialized');
  }

  async getSubscriptionPlans(): IPromiseReturnedData<ISubscriptionPlanResponse[]> {
    let stripePriceMap: Map<string, { priceId: string; amount: number; lookUpKey: string }> =
      new Map();

    try {
      stripePriceMap = await this.stripeService.getProductsWithPrices();
    } catch (error) {
      this.log.error({ error }, 'Error fetching plans from Stripe');
      this.log.warn('Falling back to config prices');
    }

    const plans = subscriptionPlanConfig.getAllPlans().map((planName) => {
      const config = subscriptionPlanConfig.getConfig(planName);
      const stripeData = stripePriceMap.get(config.name.toLowerCase());
      const priceInCents = stripeData?.amount ?? config.priceInCents;

      // Calculate annual pricing (20% discount)
      const annualPriceInCents = Math.round(priceInCents * 0.8);
      const annualSavingsPercent = priceInCents > 0 ? 20 : 0;

      return {
        ...config,
        priceInCents,
        pricing: {
          id: stripeData?.priceId || null,
          lookUpKey: stripeData?.lookUpKey || null,
          monthly: {
            priceInCents,
            displayPrice: this.formatPrice(priceInCents),
          },
          annual: {
            priceInCents: annualPriceInCents,
            displayPrice: this.formatPrice(annualPriceInCents),
            savings: annualSavingsPercent,
          },
        },
      };
    });

    return {
      data: plans,
      success: true,
    };
  }

  private formatPrice(priceInCents: number): string {
    if (priceInCents === 0) return '$0';
    return `$${Math.floor(priceInCents / 100)}`;
  }
}
