import { FinancialCalculator, LeaseMonthlyFees, LeaseFeesInput } from '@utils/financial';

/**
 * @deprecated Compatibility layer — import FinancialCalculator from '@utils/financial' instead.
 * Every export delegates to FinancialCalculator; this file goes away once callers migrate.
 */

export type { LeaseMonthlyFees, LeaseFeesInput };

export const proRateAmount = FinancialCalculator.proRateFirstMonth;
export const proRateLastMonth = FinancialCalculator.proRateLastMonth;
export const calcLateFee = FinancialCalculator.lateFee;
export const calcGatewayFee = FinancialCalculator.gatewayFee;
export const calcApplicationFeeSplit = FinancialCalculator.applicationFeeSplit;
export const calcRentAdjustment = FinancialCalculator.rentAdjustment;
export const calcAnnualToMonthly = FinancialCalculator.annualToMonthly;
export const calcSeatCost = FinancialCalculator.seatCost;
export const estimateNetIncome = FinancialCalculator.estimateNetIncome;

export function computeLeaseMonthlyFees(lease: LeaseFeesInput): LeaseMonthlyFees {
  return FinancialCalculator.leaseMonthlyFees(lease);
}
