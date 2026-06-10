import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

// ── Pro-ration ────────────────────────────────────────────────────────────────

/** ceil((rentAmount × daysCharged) / daysInMonth). Returns full month when startDay === 1. All values in cents. */
export const proRateAmount = (
  rentAmountCents: number,
  startDate: Date
): {
  amount: number;
  daysCharged: number;
  daysInMonth: number;
  isFullMonth: boolean;
} => {
  const start = new Date(startDate);
  const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const startDay = start.getDate();
  const daysCharged = daysInMonth - startDay + 1;

  if (startDay === 1) {
    return { amount: rentAmountCents, daysCharged, daysInMonth, isFullMonth: true };
  }

  const proRated = new Decimal(rentAmountCents)
    .times(daysCharged)
    .div(daysInMonth)
    .toDecimalPlaces(0, Decimal.ROUND_CEIL)
    .toNumber();

  return { amount: proRated, daysCharged, daysInMonth, isFullMonth: false };
};

/** ceil((rentAmount × daysCharged) / daysInMonth). Returns full month when endDay === daysInMonth. All values in cents. */
export const proRateLastMonth = (
  rentAmountCents: number,
  endDate: Date
): {
  amount: number;
  daysCharged: number;
  daysInMonth: number;
  dailyRate: number;
  isFullMonth: boolean;
} => {
  const end = new Date(endDate);
  const daysInMonth = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
  const daysCharged = end.getDate();
  const dailyRate = new Decimal(rentAmountCents)
    .div(daysInMonth)
    .toDecimalPlaces(0, Decimal.ROUND_CEIL)
    .toNumber();

  if (daysCharged === daysInMonth) {
    return { amount: rentAmountCents, daysCharged, daysInMonth, dailyRate, isFullMonth: true };
  }

  const proRated = new Decimal(rentAmountCents)
    .times(daysCharged)
    .div(daysInMonth)
    .toDecimalPlaces(0, Decimal.ROUND_CEIL)
    .toNumber();

  return { amount: proRated, daysCharged, daysInMonth, dailyRate, isFullMonth: false };
};

// ── Fee calculations ──────────────────────────────────────────────────────────

/** 'percentage': round_half_up(rent × rate / 100). 'fixed': passthrough. All values in cents. */
export const calcLateFee = (
  rentAmountCents: number,
  type: 'percentage' | 'fixed',
  rateOrAmount: number
): number => {
  if (type === 'percentage') {
    return new Decimal(rentAmountCents)
      .times(rateOrAmount)
      .div(100)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toNumber();
  }
  return rateOrAmount;
};

/** round_half_up(amount × percentRate / 100) + fixedFeeCents. All values in cents. */
export const calcGatewayFee = (
  amountCents: number,
  percentRate: number,
  fixedFeeCents: number
): number =>
  new Decimal(amountCents)
    .times(percentRate)
    .div(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .plus(fixedFeeCents)
    .toNumber();

/** Returns { applicationFee, gatewayFee, platformRevenue } all in cents. platformRevenue can be negative. */
export const calcApplicationFeeSplit = (
  totalAmountCents: number,
  transactionFeePercent: number,
  gatewayFeeFn: (amount: number) => number
): {
  applicationFee: number;
  gatewayFee: number;
  platformRevenue: number;
} => {
  const applicationFee = new Decimal(totalAmountCents)
    .times(transactionFeePercent)
    .div(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();

  const gatewayFee = gatewayFeeFn(totalAmountCents);
  const platformRevenue = new Decimal(applicationFee).minus(gatewayFee).toNumber();

  return { applicationFee, gatewayFee, platformRevenue };
};

// ── Rent adjustments ──────────────────────────────────────────────────────────

/** @throws if percentage < -100 */
export const calcRentAdjustment = (
  currentRentCents: number,
  percentage: number
): {
  oldAmount: number;
  newAmount: number;
  difference: number;
  percentageApplied: number;
} => {
  if (percentage < -100) {
    throw new Error('Percentage cannot be less than -100%');
  }

  const newAmount = new Decimal(currentRentCents)
    .times(new Decimal(1).plus(new Decimal(percentage).div(100)))
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();

  return {
    oldAmount: currentRentCents,
    newAmount,
    difference: new Decimal(newAmount).minus(currentRentCents).toNumber(),
    percentageApplied: percentage,
  };
};

// ── Subscription pricing ──────────────────────────────────────────────────────

export const calcAnnualToMonthly = (annualPriceCents: number): number =>
  new Decimal(annualPriceCents).div(12).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();

export const calcSeatCost = (seatCount: number, pricePerSeatCents: number): number =>
  new Decimal(seatCount)
    .times(pricePerSeatCents)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();

// ── Income estimates ──────────────────────────────────────────────────────────

const NET_INCOME_FACTOR = new Decimal('0.9');

/** 90% of gross rent. For projections only — not for invoicing. */
export const estimateNetIncome = (grossRentCents: number): number =>
  new Decimal(grossRentCents)
    .times(NET_INCOME_FACTOR)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();

// ── Lease monthly fee breakdown ───────────────────────────────────────────────

/**
 * Minimal shape required to compute monthly fees.
 * Accepts both ILeaseDocument instances and plain toObject() results.
 */
export interface LeaseFeesInput {
  petPolicy?: { monthlyFee?: number; deposit?: number } | null;
  fees: { rentAmount: number; securityDeposit: number };
  includeManagementFee?: boolean;
  // These fields are Mongoose virtuals populated at runtime — typed loosely so
  // both ILeaseDocument instances and plain toObject() results are accepted.
  propertyInfo?: any;
  property?: any;
}

export interface LeaseMonthlyFees {
  totalMonthlyRent: number;
  securityDeposit: number;
  managementFee: number;
  petMonthlyFee: number;
  petDeposit: number;
  baseRent: number;
}

/**
 * Canonical lease fee breakdown used across services, helpers, and DAOs.
 *
 * Management fee is gated by `includeManagementFee`. Property fees are read
 * from the `propertyInfo` virtual first, falling back to the `property.id`
 * populated reference, so callers work regardless of which populate path they used.
 */
export function computeLeaseMonthlyFees(lease: LeaseFeesInput): LeaseMonthlyFees {
  const baseRent = lease.fees.rentAmount;
  const petMonthlyFee = lease.petPolicy?.monthlyFee || 0;
  const petDeposit = lease.petPolicy?.deposit || 0;
  const securityDeposit = lease.fees.securityDeposit;

  const propertyFees = (lease as any).propertyInfo?.fees ?? (lease as any).property?.id?.fees;

  const managementFee = lease.includeManagementFee ? Number(propertyFees?.managementFees ?? 0) : 0;

  return {
    baseRent,
    managementFee,
    petMonthlyFee,
    petDeposit,
    securityDeposit,
    totalMonthlyRent: baseRent + petMonthlyFee + managementFee,
  };
}
