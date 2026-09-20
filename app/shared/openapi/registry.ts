import { z } from 'zod';
import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

// Patch Zod prototype with .openapi() — must run before any schema definitions
extendZodWithOpenApi(z);

export const openApiRegistry = new OpenAPIRegistry();

// Common response schemas used across all endpoints
export const StandardSuccessSchema = z
  .object({
    success: z.literal(true),
    message: z.string().optional(),
    data: z.unknown(),
  })
  .openapi('StandardSuccess');

export const StandardErrorSchema = z
  .object({
    success: z.literal(false),
    message: z.string(),
    errors: z
      .array(
        z.object({
          path: z.string(),
          message: z.string(),
        })
      )
      .optional(),
  })
  .openapi('StandardError');

export const PaginatedResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.unknown(),
    pagination: z.object({
      total: z.number(),
      perPage: z.number(),
      totalPages: z.number(),
      currentPage: z.number(),
      hasMoreResource: z.boolean(),
    }),
  })
  .openapi('PaginatedResponse');
