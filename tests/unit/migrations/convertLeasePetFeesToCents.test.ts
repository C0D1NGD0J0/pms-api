import { planPetFeeConversion } from '../../../scripts/migrations/convertLeasePetFeesToCents';

describe('planPetFeeConversion', () => {
  it('converts dollar pet fees to cents and sets only the non-zero fields', () => {
    expect(planPetFeeConversion({ deposit: 300, monthlyFee: 25 })).toEqual({
      action: 'convert',
      set: { 'petPolicy.deposit': 30000, 'petPolicy.monthlyFee': 2500 },
    });
    expect(planPetFeeConversion({ deposit: 0, monthlyFee: 40 })).toEqual({
      action: 'convert',
      set: { 'petPolicy.monthlyFee': 4000 },
    });
  });

  it('treats fractional values as dollars even above the threshold', () => {
    expect(planPetFeeConversion({ deposit: 1250.5 })).toEqual({
      action: 'convert',
      set: { 'petPolicy.deposit': 125050 },
    });
  });

  it('rounds half-up to whole cents', () => {
    expect(planPetFeeConversion({ monthlyFee: 19.995 })).toEqual({
      action: 'convert',
      set: { 'petPolicy.monthlyFee': 2000 },
    });
  });

  it('never converts a lease already marked feesInCents (idempotent)', () => {
    expect(planPetFeeConversion({ deposit: 300, feesInCents: true })).toEqual({
      action: 'skip',
      reason: 'already converted',
    });
  });

  it('reports integer values at or above the threshold as ambiguous', () => {
    expect(planPetFeeConversion({ deposit: 30000, monthlyFee: 25 }).action).toBe('ambiguous');
    expect(planPetFeeConversion({ deposit: 1000 }).action).toBe('ambiguous');
    expect(planPetFeeConversion({ deposit: 600 }, 500).action).toBe('ambiguous');
  });

  it('skips leases without a pet policy or pet fees', () => {
    expect(planPetFeeConversion(undefined).action).toBe('skip');
    expect(planPetFeeConversion({ deposit: 0, monthlyFee: null }).action).toBe('skip');
  });
});
