import { z } from 'zod';
import { ROLE_VALIDATION } from '@shared/constants/roles.constants';

export const UserUidParamSchema = z.object({
  cuid: z.string().trim().min(8, 'Client ID must be at least 8 characters'),
  uid: z.string().trim().min(8, 'User ID must be at least 8 characters'),
});

export const UserIdParamSchema = z.object({
  uid: z.string().trim().min(8, 'User ID must be at least 8 characters').optional(),
});

export const UserFilterQuerySchema = z.object({
  filter: z
    .object({
      role: z
        .union([
          z.enum(ROLE_VALIDATION.ALL_ROLES),
          z.array(z.enum(ROLE_VALIDATION.ALL_ROLES)),
          z
            .string()
            .transform((val) => val.split(',').map((r) => r.trim()))
            .pipe(z.array(z.enum(ROLE_VALIDATION.ALL_ROLES))),
        ])
        .optional(),
      department: z.string().optional(),
      status: z.enum(['active', 'inactive']).optional(),
      search: z.string().max(100, 'Search term must be 100 characters or less').optional(),
    })
    .optional(),
  pagination: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
      order: z.string().optional(),
      sortBy: z.string().optional(),
    })
    .optional(),
});

export const UserRoleParamSchema = z.object({
  cuid: z.string().trim().min(8, 'Client ID must be at least 8 characters'),
  role: z.enum(ROLE_VALIDATION.ALL_ROLES, {
    errorMap: () => ({
      message: 'Invalid role. Must be one of: admin, manager, tenant, staff, vendor',
    }),
  }),
});
