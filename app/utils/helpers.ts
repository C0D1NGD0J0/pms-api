import color from 'colors';
import crypto from 'crypto';
import bunyan from 'bunyan';
import * as nanoid from 'nanoid';
import { Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { envVariables } from '@shared/config';
import { Country, City } from 'country-state-city';
import { parsePhoneNumber } from 'libphonenumber-js';
import { NextFunction, Response, Request } from 'express';
import { IUserRole, ROLES } from '@shared/constants/roles.constants';
import {
  AsyncRequestHandler,
  ExtractedMediaFile,
  PaginateResult,
  MulterFile,
  FileType,
} from '@interfaces/utils.interface';

import { JWT_KEY_NAMES } from './constants';

const loggers = new WeakMap<object, bunyan>();
const loggerKeys = new Map<string, object>();

/**
 * Creates a customized Bunyan logger instance with color-coded console output
 * @param name - The name of the logger to create
 * @param options - Optional configuration for the logger
 * @returns A configured Bunyan logger instance
 */
export function createLogger(name: string) {
  const MAX_LOGGERS = 100;
  const LOG_LEVELS: Record<string, number> = {
    INFO: 30,
    ERROR: 50,
    DEBUG: 20,
    WARN: 40,
    TRACE: 10,
    FATAL: 60,
  };

  // Check if logger exists
  let loggerKey = loggerKeys.get(name);
  if (loggerKey) {
    const existingLogger = loggers.get(loggerKey);
    if (existingLogger) {
      return existingLogger;
    }
  }

  // Clean up old loggers if we're at the limit
  if (loggerKeys.size >= MAX_LOGGERS) {
    const oldestKey = loggerKeys.keys().next().value;
    if (oldestKey) {
      const keyToDelete = loggerKeys.get(oldestKey);
      if (keyToDelete) {
        loggers.delete(keyToDelete);
      }
      loggerKeys.delete(oldestKey);
    }
  }

  const customStream = {
    write: (record: unknown) => {
      try {
        // Completely avoid property access by stringifying the entire record first
        let recordString: string;
        try {
          recordString = JSON.stringify(record);
        } catch {
          // Fallback if JSON.stringify fails due to circular references or symbols
          recordString = String(record);
        }

        let parsedRecord: any;
        try {
          parsedRecord = JSON.parse(recordString);
        } catch {
          parsedRecord = { name: 'UNKNOWN', msg: recordString, level: 30 };
        }

        const serviceName = parsedRecord?.name || 'UNKNOWN';
        const message = parsedRecord?.msg || '';
        const level = parsedRecord?.level || 30;

        let output = `${serviceName}: ${message}`;

        switch (level) {
          case LOG_LEVELS.TRACE:
            output = color.green.bold(output);
            break;
          case LOG_LEVELS.ERROR:
          case LOG_LEVELS.FATAL:
            output = color.red.bold(output);
            break;
          case LOG_LEVELS.DEBUG:
            output = color.cyan(output);
            break;
          case LOG_LEVELS.WARN:
            output = color.yellow.italic(output);
            break;
          case LOG_LEVELS.INFO:
            output = color.grey(output);
            break;
          default:
            output = color.grey.bold(output);
        }

        if (envVariables.SERVER.ENV !== 'production' || Boolean(process.env.ENABLE_CONSOLE_LOGS)) {
          console.log(output);
        }
      } catch (err) {
        console.error('Logging Error:', err);
      }
    },
  };

  const nullStream = {
    write: () => {},
  };

  const stream =
    process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === 'dev' ||
    Boolean(process.env.ENABLE_CONSOLE_LOGS)
      ? customStream
      : nullStream;

  const logger = bunyan.createLogger({
    name,
    level: LOG_LEVELS[process.env.LOG_LEVEL || 'info'],
    streams: [
      {
        level: 'trace',
        type: 'raw',
        stream,
      },
    ],
  });
  loggerKey = {};
  loggerKeys.set(name, loggerKey);
  loggers.set(loggerKey, logger);

  return logger;
}
/**
 * Sets an authentication cookie in the HTTP response
 * @param cookieName - The name of the JWT cookie
 * @param token - The JWT token to store in the cookie
 * @param res - Express response object
 * @param cookieOptions - Optional cookie settings to override defaults
 * @returns The modified response object with cookie set
 */
export function setAuthCookies(
  data: { accessToken: string; refreshToken: string; rememberMe?: boolean },
  res: Response
) {
  if (!data.accessToken && !data.refreshToken) {
    throw new Error('One or both tokens are required.');
  }

  let opts: Record<string, any>;
  let bearerJwt: string;

  if (data.refreshToken) {
    opts = {
      path: '/api/v1/auth/refresh_token', // Only accessible on the refresh endpoint
      httpOnly: true,
      sameSite: 'strict' as const,
      secure: envVariables.SERVER.ENV !== 'development',
    };
    bearerJwt = `Bearer ${data.refreshToken}`;
    if (data.rememberMe) {
      opts.maxAge = convertTimeToSecondsAndMilliseconds(
        envVariables.JWT.EXTENDED_REFRESH_TOKEN_EXPIRY
      ).milliseconds;
    }
    res.cookie(JWT_KEY_NAMES.REFRESH_TOKEN, bearerJwt, opts);
  }

  if (data.accessToken) {
    opts = {
      path: '/',
      httpOnly: true,
      sameSite: 'strict' as const,
      secure: envVariables.SERVER.ENV === 'production',
    };
    bearerJwt = `Bearer ${data.accessToken}`;
    if (data.rememberMe) {
      opts.maxAge = convertTimeToSecondsAndMilliseconds(
        envVariables.JWT.EXTENDED_ACCESS_TOKEN_EXPIRY
      ).milliseconds;
    }
    res.cookie(JWT_KEY_NAMES.ACCESS_TOKEN, bearerJwt, opts);
  }

  return res;
}

/**
 * Converts a user role string to IUserRole enum value
 * @param userRole - The user role string to convert (case-insensitive)
 * @returns The corresponding IUserRole enum value
 * @throws Error if the role string is invalid or not supported
 */
export function convertUserRoleToEnum(userRole: string): IUserRole {
  if (!userRole || typeof userRole !== 'string') {
    throw new Error('User role must be a non-empty string');
  }

  // First, try to find the role in ROLES constants (case-insensitive)
  const roleValue = Object.values(ROLES).find(
    (role) => role.toLowerCase() === userRole.toLowerCase()
  );
  if (roleValue) {
    return roleValue as IUserRole;
  }

  // Fallback: try enum lookup for backward compatibility
  const upperRole = userRole.trim().toUpperCase() as keyof typeof IUserRole;
  const enumValue = IUserRole[upperRole];
  if (enumValue) {
    return enumValue;
  }

  const validRoles = Object.values(ROLES).join(', ');
  throw new Error(`Invalid user role: "${userRole}". Valid roles are: ${validRoles}`);
}

/**
 * Generates a random hash string using SHA-256
 * @param opts - {
  byteLength?: number;
  algorithm?: 'sha256' | 'sha512' | 'md5';
  usenano?: boolean;
}
 * @returns A hexadecimal string representation of the hash
 * @throws Error if crypto operations fail
 */
export function hashGenerator(hashOpts: { byteLength?: number; algorithm?: string }): string {
  try {
    const { byteLength = 16, algorithm = 'sha256' } = hashOpts;
    const token = crypto.randomBytes(byteLength).toString('hex');
    return crypto.createHash(algorithm).update(token).digest('hex');
  } catch (error) {
    throw new Error(`Failed to generate hash: ${error.message}`);
  }
}

/**
 * Validates if a string is a valid phone number across multiple formats
 * @param phoneNumber - The phone number string to validate
 * @returns Boolean indicating if the phone number is valid
 */
export function isValidPhoneNumber(phoneNumber: string): boolean {
  if (!phoneNumber || phoneNumber.length > 17) {
    return false;
  }
  try {
    const parsedNumber = parsePhoneNumber(phoneNumber);
    return !!parsedNumber && parsedNumber.isValid();
  } catch (error) {
    return false;
  }
}

/**
 * Wraps an async Express request handler to properly catch and forward errors to Express error middleware
 * @param fn - The async request handler function to wrap
 * @returns A wrapped function that forwards errors to the next middleware
 */
export function asyncWrapper(fn: AsyncRequestHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req as any, res, next)).catch((err) => {
      return next(err);
    });
  };
}

