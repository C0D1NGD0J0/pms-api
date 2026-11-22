import dayjs from 'dayjs';
import { FinancialCalculator } from '@utils/financial';
import {
  annualYearIndexForPeriod,
  buildAnnualRentLineItems,
  latestAnnualDueDate,
  monthsInLeaseYear,
  annualRentDueDate,
  annualRentPeriod,
  isAnnualLease,
} from '@services/payments/annualRent';

const day = (date: dayjs.Dayjs | null) => date?.format('YYYY-MM-DD');

const annualLease = (overrides: Record<string, any> = {}) =>
  ({
    fees: {
      paymentFrequency: 'annual',
      annualRentAmount: 120000000, // ₦1,200,000
      rentAmount: 10000000,
      securityDeposit: 0,
      rentDueDay: 1,
      currency: 'NGN',
    },
    duration: { startDate: new Date('2026-03-15'), endDate: new Date('2028-03-14') },
    petPolicy: null,
    ...overrides,
  }) as any;

describe('annual rent dates', () => {
  it('is due on each start-date anniversary', () => {
    expect(day(annualRentDueDate(new Date('2026-03-15'), 0))).toBe('2026-03-15');
    expect(day(annualRentDueDate(new Date('2026-03-15'), 2))).toBe('2028-03-15');
  });

  it('falls on Feb 28 for a Feb 29 start in years without one', () => {
    expect(day(annualRentDueDate(new Date('2028-02-29'), 1))).toBe('2029-02-28');
    expect(day(annualRentDueDate(new Date('2028-02-29'), 4))).toBe('2032-02-29');
  });

  it('finds the latest anniversary on or before a date', () => {
    const start = new Date('2026-03-15');
    expect(day(latestAnnualDueDate(start, dayjs('2027-03-14')))).toBe('2026-03-15');
    expect(day(latestAnnualDueDate(start, dayjs('2027-03-15')))).toBe('2027-03-15');
    expect(latestAnnualDueDate(start, dayjs('2026-03-14'))).toBeNull();
  });

  it('maps a billing period to its lease-year, only for anniversary months', () => {
    const start = new Date('2026-03-15');
    expect(annualYearIndexForPeriod(start, { month: 3, year: 2027 })).toBe(1);
    expect(annualYearIndexForPeriod(start, { month: 4, year: 2027 })).toBeNull();
    expect(annualYearIndexForPeriod(start, { month: 3, year: 2025 })).toBeNull();
    expect(annualRentPeriod(start, 1)).toEqual({ month: 3, year: 2027, frequency: 'annual' });
  });

  it('only treats leases marked annual as annual', () => {
    expect(isAnnualLease(annualLease())).toBe(true);
    expect(isAnnualLease({ fees: { paymentFrequency: 'monthly' } } as any)).toBe(false);
    expect(isAnnualLease({ fees: {} } as any)).toBe(false);
  });
});

describe('monthsInLeaseYear', () => {
  it('is 12 for a full lease-year', () => {
    expect(monthsInLeaseYear(annualLease(), 0)).toBe(12);
    expect(monthsInLeaseYear(annualLease(), 1)).toBe(12);
  });

  it('counts the months of a shorter last year, rounding a partial month up', () => {
    // 18-month lease: the second year runs 2027-03-15 → 2027-09-14 (6 months)
    const lease = annualLease({
      duration: { startDate: new Date('2026-03-15'), endDate: new Date('2027-09-14') },
    });
    expect(monthsInLeaseYear(lease, 1)).toBe(6);

    // Ends a few days into the 7th month → 7 months
    lease.duration.endDate = new Date('2027-09-20');
    expect(monthsInLeaseYear(lease, 1)).toBe(7);
  });

  it('uses the termination date when the lease ended early', () => {
    const lease = annualLease({
      duration: {
        startDate: new Date('2026-03-15'),
        endDate: new Date('2028-03-14'),
        terminationDate: new Date('2027-06-14'),
      },
    });
    expect(monthsInLeaseYear(lease, 1)).toBe(3);
  });
});

describe('buildAnnualRentLineItems', () => {
  it('bills the annual rent for a full lease-year', () => {
    const items = buildAnnualRentLineItems(annualLease(), 0);
    expect(items).toEqual([
      { description: 'Annual Rent (Mar 2026 – Feb 2027)', amountInCents: 120000000 },
    ]);
  });

  it('bills pet and management fees for the 12 months', () => {
    const lease = annualLease({
      petPolicy: { monthlyFee: 500000 },
      includeManagementFee: true,
      propertyInfo: { fees: { managementFees: 200000 } },
    });
    const items = buildAnnualRentLineItems(lease, 0);
    expect(items).toContainEqual({ description: 'Pet Fee (12 months)', amountInCents: 6000000 });
    expect(items).toContainEqual({
      description: 'Management Fee (12 months)',
      amountInCents: 2400000,
    });
  });

  it('pro-rates a shorter last year by month', () => {
    const lease = annualLease({
      duration: { startDate: new Date('2026-03-15'), endDate: new Date('2027-09-14') },
    });
    expect(buildAnnualRentLineItems(lease, 1)).toEqual([
      { description: 'Rent (Mar 2027 – Aug 2027, 6 months)', amountInCents: 60000000 },
    ]);
  });
});

describe('FinancialCalculator.proRatePartialYear', () => {
  it('returns the full amount for 12 months or more', () => {
    expect(FinancialCalculator.proRatePartialYear(120000, 12)).toBe(120000);
  });

  it('charges months / 12 of the year, rounding up', () => {
    expect(FinancialCalculator.proRatePartialYear(120000, 6)).toBe(60000);
    expect(FinancialCalculator.proRatePartialYear(100000, 1)).toBe(8334); // 8333.33 → 8334
  });
});
