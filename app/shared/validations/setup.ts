import { ZodError, ZodType } from 'zod';
import { envVariables } from '@shared/config';
import { EventTypes } from '@interfaces/index';
import { httpStatusCodes } from '@utils/constants';
import { EventEmitterService } from '@services/index';
import { NextFunction, Response, Request } from 'express';
import { extractMulterFiles, parseJsonFields, createLogger } from '@utils/helpers';

import { collectStrippedPaths } from './strippedPaths';
import './zodConfig';

const log = createLogger('ValidateRequest');

const warnAboutStrippedFields = (req: Request, raw: { body?: unknown; query?: unknown }) => {
  if (envVariables.SERVER.ENV === 'production') return;
  const strippedPaths = new Set<string>();
  if (raw.query !== undefined) collectStrippedPaths(raw.query, req.query, 'query', strippedPaths);
  if (raw.body !== undefined) collectStrippedPaths(raw.body, req.body, 'body', strippedPaths);
  if (strippedPaths.size === 0) return;

  log.warn(
    { route: `${req.method} ${req.originalUrl}`, strippedPaths: [...strippedPaths] },
    'Request validation stripped undeclared fields — declare them in the schema if they are needed'
  );
};

export const validateRequest = (schema: {
  query?: ZodType<any, any>;
  params?: ZodType<any, any>;
  body?: ZodType;
}) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { emitterService }: { emitterService: EventEmitterService } = req.container.cradle;
    try {
      const raw: { body?: unknown; query?: unknown } = {};
      if (schema.query) {
        raw.query = req.query;
        req.query = await schema.query.parseAsync(req.query);
        if (req.context?.request) {
          req.context.request.query = req.query;
        }
      }
      if (schema.params) {
        // merge so keys inherited via mergeParams but not declared in the schema survive
        req.params = { ...req.params, ...(await schema.params.parseAsync(req.params)) };
        if (req.context?.request) {
          req.context.request.params = req.params;
        }
      }
      // parse nested JSON fields in the body if multipart/form-data
      req.body = parseJsonFields(req);
      if (schema.body) {
        raw.body = req.body;
        req.body = await schema.body.parseAsync(req.body);
      }
      warnAboutStrippedFields(req, raw);
      next();
    } catch (error) {
      if (req.files) {
        const filesToDelete = extractMulterFiles(req.files).map((file) => file.filename);
        emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, filesToDelete);
      }

      if (error instanceof ZodError) {
        res.status(httpStatusCodes.UNPROCESSABLE).json({
          success: false,
          message: 'Validation failed',
          errors: error.issues.map((err) => ({
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
