import { describe, expect, it } from '@jest/globals';
import { FinancialCalculator } from '@utils/financial';

// Lease dates are stored as midnight UTC, so fixtures use Date.UTC(year, month-1, day).

describe('FinancialCalculator.proRateFirstMonth', () => {
  it('returns full month when start day is 1', () => {
    const result = FinancialCalculator.proRateFirstMonth(200000, new Date(Date.UTC(2024, 2, 1)));
    expect(result).toMatchObject({
      amount: 200000,
      isFullMonth: true,
      daysCharged: 31,
      daysInMonth: 31,
    });
  });

  it('pro-rates mid-month in a 30-day month', () => {
    // June 15: daysCharged = 16; ceil(150000 × 16 / 30) = 80000
    const result = FinancialCalculator.proRateFirstMonth(150000, new Date(Date.UTC(2024, 5, 15)));
    expect(result).toMatchObject({
      amount: 80000,
      isFullMonth: false,
      daysCharged: 16,
      daysInMonth: 30,
    });
  });

  it('pro-rates mid-month in a 31-day month with ceiling rounding', () => {
    // March 15: daysCharged = 17; ceil(200000 × 17 / 31) = 109678
    const result = FinancialCalculator.proRateFirstMonth(200000, new Date(Date.UTC(2024, 2, 15)));
    expect(result).toMatchObject({
      amount: 109678,
      isFullMonth: false,
      daysCharged: 17,
      daysInMonth: 31,
    });
  });

  it('charges 1 day when starting on the last day of the month', () => {
    // March 31: ceil(200000 × 1 / 31) = 6452
    const result = FinancialCalculator.proRateFirstMonth(200000, new Date(Date.UTC(2024, 2, 31)));
    expect(result).toMatchObject({ amount: 6452, daysCharged: 1 });
  });

  it('handles February (28 days, non-leap)', () => {
    // Feb 15: daysCharged = 14; ceil(120000 × 14 / 28) = 60000
    const result = FinancialCalculator.proRateFirstMonth(120000, new Date(Date.UTC(2023, 1, 15)));
    expect(result).toMatchObject({ amount: 60000, daysInMonth: 28, daysCharged: 14 });
  });

  it('handles February in a leap year (29 days)', () => {
    const result = FinancialCalculator.proRateFirstMonth(180000, new Date(Date.UTC(2024, 1, 1)));
    expect(result).toMatchObject({ isFullMonth: true, daysInMonth: 29 });
  });

  it('applies ceiling rounding: ceil(10000 × 1 / 30) = 334', () => {
    const result = FinancialCalculator.proRateFirstMonth(10000, new Date(Date.UTC(2024, 3, 30)));
    expect(result.amount).toBe(334);
  });
});

describe('FinancialCalculator pro-ration with stored lease dates', () => {
  // A date saved from "2026-01-01" is midnight UTC — the 31st of December on a server in a
  // negative UTC offset, which read with local accessors charged 1 day instead of a full month.
  it('reads the stored start date as the 1st, whatever the server timezone', () => {
    const result = FinancialCalculator.proRateFirstMonth(200000, new Date('2026-01-01T00:00:00Z'));
    expect(result).toMatchObject({ amount: 200000, isFullMonth: true, daysInMonth: 31 });
  });

  it('reads the stored end date as the last day of the month', () => {
    const result = FinancialCalculator.proRateLastMonth(200000, new Date('2026-02-28T00:00:00Z'));
    expect(result).toMatchObject({ amount: 200000, isFullMonth: true, daysInMonth: 28 });
  });
});

