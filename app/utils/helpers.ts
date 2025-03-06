import color from 'colors';
import crypto from 'crypto';
import bunyan from 'bunyan';
import { envVariables } from '@shared/config';
import { Response, Request, NextFunction } from 'express';
import {
  PaginateResult,
  MulterFile,
  FileType,
  ExtractedMediaFile,
  AsyncRequestHandler,
} from '@interfaces/utils.interface';

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

        switch (record.level) {
          case LOG_LEVELS.ERROR:
          case LOG_LEVELS.FATAL:
            output = color.red.bold(`${record?.name || 'UNKNOWN'}: ${record.msg}`);
            break;
          case LOG_LEVELS.DEBUG:
            output = color.cyan.bold(`${record?.name || 'UNKNOWN'}: ${record.msg}`);
            break;
          case LOG_LEVELS.WARN:
            output = color.magenta.bold(`${record?.name || 'UNKNOWN'}: ${record.msg}`);
            break;
          case LOG_LEVELS.INFO:
            output = color.yellow.bold(`${record?.name || 'UNKNOWN'}: ${record.msg}`);
            break;
          default:
            output = color.grey.bold(`${record?.name || 'UNKNOWN'}: ${record.msg}`);
        }

        if (process.env.NODE_ENV === 'development') {
          console.log(output);
        }
      } catch (err) {
        console.error('Logging Error:', err);
      }
    },
  };

  return bunyan.createLogger({
    name,
    level: 'debug',
    streams: [
      {
        level: 'debug',
        type: 'raw',
        stream: customStream,
      },
    ],
  });
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
 * Sets an authentication cookie in the HTTP response
 * @param cookieName - The name of the JWT cookie
 * @param token - The JWT token to store in the cookie
 * @param res - Express response object
 * @param cookieOptions - Optional cookie settings to override defaults
 * @returns The modified response object with cookie set
 */
export function setAuthCookie(cookieName: string, token: string, res: Response) {
  if (!cookieName || !token) {
    throw new Error('Cookie name and token are required');
  }

  const opts = {
    path: '/',
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: envVariables.SERVER.ENV !== 'development',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours by default
  };

  const bearerJwt = `Bearer ${token}`;
  res.cookie(cookieName, bearerJwt, opts);
  return res;
}

/**
 * Generates a random hash string using SHA-256
 * @param byteLength - Number of random bytes to generate (default: 10)
 * @param algorithm - Hashing algorithm to use (default: 'sha256')
 * @returns A hexadecimal string representation of the hash
 * @throws Error if crypto operations fail
 */
export function hashGenerator(
  byteLength: number = 10,
  algorithm: 'sha256' | 'sha512' | 'md5' = 'sha256'
): string {
  try {
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
      next(err);
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
