import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

// ── Pro-ration ────────────────────────────────────────────────────────────────

/** ceil((monthlyRent × daysCharged) / daysInMonth). Returns full month when startDay === 1. All values in cents. */
export const proRateAmount = (
  monthlyRentCents: number,
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
    return { amount: monthlyRentCents, daysCharged, daysInMonth, isFullMonth: true };
  }

  const proRated = new Decimal(monthlyRentCents)
    .times(daysCharged)
    .div(daysInMonth)
    .toDecimalPlaces(0, Decimal.ROUND_CEIL)
    .toNumber();

  return { amount: proRated, daysCharged, daysInMonth, isFullMonth: false };
};

/** ceil((monthlyRent × daysCharged) / daysInMonth). Returns full month when endDay === daysInMonth. All values in cents. */
export const proRateLastMonth = (
  monthlyRentCents: number,
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
  const dailyRate = new Decimal(monthlyRentCents)
    .div(daysInMonth)
    .toDecimalPlaces(0, Decimal.ROUND_CEIL)
    .toNumber();

  if (daysCharged === daysInMonth) {
    return { amount: monthlyRentCents, daysCharged, daysInMonth, dailyRate, isFullMonth: true };
  }

  const proRated = new Decimal(monthlyRentCents)
    .times(daysCharged)
    .div(daysInMonth)
    .toDecimalPlaces(0, Decimal.ROUND_CEIL)
    .toNumber();

  return { amount: proRated, daysCharged, daysInMonth, dailyRate, isFullMonth: false };
};

// ── Fee calculations ──────────────────────────────────────────────────────────

/** 'percentage': round_half_up(rent × rate / 100). 'fixed': passthrough. All values in cents. */
export const calcLateFee = (
  monthlyRentCents: number,
  type: 'percentage' | 'fixed',
  rateOrAmount: number
): number => {
  if (type === 'percentage') {
    return new Decimal(monthlyRentCents)
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
