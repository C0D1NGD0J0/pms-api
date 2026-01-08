import { ISubscriptionPlansConfig, PlanName } from '@interfaces/subscription.interface';

const PLAN_CONFIGS: Record<PlanName, ISubscriptionPlansConfig> = {
  free: {
    name: 'Free',
    priceInCents: 0,
    transactionFeePercent: 3.5,
    isCustomPricing: false,
    seatPricing: {
      includedSeats: 5, // 5 seats included
      additionalSeatPriceCents: 0, // Can't buy more seats
      maxAdditionalSeats: 0, // Must upgrade to add seats
    },
    limits: {
      maxProperties: 5,
      maxUnits: 10,
      maxVendors: -1, // unlimited
    },
    features: {
      eSignature: false,
      RepairRequestService: false,
      VisitorPassService: false,
    },
  },
  starter: {
    name: 'Starter',
    priceInCents: 2900, // $29.00/month base price
    transactionFeePercent: 3.0,
    isCustomPricing: false,
    seatPricing: {
      includedSeats: 20, // 20 seats included in $29 base
      additionalSeatPriceCents: 500, // $5/seat for additional
      maxAdditionalSeats: 10, // Can buy up to 10 more (30 total max)
    },
    limits: {
      maxProperties: 5,
      maxUnits: 50,
      maxVendors: -1,
    },
    features: {
      eSignature: true,
      RepairRequestService: true,
      VisitorPassService: false,
    },
  },
  professional: {
    name: 'Professional',
    priceInCents: 7900, // $79.00/month base price
    transactionFeePercent: 2.8,
    isCustomPricing: false,
    seatPricing: {
      includedSeats: 35, // 35 seats included in $79 base
      additionalSeatPriceCents: 800, // $8/seat for additional
      maxAdditionalSeats: 15, // Can buy up to 15 more (50 total max)
    },
    limits: {
      maxProperties: 25,
      maxUnits: 100,
      maxVendors: -1, // unlimited
    },
    features: {
      eSignature: true,
      RepairRequestService: true,
      VisitorPassService: true, // Only on Professional+
    },
  },
  enterprise: {
    name: 'Enterprise',
    priceInCents: 19900, // $199.00/month starting price (custom pricing available)
    transactionFeePercent: 2.5,
    isCustomPricing: true, // Contact sales for custom pricing
    seatPricing: {
      includedSeats: 60, // 60 seats included in base
      additionalSeatPriceCents: 1000, // $10/seat for additional
      maxAdditionalSeats: -1, // Unlimited additional seats
    },
    limits: {
      maxProperties: -1, // unlimited
      maxUnits: -1, // unlimited
      maxVendors: -1, // unlimited
    },
    features: {
      eSignature: true,
      RepairRequestService: true,
      VisitorPassService: true,
      prioritySupport: true,
    },
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

  /**
   * Get singleton instance
   */
  public static getInstance(): SubscriptionPlanConfig {
    if (!SubscriptionPlanConfig.instance) {
      SubscriptionPlanConfig.instance = new SubscriptionPlanConfig();
    }
    return SubscriptionPlanConfig.instance;
  }

  /**
   * Get subscription plan configuration by plan name
   */
  public getConfig(planName: PlanName): ISubscriptionPlansConfig {
    const config = this.configs[planName];
    if (!config) {
      throw new Error(`Invalid plan name: ${planName}`);
    }
    return config;
  }

  /**
   * Get all available plan names
   */
  public getAllPlans(): PlanName[] {
    return Object.keys(this.configs) as PlanName[];
  }

  /**
   * Check if subscription can add a new seat (employee: Admin, Manager, Staff)
   */
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

    return currentSeats < totalAllowedSeats;
  }

  /**
   * Check if subscription can purchase additional seats
   */
  public canPurchaseAdditionalSeats(additionalSeatsCount: number, planName: PlanName): boolean {
    const config = this.getConfig(planName);
    if (config.seatPricing.additionalSeatPriceCents === 0) return false; // Can't buy more
    if (config.seatPricing.maxAdditionalSeats === -1) return true; // Unlimited
    return additionalSeatsCount < config.seatPricing.maxAdditionalSeats;
  }

  /**
   * Calculate total monthly price for a subscription
   */
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

  /**
   * Calculate additional seats cost only
   */
  public calculateAdditionalSeatsCost(planName: PlanName, additionalSeatsCount: number): number {
    const config = this.getConfig(planName);
    return additionalSeatsCount * config.seatPricing.additionalSeatPriceCents;
  }

  /**
   * Check if subscription can add a new property
   */
  public canAddProperty(currentProperties: number, planName: PlanName): boolean {
    const config = this.getConfig(planName);
    if (config.limits.maxProperties === -1) return true; // unlimited
    return currentProperties < config.limits.maxProperties;
  }

  /**
   * Check if subscription can add a new unit
   */
  public canAddUnit(currentUnits: number, planName: PlanName): boolean {
    const config = this.getConfig(planName);
    if (config.limits.maxUnits === -1) return true; // unlimited
    return currentUnits < config.limits.maxUnits;
  }

  /**
   * Vendors are always unlimited for all tiers
   */
  public canAddVendor(): boolean {
    return true;
  }

  /**
   * Check if a plan has a specific feature enabled
   */
  public hasFeature(
    planName: PlanName,
    feature: keyof ISubscriptionPlansConfig['features']
  ): boolean {
    const config = this.getConfig(planName);
    return config.features[feature] === true;
  }

  /**
   * Get transaction fee percentage for a plan
   */
  public getTransactionFeePercent(planName: PlanName): number {
    const config = this.getConfig(planName);
    return config.transactionFeePercent;
  }

  /**
   * Get formatted price for display
   */
  public getFormattedPrice(planName: PlanName): string {
    const config = this.getConfig(planName);
    if (config.priceInCents === 0) return 'Free';
    return `$${(config.priceInCents / 100).toFixed(2)}`;
  }

  /**
   * Get total seat limit for a plan (included + max additional)
   */
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

// Export singleton instance for easy access
export const subscriptionPlanConfig = SubscriptionPlanConfig.getInstance();
