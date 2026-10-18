import { MAX_REPORT_EMAIL_RECIPIENTS } from '@interfaces/report.interface';
import {
  subscriptionPlanConfig,
  UNLIMITED_PLAN_LIMIT,
  isWithinLimit,
  remainingFor,
  isUnlimited,
  overageFor,
} from '@services/subscription/subscription_plans.config';

describe('Plan limit helpers (-1 = unlimited)', () => {
  describe('isUnlimited', () => {
    it('treats -1 as unlimited', () => {
      expect(UNLIMITED_PLAN_LIMIT).toBe(-1);
      expect(isUnlimited(-1)).toBe(true);
    });

    it('treats zero and positive limits as finite', () => {
      expect(isUnlimited(0)).toBe(false);
      expect(isUnlimited(10)).toBe(false);
      expect(isUnlimited(undefined)).toBe(false);
    });
  });

  describe('isWithinLimit', () => {
    it('always allows one more when the limit is unlimited', () => {
      expect(isWithinLimit(0, -1)).toBe(true);
      expect(isWithinLimit(1_000_000, -1)).toBe(true);
    });

    it('allows one more only while the count is below a finite limit', () => {
      expect(isWithinLimit(9, 10)).toBe(true);
      expect(isWithinLimit(10, 10)).toBe(false);
      expect(isWithinLimit(0, 0)).toBe(false);
    });
  });

  describe('remainingFor', () => {
    it('returns null when the limit is unlimited', () => {
      expect(remainingFor(42, -1)).toBeNull();
    });

    it('returns the non-negative remainder for a finite limit', () => {
      expect(remainingFor(3, 10)).toBe(7);
      expect(remainingFor(12, 10)).toBe(0);
    });
  });

  describe('overageFor', () => {
    it('never reports overage when the limit is unlimited', () => {
      expect(overageFor(0, -1)).toBe(0);
      expect(overageFor(500, -1)).toBe(0);
    });

    it('reports how far the count exceeds a finite limit', () => {
      expect(overageFor(5, 2)).toBe(3);
      expect(overageFor(2, 2)).toBe(0);
    });
  });
});

describe('Report email recipient cap', () => {
  it('matches the highest per-plan maxReportEmails', () => {
    const highestPlanLimit = Math.max(
      ...subscriptionPlanConfig
        .getAllPlans()
        .map((plan) => subscriptionPlanConfig.getReportLimits(plan).maxReportEmails)
    );
    expect(MAX_REPORT_EMAIL_RECIPIENTS).toBe(highestPlanLimit);
    expect(subscriptionPlanConfig.getReportLimits('enterprise').maxReportEmails).toBe(25);
  });
});
