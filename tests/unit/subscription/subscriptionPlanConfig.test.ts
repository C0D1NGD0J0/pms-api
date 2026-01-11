import { subscriptionPlanConfig } from '@services/subscription/subscription_plans.config';

describe('SubscriptionPlanConfig Unit Tests', () => {
  describe('getConfig', () => {
    it('should return correct config for personal plan', () => {
      const config = subscriptionPlanConfig.getConfig('personal');

      expect(config.name).toBe('Personal');
      expect(config.transactionFeePercent).toBe(3.5);
      expect(config.limits.maxProperties).toBe(3);
      expect(config.features.eSignature).toBe(false);
    });

    it('should return correct config for starter plan', () => {
      const config = subscriptionPlanConfig.getConfig('starter');

      expect(config.name).toBe('Starter');
      expect(config.transactionFeePercent).toBe(3.0);
      expect(config.limits.maxProperties).toBe(15);
      expect(config.features.eSignature).toBe(true);
    });

    it('should return correct config for professional plan', () => {
      const config = subscriptionPlanConfig.getConfig('professional');

      expect(config.name).toBe('Professional');
      expect(config.transactionFeePercent).toBe(2.8);
      expect(config.limits.maxProperties).toBe(25);
      expect(config.seatPricing.includedSeats).toBe(-1); // unlimited
    });
  });

  describe('getAllPlans', () => {
    it('should return all three plan names', () => {
      const plans = subscriptionPlanConfig.getAllPlans();

      expect(plans).toHaveLength(3);
      expect(plans).toContain('personal');
      expect(plans).toContain('starter');
      expect(plans).toContain('professional');
    });
  });

  describe('canAddProperty', () => {
    it('should allow adding property when under limit', () => {
      const canAdd = subscriptionPlanConfig.canAddProperty(2, 'personal');
      expect(canAdd).toBe(true);
    });

    it('should prevent adding property when at limit', () => {
      const canAdd = subscriptionPlanConfig.canAddProperty(3, 'personal');
      expect(canAdd).toBe(false);
    });

    it('should respect property limit for professional', () => {
      const canAdd = subscriptionPlanConfig.canAddProperty(24, 'professional');
      expect(canAdd).toBe(true);

      const cannotAdd = subscriptionPlanConfig.canAddProperty(25, 'professional');
      expect(cannotAdd).toBe(false);
    });
  });

  describe('calculatePrice', () => {
    it('should calculate personal plan with no additional seats', () => {
      const price = subscriptionPlanConfig.calculatePrice('personal', 0);
      expect(price).toBe(0);
    });

    it('should calculate starter plan with additional seats', () => {
      const price = subscriptionPlanConfig.calculatePrice('starter', 5);
      // Base: 0 + (5 * 500) = 2500
      expect(price).toBe(2500);
    });

    it('should calculate professional plan with no seat charges', () => {
      const price = subscriptionPlanConfig.calculatePrice('professional', 100);
      expect(price).toBe(0); // Unlimited seats, no charge
    });
  });

  describe('hasFeature', () => {
    it('should return false for eSignature on personal plan', () => {
      expect(subscriptionPlanConfig.hasFeature('personal', 'eSignature')).toBe(false);
    });

    it('should return true for eSignature on starter plan', () => {
      expect(subscriptionPlanConfig.hasFeature('starter', 'eSignature')).toBe(true);
    });

    it('should return true for reportingAnalytics on professional plan', () => {
      expect(subscriptionPlanConfig.hasFeature('professional', 'reportingAnalytics')).toBe(true);
    });
  });

  describe('getTransactionFeePercent', () => {
    it('should return correct fees for each plan', () => {
      expect(subscriptionPlanConfig.getTransactionFeePercent('personal')).toBe(3.5);
      expect(subscriptionPlanConfig.getTransactionFeePercent('starter')).toBe(3.0);
      expect(subscriptionPlanConfig.getTransactionFeePercent('professional')).toBe(2.8);
    });
  });
});
