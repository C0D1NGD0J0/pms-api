import Logger from 'bunyan';

import { createLogger } from './helpers';

interface CircuitBreakerOptions {
  isFailure?: (err: Error) => boolean;
  failureThreshold: number;
  cooldownMs: number;
  logger?: Logger;
  name: string;
}

type State = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly isFailure: (err: Error) => boolean;
  private readonly log: Logger;

  private state: State = 'closed';
  private failures = 0;
  private openedAt: number | null = null;

  constructor(opts: CircuitBreakerOptions) {
    this.name = opts.name;
    this.failureThreshold = opts.failureThreshold;
    this.cooldownMs = opts.cooldownMs;
    this.isFailure = opts.isFailure ?? (() => true);
    this.log = opts.logger ?? createLogger(`CircuitBreaker:${opts.name}`);
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - (this.openedAt ?? 0) >= this.cooldownMs) {
        this.state = 'half_open';
      } else {
        throw new CircuitBreakerOpenError(this.name);
      }
    }

    try {
      const result = await fn();
      if (this.state === 'half_open') {
        this.reset();
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (this.isFailure(error)) {
        this.recordFailure();
      }
      throw err;
    }
  }

  getState(): State {
    return this.state;
  }

  reset(): void {
    if (this.state !== 'closed') {
      this.log.info('Circuit closed');
    }
    this.state = 'closed';
    this.failures = 0;
    this.openedAt = null;
  }

  private recordFailure(): void {
    this.failures++;
    if (this.state === 'half_open' || this.failures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = Date.now();
      this.failures = 0;
      this.log.warn(
        { threshold: this.failureThreshold, cooldownMs: this.cooldownMs },
        'Circuit opened'
      );
    }
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker "${name}" is open — request rejected`);
    this.name = 'CircuitBreakerOpenError';
  }
}
