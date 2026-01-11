import { ISubscriptionPlansConfig, PlanName } from '@interfaces/subscription.interface';

const PLAN_CONFIGS: Record<PlanName, ISubscriptionPlansConfig> = {
  personal: {
    planName: 'personal',
    name: 'Personal',
    description: 'Perfect for individual landlords',
    trialDays: 0,
    ctaText: 'Get Started Free',
    isFeatured: false,
    displayOrder: 1,
    priceInCents: 0,
    transactionFeePercent: 3.5,
    isCustomPricing: false,
    seatPricing: {
      includedSeats: 5, // 5 seats included
      additionalSeatPriceCents: 0, // Can't buy more seats
      maxAdditionalSeats: 0, // Must upgrade to add seats
    },
    limits: {
      maxProperties: 3,
      maxUnits: 10,
      maxVendors: -1, // unlimited
    },
    features: {
      eSignature: false,
      RepairRequestService: false,
      VisitorPassService: false,
      reportingAnalytics: false,
    },
    featureList: [
      'Up to 3 properties',
      'Basic tenant management',
      'Rent collection',
      'Maintenance requests',
      'Email support',
    ],
    disabledFeatures: ['Advanced reporting', 'Team members'],
  },
  starter: {
    planName: 'starter',
    name: 'Starter',
    description: 'For growing property managers',
    trialDays: 14,
    priceInCents: 0,
    ctaText: 'Start 14-Day Free Trial',
    isFeatured: true,
    featuredBadge: 'Most Popular',
    displayOrder: 2,
    transactionFeePercent: 3.0,
    isCustomPricing: false,
    seatPricing: {
      includedSeats: 10,
      additionalSeatPriceCents: 500,
      maxAdditionalSeats: 20,
    },
    limits: {
      maxProperties: 15,
      maxUnits: 75,
      maxVendors: -1,
    },
    features: {
      eSignature: true,
      RepairRequestService: true,
      VisitorPassService: true,
      reportingAnalytics: false,
    },
    featureList: [
      'Up to 15 properties',
      'Advanced tenant screening',
      'Online payments & AutoPay',
      'Vendor management',
      'Financial reporting',
      'Up to 10 team members',
      'Priority support',
    ],
  },
  professional: {
    planName: 'professional',
    name: 'Professional',
    description: 'For established businesses',
    trialDays: 14,
    ctaText: 'Start 14-Day Free Trial',
    isFeatured: false,
    displayOrder: 3,
    priceInCents: 0,
    transactionFeePercent: 2.8,
    isCustomPricing: false,
    seatPricing: {
      includedSeats: -1,
      additionalSeatPriceCents: 0,
      maxAdditionalSeats: -1,
    },
    limits: {
      maxProperties: 25,
      maxUnits: 250,
      maxVendors: -1, // unlimited
    },
    features: {
      eSignature: true,
      RepairRequestService: true,
      VisitorPassService: true,
      reportingAnalytics: true,
      prioritySupport: true,
    },
    featureList: [
      'Up to 25 properties',
      'Everything in Starter',
      'Custom branding',
      'API access',
      'Advanced analytics',
      'Unlimited team members',
      'Phone support',
    ],
  },
};

export type SubscriptionPlanName = keyof typeof PLAN_CONFIGS;

/**
 * Subscription Plan Configuration Manager
 */
export class SubscriptionPlanConfig {
  private static instance: SubscriptionPlanConfig;
  private configs: Record<PlanName, ISubscriptionPlansConfig>;

  private constructor() {
    this.configs = PLAN_CONFIGS;
  }

  public static getInstance(): SubscriptionPlanConfig {
    if (!SubscriptionPlanConfig.instance) {
      SubscriptionPlanConfig.instance = new SubscriptionPlanConfig();
    }
    return SubscriptionPlanConfig.instance;
  }

  public getConfig(planName: PlanName): ISubscriptionPlansConfig {
    const config = this.configs[planName];
    if (!config) {
      throw new Error(`Invalid plan name: ${planName}`);
    }
    return config;
  }

  public getAllPlans(): PlanName[] {
    return Object.keys(this.configs) as PlanName[];
  }

