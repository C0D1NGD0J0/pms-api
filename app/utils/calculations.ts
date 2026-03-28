// ── General ───────────────────────────────────────────────────────────────────

/** Safe percentage: returns 0 when total is 0 to avoid division-by-zero. */
export const calcPercentage = (value: number, total: number): number =>
  total === 0 ? 0 : Math.round((value / total) * 100);

// ── Property / Unit metrics ───────────────────────────────────────────────────

export const calcOccupancyRate = (occupied: number, total: number): number =>
  calcPercentage(occupied, total);

export const calcCollectionRate = (collected: number, expected: number): number =>
  calcPercentage(collected, expected || 1);

// ── Date / Time helpers ───────────────────────────────────────────────────────

/** Milliseconds → whole days (ceiling). */
export const msToDays = (ms: number): number => Math.ceil(ms / (1000 * 60 * 60 * 24));

/** Days remaining until a future date (never negative). */
export const calcDaysRemaining = (futureDate: Date, from = new Date()): number =>
  Math.max(0, msToDays(futureDate.getTime() - from.getTime()));

/** Days elapsed since a past date (never negative). */
export const calcDaysElapsed = (pastDate: Date, from = new Date()): number =>
  Math.max(0, msToDays(from.getTime() - pastDate.getTime()));

/** Lease/period progress as a percentage. */
export const calcLeaseProgress = (elapsed: number, remaining: number): number =>
  calcPercentage(elapsed, elapsed + remaining);

/** n days expressed as milliseconds — replaces `n * 24 * 60 * 60 * 1000`. */
export const daysInMs = (n: number): number => n * 24 * 60 * 60 * 1000;

// ── Pagination ────────────────────────────────────────────────────────────────

export const calcTotalPages = (total: number, limit: number): number =>
  Math.ceil(total / (limit || 1));

export const calcSkip = (page: number, limit: number): number => ((page || 1) - 1) * (limit || 10);

// ── File size ─────────────────────────────────────────────────────────────────

/** n megabytes in bytes — replaces `n * 1024 * 1024`. */
export const megabytes = (n: number): number => n * 1024 * 1024;
