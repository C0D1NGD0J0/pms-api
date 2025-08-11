import { EventTypes } from '@interfaces/index';
import { httpStatusCodes } from '@utils/constants';
import { EventEmitterService } from '@services/index';
import { NextFunction, Response, Request } from 'express';
import { ZodTypeDef, ZodSchema, ZodError, ZodType } from 'zod';
import { extractMulterFiles, parseJsonFields } from '@utils/helpers';

export const validateRequest = (schema: {
  query?: ZodType<any, ZodTypeDef, any>;
  params?: ZodType<any, ZodTypeDef, any>;
  body?: ZodSchema;
}) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { emitterService }: { emitterService: EventEmitterService } = req.container.cradle;
    try {
      if (schema.query) {
        req.query = await schema.query.parseAsync(req.query);
      }
      if (schema.params) {
        req.params = await schema.params.parseAsync(req.params);
      }
      // parse nested JSON fields in the body if multipart/form-data
      req.body = parseJsonFields(req);
      schema.body && (await schema.body.parseAsync(req.body));
      next();
    } catch (error) {
      console.error('Validation error:', error.errors);
      if (req.files) {
        const filesToDelete = extractMulterFiles(req.files).map((file) => file.filename);
        emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, filesToDelete);
      }

      if (error instanceof ZodError) {
        res.status(httpStatusCodes.UNPROCESSABLE).json({
          success: false,
          message: 'Validation failed',
          errors: error.errors.map((err) => ({
            path: err.path.join('.'),
            message: err.message,
          })),
        });
      } else {
        next(error);
      }
    }
  };
};