  public canAddSeat(
    currentSeats: number,
    additionalSeatsCount: number,
    planName: PlanName
  ): boolean {
    const config = this.getConfig(planName);
    const totalAllowedSeats =
      config.seatPricing.includedSeats +
      (config.seatPricing.maxAdditionalSeats === -1
        ? Infinity
        : config.seatPricing.maxAdditionalSeats);

    return currentSeats + additionalSeatsCount <= totalAllowedSeats;
  }

  public canPurchaseAdditionalSeats(additionalSeatsCount: number, planName: PlanName): boolean {
    const config = this.getConfig(planName);
    if (config.seatPricing.additionalSeatPriceCents === 0) return false; // Can't buy more
    if (config.seatPricing.maxAdditionalSeats === -1) return true; // Unlimited
    return additionalSeatsCount < config.seatPricing.maxAdditionalSeats;
  }

  public calculatePrice(
    planName: PlanName,
    additionalSeatsCount: number = 0,
    customPriceInCents?: number
  ): number {
    const config = this.getConfig(planName);

    // For Enterprise with custom pricing, use that instead of base price
    const basePrice =
      config.isCustomPricing && customPriceInCents ? customPriceInCents : config.priceInCents;

    // Calculate additional seats cost
    const additionalSeatsCost = additionalSeatsCount * config.seatPricing.additionalSeatPriceCents;

    return basePrice + additionalSeatsCost;
  }

  public calculateAdditionalSeatsCost(planName: PlanName, additionalSeatsCount: number): number {
    const config = this.getConfig(planName);
    return additionalSeatsCount * config.seatPricing.additionalSeatPriceCents;
  }

  public canAddProperty(currentProperties: number, planName: PlanName): boolean {
    const config = this.getConfig(planName);
    if (config.limits.maxProperties === -1) return true; // unlimited
    return currentProperties < config.limits.maxProperties;
  }

  public canAddUnit(currentUnits: number, planName: PlanName): boolean {
    const config = this.getConfig(planName);
    if (config.limits.maxUnits === -1) return true; // unlimited
    return currentUnits < config.limits.maxUnits;
  }
  public canAddVendor(): boolean {
    return true;
  }

  public hasFeature(
    planName: PlanName,
    feature: keyof ISubscriptionPlansConfig['features']
  ): boolean {
    const config = this.getConfig(planName);
    return config.features[feature] === true;
  }

  public getTransactionFeePercent(planName: PlanName): number {
    const config = this.getConfig(planName);
    return config.transactionFeePercent;
  }

  public getFormattedPrice(planName: PlanName): string {
    const config = this.getConfig(planName);
    if (config.priceInCents === 0) return 'Free';
    return `$${(config.priceInCents / 100).toFixed(2)}`;
  }

  public getSeatLimit(planName: PlanName): number {
    const config = this.getConfig(planName);
    if (config.seatPricing.maxAdditionalSeats === -1) return -1; // unlimited
    return config.seatPricing.includedSeats + config.seatPricing.maxAdditionalSeats;
  }

  /**
   * Get included seats for a plan
   */
  public getIncludedSeats(planName: PlanName): number {
    const config = this.getConfig(planName);
    return config.seatPricing.includedSeats;
  }

  /**
   * Get additional seat price for a plan
   */
  public getAdditionalSeatPrice(planName: PlanName): number {
    const config = this.getConfig(planName);
    return config.seatPricing.additionalSeatPriceCents;
  }

  /**
   * Get property limit for a plan
   */
  public getPropertyLimit(planName: PlanName): number {
    const config = this.getConfig(planName);
    return config.limits.maxProperties;
  }

  /**
   * Get unit limit for a plan
   */
  public getUnitLimit(planName: PlanName): number {
    const config = this.getConfig(planName);
    return config.limits.maxUnits;
  }

  /**
   * Get display name for a plan
   */
  public getDisplayName(planName: PlanName): string {
    const config = this.getConfig(planName);
    return config.name;
  }
}

export const subscriptionPlanConfig = SubscriptionPlanConfig.getInstance();
