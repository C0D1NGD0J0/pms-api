import { subscriptionPlanConfig } from '@services/subscription/subscription_plans.config';

describe('SubscriptionPlanConfig Unit Tests', () => {
  describe('getConfig', () => {
    it('should return correct config for essential plan', () => {
      const config = subscriptionPlanConfig.getConfig('essential');

      expect(config.name).toBe('Essential');
      expect(config.transactionFeePercent).toBe(3.5);
      expect(config.limits.maxProperties).toBe(3);
      expect(config.features.eSignature).toBe(false);
    });

    it('should return correct config for growth plan', () => {
      const config = subscriptionPlanConfig.getConfig('growth');

      expect(config.name).toBe('Growth');
      expect(config.transactionFeePercent).toBe(3.0);
      expect(config.limits.maxProperties).toBe(15);
      expect(config.features.eSignature).toBe(true);
    });

    it('should return correct config for portfolio plan', () => {
      const config = subscriptionPlanConfig.getConfig('portfolio');

      expect(config.name).toBe('Portfolio');
      expect(config.transactionFeePercent).toBe(2.8);
      expect(config.limits.maxProperties).toBe(30);
      expect(config.seatPricing.includedSeats).toBe(25);
    });
  });

  describe('getAllPlans', () => {
    it('should return all three plan names', () => {
      const plans = subscriptionPlanConfig.getAllPlans();

      expect(plans).toHaveLength(3);
      expect(plans).toContain('essential');
      expect(plans).toContain('growth');
      expect(plans).toContain('portfolio');
    });
  });

  describe('canAddProperty', () => {
    it('should allow adding property when under limit', () => {
      const canAdd = subscriptionPlanConfig.canAddProperty(2, 'essential');
      expect(canAdd).toBe(true);
    });

    it('should prevent adding property when at limit', () => {
      const canAdd = subscriptionPlanConfig.canAddProperty(3, 'essential');
      expect(canAdd).toBe(false);
    });

    it('should respect property limit for portfolio', () => {
      const canAdd = subscriptionPlanConfig.canAddProperty(29, 'portfolio');
      expect(canAdd).toBe(true);

      const cannotAdd = subscriptionPlanConfig.canAddProperty(30, 'portfolio');
      expect(cannotAdd).toBe(false);
    });
  });

  describe('calculatePrice', () => {
    it('should calculate essential plan with no additional seats', () => {
      const price = subscriptionPlanConfig.calculatePrice('essential', 'monthly', 0);
      expect(price).toBe(0);
    });

    it('should calculate growth plan with additional seats', () => {
      const price = subscriptionPlanConfig.calculatePrice('growth', 'monthly', 5);
      expect(price).toBe(5400);
    });

    it('should calculate portfolio plan with additional seats', () => {
      const price = subscriptionPlanConfig.calculatePrice('portfolio', 'monthly', 10);
      expect(price).toBe(17890);
    });
  });

  describe('hasFeature', () => {
    it('should return false for eSignature on essential plan', () => {
      expect(subscriptionPlanConfig.hasFeature('essential', 'eSignature')).toBe(false);
    });

    it('should return true for eSignature on growth plan', () => {
      expect(subscriptionPlanConfig.hasFeature('growth', 'eSignature')).toBe(true);
    });

    it('should return true for reportingAnalytics on portfolio plan', () => {
      expect(subscriptionPlanConfig.hasFeature('portfolio', 'reportingAnalytics')).toBe(true);
    });
  });

  describe('getTransactionFeePercent', () => {
    it('should return correct fees for each plan', () => {
      expect(subscriptionPlanConfig.getTransactionFeePercent('essential')).toBe(3.5);
      expect(subscriptionPlanConfig.getTransactionFeePercent('growth')).toBe(3.0);
      expect(subscriptionPlanConfig.getTransactionFeePercent('portfolio')).toBe(2.8);
    });
  });
});
