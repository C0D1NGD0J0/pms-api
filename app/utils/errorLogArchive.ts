import os from 'os';
import zlib from 'zlib';
import bunyan from 'bunyan';

import { redactPII } from './pii.utils';

// No imports from helpers/config: createLogger (helpers.ts) imports this module.

export interface ErrorLogArchiveOptions {
  flushIntervalMs: number;
  environment: string;
  processType: string;
  maxRecords?: number;
  maxBytes?: number;
}

export type ErrorLogUploader = (body: Buffer, key: string) => Promise<void>;

interface ArchivedError {
  fields: Record<string, unknown>;
  requestIds: string[];
  fingerprint: string;
  firstSeen: string;
  lastSeen: string;
  level: number;
  count: number;
  name: string;
  msg: string;
}

const LEVEL_FATAL = 60;
const EARLY_FLUSH_RATIO = 0.8;
const MAX_STRING_LENGTH = 2048;
const MAX_STACK_LINES = 20;
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;
const MAX_SAMPLE_REQUEST_IDS = 3;

// Loggers whose errors come from our own upload — ignored while it runs to avoid a loop
const UPLOAD_LOGGER_NAMES = /^(S3Storage|CircuitBreaker:s3)$/;
const BUNYAN_CORE_FIELDS = new Set(['hostname', 'level', 'name', 'time', 'pid', 'msg', 'v']);
const SENSITIVE_KEY =
  /pass(word)?|secret|token|cookie|authorization|api[-_]?key|card|cvc|cvv|iban|account[-_]?number|routing|ssn/i;
const DROPPED_KEY = /^headers$/i;
// Ids, numbers and hex vary per occurrence; strip them so repeats share a fingerprint
const VARIABLE_PARTS = /\b[0-9a-f]{24}\b|\b[0-9a-f-]{36}\b|\d+/gi;

