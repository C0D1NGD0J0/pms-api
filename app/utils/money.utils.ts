import Decimal from 'decimal.js';

export const MoneyUtils = {
  // ── Conversion ───────────────────────────────────────────────────────────────

  /** Dollars → cents. e.g. 12.50 → 1250 */
  toCents: (dollars: number): number =>
    new Decimal(dollars).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),

  /** Cents → dollars rounded to 2 decimal places. e.g. 1250 → 12.50 */
  fromCents: (cents: number): number =>
    new Decimal(cents).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),

  /** Cents → fixed-decimal string. e.g. 1250 → "12.50" */
  centsToDisplay: (cents: number, decimalPlaces = 2): string =>
    new Decimal(cents).div(100).toFixed(decimalPlaces),

  centsToString: (cents: number | null | undefined, decimalPlaces = 2): string => {
    if (cents == null) return '0.00';
    if (typeof cents !== 'number' || isNaN(cents)) return '0.00';
    return new Decimal(cents).div(100).toFixed(decimalPlaces);
  },

  stringToCents: (dollarString: string | number): number => {
    if (dollarString == null) return 0;
    const numericValue = typeof dollarString === 'string' ? parseFloat(dollarString) : dollarString;
    if (isNaN(numericValue)) return 0;
    return new Decimal(numericValue)
      .times(100)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toNumber();
  },

  formatCurrency: (
    cents: number | null | undefined,
    currency = 'USD',
    locale = 'en-US'
  ): string => {
    if (cents == null)
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(0);
    if (typeof cents !== 'number' || isNaN(cents))
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(0);

    const dollars = new Decimal(cents).div(100).toNumber();
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(dollars);
  },

  // ── Object-level helpers ─────────────────────────────────────────────────────

  /** Cents → display strings for all known money fields. Missing fields are not injected. */
  formatMoneyDisplay: (moneyData: any): any => {
    if (!moneyData || typeof moneyData !== 'object') return moneyData;

    return {
      ...moneyData,
      ...(moneyData.taxAmount !== undefined && {
        taxAmount: MoneyUtils.centsToString(moneyData.taxAmount),
      }),
      ...(moneyData.rentalAmount !== undefined && {
        rentalAmount: MoneyUtils.centsToString(moneyData.rentalAmount),
      }),
      ...(moneyData.managementFees !== undefined && {
        managementFees: MoneyUtils.centsToString(moneyData.managementFees),
      }),
      ...(moneyData.securityDeposit !== undefined && {
        securityDeposit: MoneyUtils.centsToString(moneyData.securityDeposit),
      }),
      ...(moneyData.monthlyRent !== undefined && {
        monthlyRent: MoneyUtils.centsToString(moneyData.monthlyRent),
      }),
      ...(moneyData.lateFeeAmount !== undefined && {
        lateFeeAmount: MoneyUtils.centsToString(moneyData.lateFeeAmount),
      }),
    };
  },

  /** Display strings → cents for all known money fields. */
  parseMoneyInput: (moneyData: any): any => {
    if (!moneyData || typeof moneyData !== 'object') return moneyData;

    return {
      ...moneyData,
      ...(moneyData.taxAmount !== undefined && {
        taxAmount: MoneyUtils.stringToCents(moneyData.taxAmount),
      }),
      ...(moneyData.rentalAmount !== undefined && {
        rentalAmount: MoneyUtils.stringToCents(moneyData.rentalAmount),
      }),
      ...(moneyData.managementFees !== undefined && {
        managementFees: MoneyUtils.stringToCents(moneyData.managementFees),
      }),
      ...(moneyData.securityDeposit !== undefined && {
        securityDeposit: MoneyUtils.stringToCents(moneyData.securityDeposit),
      }),
      ...(moneyData.monthlyRent !== undefined && {
        monthlyRent: MoneyUtils.stringToCents(moneyData.monthlyRent),
      }),
      ...(moneyData.lateFeeAmount !== undefined && {
        lateFeeAmount: MoneyUtils.stringToCents(moneyData.lateFeeAmount),
      }),
    };
  },

  isValidMoneyValue: (value: any): boolean => {
    if (value == null || value === '') return true;
    if (typeof value === 'string') {
      const numericValue = parseFloat(value);
      return !isNaN(numericValue) && numericValue >= 0;
    }
    if (typeof value === 'number') return !isNaN(value) && value >= 0;
    return false;
  },

  formatLeaseFees: (fees: any): any => {
    if (!fees || typeof fees !== 'object') return fees;
    return {
      ...fees,
      monthlyRent: MoneyUtils.centsToString(fees.monthlyRent),
      securityDeposit: MoneyUtils.centsToString(fees.securityDeposit),
      ...(fees.lateFeeAmount !== undefined && {
        lateFeeAmount: MoneyUtils.centsToString(fees.lateFeeAmount),
      }),
    };
  },

  parseLeaseFees: (fees: any): any => {
    if (!fees || typeof fees !== 'object') return fees;
    return {
      ...fees,
      monthlyRent: MoneyUtils.stringToCents(fees.monthlyRent),
      securityDeposit: MoneyUtils.stringToCents(fees.securityDeposit),
      ...(fees.lateFeeAmount !== undefined && {
        lateFeeAmount: MoneyUtils.stringToCents(fees.lateFeeAmount),
      }),
    };
  },
};
