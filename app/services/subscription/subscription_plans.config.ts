import { ISubscriptionPlansConfig, PlanName } from '@interfaces/subscription.interface';

const FEATURES = {
  coreFeatures: {
    TENANT_MANAGEMENT: 'Tenant management',
    RENT_COLLECTION: 'Rent collection',
    MAINTENANCE_REQUESTS: 'Maintenance requests',
    ONLINE_PAYMENTS: 'Online payments & AutoPay',
    VENDOR_MANAGEMENT: 'Vendor management',
  },
  premiumFeatures: {
    E_SIGNATURE: 'E-Signature',
    GUEST_PASS: 'Guest Pass Service',
    REPORTING: 'Advanced reporting & analytics',
    CUSTOM_LEASES: 'Customizable lease agreements',
    PRIORITY_SUPPORT: 'Priority support',
  },
  upgrades: {
    EVERYTHING_IN_STARTER: 'Everything in Starter',
  },
} as const;

const PLAN_CONFIGS: Record<PlanName, ISubscriptionPlansConfig> = {
  starter: {
    planName: 'starter',
    name: 'Starter',
    description: 'Perfect for individual landlords',
    trialDays: 0,
    ctaText: 'Get Started Free',
    isFeatured: false,
    displayOrder: 1,
    pricing: {
      monthly: {
        priceId: 'price_starter_monthly',
        priceInCents: 0,
      },
      annual: {
        priceId: 'price_starter_annual',
        priceInCents: 0,
        savingsPercent: 0,
      },
    },
    transactionFeePercent: 3.5,
    isCustomPricing: false,
    seatPricing: {
      includedSeats: 3, // 3 seats included
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
      FEATURES.coreFeatures.TENANT_MANAGEMENT,
      FEATURES.coreFeatures.RENT_COLLECTION,
      FEATURES.coreFeatures.MAINTENANCE_REQUESTS,
    ],
    disabledFeatures: [FEATURES.premiumFeatures.E_SIGNATURE, FEATURES.premiumFeatures.GUEST_PASS],
  },
  personal: {
    planName: 'personal',
    name: 'Personal',
    description: 'For growing property managers',
    trialDays: 14,
    pricing: {
      monthly: {
        priceId: 'price_personal_monthly',
        priceInCents: 2900, // $29/month
      },
      annual: {
        priceId: 'price_personal_annual',
        priceInCents: 27800, // $278/year (20% discount)
        savingsPercent: 20,
      },
    },
    ctaText: 'Start 14-Day Free Trial',
    isFeatured: true,
    featuredBadge: 'Most Popular',
    displayOrder: 2,
    transactionFeePercent: 3.0,
    isCustomPricing: false,
    seatPricing: {
      includedSeats: 10,
      additionalSeatPriceCents: 899,
      maxAdditionalSeats: 25,
    },
    limits: {
      maxProperties: 15,
      maxUnits: 100,
      maxVendors: -1,
    },
    features: {
      eSignature: true,
      RepairRequestService: true,
      VisitorPassService: true,
      reportingAnalytics: true,
    },
    featureList: [
      FEATURES.coreFeatures.ONLINE_PAYMENTS,
      FEATURES.coreFeatures.VENDOR_MANAGEMENT,
      FEATURES.premiumFeatures.E_SIGNATURE,
      FEATURES.premiumFeatures.GUEST_PASS,
    ],
    disabledFeatures: [],
  },
  professional: {
    planName: 'professional',
    name: 'Professional',
    description: 'For established businesses',
    trialDays: 14,
    pricing: {
      monthly: {
        priceId: 'price_professional_monthly',
        priceInCents: 9900, // $99/month
      },
      annual: {
        priceId: 'price_professional_annual',
        priceInCents: 95000, // $950/year (20% discount)
        savingsPercent: 20,
      },
    },
    ctaText: 'Start 14-Day Free Trial',
    isFeatured: false,
    displayOrder: 3,
    transactionFeePercent: 2.8,
    isCustomPricing: false,
    seatPricing: {
      includedSeats: 25,
      additionalSeatPriceCents: 799,
      maxAdditionalSeats: 40,
    },
    limits: {
      maxProperties: 30,
      maxUnits: 300,
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
      FEATURES.upgrades.EVERYTHING_IN_STARTER,
      FEATURES.premiumFeatures.REPORTING,
      FEATURES.premiumFeatures.CUSTOM_LEASES,
      FEATURES.premiumFeatures.PRIORITY_SUPPORT,
    ],
    disabledFeatures: [],
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
    billingInterval: 'monthly' | 'annual' = 'monthly',
    additionalSeatsCount: number = 0,
    customPriceInCents?: number
  ): number {
    const config = this.getConfig(planName);

    // For Enterprise with custom pricing, use that instead of base price
    const basePrice =
      config.isCustomPricing && customPriceInCents
        ? customPriceInCents
        : config.pricing[billingInterval].priceInCents;

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

  public getFormattedPrice(
    planName: PlanName,
    billingInterval: 'monthly' | 'annual' = 'monthly'
  ): string {
    const config = this.getConfig(planName);
    const priceInCents = config.pricing[billingInterval].priceInCents;
    if (priceInCents === 0) return 'Free';
    return `$${(priceInCents / 100).toFixed(2)}`;
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

  public getFeatureListWithLimits(planName: PlanName): string[] {
    const config = this.getConfig(planName);
    const features: string[] = [];

    // Add limits as first feature
    const propertiesText =
      config.limits.maxProperties === -1 ? 'Unlimited' : `Up to ${config.limits.maxProperties}`;
    const unitsText = config.limits.maxUnits === -1 ? 'unlimited' : config.limits.maxUnits;
    features.push(`${propertiesText} properties & ${unitsText} units`);

    // Add team members as second feature
    features.push(`Up to ${config.seatPricing.includedSeats} team members`);

    // Add transaction fee
    features.push(`${config.transactionFeePercent}% transaction fee`);

    // Add the custom feature list
    features.push(...config.featureList);

    return features;
  }

  public getCompleteFeatureList(planName: PlanName): {
    enabled: string[];
    disabled: string[];
  } {
    const config = this.getConfig(planName);
    return {
      enabled: this.getFeatureListWithLimits(planName),
      disabled: config.disabledFeatures || [],
    };
  }
}

export const subscriptionPlanConfig = SubscriptionPlanConfig.getInstance();
