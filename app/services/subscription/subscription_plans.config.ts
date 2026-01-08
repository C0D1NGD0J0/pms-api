import { ISubscriptionPlansConfig, ISubscriptionTier } from '@interfaces/subscription.interface';

const PLAN_CONFIGS: Record<string, ISubscriptionPlansConfig> = {
  [ISubscriptionTier.FREE]: {
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
  [ISubscriptionTier.STARTER]: {
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
  [ISubscriptionTier.PROFESSIONAL]: {
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
  [ISubscriptionTier.ENTERPRISE]: {
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
  private configs: Record<string, ISubscriptionPlansConfig>;

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
   * Get subscription plan configuration by tier
   */
  public getConfig(tier: ISubscriptionTier): ISubscriptionPlansConfig {
    const config = this.configs[tier];
    if (!config) {
      throw new Error(`Invalid subscription tier: ${tier}`);
    }
    return config;
  }

  /**
   * Get all available tier values
   */
  public getAllTiers(): ISubscriptionTier[] {
    return Object.values(ISubscriptionTier);
  }

  /**
   * Check if subscription can add a new seat (employee: Admin, Manager, Staff)
   */
  public canAddSeat(
    currentSeats: number,
    additionalSeatsCount: number,
    tier: ISubscriptionTier
  ): boolean {
    const config = this.getConfig(tier);
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
  public canPurchaseAdditionalSeats(
    additionalSeatsCount: number,
    tier: ISubscriptionTier
  ): boolean {
    const config = this.getConfig(tier);
    if (config.seatPricing.additionalSeatPriceCents === 0) return false; // Can't buy more
    if (config.seatPricing.maxAdditionalSeats === -1) return true; // Unlimited
    return additionalSeatsCount < config.seatPricing.maxAdditionalSeats;
  }

  /**
   * Calculate total monthly price for a subscription
   */
  public calculatePrice(
    tier: ISubscriptionTier,
    additionalSeatsCount: number = 0,
    customPriceInCents?: number
  ): number {
    const config = this.getConfig(tier);

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
  public calculateAdditionalSeatsCost(
    tier: ISubscriptionTier,
    additionalSeatsCount: number
  ): number {
    const config = this.getConfig(tier);
    return additionalSeatsCount * config.seatPricing.additionalSeatPriceCents;
  }

  /**
   * Check if subscription can add a new property
   */
  public canAddProperty(currentProperties: number, tier: ISubscriptionTier): boolean {
    const config = this.getConfig(tier);
    if (config.limits.maxProperties === -1) return true; // unlimited
    return currentProperties < config.limits.maxProperties;
  }

  /**
   * Check if subscription can add a new unit
   */
  public canAddUnit(currentUnits: number, tier: ISubscriptionTier): boolean {
    const config = this.getConfig(tier);
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
   * Check if a tier has a specific feature enabled
   */
  public hasFeature(
    tier: ISubscriptionTier,
    feature: keyof ISubscriptionPlansConfig['features']
  ): boolean {
    const config = this.getConfig(tier);
    return config.features[feature] === true;
  }

  /**
   * Get transaction fee percentage for a tier
   */
  public getTransactionFeePercent(tier: ISubscriptionTier): number {
    const config = this.getConfig(tier);
    return config.transactionFeePercent;
  }

  /**
   * Get formatted price for display
   */
  public getFormattedPrice(tier: ISubscriptionTier): string {
    const config = this.getConfig(tier);
    if (config.priceInCents === 0) return 'Free';
    return `$${(config.priceInCents / 100).toFixed(2)}`;
  }

  /**
   * Get total seat limit for a tier (included + max additional)
   */
  public getSeatLimit(tier: ISubscriptionTier): number {
    const config = this.getConfig(tier);
    if (config.seatPricing.maxAdditionalSeats === -1) return -1; // unlimited
    return config.seatPricing.includedSeats + config.seatPricing.maxAdditionalSeats;
  }

  /**
   * Get included seats for a tier
   */
  public getIncludedSeats(tier: ISubscriptionTier): number {
    const config = this.getConfig(tier);
    return config.seatPricing.includedSeats;
  }

  /**
   * Get additional seat price for a tier
   */
  public getAdditionalSeatPrice(tier: ISubscriptionTier): number {
    const config = this.getConfig(tier);
    return config.seatPricing.additionalSeatPriceCents;
  }

  /**
   * Get property limit for a tier
   */
  public getPropertyLimit(tier: ISubscriptionTier): number {
    const config = this.getConfig(tier);
    return config.limits.maxProperties;
  }

  /**
   * Get unit limit for a tier
   */
  public getUnitLimit(tier: ISubscriptionTier): number {
    const config = this.getConfig(tier);
    return config.limits.maxUnits;
  }

  /**
   * Get plan name for a tier
   */
  public getPlanName(tier: ISubscriptionTier): string {
    const config = this.getConfig(tier);
    return config.name;
  }
}

// Export singleton instance for easy access
export const subscriptionPlanConfig = SubscriptionPlanConfig.getInstance();
