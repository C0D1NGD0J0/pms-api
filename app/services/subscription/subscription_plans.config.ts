import * as fs from 'fs';
import * as path from 'path';
import { ISubscriptionPlansConfig, PlanName } from '@interfaces/subscription.interface';

const CONFIG_PATH = path.join(process.cwd(), 'configs', 'platform.config.json');
let platformConfig: any;

try {
  const configData = fs.readFileSync(CONFIG_PATH, 'utf-8');
  platformConfig = JSON.parse(configData);
} catch (error) {
  console.error('Failed to load platform.config.json:', error);
  throw new Error('Platform configuration file not found or invalid');
}

const PLAN_CONFIGS: Record<PlanName, ISubscriptionPlansConfig> = platformConfig.subscriptionPlans;

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

  /**
   * Get payment gateway processing fees
   * @param provider - Payment gateway provider (e.g., 'stripe', 'paypal')
   * @returns Processing fees configuration
   *
   * NOTE: This is an estimate. Actual fees should be fetched from gateway API
   * after payment (e.g., Stripe Balance Transaction) and updated via webhook.
   */
  public getPaymentGatewayFees(provider: string = 'stripe'): {
    percentRate: number;
    fixedFeeCents: number;
    description: string;
  } {
    const gateway = platformConfig.paymentGateways[provider];
    if (!gateway) {
      throw new Error(`Payment gateway not found: ${provider}`);
    }

    return gateway.processingFee;
  }

  /**
   * Calculate payment gateway processing fee (ESTIMATION ONLY)
   * @param amountInCents - Transaction amount in cents
   * @param provider - Payment gateway provider
   * @returns Estimated processing fee in cents
   *
   * IMPORTANT: This is an ESTIMATE for budgeting purposes.
   * Actual fees vary by card type, country, etc.
   * Update payment record with actual fees from gateway API after payment succeeds.
   */
  public calculatePaymentGatewayFee(amountInCents: number, provider: string = 'stripe'): number {
    const fees = this.getPaymentGatewayFees(provider);
    return Math.round((amountInCents * fees.percentRate) / 100) + fees.fixedFeeCents;
  }

  /**
   * Get all active payment gateways
   */
  public getActivePaymentGateways(): string[] {
    return Object.keys(platformConfig.paymentGateways).filter(
      (key) => platformConfig.paymentGateways[key].isActive
    );
  }

  /**
   * Get payment gateway config
   */
  public getPaymentGatewayConfig(provider: string) {
    const gateway = platformConfig.paymentGateways[provider];
    if (!gateway) {
      throw new Error(`Payment gateway not found: ${provider}`);
    }
    return gateway;
  }
}

export const subscriptionPlanConfig = SubscriptionPlanConfig.getInstance();
