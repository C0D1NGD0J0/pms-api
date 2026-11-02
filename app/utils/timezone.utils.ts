export function getLocalDateParts(
  date: Date,
  timeZone: string
): { year: number; month: number; day: number; hour: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(date);
  } catch {
    return getLocalDateParts(date, 'UTC');
  }
  const valueOf = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: valueOf('year'),
    month: valueOf('month'),
    day: valueOf('day'),
    hour: valueOf('hour') % 24,
  };
}

/**
 * The client's local calendar date for `date`, as UTC midnight — the convention rent due dates
 * are stored in. Comparing stored due dates against this treats them as calendar days.
 */
export function localCalendarDay(date: Date, timeZone: string): Date {
  const { year, month, day } = getLocalDateParts(date, timeZone);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * The calendar day a stored date stands for, as UTC midnight. Date-only fields ("YYYY-MM-DD")
 * are stored as UTC midnight, so the UTC date is the day the user picked.
 */
export function storedCalendarDay(date: Date | string): Date {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