describe('FinancialCalculator.proRateLastMonth', () => {
  it('returns full month when end day is the last day of the month', () => {
    // March 31 — full month
    const result = FinancialCalculator.proRateLastMonth(200000, new Date(Date.UTC(2024, 2, 31)));
    expect(result).toMatchObject({
      amount: 200000,
      isFullMonth: true,
      daysCharged: 31,
      daysInMonth: 31,
    });
  });

  it('pro-rates mid-month in a 30-day month', () => {
    // June 15: daysCharged=15; ceil(150000 × 15 / 30) = 75000
    const result = FinancialCalculator.proRateLastMonth(150000, new Date(Date.UTC(2024, 5, 15)));
    expect(result).toMatchObject({
      amount: 75000,
      isFullMonth: false,
      daysCharged: 15,
      daysInMonth: 30,
    });
  });

  it('pro-rates mid-month in a 31-day month with ceiling rounding', () => {
    // March 15: daysCharged=15; ceil(200000 × 15 / 31) = 96775
    const result = FinancialCalculator.proRateLastMonth(200000, new Date(Date.UTC(2024, 2, 15)));
    expect(result).toMatchObject({
      amount: 96775,
      isFullMonth: false,
      daysCharged: 15,
      daysInMonth: 31,
    });
  });

  it('charges 1 day when ending on the first day of the month', () => {
    // April 1: ceil(200000 × 1 / 30) = 6667
    const result = FinancialCalculator.proRateLastMonth(200000, new Date(Date.UTC(2024, 3, 1)));
    expect(result).toMatchObject({ amount: 6667, daysCharged: 1, daysInMonth: 30 });
  });

  it('handles February (28 days, non-leap)', () => {
    // Feb 14: daysCharged=14; ceil(120000 × 14 / 28) = 60000
    const result = FinancialCalculator.proRateLastMonth(120000, new Date(Date.UTC(2023, 1, 14)));
    expect(result).toMatchObject({ amount: 60000, daysInMonth: 28, daysCharged: 14 });
  });

  it('handles February in a leap year (29 days)', () => {
    // Feb 29 — full last month
    const result = FinancialCalculator.proRateLastMonth(180000, new Date(Date.UTC(2024, 1, 29)));
    expect(result).toMatchObject({ isFullMonth: true, daysInMonth: 29, daysCharged: 29 });
  });

  it('returns dailyRate as ceil(rentAmount / daysInMonth)', () => {
    // June: ceil(150000 / 30) = 5000
    const result = FinancialCalculator.proRateLastMonth(150000, new Date(Date.UTC(2024, 5, 15)));
    expect(result.dailyRate).toBe(5000);
  });

  it('dailyRate uses ceiling when not evenly divisible', () => {
    // March: ceil(200000 / 31) = 6452
    const result = FinancialCalculator.proRateLastMonth(200000, new Date(Date.UTC(2024, 2, 15)));
    expect(result.dailyRate).toBe(6452);
  });

  it('mirrors FinancialCalculator.proRateFirstMonth symmetry: first-day start + last-day end = full month each', () => {
    const first = FinancialCalculator.proRateFirstMonth(200000, new Date(Date.UTC(2024, 2, 1)));
    const last = FinancialCalculator.proRateLastMonth(200000, new Date(Date.UTC(2024, 2, 31)));
    expect(first.isFullMonth).toBe(true);
    expect(last.isFullMonth).toBe(true);
  });
});

describe('first payment composition (FinancialCalculator.proRateFirstMonth + deposits)', () => {
  it('full first payment = pro-rated rent + security deposit + pet fee + pet deposit', () => {
    // June 15: daysCharged=16, ceil(150000 × 16/30) = 80000
    const proRated = FinancialCalculator.proRateFirstMonth(150000, new Date(Date.UTC(2024, 5, 15)));
    const securityDeposit = 150000;
    const petMonthlyFee = 5000;
    const petDeposit = 25000;
    const firstPayment = proRated.amount + securityDeposit + petMonthlyFee + petDeposit;
    expect(firstPayment).toBe(260000); // 80000 + 150000 + 5000 + 25000
  });

  it('first payment with no pets = pro-rated rent + security deposit only', () => {
    const proRated = FinancialCalculator.proRateFirstMonth(200000, new Date(Date.UTC(2024, 2, 1))); // full month
    const firstPayment = proRated.amount + 200000;
    expect(firstPayment).toBe(400000);
  });
});

