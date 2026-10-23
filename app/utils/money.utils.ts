import { FinancialCalculator } from '@utils/financial';

export const MoneyUtils = {
  // ── Conversion (delegates to FinancialCalculator) ────────────────────────────

  toCents: FinancialCalculator.toCents,
  fromCents: FinancialCalculator.fromCents,
  centsToDisplay: FinancialCalculator.centsToDisplay,
  centsToString: FinancialCalculator.centsToString,
  stringToCents: FinancialCalculator.stringToCents,
  formatCurrency: FinancialCalculator.formatCurrency,

  // ── Object-level helpers ─────────────────────────────────────────────────────

  /** Cents → display strings for all known money fields. Missing fields are not injected. */
  formatMoneyDisplay: (moneyData: any): any => {
    if (!moneyData || typeof moneyData !== 'object') return moneyData;

    return {
      ...moneyData,
      ...(moneyData.rentAmount !== undefined && {
        rentAmount: MoneyUtils.centsToString(moneyData.rentAmount),
      }),
      ...(moneyData.managementFees !== undefined && {
        managementFees: MoneyUtils.centsToString(moneyData.managementFees),
      }),
      ...(moneyData.securityDeposit !== undefined && {
        securityDeposit: MoneyUtils.centsToString(moneyData.securityDeposit),
      }),
      ...(moneyData.rentAmount !== undefined && {
        rentAmount: MoneyUtils.centsToString(moneyData.rentAmount),
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
      ...(moneyData.rentAmount !== undefined && {
        rentAmount: MoneyUtils.stringToCents(moneyData.rentAmount),
      }),
      ...(moneyData.managementFees !== undefined && {
        managementFees: MoneyUtils.stringToCents(moneyData.managementFees),
      }),
      ...(moneyData.securityDeposit !== undefined && {
        securityDeposit: MoneyUtils.stringToCents(moneyData.securityDeposit),
      }),
      ...(moneyData.rentAmount !== undefined && {
        rentAmount: MoneyUtils.stringToCents(moneyData.rentAmount),
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
      rentAmount: MoneyUtils.centsToString(fees.rentAmount),
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
      rentAmount: MoneyUtils.stringToCents(fees.rentAmount),
      securityDeposit: MoneyUtils.stringToCents(fees.securityDeposit),
      ...(fees.lateFeeAmount !== undefined && {
        lateFeeAmount: MoneyUtils.stringToCents(fees.lateFeeAmount),
      }),
    };
  },

  /** Pet policy money fields (deposit, monthlyFee): major units → cents. Missing fields are not injected. */
  parsePetPolicyFees: (petPolicy: any): any => {
    if (!petPolicy || typeof petPolicy !== 'object') return petPolicy;
    return {
      ...petPolicy,
      ...(petPolicy.deposit != null && {
        deposit: MoneyUtils.stringToCents(petPolicy.deposit),
      }),
      ...(petPolicy.monthlyFee != null && {
        monthlyFee: MoneyUtils.stringToCents(petPolicy.monthlyFee),
      }),
    };
  },

  /** Pet policy money fields: cents → display strings. Missing fields are not injected. */
  formatPetPolicyFees: (petPolicy: any): any => {
    if (!petPolicy || typeof petPolicy !== 'object') return petPolicy;
    return {
      ...petPolicy,
      ...(petPolicy.deposit != null && {
        deposit: MoneyUtils.centsToString(petPolicy.deposit),
      }),
      ...(petPolicy.monthlyFee != null && {
        monthlyFee: MoneyUtils.centsToString(petPolicy.monthlyFee),
      }),
    };
  },
};
