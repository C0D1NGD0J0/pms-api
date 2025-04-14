import { DiskStorage } from '@services/fileUpload';
import { httpStatusCodes } from '@utils/constants';
import { extractMulterFiles } from '@utils/helpers';
import { NextFunction, Response, Request } from 'express';
import { ZodTypeDef, ZodSchema, ZodError, ZodType } from 'zod';

export const validateRequest = (schema: {
  query?: ZodType<any, ZodTypeDef, any>;
  params?: ZodType<any, ZodTypeDef, any>;
  body?: ZodSchema;
}) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const diskStorage = req.container.resolve<DiskStorage>('diskStorage');
    try {
      if (schema.query) {
        req.query = await schema.query.parseAsync(req.query);
      }
      if (schema.params) {
        req.params = await schema.params.parseAsync(req.params);
      }
      schema.body && (await schema.body.parseAsync(JSON.parse(req.body)));
      next();
    } catch (error) {
      if (req.files) {
        const filesToDelete = extractMulterFiles(req.files).map((file) => file.filename);
        await diskStorage.deleteFiles(filesToDelete);
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
