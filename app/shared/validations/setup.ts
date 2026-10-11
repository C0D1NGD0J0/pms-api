import { EventTypes } from '@interfaces/index';
import { httpStatusCodes } from '@utils/constants';
import { EventEmitterService } from '@services/index';
import { NextFunction, Response, Request } from 'express';
import { ZodTypeDef, ZodSchema, ZodError, ZodType } from 'zod';
import { extractMulterFiles, parseJsonFields, createLogger } from '@utils/helpers';

const log = createLogger('ValidateRequest');
const MAX_REPORTED_STRIPPED_PATHS = 50;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === '[object Object]';

/**
 * Lists key paths present in the raw input but dropped by Zod's parse
 * (undeclared keys are stripped). Array indices collapse to "[]" so repeated
 * items report once. Only paths are collected — never values.
 */
export const collectStrippedPaths = (
  raw: unknown,
  parsed: unknown,
  prefix: string,
  found: Set<string> = new Set()
): Set<string> => {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    raw.forEach((item, index) => collectStrippedPaths(item, parsed[index], `${prefix}[]`, found));
  } else if (isPlainObject(raw) && isPlainObject(parsed)) {
    for (const [key, value] of Object.entries(raw)) {
      if (value === undefined) continue;
      const path = `${prefix}.${key}`;
      if (Object.prototype.hasOwnProperty.call(parsed, key)) {
        collectStrippedPaths(value, parsed[key], path, found);
      } else {
        found.add(path);
      }
    }
  }
  return found;
};

const warnAboutStrippedFields = (
  req: Request,
  checked: { section: 'body' | 'query' | 'params'; raw: unknown; parsed: unknown }[]
) => {
  if (process.env.NODE_ENV === 'production') return;
  try {
    const strippedPaths = new Set<string>();
    for (const { section, raw, parsed } of checked) {
      collectStrippedPaths(raw, parsed, section, strippedPaths);
    }
    if (strippedPaths.size === 0) return;

    log.warn(
      {
        route: `${req.method} ${req.originalUrl}`,
        strippedPaths: [...strippedPaths].slice(0, MAX_REPORTED_STRIPPED_PATHS),
      },
      'Request validation stripped undeclared fields — declare them in the schema if they are needed'
    );
  } catch {
    // diagnostics only — never affect the request
  }
};

export const validateRequest = (schema: {
  query?: ZodType<any, ZodTypeDef, any>;
  params?: ZodType<any, ZodTypeDef, any>;
  body?: ZodSchema;
}) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { emitterService }: { emitterService: EventEmitterService } = req.container.cradle;
    try {
      const checked: Parameters<typeof warnAboutStrippedFields>[1] = [];
      if (schema.query) {
        const rawQuery = req.query;
        req.query = await schema.query.parseAsync(req.query);
        checked.push({ section: 'query', raw: rawQuery, parsed: req.query });
        // Sync validated query to context
        if (req.context?.request) {
          req.context.request.query = req.query;
        }
      }
      if (schema.params) {
        const rawParams = req.params;
        req.params = await schema.params.parseAsync(req.params);
        checked.push({ section: 'params', raw: rawParams, parsed: req.params });
        // Sync validated params to context
        if (req.context?.request) {
          req.context.request.params = req.params;
        }
      }
      // parse nested JSON fields in the body if multipart/form-data
      req.body = parseJsonFields(req);
      if (schema.body) {
        const rawBody = req.body;
        req.body = await schema.body.parseAsync(req.body);
        checked.push({ section: 'body', raw: rawBody, parsed: req.body });
      }
      warnAboutStrippedFields(req, checked);
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
