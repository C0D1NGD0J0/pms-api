import dayjs from 'dayjs';
import { FinancialCalculator } from '@utils/financial';
import { storedCalendarDay } from '@utils/timezone.utils';
import { ILeaseDocument } from '@interfaces/lease.interface';

/**
 * Annual leases bill once per lease-year, on the anniversary of the start date. A lease-year is
 * identified by its index (0 = the year starting on the start date) and stored on the payment as
 * the period { month: start month, year: start year + index, frequency: 'annual' }, so the
 * existing one-record-per-period rule still applies.
 */

type AnnualLease = {
  includeManagementFee?: boolean;
  propertyInfo?: any;
  property?: any;
} & Pick<ILeaseDocument, 'fees' | 'duration' | 'petPolicy'>;

export const isAnnualLease = (lease: Pick<ILeaseDocument, 'fees'>): boolean =>
  lease.fees?.paymentFrequency === 'annual';

/** A stored date-only value (UTC midnight) as the same calendar day in local time. */
const localCalendarDate = (date: Date | string): dayjs.Dayjs => {
  const day = storedCalendarDay(date);
  return dayjs(new Date(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
};

/**
 * Whole months lease-year `yearIndex` covers: 12, except a last year cut short by the end date,
 * where a partial month counts as a full one.
 */
export function monthsInLeaseYear(
  lease: Pick<ILeaseDocument, 'duration'>,
  yearIndex: number
): number {
  const yearStart = annualRentDueDate(lease.duration.startDate, yearIndex);
  const nextYearStart = annualRentDueDate(lease.duration.startDate, yearIndex + 1);
  const leaseEnd = lease.duration.terminationDate ?? lease.duration.endDate;
  if (!leaseEnd) return 12;

  // The end date is the lease's last day, so the term runs up to the day after it
  const termEnd = localCalendarDate(leaseEnd).add(1, 'day');
  if (!termEnd.isBefore(nextYearStart)) return 12;

  const months = Math.ceil(termEnd.diff(yearStart, 'month', true));
  return Math.min(12, Math.max(1, months));
}

/** The latest anniversary due date on or before `by`, or null when `by` is before the start. */
export function latestAnnualDueDate(
  leaseStartDate: Date | string,
  by: dayjs.Dayjs
): dayjs.Dayjs | null {
  const firstDueDate = annualRentDueDate(leaseStartDate, 0);
  if (by.isBefore(firstDueDate)) return null;

  let yearIndex = by.year() - firstDueDate.year();
  if (annualRentDueDate(leaseStartDate, yearIndex).isAfter(by)) yearIndex -= 1;
  return annualRentDueDate(leaseStartDate, yearIndex);
}

/**
 * Due date of lease-year `yearIndex`, as a local day like `rentDueDateForMonth`. A Feb 29 start
 * falls on Feb 28 in years without one.
 */
export function annualRentDueDate(leaseStartDate: Date | string, yearIndex: number): dayjs.Dayjs {
  const start = storedCalendarDay(leaseStartDate);
  const monthStart = dayjs(new Date(start.getUTCFullYear() + yearIndex, start.getUTCMonth(), 1));
  return monthStart.date(Math.min(start.getUTCDate(), monthStart.daysInMonth())).startOf('day');
}

/**
 * The lease-year a billing period stands for, or null when the period isn't an anniversary
 * month on or after the start (annual leases are only billed on anniversaries).
 */
export function annualYearIndexForPeriod(
  leaseStartDate: Date | string,
  period: { month: number; year: number }
): number | null {
  const start = storedCalendarDay(leaseStartDate);
  const yearIndex = period.year - start.getUTCFullYear();
  if (period.month !== start.getUTCMonth() + 1 || yearIndex < 0) return null;
  return yearIndex;
}

/** The billing period stored on an annual lease-year's payment. */
export function annualRentPeriod(
  leaseStartDate: Date | string,
  yearIndex: number
): { month: number; year: number; frequency: 'annual' } {
  const start = storedCalendarDay(leaseStartDate);
  return {
    month: start.getUTCMonth() + 1,
    year: start.getUTCFullYear() + yearIndex,
    frequency: 'annual',
  };
}

const formatMonth = (date: dayjs.Dayjs): string =>
  date.toDate().toLocaleString('en-US', { month: 'short', year: 'numeric' });

/**
 * Line items for one annual lease-year: the annual rent plus the pet and management fees for
 * the months it covers. A shorter last year is pro-rated by month.
 */
export function buildAnnualRentLineItems(
  lease: AnnualLease,
  yearIndex: number
): { description: string; amountInCents: number }[] {
  const months = monthsInLeaseYear(lease, yearIndex);
  const yearStart = annualRentDueDate(lease.duration.startDate, yearIndex);
  const lastMonth = yearStart.add(months - 1, 'month');
  const span = `${formatMonth(yearStart)} – ${formatMonth(lastMonth)}`;

  const { petMonthlyFee, managementFee } = FinancialCalculator.leaseMonthlyFees(lease as any);
  const annualRent = lease.fees?.annualRentAmount ?? 0;
  const rent = FinancialCalculator.proRatePartialYear(annualRent, months);

  const lineItems: { description: string; amountInCents: number }[] = [];
  if (rent > 0) {
    lineItems.push({
      description: months === 12 ? `Annual Rent (${span})` : `Rent (${span}, ${months} months)`,
      amountInCents: rent,
    });
  }
  if (petMonthlyFee > 0) {
    lineItems.push({
      description: `Pet Fee (${months} months)`,
      amountInCents: petMonthlyFee * months,
    });
  }
  if (managementFee > 0) {
    lineItems.push({
      description: `Management Fee (${months} months)`,
      amountInCents: managementFee * months,
    });
  }
  return lineItems;
}
