import color from 'colors';
import crypto from 'crypto';
import bunyan from 'bunyan';
import { envVariables } from '@shared/config';
import { Country, City } from 'country-state-city';
import { NextFunction, Response, Request } from 'express';
import {
  AsyncRequestHandler,
  ExtractedMediaFile,
  PaginateResult,
  MulterFile,
  FileType,
} from '@interfaces/utils.interface';

import { JWT_KEY_NAMES } from './constants';

interface LogRecord {
  level: number;
  name?: string;
  streams: any;
  msg: string;
}

/**
 * Creates a customized Bunyan logger instance with color-coded console output
 * @param name - The name of the logger to create
 * @param options - Optional configuration for the logger
 * @returns A configured Bunyan logger instance
 */
export function createLogger(name: string) {
  const LOG_LEVELS: Record<string, number> = {
    INFO: 30,
    ERROR: 50,
    DEBUG: 20,
    WARN: 40,
    TRACE: 10,
    FATAL: 60,
  };

  const customStream = {
    write: (record: unknown) => {
      try {
        let output: string;
        const logRecord = record as LogRecord;

        switch (logRecord.level) {
          case LOG_LEVELS.ERROR:
          case LOG_LEVELS.FATAL:
            output = color.red.bold(`${logRecord?.name || 'UNKNOWN'}: ${logRecord?.msg}`);
            break;
          case LOG_LEVELS.DEBUG:
            output = color.cyan.bold(`${logRecord?.name || 'UNKNOWN'}: ${logRecord?.msg}`);
            break;
          case LOG_LEVELS.WARN:
            output = color.magenta.bold(`${logRecord?.name || 'UNKNOWN'}: ${logRecord?.msg}`);
            break;
          case LOG_LEVELS.INFO:
            output = color.yellow.bold(`${logRecord?.name || 'UNKNOWN'}: ${logRecord?.msg}`);
            break;
          default:
            output = color.grey.bold(`${logRecord?.name || 'UNKNOWN'}: ${logRecord?.msg}`);
        }

        if (envVariables.SERVER.ENV !== 'production') {
          return console.log(output);
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
    process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'production'
      ? nullStream
      : customStream;

  return bunyan.createLogger({
    name,
    level: 'debug',
    streams: [
      {
        level: 'debug',
        type: 'raw',
        stream,
      },
    ],
  });
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
      path: '/api/v1/auth/refresh', // Only accessible on the refresh endpoint
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
      secure: envVariables.SERVER.ENV !== 'development',
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
 * Validates if a string is a valid phone number across multiple formats
 * @param phoneNumber - The phone number string to validate
 * @returns Boolean indicating if the phone number is valid
 */
export function isValidPhoneNumber(phoneNumber: string): boolean {
  if (!phoneNumber) {
    return false;
  }
  const PHONE_PATTERNS = {
    US_CANADA: /^(\+\d{1,2}\s?)?1?\.?\s?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/,
    EUROPE: /^(\+3[0-9]|4[0-46-9]|5[1-8]|7[1-79])?\d{6,14}$/,
    AFRICA: /^(\+2[0-46-8])?\d{6,14}$/,
  };
  const normalizedNumber = phoneNumber.trim();

  return (
    PHONE_PATTERNS.US_CANADA.test(normalizedNumber) ||
    PHONE_PATTERNS.EUROPE.test(normalizedNumber) ||
    PHONE_PATTERNS.AFRICA.test(normalizedNumber)
  );
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
export function hashGenerator(hashOpts: {
  byteLength?: number;
  algorithm?: string;
  usenano?: boolean;
}): string {
  try {
    const { byteLength = 16, algorithm = 'sha256' } = hashOpts;
    // if (usenano) {
    //   return nanoid(10);
    // }
    const token = crypto.randomBytes(byteLength).toString('hex');
    return crypto.createHash(algorithm).update(token).digest('hex');
  } catch (error) {
    throw new Error(`Failed to generate hash: ${error.message}`);
  }
}

/**
 * Wraps an async Express request handler to properly catch and forward errors to Express error middleware
 * @param fn - The async request handler function to wrap
 * @returns A wrapped function that forwards errors to the next middleware
 */
export function asyncWrapper(fn: AsyncRequestHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      return next(err);
    });
  };
}

/**
 * Extracts and standardizes file information from Multer file objects
 * @param files - A Multer file object or array of file objects
 * @param allowedTypes - Optional array of allowed file types (e.g., ['image', 'document'])
 * @returns An array of standardized file information objects
 * @throws Error if any files have invalid types when allowedTypes is provided
 */
export const extractMulterFiles = (
  files: MulterFile,
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
      filename: file.filename,
      fileSize: file.size,
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
 * Generates a shortened UID from a UUID by removing hyphens and limiting length
 * @param uuid - The UUID string to shorten
 * @param length - The desired length of the shortened UID (default: 9)
 * @returns The shortened UID string
 * @throws Error if uuid is not provided or not a valid UUID format
 */
export function generateShortUID(uuid: string, length: number = 9): string {
  if (!uuid) {
    throw new Error('UUID is required');
  }

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(uuid)) {
    throw new Error('Invalid UUID format');
  }

  const normalizedLength = Math.max(1, Math.min(32, length));
  return uuid.replace(/-/g, '').slice(0, normalizedLength);
}

/**
 * Generates pagination metadata for query results
 * @param count - The total number of items in the collection
 * @param skip - The number of items to skip (offset)
 * @param limit - The maximum number of items per page
 * @returns An object containing pagination metadata
 * @throws Error if negative values are provided
 */
export const paginateResult = (count: number, skip: number, limit: number): PaginateResult => {
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

/**
 * Validates if the provided name is a valid city or country
 * @param location The city or country name to validate
 * @returns {boolean} True if the location is a valid city or country name
 */
export const isValidLocation = (location: string): boolean => {
  if (!location) return false;

  const normalizedLocation = location.trim().toLowerCase();

  const isCity = City.getAllCities().some((city) => city.name.toLowerCase() === normalizedLocation);
  if (isCity) return true;

  const isCountry = Country.getAllCountries().some(
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

  const matchingCity = City.getAllCities().find(
    (city) => city.name.toLowerCase() === normalizedLocation
  );

  if (matchingCity) {
    const country = Country.getCountryByCode(matchingCity.countryCode);
    return `${matchingCity.name}, ${country?.name}`;
  }
  const matchingCountry = Country.getAllCountries().find(
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
