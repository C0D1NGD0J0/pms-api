import { describe, expect, it } from '@jest/globals';
import { DEFAULT_LATE_FEE_GRACE_DAYS, FinancialCalculator } from '@utils/financial';

describe('FinancialCalculator.percentOf', () => {
  it('rounds half up in cents', () => {
    expect(FinancialCalculator.percentOf(10000, 4.2)).toBe(420);
    expect(FinancialCalculator.percentOf(500, 2.9)).toBe(15); // float Math.round gives 14
    expect(FinancialCalculator.percentOf(0, 5)).toBe(0);
  });
});

describe('FinancialCalculator.seatCost', () => {
  it('multiplies seats by the price per seat', () => {
    expect(FinancialCalculator.seatCost(2, 1500)).toBe(3000);
  });
});

describe('FinancialCalculator.proportionalShare', () => {
  it('scales an amount to part/whole, rounding half up', () => {
    // instant payout capped at 1,000,000 of 1,500,000 net: fee 4500 → 3000
    expect(FinancialCalculator.proportionalShare(4500, 1000000, 1500000)).toBe(3000);
    expect(FinancialCalculator.proportionalShare(100, 1, 3)).toBe(33);
    expect(FinancialCalculator.proportionalShare(100, 2, 3)).toBe(67);
  });
});

describe('FinancialCalculator.annualFromMonthly', () => {
  it('charges 12 months less the discount', () => {
    expect(FinancialCalculator.annualFromMonthly(4900, 0)).toBe(58800);
    expect(FinancialCalculator.annualFromMonthly(4900, 20)).toBe(47040);
    expect(FinancialCalculator.annualFromMonthly(999, 15)).toBe(10190); // 10189.8 → 10190
  });
});

describe('FinancialCalculator.daysLate', () => {
  const dueDate = new Date('2026-10-01T00:00:00Z');

  it('counts whole calendar days after the due date', () => {
    expect(FinancialCalculator.daysLate(dueDate, new Date('2026-10-06T00:00:00Z'))).toBe(5);
    expect(FinancialCalculator.daysLate(dueDate, new Date('2026-10-06T23:59:59Z'))).toBe(5);
  });

  it('is 0 on or before the due date', () => {
    expect(FinancialCalculator.daysLate(dueDate, new Date('2026-10-01T18:00:00Z'))).toBe(0);
    expect(FinancialCalculator.daysLate(dueDate, new Date('2026-09-28T00:00:00Z'))).toBe(0);
  });

  it('ignores the time of day on the due date', () => {
    const afternoonDue = new Date('2026-10-01T15:00:00Z');
    expect(FinancialCalculator.daysLate(afternoonDue, new Date('2026-10-06T10:00:00Z'))).toBe(5);
  });

  it('counts across month and DST boundaries without drift', () => {
    expect(
      FinancialCalculator.daysLate(
        new Date('2026-10-30T00:00:00Z'),
        new Date('2026-11-03T00:00:00Z')
      )
    ).toBe(4);
  });

  it('defaults asOf to now', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(FinancialCalculator.daysLate(yesterday)).toBe(1);
  });
});

describe('FinancialCalculator.paymentTotal', () => {
  it('leaves out the absorbed gateway cost on online payments', () => {
    const online = { baseAmount: 150000, processingFee: 4380, paymentMethod: 'online' };
    expect(FinancialCalculator.tenantProcessingFee(online)).toBe(0);
    expect(FinancialCalculator.paymentTotal(online)).toBe(150000);
  });

  it('adds the fee a PM recorded on a manual entry', () => {
    const manual = { baseAmount: 150000, processingFee: 500, paymentMethod: 'check' };
    expect(FinancialCalculator.tenantProcessingFee(manual)).toBe(500);
    expect(FinancialCalculator.paymentTotal(manual)).toBe(150500);
  });

  it('treats a missing fee as 0', () => {
    expect(FinancialCalculator.paymentTotal({ baseAmount: 1000, paymentMethod: 'cash' })).toBe(
      1000
    );
  });
});

describe('FinancialCalculator.refundableRemaining', () => {
  it('subtracts what was already refunded and never goes below 0', () => {
    expect(FinancialCalculator.refundableRemaining(150000, 30000)).toBe(120000);
    expect(FinancialCalculator.refundableRemaining(150000)).toBe(150000);
    expect(FinancialCalculator.refundableRemaining(150000, 999999)).toBe(0);
  });
});

