import zlib from 'zlib';
import { s3ErrorLogUploader, ErrorLogArchive } from '@utils/errorLogArchive';

const ERROR = 50;
const FATAL = 60;
const FOUR_HOURS = 4 * 60 * 60 * 1000;

const record = (overrides: Record<string, unknown> = {}) => ({
  name: 'PaymentService',
  hostname: 'host',
  pid: 1,
  level: ERROR,
  msg: 'Charge failed',
  time: new Date('2026-10-27T14:05:09Z'),
  v: 0,
  ...overrides,
});

const decode = (body: Buffer): any[] =>
  zlib
    .gunzipSync(body)
    .toString()
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

describe('ErrorLogArchive', () => {
  let uploader: jest.Mock;
  let archive: ErrorLogArchive;

  const createArchive = (options: Partial<ConstructorParameters<typeof ErrorLogArchive>[0]> = {}) =>
    new ErrorLogArchive({
      flushIntervalMs: FOUR_HOURS,
      environment: 'production',
      processType: 'worker',
      ...options,
    });

  beforeEach(() => {
    jest.useFakeTimers();
    uploader = jest.fn().mockResolvedValue(undefined);
    archive = createArchive();
    archive.attachUploader(uploader);
  });

  afterEach(() => {
    archive.stop();
    jest.useRealTimers();
  });

  it('counts repeats of the same error instead of storing them again', async () => {
    archive.write(record({ msg: 'Job 101 failed', requestId: 'req-1' }));
    archive.write(record({ msg: 'Job 202 failed', requestId: 'req-2' }));
    archive.write(record({ msg: 'Job 303 failed', time: new Date('2026-10-27T15:00:00Z') }));

    await archive.flush();

    const [entry] = decode(uploader.mock.calls[0][0]);
    expect(entry).toEqual(
      expect.objectContaining({
        msg: 'Job 101 failed',
        count: 3,
        requestIds: ['req-1', 'req-2'],
        firstSeen: '2026-10-27T14:05:09.000Z',
        lastSeen: '2026-10-27T15:00:00.000Z',
      })
    );
  });

  it('keeps errors from different places as separate records', async () => {
    archive.write(record({ name: 'PaymentService' }));
    archive.write(record({ name: 'LeaseService' }));

    await archive.flush();

    expect(decode(uploader.mock.calls[0][0])).toHaveLength(2);
  });

  it('redacts secrets and PII (via redactPII), drops headers, keeps ids', async () => {
    archive.write(
      record({
        msg: 'Login failed for jane.doe@example.com on payment 6650a1b2c3d4e5f6a7b8c9d0',
        req: {
          headers: { cookie: 'session=abc' },
          body: { password: 'hunter2', email: 'jane@x.io' },
        },
        refreshToken: 'rt_123',
        cardNumber: '4242424242424242',
      })
    );

    await archive.flush();

    const [entry] = decode(uploader.mock.calls[0][0]);
    const text = JSON.stringify(entry);
    expect(entry.msg).toBe('Login failed for [EMAIL] on payment 6650a1b2c3d4e5f6a7b8c9d0');
    expect(entry.fields.req).toEqual({ body: { password: '[REDACTED]', email: '[EMAIL]' } });
    expect(entry.fields.refreshToken).toBe('[REDACTED]');
    expect(entry.fields.cardNumber).toBe('[REDACTED]');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('session=abc');
  });

  it('truncates long strings and stacks, and serialises Error objects', async () => {
    const err = new Error('x'.repeat(5000));
    err.stack = [
      'Error: boom',
      ...Array.from({ length: 50 }, (_, i) => `    at fn${i} (f.ts:${i}:1)`),
    ].join('\n');

    archive.write(record({ err }));
    await archive.flush();

    const [entry] = decode(uploader.mock.calls[0][0]);
    expect(entry.fields.err.message.length).toBeLessThan(2100);
    expect(entry.fields.err.message).toContain('[truncated]');
    expect(entry.fields.err.stack.split('\n')).toHaveLength(20);
  });

  it('caps distinct errors per upload and records how many were dropped', async () => {
    archive.stop();
    archive = createArchive({ maxRecords: 10 });
    uploader.mockReturnValue(new Promise(() => undefined)); // keep the first upload in flight
    archive.attachUploader(uploader);

    for (let i = 0; i < 8; i++) archive.write(record({ name: `Service${i}` })); // 80% → early upload
    expect(uploader).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 12; i++) archive.write(record({ name: `Other${i}` }));
    expect(archive.bufferedCount).toBe(10);
    expect((archive as any).droppedCount).toBe(2);
  });

  it('uploads early once the buffer is 80% full', () => {
    archive.stop();
    archive = createArchive({ maxRecords: 10 });
    archive.attachUploader(uploader);

    for (let i = 0; i < 7; i++) archive.write(record({ name: `Service${i}` }));
    expect(uploader).not.toHaveBeenCalled();

    archive.write(record({ name: 'Service7' }));
    expect(uploader).toHaveBeenCalledTimes(1);
  });

  it('uploads immediately on a fatal error', () => {
    archive.write(record({ level: FATAL, msg: 'Out of memory' }));

    expect(uploader).toHaveBeenCalledTimes(1);
  });

  it('uploads on the flush interval and skips empty windows', async () => {
    archive.write(record());

    await jest.advanceTimersByTimeAsync(FOUR_HOURS - 1);
    expect(uploader).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(uploader).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(FOUR_HOURS);
    expect(uploader).toHaveBeenCalledTimes(1);
  });

  it('builds a dated, per-process key', async () => {
    jest.setSystemTime(new Date('2026-10-27T09:04:03Z'));
    archive.write(record());

    await archive.flush();

    expect(uploader.mock.calls[0][1]).toMatch(
      /^error-logs\/production\/worker\/2026-10-27\/090403-[0-9a-f]{4}\.ndjson\.gz$/
    );
  });

  it('ignores S3 errors raised by its own upload, but archives them otherwise', async () => {
    let finishUpload!: () => void;
    uploader.mockReturnValueOnce(new Promise<void>((resolve) => (finishUpload = resolve)));
    archive.write(record());

    const uploading = archive.flush();
    archive.write(record({ name: 'S3Storage', msg: 'Error uploading buffer to S3' }));
    expect(archive.bufferedCount).toBe(0);

    finishUpload();
    await uploading;
    archive.write(record({ name: 'S3Storage', msg: 'Error uploading buffer to S3' }));
    expect(archive.bufferedCount).toBe(1);
  });

  it('keeps records from a failed upload for the next one and warns through the logger', async () => {
    const log = { warn: jest.fn() };
    archive.attachUploader(uploader, log as any);
    const s3Error = new Error('s3 down');
    uploader.mockRejectedValueOnce(s3Error);
    archive.write(record());

    await archive.flush();
    expect(archive.bufferedCount).toBe(1);
    expect(log.warn).toHaveBeenCalledWith(
      { err: s3Error },
      expect.stringContaining('upload failed')
    );

    archive.write(record());
    await archive.flush();
    const [entry] = decode(uploader.mock.calls[1][0]);
    expect(entry.count).toBe(2);
  });

  it('serialises errors with bunyan, keeping the error code', async () => {
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND smtp.example.com'), {
      code: 'ENOTFOUND',
    });

    archive.write(record({ err }));
    await archive.flush();

    const [entry] = decode(uploader.mock.calls[0][0]);
    expect(entry.fields.err).toEqual(
      expect.objectContaining({ name: 'Error', code: 'ENOTFOUND', message: err.message })
    );
  });

  it('never throws from write, even for malformed records', () => {
    expect(() => archive.write(null)).not.toThrow();
  });

  it('uploads through S3Service.uploadBuffer as gzip', async () => {
    const s3 = { uploadBuffer: jest.fn().mockResolvedValue({ url: 'u', key: 'k' }) };
    const body = Buffer.from('x');

    await s3ErrorLogUploader(s3)(body, 'error-logs/a.ndjson.gz');

    expect(s3.uploadBuffer).toHaveBeenCalledWith(
      body,
      'error-logs/a.ndjson.gz',
      'application/gzip'
    );
  });
});
