import { ZodError, AnyZodObject } from 'zod';
import { httpStatusCodes } from '@utils/constants';
import { Response, Request, NextFunction } from 'express';

export const validateRequest = (schema: AnyZodObject) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync(req.body);
      return next();
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
      }
      next(error);
    }
  };
};
