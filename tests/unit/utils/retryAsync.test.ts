import { retryAsync } from '@utils/retryAsync';
import { beforeEach, afterEach, describe, expect, jest, it } from '@jest/globals';

// jest.fn() returns Mock<UnknownFunction> — bridge to typed callback signatures
const asCallback = <T>(mock: ReturnType<typeof jest.fn>) => mock as unknown as T;

// Run op + drain all fake timers concurrently to avoid unhandled-rejection warnings
async function run<T>(op: () => Promise<T>): Promise<T> {
  const [result] = await Promise.all([op(), jest.runAllTimersAsync()]);
  return result;
}

describe('retryAsync', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('returns value immediately on first success', async () => {
    const fn = jest.fn();
    fn.mockReturnValue(Promise.resolve('ok'));

    const result = await retryAsync(fn as () => Promise<string>, { attempts: 3, backoff: 'fixed', delay: 50 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and returns value on later success', async () => {
    const fn = jest.fn();
    fn.mockImplementationOnce(() => Promise.reject(new Error('transient')))
      .mockImplementation(() => Promise.resolve('recovered'));

    const result = await run(() => retryAsync(fn as () => Promise<string>, { attempts: 3, backoff: 'fixed', delay: 50 }));

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws last error after exhausting all attempts', async () => {
    const fn = jest.fn();
    fn.mockImplementation(() => Promise.reject(new Error('always fails')));

    await expect(
      run(() => retryAsync(fn as () => Promise<never>, { attempts: 3, backoff: 'fixed', delay: 50 }))
    ).rejects.toThrow('always fails');

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('stops retrying immediately when retryOn returns false', async () => {
    const fn = jest.fn();
    fn.mockImplementation(() => Promise.reject(new Error('fatal')));
    const retryOn = asCallback<(e: Error) => boolean>(jest.fn().mockReturnValue(false));

    await expect(
      run(() => retryAsync(fn as () => Promise<never>, { attempts: 3, backoff: 'fixed', delay: 50, retryOn }))
    ).rejects.toThrow('fatal');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls onRetry with error and attempt number on each retry, not on final attempt', async () => {
    const err1 = new Error('fail-1');
    const err2 = new Error('fail-2');
    const fn = jest.fn();
    fn.mockImplementationOnce(() => Promise.reject(err1))
      .mockImplementationOnce(() => Promise.reject(err2))
      .mockImplementation(() => Promise.resolve('done'));
    const onRetry = jest.fn();

    await run(() => retryAsync(fn as () => Promise<string>, { attempts: 3, backoff: 'fixed', delay: 50, onRetry }));

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, err1, 1);
    expect(onRetry).toHaveBeenNthCalledWith(2, err2, 2);
  });

  it('uses the same delay for every retry under fixed backoff', async () => {
    const fn = jest.fn().mockImplementation(() => Promise.reject(new Error('fail')));
    const spy = jest.spyOn(globalThis, 'setTimeout');

    await expect(
      run(() => retryAsync(fn as () => Promise<never>, { attempts: 3, backoff: 'fixed', delay: 200 }))
    ).rejects.toThrow();

    const delays = spy.mock.calls.map((c) => c[1] as number);
    expect(delays).toEqual([200, 200]);
    spy.mockRestore();
  });

  it('doubles the delay on each retry under exponential backoff', async () => {
    const fn = jest.fn().mockImplementation(() => Promise.reject(new Error('fail')));
    const spy = jest.spyOn(globalThis, 'setTimeout');

    await expect(
      run(() => retryAsync(fn as () => Promise<never>, { attempts: 4, backoff: 'exponential', delay: 100 }))
    ).rejects.toThrow();

    const delays = spy.mock.calls.map((c) => c[1] as number);
    expect(delays).toEqual([100, 200, 400]);
    spy.mockRestore();
  });

  it('wraps non-Error thrown values in an Error before rethrowing', async () => {
    const fn = jest.fn().mockImplementation(() => Promise.reject('plain string'));

    await expect(
      retryAsync(fn as () => Promise<never>, { attempts: 1, backoff: 'fixed', delay: 0 })
    ).rejects.toThrow('plain string');
  });
});
