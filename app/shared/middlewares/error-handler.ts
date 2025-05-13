import { MongooseError } from 'mongoose';
import { envVariables } from '@shared/config';
import { AwilixResolutionError } from 'awilix';
import { EventTypes } from '@interfaces/index';
import { NextFunction, Response, Request } from 'express';
import { extractMulterFiles, createLogger } from '@utils/helpers';
import { handleMongoError, CustomError } from '@shared/customErrors';

const logger = createLogger('ErrorHandler_Middleware');

export const errorHandlerMiddleware = async (
  err: { statusCode?: number; errors: unknown[] } & Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { emitterService } = req.container.cradle;
  const statusCode = err.statusCode || 500;
  const message =
    err instanceof CustomError
      ? err.message
      : err instanceof MongooseError
        ? handleMongoError(err).message
        : err instanceof AwilixResolutionError
          ? `${err.name}: ${err.message}` || 'An unexpected error occurred'
          : err.message || 'Internal Server Error';

  const errorResponse = {
    success: false,
    message,
    statusCode,
    ...(err.errors?.length ? { errors: err.errors } : {}),
  };

  if (envVariables.SERVER.ENV === 'development') {
    const limitedStack = err.stack
      ? err.stack.split('\n').slice(0, 10).join('\n')
      : 'No stack trace available';

    logger.debug(`Limited stack: ${limitedStack}`);
  }

  if (req.files) {
    const filesToDelete = extractMulterFiles(req.files).map((file) => file.filename);
    emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, filesToDelete);
  }
  if (res.headersSent) {
    // If headers are already sent, forward to the express error handler
    return next(err);
  }
  res.status(errorResponse.statusCode).json(errorResponse);
};
