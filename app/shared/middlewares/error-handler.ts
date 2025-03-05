import { MongooseError } from 'mongoose';
import { AwilixResolutionError } from 'awilix';
import { envVariables } from '@shared/config';
// import { DiskStorage } from '@services/FileUploadService';
import { NextFunction, Request, Response } from 'express';
import { createLogger, extractMulterFiles } from '@utils/helpers';
import {
  CustomError,
  handleMongooseError,
  InternalServerError,
  MongoDatabaseError,
} from '@shared/customErrors';

const logger = createLogger('ErrorHandler_Middleware');

export const errorHandlerMiddleware = async (
  err: { statusCode?: number } & Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let error;

  if (err instanceof CustomError) {
    error = err;
  } else if (err instanceof MongooseError) {
    error = handleMongooseError(err);
  } else if (err instanceof AwilixResolutionError) {
    error = new InternalServerError({
      message: `${err.name}: ${err.message}` || 'An unexpected error occurred',
    });
  } else {
    error = new InternalServerError({
      message: `${err.name}: ${err.message}` || 'An unexpected error occurred',
    });
  }

  const response = {
    success: false,
    message: error.message,
    statusCode: error.statusCode,
    ...(error.errorInfo?.length ? { errorInfo: error.errorInfo } : {}),
    ...(envVariables.SERVER.ENV === 'development' && { stack: error.stack }),
  };

  if (envVariables.SERVER.ENV === 'development') {
    logger.error(error);
  }

  if (res.headersSent) {
    // If headers are already sent, delegate to the default Express error handler
    return next(response);
  }
  res.status(error.statusCode).json(response);
};
