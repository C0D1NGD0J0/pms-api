import { MongooseError } from 'mongoose';
import { envVariables } from '@shared/config';
import { createLogger } from '@utils/helpers';
import { AwilixResolutionError } from 'awilix';
// import { DiskStorage } from '@services/FileUploadService';
import { Response, Request, NextFunction } from 'express';
import { InternalServerError, handleMongoError, CustomError } from '@shared/customErrors';

const logger = createLogger('ErrorHandler_Middleware');

export const errorHandlerMiddleware = async (
  err: { statusCode?: number; errors: unknown[] } & Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let error;

  if (err instanceof CustomError) {
    error = err;
  } else if (err instanceof MongooseError) {
    error = handleMongoError(err);
  } else if (err instanceof AwilixResolutionError) {
    error = new InternalServerError({
      message: `${err.name}: ${err.message}` || 'An unexpected error occurred',
    });
  } else {
    error = err;
  }

  const errorResponse = {
    success: false,
    message: error.message,
    statusCode: error.statusCode || 500,
    ...(err.errors?.length ? { errors: err.errors } : {}),
    ...(envVariables.SERVER.ENV === 'development' && { stack: error.stack }),
  };

  if (envVariables.SERVER.ENV === 'development') {
    logger.error(errorResponse);
  }

  if (res.headersSent) {
    // If headers are already sent, delegate to the default Express error handler
    return next(errorResponse);
  }
  res.status(errorResponse.statusCode).json(errorResponse);
};