/**
 * Extracts and standardizes file information from Multer file objects
 * @param files - A Multer file object or array of file objects
 * @param actorId - The ID of the user who uploaded the files
 * @param allowedTypes - Optional array of allowed file types (e.g., ['image', 'document'])
 * @returns An array of standardized file information objects
 * @throws Error if any files have invalid types when allowedTypes is provided
 */
export const extractMulterFiles = (
  files: MulterFile,
  actorId?: string,
  allowedTypes?: FileType[]
): ExtractedMediaFile[] => {
  if (!files) {
    return [];
  }

  const result: ExtractedMediaFile[] = [];
  const extractFile = (file: any) => {
    const mimeType = file.mimetype.split('/')[0];

    if (allowedTypes && !allowedTypes.includes(mimeType as FileType)) {
      throw new Error(
        `File type '${mimeType}' is not allowed. Allowed types: ${allowedTypes.join(', ')}`
      );
    }

    result.push({
      fieldName: file.fieldname,
      mimeType,
      path: file.path,
      originalFileName: file.originalname,
      filename: file.filename,
      fileSize: file.size,
      uploadedBy: actorId || '',
      url: '',
      key: '',
      status: 'pending',
      uploadedAt: file.uploadedAt || new Date().toISOString(),
    });
  };

  if (Array.isArray(files)) {
    files.forEach(extractFile);
  } else {
    for (const key in files) {
      if (Array.isArray(files[key])) {
        files[key].forEach(extractFile);
      }
    }
  }

  return result;
};

