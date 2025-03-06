import { MongooseError } from 'mongoose';
import { httpStatusCodes } from '@utils/index';

/**
 * Base class for all custom application errors
 */
export class CustomError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly errorInfo?: Record<string, string>[];
  public readonly originalError?: Error;

  constructor(options: {
    message: string;
    statusCode: number;
    isOperational?: boolean;
    errorInfo?: Record<string, string>[];
    originalError?: Error;
  }) {
    super(options.message);

    this.name = this.constructor.name;
    this.statusCode = options.statusCode;
    this.isOperational = options.isOperational ?? true;
    this.errorInfo = options.errorInfo;
    this.originalError = options.originalError;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error for corrupted file uploads
 */
export class CorruptedFileRequestError extends CustomError {
  constructor(options?: {
    message?: string;
    statusCode?: number;
    errorInfo?: Record<string, string>[];
    originalError?: Error;
  }) {
    super({
      message: options?.message || 'File scanner detected invalid file.',
      statusCode: options?.statusCode || httpStatusCodes.UNPROCESSABLE,
      errorInfo: options?.errorInfo,
      originalError: options?.originalError,
    });
  }
}

/**
 * Error representing an unprocessable request (422)
 */
export class InvalidRequestError extends CustomError {
  constructor(options?: {
    message?: string;
    statusCode?: number;
    errorInfo?: Record<string, string>[];
    originalError?: Error;
  }) {
    super({
      message: options?.message || 'Unable to process request.',
      statusCode: options?.statusCode || httpStatusCodes.UNPROCESSABLE,
      errorInfo: options?.errorInfo,
      originalError: options?.originalError,
    });
  }
}

/**
 * Error for validation failures
 */
export class ValidationRequestError extends CustomError {
  constructor(options?: {
    message?: string;
    errorInfo?: Record<string, string>[];
    statusCode?: number;
    originalError?: Error;
  }) {
    super({
      message: options?.message || 'Validation Request.',
      statusCode: options?.statusCode || httpStatusCodes.UNPROCESSABLE,
      errorInfo: options?.errorInfo,
      originalError: options?.originalError,
    });
  }
}

/**
 * Error representing a 400 Bad Request
 */
export class BadRequestError extends CustomError {
  constructor(options?: {
    message?: string;
    statusCode?: number;
    errorInfo?: Record<string, string>[];
    originalError?: Error;
  }) {
    super({
      message: options?.message || 'Bad Request.',
      statusCode: options?.statusCode || httpStatusCodes.BAD_REQUEST,
      errorInfo: options?.errorInfo,
      originalError: options?.originalError,
    });
  }
}

/**
 * Error representing a 503 Service Unavailable
 */
export class ServiceUnavailableError extends CustomError {
  constructor(options?: { message?: string; statusCode?: number; originalError?: Error }) {
    super({
      message: options?.message || 'Service Unavailable',
      statusCode: options?.statusCode || httpStatusCodes.SERVICE_UNAVAILABLE,
      isOperational: false,
      originalError: options?.originalError,
    });
  }
}

/**
 * Error representing a 500 Internal Server Error
 */
export class InternalServerError extends CustomError {
  constructor(options?: { message?: string; statusCode?: number; originalError?: Error }) {
    super({
      message: options?.message || 'Internal Server Error.',
      statusCode: options?.statusCode || httpStatusCodes.INTERNAL_SERVER,
      isOperational: false,
      originalError: options?.originalError,
    });
  }
}

/**
 * Error representing a 401 Unauthorized
 */
export class UnauthorizedError extends CustomError {
  constructor(options?: { message?: string; statusCode?: number; originalError?: Error }) {
    super({
      message: options?.message || 'Unauthorized access.',
      statusCode: options?.statusCode || httpStatusCodes.UNAUTHORIZED,
      originalError: options?.originalError,
    });
  }
}

/**
 * Error related to Redis operations
 */
export class RedisError extends CustomError {
  constructor(options: { message: string; statusCode?: number; originalError?: Error }) {
    super({
      message: options.message,
      statusCode: options.statusCode || httpStatusCodes.INTERNAL_SERVER,
      isOperational: false,
      originalError: options.originalError,
    });
  }
}

/**
 * Error representing a 404 Not Found
 */
export class NotFoundError extends CustomError {
  constructor(options?: { message?: string; statusCode?: number; originalError?: Error }) {
    super({
      message: options?.message || 'Resource not found.',
      statusCode: options?.statusCode || httpStatusCodes.NOT_FOUND,
      originalError: options?.originalError,
    });
  }
}

/**
 * Error representing a 403 Forbidden
 */
export class ForbiddenError extends CustomError {
  constructor(options?: { message?: string; statusCode?: number; originalError?: Error }) {
    super({
      message: options?.message || 'Forbidden.',
      statusCode: options?.statusCode || httpStatusCodes.FORBIDDEN,
      originalError: options?.originalError,
    });
  }
}

/**
 * Error related to MongoDB/Mongoose operations
 */
export class MongoDatabaseError extends CustomError {
  constructor(options: { message: string; statusCode?: number; originalError?: Error }) {
    super({
      message: options.message,
      statusCode: options.statusCode || httpStatusCodes.INTERNAL_SERVER,
      originalError: options.originalError,
    });
  }
}

/**
 * Utility function to handle and convert Mongoose errors
 */
export function handleMongoError(err: MongooseError | Error): CustomError {
  // CastError - invalid ObjectId
  if (err.name === 'CastError') {
    const castErr = err as unknown as { value: string };
    return new NotFoundError({
      message: `Resource with ID ${castErr.value} not found!`,
      originalError: err,
    });
  }

  // Duplicate key error
  if ('code' in err && err.code === 11000) {
    return new InvalidRequestError({
      message: 'A duplicate value was provided for a unique field',
      originalError: err,
    });
  }

  // Validation error
  if (err.name === 'ValidationError') {
    const validationErr = err as unknown as {
      errors: Record<string, { message: string; name: string }>;
    };
    const messages = Object.values(validationErr.errors).map((error) => {
      if (error.name === 'CastError') {
        return error.message.replace('Error, ', '');
      }
      if (error.name === 'ValidatorError') {
        return error.message.replace('Path', '').trim();
      }
      return error.message || 'Unknown validation error';
    });

    return new ValidationRequestError({
      message: 'Validation failed',
      errorInfo: messages.map((msg) => ({ message: msg })),
      originalError: err,
    });
  }

  // Network errors
  if (err.name === 'MongoNetworkError' || err.name === 'MongooseServerSelectionError') {
    return new ServiceUnavailableError({
      message: 'Database connection error, please try again later',
      originalError: err,
    });
  }

  // Document not found
  if (err.name === 'DocumentNotFoundError') {
    return new NotFoundError({
      message: 'Document not found',
      originalError: err,
    });
  }

  // Default fallback
  return new InternalServerError({
    message: 'An unexpected database error occurred',
    originalError: err,
  });
}
