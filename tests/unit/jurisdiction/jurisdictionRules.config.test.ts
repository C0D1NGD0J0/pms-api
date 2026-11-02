import { jurisdictionRulesConfig } from '@services/jurisdiction';

describe('jurisdictionRulesConfig', () => {
  describe('getRentGuideline', () => {
    it('returns the Ontario guideline for a known year', () => {
      expect(jurisdictionRulesConfig.getRentGuideline('ON', 2026)?.percentage).toBe(2.1);
      expect(jurisdictionRulesConfig.getRentGuideline('ON', 2027)?.percentage).toBe(1.9);
    });

    it('returns the BC guideline for a known year', () => {
      expect(jurisdictionRulesConfig.getRentGuideline('BC', 2026)?.percentage).toBe(2.3);
      expect(jurisdictionRulesConfig.getRentGuideline('BC', 2027)?.percentage).toBe(2.2);
    });

    it('is case-insensitive on the jurisdiction code', () => {
      expect(jurisdictionRulesConfig.getRentGuideline('on', 2026)?.percentage).toBe(2.1);
    });

    it('returns null for an unknown year or jurisdiction', () => {
      expect(jurisdictionRulesConfig.getRentGuideline('ON', 2000)).toBeNull();
      expect(jurisdictionRulesConfig.getRentGuideline('XX', 2026)).toBeNull();
    });
  });

  describe('getNoticePeriod', () => {
    it('returns the notice period for a known form', () => {
      expect(jurisdictionRulesConfig.getNoticePeriod('ON', 'N4')?.days).toBe(14);
      expect(jurisdictionRulesConfig.getNoticePeriod('ON', 'N1')?.days).toBe(90);
    });

    it('returns null for an unknown notice type', () => {
      expect(jurisdictionRulesConfig.getNoticePeriod('ON', 'ZZ')).toBeNull();
    });
  });

  describe('getForms / getFormsByContext', () => {
    it('returns all Ontario forms with their codes', () => {
      const forms = jurisdictionRulesConfig.getForms('ON');
      expect(forms.map((f) => f.code).sort()).toEqual(['L1', 'N1', 'N11', 'N12', 'N4']);
    });

    it('filters forms by context', () => {
      expect(
        jurisdictionRulesConfig.getFormsByContext('ON', 'rentIncrease').map((f) => f.code)
      ).toEqual(['N1']);
      expect(
        jurisdictionRulesConfig
          .getFormsByContext('ON', 'arrears')
          .map((f) => f.code)
          .sort()
      ).toEqual(['L1', 'N4']);
    });

    it('returns an empty array for an unknown jurisdiction', () => {
      expect(jurisdictionRulesConfig.getForms('XX')).toEqual([]);
      expect(jurisdictionRulesConfig.getFormsByContext('XX', 'rentIncrease')).toEqual([]);
    });
  });

  describe('getJurisdiction / getSupportedJurisdictions', () => {
    it('exposes the Ontario exemption rule', () => {
      const on = jurisdictionRulesConfig.getJurisdiction('ON');
      expect(on?.rentIncreaseRules.maxGuidelineCapPercent).toBe(2.5);
      expect(on?.rentIncreaseRules.notes).toMatch(/November 15, 2018/);
    });

    it('lists supported jurisdictions', () => {
      expect(jurisdictionRulesConfig.getSupportedJurisdictions().sort()).toEqual(['BC', 'ON']);
    });
  });
});
