import { z } from 'zod';

/**
 * Zod 4 rewrote its default error messages ("Required" became "Invalid input: expected string,
 * received undefined", ...). API validation responses surface these messages to the UI, so this
 * error map reproduces the Zod 3 defaults. Messages set on a schema (`message` / `error`) still win.
 */

type CompatIssue = z.core.$ZodRawIssue;

const describeReceived = (input: unknown): string => {
  if (input === undefined) return 'undefined';
  if (input === null) return 'null';
  if (Array.isArray(input)) return 'array';
  if (input instanceof Date) return 'date';
  if (input instanceof Map) return 'map';
  if (input instanceof Set) return 'set';
  if (input instanceof Promise) return 'promise';
  if (typeof input === 'number') {
    if (Number.isNaN(input)) return 'nan';
    return Number.isInteger(input) ? 'integer' : 'float';
  }
  return typeof input;
};

const quoteValue = (value: unknown) => (typeof value === 'string' ? `'${value}'` : String(value));

const joinValues = (values: readonly unknown[], separator = ' | ') =>
  values.map(quoteValue).join(separator);

const isLiteralSchema = (issue: CompatIssue) =>
  (issue.inst as { _zod?: { def?: { type?: string } } } | undefined)?._zod?.def?.type === 'literal';

const formatBound = (origin: string, bound: number | bigint) =>
  origin === 'date' ? String(new Date(Number(bound))) : bound.toString();

const invalidTypeMessage = (issue: { code: 'invalid_type' } & CompatIssue) => {
  if (issue.input === undefined) return 'Required';
  if (issue.expected === 'date' && issue.input instanceof Date) return 'Invalid date';
  if (issue.expected === 'int')
    return `Expected integer, received ${describeReceived(issue.input)}`;
  if (issue.expected === 'number' && typeof issue.input === 'number') {
    return Number.isNaN(issue.input) ? 'Expected number, received nan' : 'Number must be finite';
  }
  return `Expected ${issue.expected}, received ${describeReceived(issue.input)}`;
};

const tooSmallMessage = (issue: { code: 'too_small' } & CompatIssue) => {
  const { origin, minimum, exact, inclusive } = issue;
  if (origin === 'array' || origin === 'set') {
    const qualifier = exact ? 'exactly' : inclusive ? 'at least' : 'more than';
    return `${origin === 'set' ? 'Set' : 'Array'} must contain ${qualifier} ${minimum} element(s)`;
  }
  if (origin === 'string') {
    const qualifier = exact ? 'exactly' : inclusive ? 'at least' : 'over';
    return `String must contain ${qualifier} ${minimum} character(s)`;
  }
  const qualifier = exact
    ? 'exactly equal to '
    : inclusive
      ? 'greater than or equal to '
      : 'greater than ';
  const subject = origin === 'date' ? 'Date' : 'Number';
  return `${subject} must be ${qualifier}${formatBound(origin, minimum)}`;
};

const tooBigMessage = (issue: { code: 'too_big' } & CompatIssue) => {
  const { origin, maximum, exact, inclusive } = issue;
  if (origin === 'array' || origin === 'set') {
    const qualifier = exact ? 'exactly' : inclusive ? 'at most' : 'less than';
    return `${origin === 'set' ? 'Set' : 'Array'} must contain ${qualifier} ${maximum} element(s)`;
  }
  if (origin === 'string') {
    const qualifier = exact ? 'exactly' : inclusive ? 'at most' : 'under';
    return `String must contain ${qualifier} ${maximum} character(s)`;
  }
  if (origin === 'date') {
    const qualifier = exact ? 'exactly' : inclusive ? 'smaller than or equal to' : 'smaller than';
    return `Date must be ${qualifier} ${formatBound(origin, maximum)}`;
  }
  const qualifier = exact ? 'exactly' : inclusive ? 'less than or equal to' : 'less than';
  return `Number must be ${qualifier} ${maximum}`;
};

const STRING_FORMAT_NAMES: Record<string, string> = {
  guid: 'uuid',
  ipv4: 'ip',
  ipv6: 'ip',
  regex: '',
};

const invalidFormatMessage = (issue: { code: 'invalid_format' } & CompatIssue) => {
  const formatIssue = issue as {
    prefix?: string;
    suffix?: string;
    includes?: string;
  } & typeof issue;
  switch (issue.format) {
    case 'starts_with':
      return `Invalid input: must start with "${formatIssue.prefix}"`;
    case 'ends_with':
      return `Invalid input: must end with "${formatIssue.suffix}"`;
    case 'includes':
      return `Invalid input: must include "${formatIssue.includes}"`;
    case 'regex':
      return 'Invalid';
    default: {
      const name = STRING_FORMAT_NAMES[issue.format] ?? issue.format;
      return `Invalid ${name}`;
    }
  }
};

export const zod3CompatibleErrorMap = (issue: CompatIssue): string | undefined => {
  switch (issue.code) {
    case 'unrecognized_keys':
      return `Unrecognized key(s) in object: ${issue.keys.map((key) => `'${key}'`).join(', ')}`;
    case 'not_multiple_of':
      return `Number must be a multiple of ${issue.divisor}`;
    case 'invalid_format':
      return invalidFormatMessage(issue);
    case 'invalid_value':
      if (isLiteralSchema(issue)) {
        return `Invalid literal value, expected ${JSON.stringify(issue.values[0])}`;
      }
      // Zod 3 reported a missing or wrongly typed enum value as an invalid_type issue
      if (issue.input === undefined) return 'Required';
      if (
        typeof issue.input !== 'string' &&
        issue.values.every((value) => typeof value === 'string')
      ) {
        return `Expected ${joinValues(issue.values)}, received ${describeReceived(issue.input)}`;
      }
      return `Invalid enum value. Expected ${joinValues(issue.values)}, received ${quoteValue(issue.input)}`;
    case 'invalid_union': {
      const { discriminator, options } = issue as { discriminator?: string; options?: unknown };
      if (discriminator !== undefined && Array.isArray(options)) {
        return `Invalid discriminator value. Expected ${joinValues(options)}`;
      }
      return 'Invalid input';
    }
    case 'invalid_type':
      return invalidTypeMessage(issue);
    case 'too_small':
      return tooSmallMessage(issue);
    case 'too_big':
      return tooBigMessage(issue);
    default:
      return 'Invalid input';
  }
};

/**
 * Replacement for Zod 3's `required_error` / `invalid_type_error` schema params.
 * `required` applies when the value is missing, `invalidType` when it has the wrong type; any
 * other issue (and an invalid Date, which Zod 3 reported as "Invalid date") keeps its default.
 */
export const typeErrors =
  ({ required, invalidType }: { required?: string; invalidType?: string }) =>
  (issue: CompatIssue): string | undefined => {
    if (issue.code !== 'invalid_type') return undefined;
    if (issue.input === undefined) return required;
    if (issue.input instanceof Date) return undefined;
    return invalidType;
  };

z.config({ customError: zod3CompatibleErrorMap });

/** Replacement for a Zod 3 error map that only customised the `invalid_date` issue. */
export const invalidDateMessage =
  (message: string) =>
  (issue: CompatIssue): string | undefined =>
    issue.code === 'invalid_type' && issue.input instanceof Date ? message : undefined;