/**
 * Generates a shortened UID
 * @param length - The desired length of the shortened UID (default: 9)
 * @returns The shortened UID string
 */
export function generateShortUID(length = 12): string {
  if (length) {
    return nanoid.nanoid(length).toUpperCase();
  }
  return uuidv4();
}

/**
 * Generates pagination metadata for query results
 * @param count - The total number of items in the collection
 * @param skip - The number of items to skip (offset)
 * @param limit - The maximum number of items per page
 * @returns An object containing pagination metadata
 * @throws Error if negative values are provided
 */
export const paginateResult = (count: number, skip = 0, limit = 10): PaginateResult => {
  if (count < 0 || skip < 0 || limit <= 0) {
    throw new Error(
      'Invalid pagination parameters: count and skip must be non-negative, limit must be positive'
    );
  }

  const normalizedLimit = Math.max(1, limit);
  const totalPages = Math.max(1, Math.ceil(count / normalizedLimit));
  const currentPage = Math.min(totalPages, Math.max(1, Math.floor(skip / normalizedLimit) + 1));

  const result: PaginateResult = {
    total: count,
    perPage: normalizedLimit,
    totalPages,
    currentPage,
    hasMoreResource: currentPage < totalPages,
  };

  return result;
};

// Cache for city and country data to prevent memory leaks
let cachedCities: any[] | null = null;
let cachedCountries: any[] | null = null;

const getCachedCities = (): any[] => {
  if (!cachedCities) {
    cachedCities = City.getAllCities();
  }
  return cachedCities;
};

const getCachedCountries = (): any[] => {
  if (!cachedCountries) {
    cachedCountries = Country.getAllCountries();
  }
  return cachedCountries;
};

/**
 * Validates if the provided name is a valid city or country
 * @param location The city or country name to validate
 * @returns {boolean} True if the location is a valid city or country name
 */
export const isValidLocation = (location: string): boolean => {
  if (!location) return false;

  const normalizedLocation = location.trim().toLowerCase();

  const isCity = getCachedCities().some((city) => city.name.toLowerCase() === normalizedLocation);
  if (isCity) return true;

  const isCountry = getCachedCountries().some(
    (country) => country.name.toLowerCase() === normalizedLocation
  );
  return isCountry;
};

/**
 * Get location details for a city or country
 * @param location The city or country name
 * @returns Location details or null if not found
 */
export const getLocationDetails = (location: string): string | null => {
  if (!location) return null;

  const normalizedLocation = location.trim().toLowerCase();

  const matchingCity = getCachedCities().find(
    (city) => city.name.toLowerCase() === normalizedLocation
  );

  if (matchingCity) {
    const country = Country.getCountryByCode(matchingCity.countryCode);
    return `${matchingCity.name}, ${country?.name}`;
  }
  const matchingCountry = getCachedCountries().find(
    (country) => country.name.toLowerCase() === normalizedLocation
  );

  if (matchingCountry) {
    return `${matchingCountry.name}`;
  }
  return null;
};

/**
 * Converts time expressions like '1d', '120min', '60s', '1 day', '2 days', '120 mins' into seconds and milliseconds.
 * Supported units are 'd' (days), 'h' (hours), 'm' (minutes), 's' (seconds), 'day', 'days', 'min', 'mins'.
 *
 * @param {string} timeStr The time string to convert.
 * @returns {object} An object containing the time in seconds and milliseconds.
 */
