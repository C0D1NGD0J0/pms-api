import { LeaseStatus } from '@interfaces/lease.interface';
import { ValidationRequestError } from '@shared/customErrors';
import { ILeaseESignatureStatusEnum } from '@interfaces/lease.interface';
import {
  validateLeaseReadyForSignature,
  calculateNextPaymentDate,
  calculateProRatedAmount,
  calculateFinancialSummary,
} from '@services/lease/leaseHelpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLease(overrides: Record<string, any> = {}): any {
  const startDate = daysFromNow(1); // tomorrow by default
  const endDate = daysFromNow(60);  // 60 days out — well above the 30-day minimum
  return {
    status: LeaseStatus.READY_FOR_SIGNATURE,
    eSignature: {},
    duration: { startDate, endDate },
    ...overrides,
  };
}

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

// ---------------------------------------------------------------------------
// validateLeaseReadyForSignature — date guards
// ---------------------------------------------------------------------------

describe('validateLeaseReadyForSignature — date guards', () => {
  it('throws when lease is not READY_FOR_SIGNATURE', () => {
    const lease = makeLease({ status: LeaseStatus.DRAFT });
    expect(() => validateLeaseReadyForSignature(lease)).toThrow(ValidationRequestError);
  });

  it('throws when lease has already been sent (envelopeId present)', () => {
    const lease = makeLease({
      eSignature: { status: ILeaseESignatureStatusEnum.SENT, envelopeId: 'env-123' },
    });
    expect(() => validateLeaseReadyForSignature(lease)).toThrow(ValidationRequestError);
  });

  it('throws when start date is in the past', () => {
    const lease = makeLease({
      duration: { startDate: daysFromNow(-1), endDate: daysFromNow(60) },
    });
    expect(() => validateLeaseReadyForSignature(lease)).toThrow(ValidationRequestError);
  });

  it('passes when start date is today', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lease = makeLease({
      duration: { startDate: today, endDate: daysFromNow(60) },
    });
    expect(() => validateLeaseReadyForSignature(lease)).not.toThrow();
  });

  it('passes when start date is in the future', () => {
    const lease = makeLease();
    expect(() => validateLeaseReadyForSignature(lease)).not.toThrow();
  });

  it('throws when end date leaves fewer than 30 days remaining', () => {
    const lease = makeLease({
      duration: { startDate: daysFromNow(1), endDate: daysFromNow(29) },
    });
    expect(() => validateLeaseReadyForSignature(lease)).toThrow(ValidationRequestError);
  });

  it('throws on exactly 29 remaining days (below minimum)', () => {
    const lease = makeLease({
      duration: { startDate: daysFromNow(1), endDate: daysFromNow(29) },
    });
    const err = (() => {
      try {
        validateLeaseReadyForSignature(lease);
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ValidationRequestError);
    expect((err as ValidationRequestError).message).toMatch(/day\(s\) remaining/);
  });

  it('passes when end date leaves exactly 30 days remaining', () => {
    const lease = makeLease({
      duration: { startDate: daysFromNow(1), endDate: daysFromNow(30) },
    });
    expect(() => validateLeaseReadyForSignature(lease)).not.toThrow();
  });

  it('passes when end date leaves more than 30 days remaining', () => {
    const lease = makeLease({
      duration: { startDate: daysFromNow(1), endDate: daysFromNow(31) },
    });
    expect(() => validateLeaseReadyForSignature(lease)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// calculateProRatedAmount
// ---------------------------------------------------------------------------

describe('calculateProRatedAmount', () => {
  it('returns full month when tenant starts on day 1', () => {
    const startDate = new Date(2026, 3, 1); // April 1
    const result = calculateProRatedAmount(300000, startDate); // $3000 in cents
    expect(result.isFullMonth).toBe(true);
    expect(result.amount).toBe(300000);
    expect(result.daysCharged).toBe(30);
    expect(result.daysInMonth).toBe(30);
  });

  it('pro-rates for mid-month start (April 10 → 21 of 30 days)', () => {
    const startDate = new Date(2026, 3, 10); // April 10 — 30 day month
    const monthlyRentInCents = 300000; // $3,000
    const result = calculateProRatedAmount(monthlyRentInCents, startDate);
    expect(result.isFullMonth).toBe(false);
    expect(result.daysInMonth).toBe(30);
    expect(result.daysCharged).toBe(21); // 30 - 10 + 1
    // ceil(300000 * 21 / 30) = ceil(210000) = 210000
    expect(result.amount).toBe(210000);
  });

  it('pro-rates for last day of a 31-day month (1 day charged)', () => {
    const startDate = new Date(2026, 2, 31); // March 31
    const result = calculateProRatedAmount(310000, startDate);
    expect(result.daysCharged).toBe(1);
    expect(result.daysInMonth).toBe(31);
    // ceil(310000 * 1 / 31) = ceil(10000) = 10000
    expect(result.amount).toBe(10000);
  });

  it('pro-rates correctly for February (28-day month) start day 15', () => {
    const startDate = new Date(2026, 1, 15); // Feb 15, 2026 (not a leap year)
    const result = calculateProRatedAmount(280000, startDate);
    expect(result.daysInMonth).toBe(28);
    expect(result.daysCharged).toBe(14); // 28 - 15 + 1
    // ceil(280000 * 14 / 28) = ceil(140000) = 140000
    expect(result.amount).toBe(140000);
  });

  it('rounds up fractional cents (ceiling)', () => {
    // rent = 100001 cents, start day 2 in a 31-day month → 30 days charged
    // 100001 * 30 / 31 = 96775.16... → ceil = 96776
    const startDate = new Date(2026, 2, 2); // March 2
    const result = calculateProRatedAmount(100001, startDate);
    expect(result.amount).toBe(Math.ceil((100001 * 30) / 31));
  });
});

// ---------------------------------------------------------------------------
// calculateFinancialSummary — first payment composition
// ---------------------------------------------------------------------------

function makeLeaseDoc(overrides: Record<string, any> = {}): any {
  return {
    fees: {
      monthlyRent: 200000, // $2,000 in cents
      securityDeposit: 200000,
      currency: 'USD',
      rentDueDay: 1,
    },
    duration: {
      startDate: new Date(2024, 2, 1), // March 1 — full month
      endDate: new Date(2025, 1, 28),
    },
    petPolicy: {
      allowed: false,
      monthlyFee: 0,
      deposit: 0,
    },
    ...overrides,
  };
}

describe('calculateFinancialSummary — first payment composition', () => {
  it('full-month start: firstPayment = rent + security deposit (no pets)', () => {
    const lease = makeLeaseDoc();
    const summary = calculateFinancialSummary(lease);
    // pro-rated = full 200000; firstPayment = 200000 + 200000
    expect(summary.firstPaymentAmount).toBe(400000);
    expect(summary.isFirstMonthFullMonth).toBe(true);
  });

  it('mid-month start includes pro-rated rent + security deposit only (no pets)', () => {
    // June 15: daysCharged=16, ceil(200000 × 16/30) = 106667
    const lease = makeLeaseDoc({
      duration: { startDate: new Date(2024, 5, 15), endDate: new Date(2025, 4, 31) },
    });
    const summary = calculateFinancialSummary(lease);
    const expectedProRated = Math.ceil((200000 * 16) / 30); // 106667
    expect(summary.proRatedFirstMonthAmount).toBe(expectedProRated);
    expect(summary.firstPaymentAmount).toBe(expectedProRated + 200000);
  });

  it('includes pet monthly fee in first payment when pets allowed', () => {
    const lease = makeLeaseDoc({
      petPolicy: { allowed: true, monthlyFee: 5000, deposit: 0 },
    });
    const summary = calculateFinancialSummary(lease);
    // full month: 200000 rent + 200000 deposit + 5000 pet fee
    expect(summary.firstPaymentAmount).toBe(405000);
    expect(summary.petFeeRaw).toBe(5000);
  });

  it('includes pet deposit in first payment when pets allowed', () => {
    const lease = makeLeaseDoc({
      petPolicy: { allowed: true, monthlyFee: 5000, deposit: 25000 },
    });
    const summary = calculateFinancialSummary(lease);
    // 200000 + 200000 + 5000 + 25000
    expect(summary.firstPaymentAmount).toBe(430000);
  });

  it('pet deposit is one-time: included in firstPaymentAmount', () => {
    const lease = makeLeaseDoc({
      petPolicy: { allowed: true, monthlyFee: 0, deposit: 30000 },
    });
    const summary = calculateFinancialSummary(lease);
    expect(summary.firstPaymentAmount).toBe(200000 + 200000 + 30000);
  });

  it('no pet fee display when monthlyFee is 0', () => {
    const lease = makeLeaseDoc();
    const summary = calculateFinancialSummary(lease);
    expect(summary.petFee).toBeUndefined();
    expect(summary.petFeeRaw).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateNextPaymentDate
// ---------------------------------------------------------------------------

describe('calculateNextPaymentDate', () => {
  it('returns startDate when lease has not started yet (future start)', () => {
    const futureStart = daysFromNow(10);
    const result = calculateNextPaymentDate(1, futureStart);
    // Should be the same day as startDate
    result.setHours(0, 0, 0, 0);
    futureStart.setHours(0, 0, 0, 0);
    expect(result.getTime()).toBe(futureStart.getTime());
  });

  it('returns startDate when start date is today', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result = calculateNextPaymentDate(1, today);
    result.setHours(0, 0, 0, 0);
    expect(result.getTime()).toBe(today.getTime());
  });

  it('returns next occurrence of rentDueDay when lease is active and due day is in the future this month', () => {
    const pastStart = daysFromNow(-20);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Pick a rentDueDay that is definitely in the future this month
    const futureDay = today.getDate() + 5;
    if (futureDay > 28) {
      // Skip this specific sub-case if we're too late in the month
      return;
    }

    const result = calculateNextPaymentDate(futureDay, pastStart);
    expect(result.getDate()).toBe(futureDay);
    expect(result.getMonth()).toBe(today.getMonth());
  });

  it('returns next month occurrence when rentDueDay has already passed this month', () => {
    const pastStart = daysFromNow(-20);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // rentDueDay = 1 and today > 1, so next occurrence is 1st of next month
    const rentDueDay = 1;
    if (today.getDate() === 1) {
      // Edge case: if today IS the 1st, use day 28 instead
      const result = calculateNextPaymentDate(28, pastStart);
      expect(result.getDate()).toBe(28);
      return;
    }

    const result = calculateNextPaymentDate(rentDueDay, pastStart);
    const expectedMonth = (today.getMonth() + 1) % 12;
    expect(result.getDate()).toBe(rentDueDay);
    expect(result.getMonth()).toBe(expectedMonth);
  });
});
