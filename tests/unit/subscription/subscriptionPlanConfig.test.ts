import { subscriptionPlanConfig } from '@services/subscription/subscription_plans.config';

describe('SubscriptionPlanConfig Unit Tests', () => {
  describe('getConfig', () => {
    it('should return correct config for essential plan', () => {
      const config = subscriptionPlanConfig.getConfig('essential');

      expect(config.name).toBe('Essential');
      expect(config.transactionFeePercent).toBe(4.2);
      expect(config.limits.maxProperties).toBe(3);
      expect(config.features.eSignature).toBe(false);
    });

    it('should return correct config for growth plan', () => {
      const config = subscriptionPlanConfig.getConfig('growth');

      expect(config.name).toBe('Growth');
      expect(config.transactionFeePercent).toBe(3.9);
      expect(config.limits.maxProperties).toBe(8);
      expect(config.features.eSignature).toBe(true);
    });

    it('should return correct config for portfolio plan', () => {
      const config = subscriptionPlanConfig.getConfig('portfolio');

      expect(config.name).toBe('Portfolio');
      expect(config.transactionFeePercent).toBe(3.5);
      expect(config.limits.maxProperties).toBe(20);
      expect(config.seatPricing.includedSeats).toBe(25);
    });
  });

  describe('getAllPlans', () => {
    it('should return all plan names', () => {
      const plans = subscriptionPlanConfig.getAllPlans();

      expect(plans).toHaveLength(4);
      expect(plans).toContain('essential');
      expect(plans).toContain('growth');
      expect(plans).toContain('portfolio');
      expect(plans).toContain('enterprise');
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
      const canAdd = subscriptionPlanConfig.canAddProperty(19, 'portfolio');
      expect(canAdd).toBe(true);

      const cannotAdd = subscriptionPlanConfig.canAddProperty(20, 'portfolio');
      expect(cannotAdd).toBe(false);
    });
  });

  describe('calculatePrice', () => {
    it('should calculate essential plan with no additional seats', () => {
      const price = subscriptionPlanConfig.calculatePrice('essential', 'monthly', 0);
      expect(price).toBe(0);
    });

    it('should calculate growth plan monthly price', () => {
      const price = subscriptionPlanConfig.calculatePrice('growth', 'monthly', 0);
      expect(price).toBe(6999); // $69.99/month
    });

    it('should calculate growth plan annual price', () => {
      const price = subscriptionPlanConfig.calculatePrice('growth', 'annual', 0);
      expect(price).toBe(83988); // 12 × $69.99, no annual discount
    });

    it('should calculate growth plan with additional seats', () => {
      const price = subscriptionPlanConfig.calculatePrice('growth', 'monthly', 5);
      expect(price).toBe(10994); // 6999 + (5 * 799)
    });

    it('should calculate portfolio plan monthly price', () => {
      const price = subscriptionPlanConfig.calculatePrice('portfolio', 'monthly', 0);
      expect(price).toBe(14999); // $149.99/month
    });

    it('should calculate portfolio plan annual price', () => {
      const price = subscriptionPlanConfig.calculatePrice('portfolio', 'annual', 0);
      expect(price).toBe(179988); // 12 × $149.99, no annual discount
    });

    it('should calculate portfolio plan with additional seats', () => {
      const price = subscriptionPlanConfig.calculatePrice('portfolio', 'monthly', 10);
      expect(price).toBe(20989); // 14999 + (10 * 599)
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
      expect(subscriptionPlanConfig.getTransactionFeePercent('essential')).toBe(4.2);
      expect(subscriptionPlanConfig.getTransactionFeePercent('growth')).toBe(3.9);
      expect(subscriptionPlanConfig.getTransactionFeePercent('portfolio')).toBe(3.5);
    });
  });

  describe('getFormattedPrice', () => {
    it('should format essential plan as Free', () => {
      expect(subscriptionPlanConfig.getFormattedPrice('essential', 'monthly')).toBe('Free');
      expect(subscriptionPlanConfig.getFormattedPrice('essential', 'annual')).toBe('Free');
    });

    it('should format growth plan monthly price with decimals', () => {
      expect(subscriptionPlanConfig.getFormattedPrice('growth', 'monthly')).toBe('$69.99');
    });

    it('should format growth plan annual price with decimals', () => {
      expect(subscriptionPlanConfig.getFormattedPrice('growth', 'annual')).toBe('$839.88');
    });

    it('should format portfolio plan monthly price with decimals', () => {
      expect(subscriptionPlanConfig.getFormattedPrice('portfolio', 'monthly')).toBe('$149.99');
    });

    it('should format portfolio plan annual price with decimals', () => {
      expect(subscriptionPlanConfig.getFormattedPrice('portfolio', 'annual')).toBe('$1799.88');
    });
  });

  describe('resolvePlanByLookupKey', () => {
    it('should resolve portfolio from monthly lookup key', () => {
      expect(subscriptionPlanConfig.resolvePlanByLookupKey('portfolio_monthly_price')).toBe(
        'portfolio'
      );
    });

    it('should resolve growth from annual lookup key', () => {
      expect(subscriptionPlanConfig.resolvePlanByLookupKey('growth_annual_price')).toBe('growth');
    });

    it('should resolve essential', () => {
      expect(subscriptionPlanConfig.resolvePlanByLookupKey('essential_monthly_price')).toBe(
        'essential'
      );
    });

    it('should return null for unknown key', () => {
      expect(subscriptionPlanConfig.resolvePlanByLookupKey('unknown_plan_price')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(subscriptionPlanConfig.resolvePlanByLookupKey('')).toBeNull();
    });
  });

  describe('annual discount', () => {
    it('derives annual prices from monthly with no discount by default', () => {
      expect(subscriptionPlanConfig.getAnnualDiscountPercent()).toBe(0);
      for (const plan of ['growth', 'portfolio', 'enterprise'] as const) {
        const config = subscriptionPlanConfig.getConfig(plan);
        expect(config.pricing.annual.priceInCents).toBe(config.pricing.monthly.priceInCents * 12);
        expect(config.pricing.annual.savingsPercent).toBe(0);
      }
    });
  });

  describe('ACH fees', () => {
    it('charges the ACH percentage below the cap', () => {
      expect(subscriptionPlanConfig.calculateAchApplicationFee(100000)).toBe(1250); // 1.25% of $1,000
    });

    it('caps the ACH application fee at $30', () => {
      expect(subscriptionPlanConfig.getAchFeeCapCents()).toBe(3000);
      expect(subscriptionPlanConfig.calculateAchApplicationFee(350000)).toBe(3000); // $3,500 rent
    });

    it('caps the bank-debit gateway estimate at $5', () => {
      expect(
        subscriptionPlanConfig.calculatePaymentGatewayFee(100000, 'stripe', 'auto-debit')
      ).toBe(500); // 1% + $0.40 = $10.40, capped
      expect(subscriptionPlanConfig.calculatePaymentGatewayFee(20000, 'stripe', 'auto-debit')).toBe(
        240
      ); // 1% of $200 + $0.40
    });
  });
});