const truncate = (value: string): string =>
  value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]` : value;

// Same PII rules as the AI redaction; ids stay so archived errors can still be traced
const sanitizeString = (value: string): string =>
  truncate(redactPII(value, undefined, { keepIdentifiers: true }));

const serializeError = (error: Error): unknown => {
  const { stack, ...rest } = bunyan.stdSerializers.err(error);
  const shortStack =
    typeof stack === 'string' ? stack.split('\n').slice(0, MAX_STACK_LINES).join('\n') : stack;
  return sanitize({ ...rest, stack: shortStack }, 1);
};

const sanitize = (value: unknown, depth = 0): unknown => {
  if (value instanceof Error) return serializeError(value);
  if (typeof value === 'string') return sanitizeString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[depth limit]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitize(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (DROPPED_KEY.test(key)) continue;
    result[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitize(nested, depth + 1);
  }
  return result;
};

const firstStackFrame = (fields: Record<string, unknown>): string => {
  for (const value of Object.values(fields)) {
    const stack = (value as { stack?: unknown } | null)?.stack;
    if (typeof stack === 'string') {
      return (
        stack
          .split('\n')
          .find((line) => line.trim().startsWith('at '))
          ?.trim() ?? ''
      );
    }
  }
  return '';
};

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * Buffers error/fatal log records in memory and uploads them to S3 as gzipped NDJSON.
 * Repeats of the same error are counted, not stored again; secrets, headers and emails are
 * stripped; the buffer is size-capped. Uploads every flush interval, early when the buffer is
 * nearly full, immediately on fatal, and on shutdown via flush().
 */
export class ErrorLogArchive {
  private records = new Map<string, ArchivedError>();
  private bufferedBytes = 0;
  private droppedCount = 0;
  private uploader: ErrorLogUploader | null = null;
  private log: Pick<bunyan, 'warn'> | null = null;
  private uploading: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly maxRecords: number;
  private readonly maxBytes: number;

  constructor(private readonly options: ErrorLogArchiveOptions) {
    this.maxRecords = options.maxRecords ?? 2000;
    this.maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  }

  /** bunyan raw stream entry point */
  write(record: unknown): void {
    try {
      this.add(record as Record<string, unknown>);
    } catch {
      // Archiving must never break logging
    }
  }

  /** `log` reports failed uploads; its warn level is below what the archive collects */
  attachUploader(uploader: ErrorLogUploader, log?: Pick<bunyan, 'warn'>): void {
    this.uploader = uploader;
    this.log = log ?? null;
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.options.flushIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get bufferedCount(): number {
    return this.records.size;
  }

  async flush(): Promise<void> {
    if (this.uploading) return this.uploading;
    if (!this.uploader || (this.records.size === 0 && this.droppedCount === 0)) return;

    const records = this.records;
    const droppedCount = this.droppedCount;
    this.records = new Map();
    this.bufferedBytes = 0;
    this.droppedCount = 0;

    this.uploading = this.upload(records, droppedCount).finally(() => {
      this.uploading = null;
    });
    return this.uploading;
  }

  buildKey(date: Date): string {
    const { environment, processType } = this.options;
    const day = `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}`;
    const time = `${pad(date.getUTCHours())}-${pad(date.getUTCMinutes())}-${pad(date.getUTCSeconds())}`;
    return `error-logs/${environment}/${processType}/${day}/${time}-${os.hostname()}-${process.pid}.ndjson.gz`;
  }

  private add(record: Record<string, unknown>): void {
    const name = String(record.name ?? 'unknown');
    if (this.uploading && UPLOAD_LOGGER_NAMES.test(name)) return;

    const level = Number(record.level ?? 0);
    const msg = sanitizeString(String(record.msg ?? ''));
    const time = record.time instanceof Date ? record.time.toISOString() : new Date().toISOString();

    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (!BUNYAN_CORE_FIELDS.has(key)) fields[key] = value;
    }
    const sanitizedFields = sanitize(fields) as Record<string, unknown>;
    const requestId = typeof record.requestId === 'string' ? record.requestId : undefined;

    const fingerprint = [
      name,
      msg.replace(VARIABLE_PARTS, '#'),
      firstStackFrame(sanitizedFields).replace(/:\d+:\d+\)?$/, ''),
    ].join('|');

    const existing = this.records.get(fingerprint);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = time;
      if (requestId && existing.requestIds.length < MAX_SAMPLE_REQUEST_IDS) {
        existing.requestIds.push(requestId);
      }
    } else {
      const entry: ArchivedError = {
        fingerprint,
        name,
        level,
        msg,
        count: 1,
        firstSeen: time,
        lastSeen: time,
        requestIds: requestId ? [requestId] : [],
        fields: sanitizedFields,
      };
      const size = Buffer.byteLength(JSON.stringify(entry));
      if (this.records.size >= this.maxRecords || this.bufferedBytes + size > this.maxBytes) {
        this.droppedCount += 1;
      } else {
        this.records.set(fingerprint, entry);
        this.bufferedBytes += size;
      }
    }

    const nearlyFull =
      this.records.size >= this.maxRecords * EARLY_FLUSH_RATIO ||
      this.bufferedBytes >= this.maxBytes * EARLY_FLUSH_RATIO;
    if (level >= LEVEL_FATAL || nearlyFull) void this.flush();
  }

  private async upload(records: Map<string, ArchivedError>, droppedCount: number): Promise<void> {
    const lines = [...records.values()].map((entry) => JSON.stringify(entry));
    if (droppedCount > 0) lines.push(JSON.stringify({ type: 'summary', droppedCount }));
    const body = zlib.gzipSync(Buffer.from(`${lines.join('\n')}\n`));

    try {
      await this.uploader!(body, this.buildKey(new Date()));
    } catch (error) {
      this.restore(records, droppedCount);
      this.log?.warn({ err: error }, 'Error log upload failed — kept for the next upload');
    }
  }

  /** Puts records from a failed upload back, without exceeding the buffer limits. */
  private restore(records: Map<string, ArchivedError>, droppedCount: number): void {
    this.droppedCount += droppedCount;
    for (const [fingerprint, entry] of records) {
      const current = this.records.get(fingerprint);
      if (current) {
        current.count += entry.count;
        current.firstSeen = entry.firstSeen;
        continue;
      }
      const size = Buffer.byteLength(JSON.stringify(entry));
      if (this.records.size >= this.maxRecords || this.bufferedBytes + size > this.maxBytes) {
        this.droppedCount += entry.count;
      } else {
        this.records.set(fingerprint, entry);
        this.bufferedBytes += size;
      }
    }
  }
}

/** Adapts S3Service (structurally typed to avoid importing it here) into an archive uploader. */
export const s3ErrorLogUploader =
  (s3: { uploadBuffer(body: Buffer, key: string, contentType: string): Promise<unknown> }) =>
  async (body: Buffer, key: string): Promise<void> => {
    await s3.uploadBuffer(body, key, 'application/gzip');
  };
