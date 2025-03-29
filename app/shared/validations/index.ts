import { httpStatusCodes } from '@utils/constants';
import { NextFunction, Response, Request } from 'express';
import { ZodTypeDef, ZodSchema, ZodError, ZodType } from 'zod';

export const validateRequest = (schema: {
  query?: ZodType<any, ZodTypeDef, any>;
  params?: ZodType<any, ZodTypeDef, any>;
  body?: ZodSchema;
}) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schema.query) {
        req.query = await schema.query.parseAsync(req.query);
      }
      if (schema.params) {
        req.params = await schema.params.parseAsync(req.params);
      }
      schema.body && (await schema.body.parseAsync(req.body));
      next();
    } catch (error) {
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
