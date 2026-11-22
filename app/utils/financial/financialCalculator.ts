import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

/** Days after the due date before a late fee applies, when the lease doesn't set lateFeeDays. */
export const DEFAULT_LATE_FEE_GRACE_DAYS = 5;

const NET_INCOME_FACTOR = new Decimal('0.9');
const DAY_MS = 24 * 60 * 60 * 1000;

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

/** Fee fields read by the lease's own breakdown (rent, pet fees, deposits, late-fee terms). */
export interface LeaseFeeBreakdownInput {
  fees?: {
    rentAmount?: number;
    securityDeposit?: number;
    lateFeeDays?: number;
    lateFeeType?: LateFeeType;
    lateFeePercentage?: number;
    lateFeeAmount?: number;
    currency?: string;
  } | null;
  petPolicy?: { monthlyFee?: number; deposit?: number } | null;
}

export interface LeaseMonthlyFees {
  totalMonthlyRent: number;
  securityDeposit: number;
  managementFee: number;
  petMonthlyFee: number;
  petDeposit: number;
  baseRent: number;
}

export interface PropertyFeeBreakdownInput {
  securityDeposit?: number;
  managementFees?: number;
  rentAmount?: number;
  currency?: string;
}

export type LateFeeType = 'percentage' | 'fixed';

/**
 * Single home for money math. Every amount in and out is a whole number of cents.
 * Adding or multiplying whole cents is exact, so that is plain JavaScript. Decimal.js is
 * only used where a fraction gets rounded (percentages, division, pro-ration):
 * fees round half-up, pro-ration rounds up.
 *
 * Static and stateless so models, configs and DAOs can use it without the DI container.
 */
export class FinancialCalculator {
  // ── Conversion ───────────────────────────────────────────────────────────────

  /** Dollars → cents. e.g. 12.50 → 1250 */
  static toCents(dollars: number): number {
    return new Decimal(dollars).times(100).round().toNumber();
  }

  /** Cents → dollars rounded to 2 decimal places. e.g. 1250 → 12.50 */
  static fromCents(cents: number): number {
    return new Decimal(cents).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
  }

  /** Cents → fixed-decimal string. e.g. 1250 → "12.50" */
  static centsToDisplay(cents: number, decimalPlaces = 2): string {
    return new Decimal(cents).div(100).toFixed(decimalPlaces);
  }

  /** Like centsToDisplay, but null/undefined/NaN become "0.00". */
  static centsToString(cents: number | null | undefined, decimalPlaces = 2): string {
    if (cents == null) return '0.00';
    if (typeof cents !== 'number' || isNaN(cents)) return '0.00';
    return new Decimal(cents).div(100).toFixed(decimalPlaces);
  }

  /** "12.50" or 12.5 → 1250. Missing or unparseable input becomes 0. */
  static stringToCents(dollarString: string | number): number {
    if (dollarString == null) return 0;
    const numericValue = typeof dollarString === 'string' ? parseFloat(dollarString) : dollarString;
    if (isNaN(numericValue)) return 0;
    return new Decimal(numericValue).times(100).round().toNumber();
  }

  static formatCurrency(
    cents: number | null | undefined,
    currency = 'USD',
    locale = 'en-US'
  ): string {
    const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
    if (cents == null || typeof cents !== 'number' || isNaN(cents)) return formatter.format(0);
    return formatter.format(new Decimal(cents).div(100).toNumber());
  }

  // ── Generic arithmetic ───────────────────────────────────────────────────────

  /** round_half_up(amount × percent / 100) */
  static percentOf(amountCents: number, percent: number): number {
    return new Decimal(amountCents).times(percent).div(100).round().toNumber();
  }

  /** round_half_up(amount × part / whole) — amount scaled to a share of a whole. */
  static proportionalShare(amountCents: number, part: number, whole: number): number {
    return new Decimal(amountCents).times(part).div(whole).round().toNumber();
  }

  // ── Pro-ration ───────────────────────────────────────────────────────────────

  /**
   * ceil((rentAmount × daysCharged) / daysInMonth). Returns full month when startDay === 1.
   * Lease dates are stored as midnight UTC, so the calendar day is read in UTC.
   */
  static proRateFirstMonth(
    rentAmountCents: number,
    startDate: Date
  ): { amount: number; daysCharged: number; daysInMonth: number; isFullMonth: boolean } {
    const start = new Date(startDate);
    const daysInMonth = FinancialCalculator.daysInUtcMonth(start);
    const startDay = start.getUTCDate();
    const daysCharged = daysInMonth - startDay + 1;

    if (startDay === 1) {
      return { amount: rentAmountCents, daysCharged, daysInMonth, isFullMonth: true };
    }

    return {
      amount: FinancialCalculator.proRateDays(rentAmountCents, daysCharged, daysInMonth),
      daysCharged,
      daysInMonth,
      isFullMonth: false,
    };
  }