describe('FinancialCalculator.lateFee', () => {
  it('returns percentage-based fee rounded half-up', () =>
    expect(FinancialCalculator.lateFee(150000, 'percentage', 5)).toBe(7500));
  it('passes through a fixed fee unchanged', () =>
    expect(FinancialCalculator.lateFee(200000, 'fixed', 5000)).toBe(5000));
  it('returns 0 for 0% or $0 fixed', () => {
    expect(FinancialCalculator.lateFee(150000, 'percentage', 0)).toBe(0);
    expect(FinancialCalculator.lateFee(150000, 'fixed', 0)).toBe(0);
  });
});

describe('FinancialCalculator.gatewayFee', () => {
  it('calculates Stripe-style fee: 2.9% + 30¢ on $10 → 59¢', () =>
    expect(FinancialCalculator.gatewayFee(1000, 2.9, 30)).toBe(59));
  it('calculates Stripe-style fee on $100 → 320¢', () =>
    expect(FinancialCalculator.gatewayFee(10000, 2.9, 30)).toBe(320));
  it('returns only fixed fee when percent rate is 0', () =>
    expect(FinancialCalculator.gatewayFee(50000, 0, 30)).toBe(30));
  it('caps the fee at maxFeeCents (Canadian PAD: 1% + 40¢, max $5)', () =>
    expect(FinancialCalculator.gatewayFee(250000, 1, 40, 500)).toBe(500));
  it('leaves fees under the cap unchanged', () =>
    expect(FinancialCalculator.gatewayFee(20000, 1, 40, 500)).toBe(240));
});

describe('FinancialCalculator.applicationFeeSplit', () => {
  it('splits charge into applicationFee, gatewayFee, and platformRevenue', () => {
    // 2% of 20000 cents = 400 cents app fee
    const result = FinancialCalculator.applicationFeeSplit(20000, 2, () => 30);
    expect(result).toEqual({ applicationFee: 400, gatewayFee: 30, platformRevenue: 370 });
  });

  it('platformRevenue can be negative when gatewayFee exceeds applicationFee', () => {
    // 0.5% of 100 cents = 1 cent app fee, gateway fee = 30 → negative
    const result = FinancialCalculator.applicationFeeSplit(100, 0.5, () => 30);
    expect(result.platformRevenue).toBeLessThan(0);
  });

  it('passes the total amount to the gateway fee function', () => {
    let received = -1;
    FinancialCalculator.applicationFeeSplit(15000, 2, (amt) => {
      received = amt;
      return 0;
    });
    expect(received).toBe(15000);
  });

  it('handles real plan config values (3.5% basic plan)', () => {
    // 3.5% of 275000 cents (C$2,750) = 9625 cents ($96.25)
    const result = FinancialCalculator.applicationFeeSplit(275000, 3.5, () => 0);
    expect(result.applicationFee).toBe(9625);
  });
});

describe('FinancialCalculator.rentAdjustment', () => {
  it('throws when percentage < -100', () => {
    expect(() => FinancialCalculator.rentAdjustment(200000, -101)).toThrow(
      'Percentage cannot be less than -100%'
    );
  });
  it('produces newAmount of 0 at exactly -100%', () => {
    expect(FinancialCalculator.rentAdjustment(200000, -100)).toMatchObject({
      newAmount: 0,
      difference: -200000,
    });
  });
  it('increases rent by positive percentage', () => {
    expect(FinancialCalculator.rentAdjustment(150000, 10)).toMatchObject({
      newAmount: 165000,
      difference: 15000,
    });
  });
  it('decreases rent by negative percentage', () => {
    expect(FinancialCalculator.rentAdjustment(200000, -20)).toMatchObject({
      newAmount: 160000,
      difference: -40000,
    });
  });
  it('rounds fractional result half-up: 100 × 1.035 = 103.5 → 104', () => {
    expect(FinancialCalculator.rentAdjustment(100, 3.5).newAmount).toBe(104);
  });
});

describe('FinancialCalculator.estimateNetIncome', () => {
  it('returns 90% of gross rent', () =>
    expect(FinancialCalculator.estimateNetIncome(200000)).toBe(180000));
  it('returns 0 for 0 input', () => expect(FinancialCalculator.estimateNetIncome(0)).toBe(0));
});

