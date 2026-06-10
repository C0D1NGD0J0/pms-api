import { MoneyUtils } from '@utils/money.utils';
import { describe, expect, it } from '@jest/globals';

describe('MoneyUtils.toCents', () => {
  it('converts dollars to cents', () => expect(MoneyUtils.toCents(12.5)).toBe(1250));
  it('eliminates floating-point drift: 0.1 + 0.2 → 30', () => expect(MoneyUtils.toCents(0.1 + 0.2)).toBe(30));
  it('rounds half-up: 1.005 → 101', () => expect(MoneyUtils.toCents(1.005)).toBe(101));
  it('rounds down: 1.004 → 100', () => expect(MoneyUtils.toCents(1.004)).toBe(100));
});

describe('MoneyUtils.fromCents', () => {
  it('converts cents to dollars', () => expect(MoneyUtils.fromCents(1250)).toBe(12.5));
  it('handles a single cent', () => expect(MoneyUtils.fromCents(1)).toBe(0.01));
});

describe('MoneyUtils.centsToDisplay', () => {
  it('formats as 2-decimal string by default', () => expect(MoneyUtils.centsToDisplay(1250)).toBe('12.50'));
  it('respects custom decimal places', () => expect(MoneyUtils.centsToDisplay(1250, 4)).toBe('12.5000'));
});

describe('MoneyUtils.centsToString', () => {
  it('formats a normal value', () => expect(MoneyUtils.centsToString(1250)).toBe('12.50'));
  it('returns "0.00" for null', () => expect(MoneyUtils.centsToString(null)).toBe('0.00'));
  it('returns "0.00" for undefined', () => expect(MoneyUtils.centsToString(undefined)).toBe('0.00'));
  it('returns "0.00" for NaN', () => expect(MoneyUtils.centsToString(NaN)).toBe('0.00'));
});

describe('MoneyUtils.stringToCents', () => {
  it('converts a dollar string', () => expect(MoneyUtils.stringToCents('12.50')).toBe(1250));
  it('converts a numeric value directly', () => expect(MoneyUtils.stringToCents(12.5)).toBe(1250));
  it('returns 0 for non-numeric string', () => expect(MoneyUtils.stringToCents('bad')).toBe(0));
  it('returns 0 for null', () => expect(MoneyUtils.stringToCents(null as any)).toBe(0));
});

describe('MoneyUtils.formatCurrency', () => {
  it('formats with currency symbol', () => expect(MoneyUtils.formatCurrency(150000)).toBe('$1,500.00'));
  it('returns "$0.00" for null/undefined/NaN', () => {
    expect(MoneyUtils.formatCurrency(null)).toBe('$0.00');
    expect(MoneyUtils.formatCurrency(undefined)).toBe('$0.00');
    expect(MoneyUtils.formatCurrency(NaN)).toBe('$0.00');
  });
});

describe('MoneyUtils.isValidMoneyValue', () => {
  it('returns true for null and empty string', () => {
    expect(MoneyUtils.isValidMoneyValue(null)).toBe(true);
    expect(MoneyUtils.isValidMoneyValue('')).toBe(true);
  });
  it('returns true for non-negative number and numeric string', () => {
    expect(MoneyUtils.isValidMoneyValue(0)).toBe(true);
    expect(MoneyUtils.isValidMoneyValue('12.50')).toBe(true);
  });
  it('returns false for negative, non-numeric, NaN, and objects', () => {
    expect(MoneyUtils.isValidMoneyValue(-1)).toBe(false);
    expect(MoneyUtils.isValidMoneyValue('abc')).toBe(false);
    expect(MoneyUtils.isValidMoneyValue(NaN)).toBe(false);
    expect(MoneyUtils.isValidMoneyValue({})).toBe(false);
  });
});

describe('MoneyUtils.formatMoneyDisplay', () => {
  it('converts all known money fields from cents to strings', () => {
    const result = MoneyUtils.formatMoneyDisplay({ rentAmount: 120000, managementFees: 500 });
    expect(result).toMatchObject({ rentAmount: '1200.00', managementFees: '5.00' });
  });
  it('does not inject absent fields', () => {
    const result = MoneyUtils.formatMoneyDisplay({ rentAmount: 100000 });
    expect(result).toEqual({ rentAmount: '1000.00' });
  });
  it('returns non-object input unchanged', () => expect(MoneyUtils.formatMoneyDisplay(null)).toBeNull());
});

describe('MoneyUtils.parseMoneyInput', () => {
  it('round-trips with formatMoneyDisplay', () => {
    const original = { rentAmount: 125050, securityDeposit: 250000, managementFees: 999 };
    expect(MoneyUtils.parseMoneyInput(MoneyUtils.formatMoneyDisplay(original))).toEqual(original);
  });
  it('returns 0 for an invalid string field', () => {
    expect(MoneyUtils.parseMoneyInput({ rentAmount: 'bad' }).rentAmount).toBe(0);
  });
});

describe('MoneyUtils.formatLeaseFees / parseLeaseFees', () => {
  it('converts lease fee fields to display strings', () => {
    const result = MoneyUtils.formatLeaseFees({ rentAmount: 120000, securityDeposit: 240000, lateFeeAmount: 5000 });
    expect(result).toMatchObject({ rentAmount: '1200.00', securityDeposit: '2400.00', lateFeeAmount: '50.00' });
  });
  it('omits lateFeeAmount when absent', () => {
    const result = MoneyUtils.formatLeaseFees({ rentAmount: 100000, securityDeposit: 200000 });
    expect(result).not.toHaveProperty('lateFeeAmount');
  });
  it('round-trips with parseLeaseFees', () => {
    const original = { rentAmount: 125000, securityDeposit: 250000, lateFeeAmount: 7500 };
    expect(MoneyUtils.parseLeaseFees(MoneyUtils.formatLeaseFees(original))).toEqual(original);
  });
});
