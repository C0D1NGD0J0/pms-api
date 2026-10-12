/** Plan limits use -1 to mean "no limit" (e.g. Enterprise maxProperties, maxReportsPerMonth). */
export const UNLIMITED_PLAN_LIMIT = -1;

/** Items left before `limit` is reached; null when the limit is unlimited. */
export function remainingFor(count: number, limit: number): number | null {
  return isUnlimited(limit) ? null : Math.max(0, limit - count);
}

/** Items over `limit` (billable overage); always 0 when the limit is unlimited. */
export function overageFor(count: number, limit: number): number {
  return isUnlimited(limit) ? 0 : Math.max(0, count - limit);
}

/** True when one more item can be added on top of `count` without exceeding `limit`. */
export function isWithinLimit(count: number, limit: number): boolean {
  return isUnlimited(limit) || count < limit;
}

export function isUnlimited(limit: number | null | undefined): boolean {
  return limit === UNLIMITED_PLAN_LIMIT;
}
