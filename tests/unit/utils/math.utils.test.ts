import { describe, expect, it } from '@jest/globals';
import {
  calcCollectionRate,
  calcOccupancyRate,
  calcDaysRemaining,
  calcLeaseProgress,
  calcPercentChange,
  calcDaysElapsed,
  calcPercentage,
  roundToDecimal,
  calcTotalPages,
  megabytes,
  msToDays,
  daysInMs,
  calcSkip,
} from '@utils/math.utils';

describe('calcPercentage', () => {
  it('returns 0 when total is 0', () => expect(calcPercentage(0, 0)).toBe(0));
  it('returns correct percentage', () => expect(calcPercentage(1, 2)).toBe(50));
  it('rounds half-up: 1/3 → 33, 2/3 → 67', () => {
    expect(calcPercentage(1, 3)).toBe(33);
    expect(calcPercentage(2, 3)).toBe(67);
  });
});

describe('calcOccupancyRate / calcCollectionRate', () => {
  it('delegates to calcPercentage', () => {
    expect(calcOccupancyRate(8, 10)).toBe(80);
    expect(calcCollectionRate(750, 1000)).toBe(75);
  });
  it('returns 0 when total is 0', () => {
    expect(calcOccupancyRate(0, 0)).toBe(0);
    expect(calcCollectionRate(0, 0)).toBe(0);
  });
});

describe('msToDays', () => {
  it('returns 1 for exactly one day', () => expect(msToDays(86_400_000)).toBe(1));
  it('floors a partial day', () => expect(msToDays(86_400_000 * 1.5)).toBe(1));
});

describe('calcDaysRemaining', () => {
  it('returns days until a future date', () => {
    expect(calcDaysRemaining(new Date('2026-04-29'), new Date('2026-04-19'))).toBe(10);
  });
  it('returns 0 for same day or past date', () => {
    const d = new Date('2026-04-19');
    expect(calcDaysRemaining(d, d)).toBe(0);
    expect(calcDaysRemaining(new Date('2026-04-10'), new Date('2026-04-19'))).toBe(0);
  });
});

describe('calcDaysElapsed', () => {
  it('returns days since a past date', () => {
    expect(calcDaysElapsed(new Date('2026-04-09'), new Date('2026-04-19'))).toBe(10);
  });
  it('returns 0 for same day or future date', () => {
    const d = new Date('2026-04-19');
    expect(calcDaysElapsed(d, d)).toBe(0);
    expect(calcDaysElapsed(new Date('2026-04-29'), new Date('2026-04-19'))).toBe(0);
  });
});

describe('calcLeaseProgress', () => {
  it('returns 0 when both are 0', () => expect(calcLeaseProgress(0, 0)).toBe(0));
  it('returns 50 at halfway', () => expect(calcLeaseProgress(180, 180)).toBe(50));
  it('returns 100 when fully elapsed', () => expect(calcLeaseProgress(365, 0)).toBe(100));
});

describe('daysInMs', () => {
  it('converts days to milliseconds', () => expect(daysInMs(1)).toBe(86_400_000));
  it('is the inverse of msToDays', () => expect(msToDays(daysInMs(30))).toBe(30));
});

describe('roundToDecimal', () => {
  it('rounds half-up: 2.455 → 2.46', () => expect(roundToDecimal(2.455, 2)).toBe(2.46));
  it('rounds down: 2.454 → 2.45', () => expect(roundToDecimal(2.454, 2)).toBe(2.45));
  it('handles negatives: -2.455 → -2.46 (away from zero)', () =>
    expect(roundToDecimal(-2.455, 2)).toBe(-2.46));
});

describe('calcPercentChange', () => {
  it('returns 0 when prior is 0', () => expect(calcPercentChange(100, 0)).toBe(0));
  it('returns positive change', () => expect(calcPercentChange(120, 100)).toBe(20.0));
  it('returns negative change', () => expect(calcPercentChange(80, 100)).toBe(-20.0));
  it('rounds to 1 decimal place: 11/99 → 11.1%', () =>
    expect(calcPercentChange(110, 99)).toBe(11.1));
});

describe('calcTotalPages', () => {
  it('returns 0 when total is 0', () => expect(calcTotalPages(0, 10)).toBe(0));
  it('ceils a partial page', () => expect(calcTotalPages(11, 10)).toBe(2));
  it('guards against limit=0', () => expect(calcTotalPages(10, 0)).toBe(10));
});

describe('calcSkip', () => {
  it('returns 0 for page 1', () => expect(calcSkip(1, 10)).toBe(0));
  it('returns correct offset for page 2', () => expect(calcSkip(2, 10)).toBe(10));
  it('treats page 0 as page 1', () => expect(calcSkip(0, 10)).toBe(0));
});

describe('megabytes', () => {
  it('converts MB to bytes', () => expect(megabytes(1)).toBe(1_048_576));
});
