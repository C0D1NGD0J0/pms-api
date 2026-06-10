export interface RetryOptions {
  onRetry?: (error: Error, attempt: number) => void;
  retryOn?: (error: Error) => boolean; // return false to skip retry for this error
  backoff: 'fixed' | 'exponential';
  attempts: number;
  delay: number; // base delay in ms
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retries an async function up to `attempts` times with fixed or exponential backoff.
 * If `retryOn` is provided, only retries when it returns true for the thrown error.
 */
export async function retryAsync<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { attempts, backoff, delay, retryOn, onRetry } = options;

  let lastError: Error = new Error('retryAsync: no attempts made');

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      const isLastAttempt = attempt === attempts;
      if (isLastAttempt) break;

      if (retryOn && !retryOn(lastError)) break;

      onRetry?.(lastError, attempt);

      const waitMs = backoff === 'exponential' ? delay * 2 ** (attempt - 1) : delay;
      await sleep(waitMs);
    }
  }

  throw lastError;
}