describe('FinancialCalculator.managementFeePercentage', () => {
  it('returns a 2-decimal string share of rent', () => {
    expect(FinancialCalculator.managementFeePercentage(17000, 200000)).toBe('8.50');
    expect(FinancialCalculator.managementFeePercentage(10000, 30000)).toBe('33.33');
  });

  it('returns "0.00" when rent is zero or missing', () => {
    expect(FinancialCalculator.managementFeePercentage(17000, 0)).toBe('0.00');
    expect(FinancialCalculator.managementFeePercentage(17000, NaN)).toBe('0.00');
  });
});

describe('FinancialCalculator.propertyFeeBreakdown', () => {
  it('matches the shape and values Property.calculateFees has always returned', () => {
    const result = FinancialCalculator.propertyFeeBreakdown({
      rentAmount: 200000,
      managementFees: 17000,
      securityDeposit: 400000,
      currency: 'CAD',
    });

    expect(result).toEqual({
      monthly: { rental: 200000, management: 17000, total: 217000 },
      annual: { total: 2604000 },
      deposits: { security: 400000 },
      analysis: { managementFeePercentage: '8.50' },
      currency: 'CAD',
    });
  });

  it('defaults missing fees to zero and currency to USD', () => {
    expect(FinancialCalculator.propertyFeeBreakdown(undefined)).toEqual({
      monthly: { rental: 0, management: 0, total: 0 },
      annual: { total: 0 },
      deposits: { security: 0 },
      analysis: { managementFeePercentage: '0.00' },
      currency: 'USD',
    });
  });
});

describe('FinancialCalculator.leaseFeeBreakdown', () => {
  const lease = {
    fees: {
      rentAmount: 150000,
      securityDeposit: 300000,
      lateFeeDays: 3,
      lateFeeType: 'fixed' as const,
      lateFeeAmount: 5000,
      currency: 'CAD',
    },
    petPolicy: { monthlyFee: 2500, deposit: 20000 },
  };

  it('sums rent + pet fee and both deposits, without the management fee', () => {
    const result = FinancialCalculator.leaseFeeBreakdown(lease);
    expect(result.monthly).toEqual({ rent: 150000, petFee: 2500, total: 152500 });
    expect(result.deposits).toEqual({ security: 300000, pet: 20000, total: 320000 });
    expect(result.currency).toBe('CAD');
  });

  it('charges no late fee before the grace period ends', () => {
    expect(FinancialCalculator.leaseFeeBreakdown(lease, { daysLate: 2 }).late).toEqual({
      daysLate: 2,
      fee: 0,
      type: 'fixed',
      percentage: undefined,
      gracePeriod: 3,
    });
  });

  it('charges the fixed late fee once daysLate reaches the grace period', () => {
    expect(FinancialCalculator.leaseFeeBreakdown(lease, { daysLate: 3 }).late.fee).toBe(5000);
  });

  it('charges a percentage of base rent for percentage late fees', () => {
    const percentageLease = {
      ...lease,
      fees: { ...lease.fees, lateFeeType: 'percentage' as const, lateFeePercentage: 5 },
    };
    expect(FinancialCalculator.leaseFeeBreakdown(percentageLease, { daysLate: 10 }).late.fee).toBe(
      7500
    );
  });

  it('falls back to the default grace period when the lease has none', () => {
    const noGrace = { ...lease, fees: { ...lease.fees, lateFeeDays: undefined } };
    const result = FinancialCalculator.leaseFeeBreakdown(noGrace, {
      daysLate: DEFAULT_LATE_FEE_GRACE_DAYS - 1,
    });
    expect(result.late).toMatchObject({ gracePeriod: DEFAULT_LATE_FEE_GRACE_DAYS, fee: 0 });
  });

  it('handles a lease with no fees or pet policy', () => {
    const result = FinancialCalculator.leaseFeeBreakdown({ fees: null, petPolicy: null });
    expect(result.monthly.total).toBe(0);
    expect(result.deposits.total).toBe(0);
    expect(result.currency).toBe('USD');
  });
});

describe('FinancialCalculator.leaseMonthlyFees', () => {
  it('adds the property management fee only when the lease opts in', () => {
    const lease = {
      fees: { rentAmount: 150000, securityDeposit: 300000 },
      petPolicy: { monthlyFee: 2500 },
      propertyInfo: { fees: { managementFees: 10000 } },
    };

    expect(FinancialCalculator.leaseMonthlyFees(lease).totalMonthlyRent).toBe(152500);
    expect(
      FinancialCalculator.leaseMonthlyFees({ ...lease, includeManagementFee: true })
        .totalMonthlyRent
    ).toBe(162500);
  });
});
