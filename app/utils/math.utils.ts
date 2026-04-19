import dayjs from 'dayjs';
import Decimal from 'decimal.js';

// ── General ───────────────────────────────────────────────────────────────────

export const calcPercentage = (value: number, total: number): number =>
  total === 0
    ? 0
    : new Decimal(value).div(total).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();

// ── Property / Unit metrics ───────────────────────────────────────────────────

export const calcOccupancyRate = (occupied: number, total: number): number =>
  calcPercentage(occupied, total);

export const calcCollectionRate = (collected: number, expected: number): number =>
  calcPercentage(collected, expected);

// ── Date / Time helpers ───────────────────────────────────────────────────────

/** Raw ms diff → whole days (ceiling). */
export const msToDays = (ms: number): number => Math.ceil(ms / (1000 * 60 * 60 * 24));

export const calcDaysRemaining = (futureDate: Date, from = new Date()): number =>
  Math.max(0, Math.ceil(dayjs(futureDate).diff(dayjs(from), 'day', true)));

export const calcDaysElapsed = (pastDate: Date, from = new Date()): number =>
  Math.max(0, Math.ceil(dayjs(from).diff(dayjs(pastDate), 'day', true)));

export const calcLeaseProgress = (elapsed: number, remaining: number): number =>
  calcPercentage(elapsed, elapsed + remaining);

export const daysInMs = (n: number): number => n * 24 * 60 * 60 * 1000;

// ── Rounding ──────────────────────────────────────────────────────────────────

export const roundToDecimal = (value: number, places: number): number =>
  new Decimal(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toNumber();

export const calcPercentChange = (recent: number, prior: number): number =>
  prior === 0
    ? 0
    : new Decimal(recent)
        .minus(prior)
        .div(prior)
        .times(100)
        .toDecimalPlaces(1, Decimal.ROUND_HALF_UP)
        .toNumber();

// ── Pagination ────────────────────────────────────────────────────────────────

export const calcTotalPages = (total: number, limit: number): number =>
  Math.ceil(total / (limit || 1));

export const calcSkip = (page: number, limit: number): number => ((page || 1) - 1) * (limit || 10);

// ── File size ─────────────────────────────────────────────────────────────────

export const megabytes = (n: number): number => n * 1024 * 1024;
