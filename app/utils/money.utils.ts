import { FinancialCalculator } from '@utils/financial';

/**
 * Maps the money fields of request/response objects between display strings and cents.
 * The conversions themselves live in FinancialCalculator.
 */
export const MoneyUtils = {
  // ── Object-level helpers ─────────────────────────────────────────────────────

  /** Cents → display strings for all known money fields. Missing fields are not injected. */
  formatMoneyDisplay: (moneyData: any): any => {
    if (!moneyData || typeof moneyData !== 'object') return moneyData;

    return {
      ...moneyData,
      ...(moneyData.rentAmount !== undefined && {
        rentAmount: FinancialCalculator.centsToString(moneyData.rentAmount),
      }),
      ...(moneyData.managementFees !== undefined && {
        managementFees: FinancialCalculator.centsToString(moneyData.managementFees),
      }),
      ...(moneyData.securityDeposit !== undefined && {
        securityDeposit: FinancialCalculator.centsToString(moneyData.securityDeposit),
      }),
      ...(moneyData.rentAmount !== undefined && {
        rentAmount: FinancialCalculator.centsToString(moneyData.rentAmount),
      }),
      ...(moneyData.lateFeeAmount !== undefined && {
        lateFeeAmount: FinancialCalculator.centsToString(moneyData.lateFeeAmount),
      }),
    };
  },

  /** Display strings → cents for all known money fields. */
  parseMoneyInput: (moneyData: any): any => {
    if (!moneyData || typeof moneyData !== 'object') return moneyData;

    return {
      ...moneyData,
      ...(moneyData.rentAmount !== undefined && {
        rentAmount: FinancialCalculator.stringToCents(moneyData.rentAmount),
      }),
      ...(moneyData.managementFees !== undefined && {
        managementFees: FinancialCalculator.stringToCents(moneyData.managementFees),
      }),
      ...(moneyData.securityDeposit !== undefined && {
        securityDeposit: FinancialCalculator.stringToCents(moneyData.securityDeposit),
      }),
      ...(moneyData.rentAmount !== undefined && {
        rentAmount: FinancialCalculator.stringToCents(moneyData.rentAmount),
      }),
      ...(moneyData.lateFeeAmount !== undefined && {
        lateFeeAmount: FinancialCalculator.stringToCents(moneyData.lateFeeAmount),
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
      rentAmount: FinancialCalculator.centsToString(fees.rentAmount),
      securityDeposit: FinancialCalculator.centsToString(fees.securityDeposit),
      ...(fees.lateFeeAmount !== undefined && {
        lateFeeAmount: FinancialCalculator.centsToString(fees.lateFeeAmount),
      }),
    };
  },

  parseLeaseFees: (fees: any): any => {
    if (!fees || typeof fees !== 'object') return fees;
    return {
      ...fees,
      rentAmount: FinancialCalculator.stringToCents(fees.rentAmount),
      securityDeposit: FinancialCalculator.stringToCents(fees.securityDeposit),
      ...(fees.lateFeeAmount !== undefined && {
        lateFeeAmount: FinancialCalculator.stringToCents(fees.lateFeeAmount),
      }),
    };
  },

  /** Pet policy money fields (deposit, monthlyFee): major units → cents. Missing fields are not injected. */
  parsePetPolicyFees: (petPolicy: any): any => {
    if (!petPolicy || typeof petPolicy !== 'object') return petPolicy;
    return {
      ...petPolicy,
      ...(petPolicy.deposit != null && {
        deposit: FinancialCalculator.stringToCents(petPolicy.deposit),
      }),
      ...(petPolicy.monthlyFee != null && {
        monthlyFee: FinancialCalculator.stringToCents(petPolicy.monthlyFee),
      }),
    };
  },

  /** Pet policy money fields: cents → display strings. Missing fields are not injected. */
  formatPetPolicyFees: (petPolicy: any): any => {
    if (!petPolicy || typeof petPolicy !== 'object') return petPolicy;
    return {
      ...petPolicy,
      ...(petPolicy.deposit != null && {
        deposit: FinancialCalculator.centsToString(petPolicy.deposit),
      }),
      ...(petPolicy.monthlyFee != null && {
        monthlyFee: FinancialCalculator.centsToString(petPolicy.monthlyFee),
      }),
    };
  },
};