export const convertTimeToSecondsAndMilliseconds = (
  timeStr: string
): { seconds: number; milliseconds: number } => {
  const timePattern = /^(\d+)\s?(d|day|days|h|hour|hours|m|min|mins|s|sec|secs|second|seconds)$/i;
  const match = timeStr.match(timePattern);

  if (!match) {
    throw new Error(
      "Invalid time format. Please use 'd', 'day', 'days', 'h', 'hour', 'hours', 'm', 'min', 'mins', 's', 'sec', 'secs', 'second', or 'seconds' as units."
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  let seconds = 0;

  switch (unit) {
    case 'seconds':
    case 'second':
    case 'secs':
    case 'sec':
    case 's':
      seconds = value;
      break;
    case 'hours':
    case 'hour':
    case 'h':
      seconds = value * 3600; // 60 * 60
      break;
    case 'days':
    case 'day':
    case 'd':
      seconds = value * 86400; // 24 * 60 * 60
      break;
    case 'mins':
    case 'min':
    case 'm':
      seconds = value * 60;
      break;
    default:
      throw new Error('Unsupported time unit. Please use a recognized unit.');
  }

  return {
    seconds,
    milliseconds: seconds * 1000,
  };
};

/**
 * Middleware to parse stringified JSON, booleans, and numbers in req.body
 * Useful for multipart/form-data where nested fields are sent as strings
 */
export const parseJsonFields = (req: Request) => {
  if (!req.body || typeof req.body !== 'object') return req.body;

  const tryParse = (val: string) => {
    try {
      const parsed = JSON.parse(val);
      return typeof parsed === 'object' ? parsed : val;
    } catch {
      return val;
    }
  };

  const convertValue = (value: any): any => {
    if (value == null) return value;

    if (typeof value === 'string') {
      const trimmed = value.trim();

      if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        return tryParse(trimmed);
      }

      if (trimmed.toLowerCase() === 'true') return true;
      if (trimmed.toLowerCase() === 'false') return false;

      return value;
    }

    if (Array.isArray(value)) return value.map(convertValue);
    if (typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convertValue(v)]));
    }

    return value;
  };

  try {
    req.body = convertValue(req.body);
  } catch (error) {
    console.error('Error in parseJsonFields middleware:', error);
  }

  return req.body;
};

export const getRequestDuration = (start: bigint): { durationInMs: number } => {
  const diff = process.hrtime.bigint() - start;
  const durationInMs = Number(diff) / 1000000;
  return { durationInMs };
};

/**
 * Generates a secure random password for bulk user creation
 * @param length - The desired length of the password (default: 12)
 * @returns A secure random password string
 * @throws Error if password generation fails
 */
export function generateDefaultPassword(length = 12): string {
  try {
    if (length < 8) {
      throw new Error('Password length must be at least 8 characters');
    }

    // Define character sets for password generation
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    const symbols = '!@#$%^&*';
    const allChars = lowercase + uppercase + numbers + symbols;

    // Ensure password has at least one character from each set
    let password = '';
    password += lowercase[crypto.randomInt(0, lowercase.length)];
    password += uppercase[crypto.randomInt(0, uppercase.length)];
    password += numbers[crypto.randomInt(0, numbers.length)];
    password += symbols[crypto.randomInt(0, symbols.length)];

    // Fill the rest of the password length with random characters
    for (let i = 4; i < length; i++) {
      password += allChars[crypto.randomInt(0, allChars.length)];
    }

    // Shuffle the password to avoid predictable patterns
    return password
      .split('')
      .sort(() => Math.random() - 0.5)
      .join('');
  } catch (error) {
    throw new Error(`Failed to generate default password: ${error.message}`);
  }
}

export const buildDotNotation = (obj: any, prefix = ''): Record<string, any> => {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      // Recursively flatten nested objects
      Object.assign(result, buildDotNotation(value, newKey));
    } else {
      result[newKey] = value;
    }
  }

  return result;
};

/**
 * Creates a MongoDB-safe update object using dot notation to prevent nested object overwrites
 * @param updateData - The object containing fields to update
 * @returns Safe MongoDB update object with dot notation for nested fields
 *
 * @example
 * // Input: { fees: { rentalAmount: 1200 }, name: "New Property" }
 * // Output: { "fees.rentalAmount": 1200, name: "New Property" }
 */