  /**
   * ceil((rentAmount × daysCharged) / daysInMonth). Returns full month when endDay === daysInMonth.
   * Lease dates are stored as midnight UTC, so the calendar day is read in UTC.
   */
  static proRateLastMonth(
    rentAmountCents: number,
    endDate: Date
  ): {
    amount: number;
    daysCharged: number;
    daysInMonth: number;
    dailyRate: number;
    isFullMonth: boolean;
  } {
    const end = new Date(endDate);
    const daysInMonth = FinancialCalculator.daysInUtcMonth(end);
    const daysCharged = end.getUTCDate();
    const dailyRate = FinancialCalculator.proRateDays(rentAmountCents, 1, daysInMonth);

    if (daysCharged === daysInMonth) {
      return { amount: rentAmountCents, daysCharged, daysInMonth, dailyRate, isFullMonth: true };
    }

    return {
      amount: FinancialCalculator.proRateDays(rentAmountCents, daysCharged, daysInMonth),
      daysCharged,
      daysInMonth,
      dailyRate,
      isFullMonth: false,
    };
  }

  private static daysInUtcMonth(date: Date): number {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  }

  private static proRateDays(
    amountCents: number,
    daysCharged: number,
    daysInMonth: number
  ): number {
    return new Decimal(amountCents)
      .times(daysCharged)
      .div(daysInMonth)
      .toDecimalPlaces(0, Decimal.ROUND_CEIL)
      .toNumber();
  }

  // ── Late fees ────────────────────────────────────────────────────────────────

  /** 'percentage': round_half_up(rent × rate / 100). 'fixed': passthrough. */
  static lateFee(rentAmountCents: number, type: LateFeeType, rateOrAmount: number): number {
    if (type === 'percentage') return FinancialCalculator.percentOf(rentAmountCents, rateOrAmount);
    return rateOrAmount;
  }

  /**
   * Whole calendar days from the due date to `asOf`, never negative. Both are read as UTC
   * calendar days — the convention due dates are stored in. Pass `localCalendarDay(now, tz)`
   * as `asOf` to count in the client's time zone.
   */
  static daysLate(dueDate: Date, asOf: Date = new Date()): number {
    const dueDay = FinancialCalculator.utcCalendarDayMs(new Date(dueDate));
    const asOfDay = FinancialCalculator.utcCalendarDayMs(new Date(asOf));
    return Math.max(0, Math.round((asOfDay - dueDay) / DAY_MS));
  }

