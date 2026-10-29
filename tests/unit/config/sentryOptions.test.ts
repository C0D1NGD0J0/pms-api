import type { ErrorEvent, EventHint } from '@sentry/node';
import { buildSentryOptions, dropNoisyEvents, sampleRate } from '@shared/config/sentry.options';

const DSN = 'https://key@o0.ingest.sentry.io/1';
const event = { event_id: 'e1' } as ErrorEvent;
const hintFor = (originalException: unknown) => ({ originalException }) as EventHint;

describe('buildSentryOptions (free plan)', () => {
  it('is enabled only in production', () => {
    expect(buildSentryOptions({ SENTRY_DSN: DSN, NODE_ENV: 'production' }).enabled).toBe(true);
    expect(buildSentryOptions({ SENTRY_DSN: DSN, NODE_ENV: 'development' }).enabled).toBe(false);
    expect(buildSentryOptions({ SENTRY_DSN: DSN }).enabled).toBe(false);
  });

  it('can be forced on for a one-off local test, but never without a DSN', () => {
    expect(buildSentryOptions({ SENTRY_DSN: DSN, SENTRY_ENABLED: 'true' }).enabled).toBe(true);
    expect(buildSentryOptions({ NODE_ENV: 'production', SENTRY_ENABLED: 'true' }).enabled).toBe(
      false
    );
  });

  it('traces a low 5% by default, overridable through SENTRY_TRACES_SAMPLE_RATE', () => {
    expect(buildSentryOptions({ NODE_ENV: 'production' }).tracesSampleRate).toBe(0.05);
    expect(
      buildSentryOptions({ NODE_ENV: 'production', SENTRY_TRACES_SAMPLE_RATE: '0' })
        .tracesSampleRate
    ).toBe(0);
    expect(
      buildSentryOptions({ NODE_ENV: 'production', SENTRY_TRACES_SAMPLE_RATE: '0.2' })
        .tracesSampleRate
    ).toBe(0.2);
  });
});

describe('sampleRate', () => {
  it('uses the env value when it is between 0 and 1', () => {
    expect(sampleRate('0', 0.05)).toBe(0);
    expect(sampleRate('1', 0.05)).toBe(1);
  });

  it('falls back for missing, invalid or out-of-range values', () => {
    expect(sampleRate(undefined, 0.05)).toBe(0.05);
    expect(sampleRate('', 0.05)).toBe(0.05);
    expect(sampleRate('abc', 0.05)).toBe(0.05);
    expect(sampleRate('2', 0.05)).toBe(0.05);
    expect(sampleRate('-1', 0.05)).toBe(0.05);
  });
});

describe('dropNoisyEvents', () => {
  it('drops open circuit breaker errors', () => {
    const error = Object.assign(new Error('open'), { name: 'CircuitBreakerOpenError' });
    expect(dropNoisyEvents(event, hintFor(error))).toBeNull();
  });

  it('drops expected client errors below 500', () => {
    const error = Object.assign(new Error('Not found'), { statusCode: 404 });
    expect(dropNoisyEvents(event, hintFor(error))).toBeNull();
  });

  it('keeps server errors and plain exceptions', () => {
    const serverError = Object.assign(new Error('db down'), { statusCode: 500 });
    expect(dropNoisyEvents(event, hintFor(serverError))).toBe(event);
    expect(dropNoisyEvents(event, hintFor(new TypeError('x is undefined')))).toBe(event);
    expect(dropNoisyEvents(event, hintFor(undefined))).toBe(event);
  });
});