describe('FinancialCalculator.annualToMonthly', () => {
  it('divides annual price by 12', () =>
    expect(FinancialCalculator.annualToMonthly(120000)).toBe(10000));
  it('rounds half-up when not evenly divisible', () =>
    expect(FinancialCalculator.annualToMonthly(100)).toBe(8));
});

describe('FinancialCalculator.seatCost', () => {
  it('returns seat count × per-seat price', () =>
    expect(FinancialCalculator.seatCost(5, 1000)).toBe(5000));
  it('returns 0 for 0 seats', () => expect(FinancialCalculator.seatCost(0, 1000)).toBe(0));
  it('returns negative cost for removal delta', () =>
    expect(FinancialCalculator.seatCost(-3, 1000)).toBe(-3000));
  it('returns an integer (no fractional cents)', () =>
    expect(Number.isInteger(FinancialCalculator.seatCost(3, 333))).toBe(true));
});

describe('FinancialCalculator.leaseMonthlyFees', () => {
  function base(overrides: Record<string, any> = {}) {
    return {
      fees: { rentAmount: 200000, securityDeposit: 200000 },
      petPolicy: null,
      includeManagementFee: false,
      ...overrides,
    };
  }

  it('returns baseRent and totalMonthlyRent equal when no extras', () => {
    const r = FinancialCalculator.leaseMonthlyFees(base());
    expect(r.baseRent).toBe(200000);
    expect(r.totalMonthlyRent).toBe(200000);
    expect(r.managementFee).toBe(0);
    expect(r.petMonthlyFee).toBe(0);
  });

  it('includes petMonthlyFee in totalMonthlyRent', () => {
    const r = FinancialCalculator.leaseMonthlyFees(
      base({ petPolicy: { monthlyFee: 5000, deposit: 10000 } })
    );
    expect(r.petMonthlyFee).toBe(5000);
    expect(r.petDeposit).toBe(10000);
    expect(r.totalMonthlyRent).toBe(205000);
  });

  it('reads management fee from propertyInfo virtual when includeManagementFee is true', () => {
    const r = FinancialCalculator.leaseMonthlyFees(
      base({
        includeManagementFee: true,
        propertyInfo: { fees: { managementFees: 15000 } },
      })
    );
    expect(r.managementFee).toBe(15000);
    expect(r.totalMonthlyRent).toBe(215000);
  });

  it('falls back to property.id populated ref when propertyInfo is absent', () => {
    const r = FinancialCalculator.leaseMonthlyFees(
      base({
        includeManagementFee: true,
        property: { id: { fees: { managementFees: 8000 } } },
      })
    );
    expect(r.managementFee).toBe(8000);
    expect(r.totalMonthlyRent).toBe(208000);
  });

  it('prefers propertyInfo over property.id when both are present', () => {
    const r = FinancialCalculator.leaseMonthlyFees(
      base({
        includeManagementFee: true,
        propertyInfo: { fees: { managementFees: 12000 } },
        property: { id: { fees: { managementFees: 99999 } } },
      })
    );
    expect(r.managementFee).toBe(12000);
  });

  it('excludes management fee when includeManagementFee is false', () => {
    const r = FinancialCalculator.leaseMonthlyFees(
      base({
        includeManagementFee: false,
        propertyInfo: { fees: { managementFees: 15000 } },
      })
    );
    expect(r.managementFee).toBe(0);
    expect(r.totalMonthlyRent).toBe(200000);
  });

  it('combines base rent + pet fee + management fee in totalMonthlyRent', () => {
    const r = FinancialCalculator.leaseMonthlyFees(
      base({
        includeManagementFee: true,
        petPolicy: { monthlyFee: 5000, deposit: 10000 },
        propertyInfo: { fees: { managementFees: 10000 } },
      })
    );
    expect(r.totalMonthlyRent).toBe(215000); // 200000 + 5000 + 10000
  });
});
