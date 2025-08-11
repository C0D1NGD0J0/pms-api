import { MongooseError } from 'mongoose';
import { AwilixResolutionError } from 'awilix';
import { EventTypes } from '@interfaces/index';
import { NextFunction, Response, Request } from 'express';
import { extractMulterFiles, createLogger } from '@utils/helpers';
import { handleMongoError, CustomError } from '@shared/customErrors';

const logger = createLogger('ErrorHandler_Middleware');

export const errorHandlerMiddleware = async (
  err: { statusCode?: number; errors: unknown[]; errorInfo?: Record<string, string[]> } & Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { emitterService } = req.container.cradle;

  logger.error('Error caught by middleware:', {
    stack: err.stack ? err.stack.split('\n').slice(0, 5).join('\n') : 'No stack trace available',
  });

  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let errorInfo = err.errorInfo;

  if (err instanceof CustomError) {
    message = err.message;
    statusCode = err.statusCode || 500;
    errorInfo = err.errorInfo;
  } else if (err instanceof MongooseError) {
    const mongoError = handleMongoError(err);
    message = mongoError.message;
    statusCode = mongoError.statusCode || 422;
    errorInfo = mongoError.errorInfo;
  } else if (err instanceof AwilixResolutionError) {
    message = `Dependency injection error: ${err.message}`;
    statusCode = 500;
  } else if (err.name === 'ValidationError') {
    message = 'Validation failed';
    statusCode = 422;
    if ((err as any).errors) {
      errorInfo = Object.keys((err as any).errors).reduce((acc: Record<string, string[]>, key) => {
        acc[key] = [(err as any).errors[key].message];
        return acc;
      }, {});
    }
  } else if (err.name === 'CastError') {
    message = 'Invalid data format';
    statusCode = 400;
  } else if (err.name === 'MongoError' || err.name === 'MongoServerError') {
    if ((err as any).code === 11000) {
      message = 'Duplicate key error';
      statusCode = 409;
    } else {
      message = 'Database operation failed';
      statusCode = 500;
    }
  }

  const errorResponse = {
    success: false,
    message,
    statusCode,
    ...(err.errors?.length ? { errors: err.errors } : {}),
    ...(errorInfo ? { errorInfo } : {}),
  };

  // clean up uploaded files on error
  if (req.files) {
    try {
      const filesToDelete = extractMulterFiles(req.files).map((file) => file.filename);
      emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, filesToDelete);
    } catch (cleanupError) {
      void cleanupError; // ignore cleanup errors
    }
  }

  // prevent sending response if headers already sent
  if (res.headersSent) {
    logger.warn('Headers already sent, forwarding to Express error handler');
    return next(err);
  }
  // send the error response
  res.status(errorResponse.statusCode).json(errorResponse);
};
