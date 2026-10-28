import type { NodeOptions, ErrorEvent, EventHint } from '@sentry/node';

// No app imports: instrument.ts loads this before any other module.

type SentryEnv = Record<string, string | undefined>;

const NOISE_ERROR_NAMES = new Set(['CircuitBreakerOpenError']);

/** Drops errors that don't need an alert, so the free-plan quota goes on real failures. */
export const dropNoisyEvents = (event: ErrorEvent, hint: EventHint): ErrorEvent | null => {
  const error = hint?.originalException as { name?: string; statusCode?: number } | undefined;
  if (!error || typeof error !== 'object') return event;
  if (error.name && NOISE_ERROR_NAMES.has(error.name)) return null;
  // CustomErrors below 500 are expected outcomes (validation, not found, forbidden)
  if (typeof error.statusCode === 'number' && error.statusCode < 500) return null;
  return event;
};

export const parseSampleRate = (value: string | undefined): number => {
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0;
};

/** Sentry runs only in production (SENTRY_ENABLED=true forces it on for a local test). */
export const buildSentryOptions = (env: SentryEnv): NodeOptions => {
  const environment = env.NODE_ENV || 'development';
  const forceEnabled = env.SENTRY_ENABLED === 'true';

  return {
    dsn: env.SENTRY_DSN,
    enabled: !!env.SENTRY_DSN && (environment === 'production' || forceEnabled),
    environment,
    sendDefaultPii: env.SENTRY_SEND_DEFAULT_PII === 'true',
    // Performance tracing is off unless explicitly sampled — transactions count against quota
    tracesSampleRate: parseSampleRate(env.SENTRY_TRACES_SAMPLE_RATE),
    beforeSend: dropNoisyEvents,
  };
};