  private static utcCalendarDayMs(date: Date): number {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  // ── Platform / gateway fees ──────────────────────────────────────────────────

  /** round_half_up(amount × percentRate / 100) + fixedFeeCents, optionally capped at maxFeeCents. */
  static gatewayFee(
    amountCents: number,
    percentRate: number,
    fixedFeeCents: number,
    maxFeeCents?: number
  ): number {
    const fee = FinancialCalculator.percentOf(amountCents, percentRate) + fixedFeeCents;
    return maxFeeCents != null ? Math.min(fee, maxFeeCents) : fee;
  }

  /** platformRevenue = applicationFee − gatewayFee, and can be negative. */
  static applicationFeeSplit(
    totalAmountCents: number,
    transactionFeePercent: number,
    gatewayFeeFn: (amount: number) => number
  ): { applicationFee: number; gatewayFee: number; platformRevenue: number } {
    const applicationFee = FinancialCalculator.percentOf(totalAmountCents, transactionFeePercent);
    const gatewayFee = gatewayFeeFn(totalAmountCents);
    const platformRevenue = applicationFee - gatewayFee;
    return { applicationFee, gatewayFee, platformRevenue };
  }

  // ── Payment totals ───────────────────────────────────────────────────────────

  /**
   * The processing fee the tenant actually paid. On manual entries the PM records it; on
   * online payments processingFee is the gateway's cost, which the platform absorbs.
   */
  static tenantProcessingFee(payment: {
    processingFee?: number | null;
    paymentMethod?: string | null;
  }): number {
    return payment.paymentMethod === 'online' ? 0 : payment.processingFee || 0;
  }

  /** What the tenant paid for a payment record: base amount plus any fee they were charged. */
  static paymentTotal(payment: {
    baseAmount?: number | null;
    processingFee?: number | null;
    paymentMethod?: string | null;
  }): number {
    return (payment.baseAmount || 0) + FinancialCalculator.tenantProcessingFee(payment);
  }

  // ── Refunds ──────────────────────────────────────────────────────────────────

  /** What can still be refunded on a payment, given the cumulative amount already refunded. */
  static refundableRemaining(baseAmountCents: number, alreadyRefundedCents = 0): number {
    return Math.max(0, baseAmountCents - (alreadyRefundedCents || 0));
  }

  // ── Rent ─────────────────────────────────────────────────────────────────────

  /** @throws if percentage < -100 */
  static rentAdjustment(
    currentRentCents: number,
    percentage: number
  ): { oldAmount: number; newAmount: number; difference: number; percentageApplied: number } {
    if (percentage < -100) {
      throw new Error('Percentage cannot be less than -100%');
    }

    const newAmount = new Decimal(currentRentCents)
      .times(100 + percentage)
      .div(100)
      .round()
      .toNumber();

    return {
      oldAmount: currentRentCents,
      newAmount,
      difference: newAmount - currentRentCents,
      percentageApplied: percentage,
    };
  }

  /**
   * Canonical lease fee breakdown used across services, helpers, and DAOs.
   *
   * Management fee is gated by `includeManagementFee`. Property fees are read
   * from the `propertyInfo` virtual first, falling back to the `property.id`
   * populated reference, so callers work regardless of which populate path they used.
   */
  static leaseMonthlyFees(lease: LeaseFeesInput): LeaseMonthlyFees {
    const baseRent = lease.fees.rentAmount;
    const petMonthlyFee = lease.petPolicy?.monthlyFee || 0;
    const petDeposit = lease.petPolicy?.deposit || 0;
    const securityDeposit = lease.fees.securityDeposit;

    const propertyFees = lease.propertyInfo?.fees ?? lease.property?.id?.fees;
    const managementFee = lease.includeManagementFee
      ? Number(propertyFees?.managementFees ?? 0)
      : 0;

    return {
      baseRent,
      managementFee,
      petMonthlyFee,
      petDeposit,
      securityDeposit,
      totalMonthlyRent: baseRent + petMonthlyFee + managementFee,
    };
  }

  /**
   * The lease's own fee view: rent + pet fee (no management fee), deposits, and the
   * late fee owed once `daysLate` reaches the grace period.
   */
  static leaseFeeBreakdown(lease: LeaseFeeBreakdownInput, options?: { daysLate?: number }) {
    const daysLate = options?.daysLate || 0;
    const fees = lease.fees;

    const rentAmount = fees?.rentAmount || 0;
    const petMonthlyFee = lease.petPolicy?.monthlyFee || 0;
    const securityDeposit = fees?.securityDeposit || 0;
    const petDeposit = lease.petPolicy?.deposit || 0;
    const gracePeriod = fees?.lateFeeDays || DEFAULT_LATE_FEE_GRACE_DAYS;

    let lateFee = 0;
    if (daysLate >= gracePeriod) {
      lateFee =
        fees?.lateFeeType === 'percentage' && fees?.lateFeePercentage
          ? FinancialCalculator.lateFee(rentAmount, 'percentage', fees.lateFeePercentage)
          : FinancialCalculator.lateFee(rentAmount, 'fixed', fees?.lateFeeAmount || 0);
    }

    return {
      monthly: {
        rent: rentAmount,
        petFee: petMonthlyFee,
        total: rentAmount + petMonthlyFee,
      },
      deposits: {
        security: securityDeposit,
        pet: petDeposit,
        total: securityDeposit + petDeposit,
      },
      late: {
        daysLate,
        fee: lateFee,
        type: fees?.lateFeeType || 'fixed',
        percentage: fees?.lateFeePercentage,
        gracePeriod,
      },
      currency: fees?.currency || 'USD',
    };
  }

  /** Management fee as a share of rent, as a 2-decimal string (e.g. "8.50"). "0.00" when rent is 0. */
  static managementFeePercentage(managementFeesCents: number, rentAmountCents: number): string {
    if (!(rentAmountCents > 0)) return '0.00';
    return new Decimal(managementFeesCents).div(rentAmountCents).times(100).toFixed(2);
  }

  static propertyFeeBreakdown(fees: PropertyFeeBreakdownInput | null | undefined) {
    const rentAmount = fees?.rentAmount || 0;
    const managementFees = fees?.managementFees || 0;
    const totalMonthly = rentAmount + managementFees;

    return {
      monthly: {
        rental: rentAmount,
        management: managementFees,
        total: totalMonthly,
      },
      annual: {
        total: totalMonthly * 12,
      },
      deposits: {
        security: fees?.securityDeposit || 0,
      },
      analysis: {
        managementFeePercentage: FinancialCalculator.managementFeePercentage(
          managementFees,
          rentAmount
        ),
      },
      currency: fees?.currency || 'USD',
    };
  }

  // ── Subscription pricing ─────────────────────────────────────────────────────

  static annualToMonthly(annualPriceCents: number): number {
    return new Decimal(annualPriceCents).div(12).round().toNumber();
  }

  /** round_half_up(monthly × 12 × (100 − discount) / 100). */
  static annualFromMonthly(monthlyPriceCents: number, discountPercent: number): number {
    return FinancialCalculator.percentOf(monthlyPriceCents * 12, 100 - discountPercent);
  }

  static seatCost(seatCount: number, pricePerSeatCents: number): number {
    return seatCount * pricePerSeatCents;
  }

  // ── Income estimates ─────────────────────────────────────────────────────────

  /** 90% of gross rent. For projections only — not for invoicing. */
  static estimateNetIncome(grossRentCents: number): number {
    return new Decimal(grossRentCents).times(NET_INCOME_FACTOR).round().toNumber();
  }
}
