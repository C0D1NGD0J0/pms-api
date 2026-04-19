import { describe, expect, it } from '@jest/globals';
import {
  calcApplicationFeeSplit,
  calcAnnualToMonthly,
  calcRentAdjustment,
  estimateNetIncome,
  calcGatewayFee,
  proRateAmount,
  calcSeatCost,
  calcLateFee,
} from '@utils/financial.utils';

// Dates use new Date(year, month-1, day) (local time) to avoid UTC-parse timezone shifts.

describe('proRateAmount', () => {
  it('returns full month when start day is 1', () => {
    const result = proRateAmount(200000, new Date(2024, 2, 1));
    expect(result).toMatchObject({ amount: 200000, isFullMonth: true, daysCharged: 31, daysInMonth: 31 });
  });

  it('pro-rates mid-month in a 30-day month', () => {
    // June 15: daysCharged = 16; ceil(150000 × 16 / 30) = 80000
    const result = proRateAmount(150000, new Date(2024, 5, 15));
    expect(result).toMatchObject({ amount: 80000, isFullMonth: false, daysCharged: 16, daysInMonth: 30 });
  });

  it('pro-rates mid-month in a 31-day month with ceiling rounding', () => {
    // March 15: daysCharged = 17; ceil(200000 × 17 / 31) = 109678
    const result = proRateAmount(200000, new Date(2024, 2, 15));
    expect(result).toMatchObject({ amount: 109678, isFullMonth: false, daysCharged: 17, daysInMonth: 31 });
  });

  it('charges 1 day when starting on the last day of the month', () => {
    // March 31: ceil(200000 × 1 / 31) = 6452
    const result = proRateAmount(200000, new Date(2024, 2, 31));
    expect(result).toMatchObject({ amount: 6452, daysCharged: 1 });
  });

  it('handles February (28 days, non-leap)', () => {
    // Feb 15: daysCharged = 14; ceil(120000 × 14 / 28) = 60000
    const result = proRateAmount(120000, new Date(2023, 1, 15));
    expect(result).toMatchObject({ amount: 60000, daysInMonth: 28, daysCharged: 14 });
  });

  it('handles February in a leap year (29 days)', () => {
    const result = proRateAmount(180000, new Date(2024, 1, 1));
    expect(result).toMatchObject({ isFullMonth: true, daysInMonth: 29 });
  });

  it('applies ceiling rounding: ceil(10000 × 1 / 30) = 334', () => {
    const result = proRateAmount(10000, new Date(2024, 3, 30));
    expect(result.amount).toBe(334);
  });
});

describe('calcLateFee', () => {
  it('returns percentage-based fee rounded half-up', () => expect(calcLateFee(150000, 'percentage', 5)).toBe(7500));
  it('passes through a fixed fee unchanged', () => expect(calcLateFee(200000, 'fixed', 5000)).toBe(5000));
  it('returns 0 for 0% or $0 fixed', () => {
    expect(calcLateFee(150000, 'percentage', 0)).toBe(0);
    expect(calcLateFee(150000, 'fixed', 0)).toBe(0);
  });
});

describe('calcGatewayFee', () => {
  it('calculates Stripe-style fee: 2.9% + 30¢ on $10 → 59¢', () => expect(calcGatewayFee(1000, 2.9, 30)).toBe(59));
  it('calculates Stripe-style fee on $100 → 320¢', () => expect(calcGatewayFee(10000, 2.9, 30)).toBe(320));
  it('returns only fixed fee when percent rate is 0', () => expect(calcGatewayFee(50000, 0, 30)).toBe(30));
});

describe('calcApplicationFeeSplit', () => {
  it('splits charge into applicationFee, gatewayFee, and platformRevenue', () => {
    const result = calcApplicationFeeSplit(20000, 0.02, () => 30);
    expect(result).toEqual({ applicationFee: 400, gatewayFee: 30, platformRevenue: 370 });
  });

  it('platformRevenue can be negative when gatewayFee exceeds applicationFee', () => {
    const result = calcApplicationFeeSplit(100, 0.005, () => 30);
    expect(result.platformRevenue).toBeLessThan(0);
  });

  it('passes the total amount to the gateway fee function', () => {
    let received = -1;
    calcApplicationFeeSplit(15000, 0.02, (amt) => { received = amt; return 0; });
    expect(received).toBe(15000);
  });
});

describe('calcRentAdjustment', () => {
  it('throws when percentage < -100', () => {
    expect(() => calcRentAdjustment(200000, -101)).toThrow('Percentage cannot be less than -100%');
  });
  it('produces newAmount of 0 at exactly -100%', () => {
    expect(calcRentAdjustment(200000, -100)).toMatchObject({ newAmount: 0, difference: -200000 });
  });
  it('increases rent by positive percentage', () => {
    expect(calcRentAdjustment(150000, 10)).toMatchObject({ newAmount: 165000, difference: 15000 });
  });
  it('decreases rent by negative percentage', () => {
    expect(calcRentAdjustment(200000, -20)).toMatchObject({ newAmount: 160000, difference: -40000 });
  });
  it('rounds fractional result half-up: 100 × 1.035 = 103.5 → 104', () => {
    expect(calcRentAdjustment(100, 3.5).newAmount).toBe(104);
  });
});

describe('estimateNetIncome', () => {
  it('returns 90% of gross rent', () => expect(estimateNetIncome(200000)).toBe(180000));
  it('returns 0 for 0 input', () => expect(estimateNetIncome(0)).toBe(0));
});

describe('calcAnnualToMonthly', () => {
  it('divides annual price by 12', () => expect(calcAnnualToMonthly(120000)).toBe(10000));
  it('rounds half-up when not evenly divisible', () => expect(calcAnnualToMonthly(100)).toBe(8));
});

describe('calcSeatCost', () => {
  it('returns seat count × per-seat price', () => expect(calcSeatCost(5, 1000)).toBe(5000));
  it('returns 0 for 0 seats', () => expect(calcSeatCost(0, 1000)).toBe(0));
  it('returns negative cost for removal delta', () => expect(calcSeatCost(-3, 1000)).toBe(-3000));
});