export const createSafeMongoUpdate = (updateData: Record<string, any>): Record<string, any> => {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(updateData)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      !(value instanceof Types.ObjectId)
    ) {
      const dotNotated = buildDotNotation(value, key);
      Object.assign(result, dotNotated);
    } else {
      result[key] = value;
    }
  }

  return result;
};

export const MoneyUtils = {
  /**
   * Converts cents (integer) to dollar string format
   * @param cents - The amount in cents (e.g., 450000)
   * @param decimalPlaces - Number of decimal places (default: 2)
   * @returns Formatted string (e.g., "4500.00")
   */
  centsToString: (cents: number | null | undefined, decimalPlaces = 2): string => {
    if (cents == null) return '0.00';
    if (typeof cents !== 'number' || isNaN(cents)) return '0.00';
    return (cents / 100).toFixed(decimalPlaces);
  },

  /**
   * Converts dollar string to cents (integer)
   * @param dollarString - The amount as string (e.g., "4500.00")
   * @returns Amount in cents (e.g., 450000)
   */
  stringToCents: (dollarString: string | number): number => {
    if (dollarString == null) return 0;
    const numericValue = typeof dollarString === 'string' ? parseFloat(dollarString) : dollarString;
    if (isNaN(numericValue)) return 0;
    return Math.round(numericValue * 100);
  },

  /**
   * Formats a dollar amount with currency symbol
   * @param cents - The amount in cents
   * @param currency - Currency code (default: 'USD')
   * @param locale - Locale for formatting (default: 'en-US')
   * @returns Formatted currency string (e.g., "$4,500.00")
   */
  formatCurrency: (
    cents: number | null | undefined,
    currency = 'USD',
    locale = 'en-US'
  ): string => {
    if (cents == null)
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(0);
    if (typeof cents !== 'number' || isNaN(cents))
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(0);

    const dollars = cents / 100;
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).format(dollars);
  },

  /**
   * Transforms a money object from database format (cents) to frontend format (strings) for display
   * @param moneyData - The money object from database (fees, rent, lease amounts, etc.)
   * @returns Transformed money object with string values for frontend display
   */
  formatMoneyDisplay: (moneyData: any): any => {
    if (!moneyData || typeof moneyData !== 'object') return moneyData;

    return {
      ...moneyData,
      ...(moneyData.taxAmount !== undefined && {
        taxAmount: MoneyUtils.centsToString(moneyData.taxAmount),
      }),
      ...(moneyData.rentalAmount !== undefined && {
        rentalAmount: MoneyUtils.centsToString(moneyData.rentalAmount),
      }),
      ...(moneyData.managementFees !== undefined && {
        managementFees: MoneyUtils.centsToString(moneyData.managementFees),
      }),
      ...(moneyData.securityDeposit !== undefined && {
        securityDeposit: MoneyUtils.centsToString(moneyData.securityDeposit),
      }),
    };
  },

  /**
   * Parses a money object from frontend format (strings) to database format (cents) for storage
   * @param moneyData - The money object from frontend (fees, rent, lease amounts, etc.)
   * @returns Parsed money object with cent values for database storage
   */
  parseMoneyInput: (moneyData: any): any => {
    if (!moneyData || typeof moneyData !== 'object') return moneyData;

    return {
      ...moneyData,
      ...(moneyData.taxAmount !== undefined && {
        taxAmount: MoneyUtils.stringToCents(moneyData.taxAmount),
      }),
      ...(moneyData.rentalAmount !== undefined && {
        rentalAmount: MoneyUtils.stringToCents(moneyData.rentalAmount),
      }),
      ...(moneyData.managementFees !== undefined && {
        managementFees: MoneyUtils.stringToCents(moneyData.managementFees),
      }),
      ...(moneyData.securityDeposit !== undefined && {
        securityDeposit: MoneyUtils.stringToCents(moneyData.securityDeposit),
      }),
    };
  },

  /**
   * Validates that a money value is properly formatted
   * @param value - The value to validate
   * @returns true if valid, false otherwise
   */
  isValidMoneyValue: (value: any): boolean => {
    if (value == null || value === '') return true; // allow empty values

    if (typeof value === 'string') {
      const numericValue = parseFloat(value);
      return !isNaN(numericValue) && numericValue >= 0;
    }

    if (typeof value === 'number') {
      return !isNaN(value) && value >= 0;
    }

    return false;
  },
};
