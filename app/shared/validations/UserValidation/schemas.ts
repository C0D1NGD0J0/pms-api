import { z } from 'zod';

export const UserUidParamSchema = z.object({
  cuid: z.string().trim().min(8, 'Client ID must be at least 8 characters'),
  uid: z.string().trim().min(8, 'User ID must be at least 8 characters'),
});

export const UserIdParamSchema = z.object({
  uid: z.string().trim().min(8, 'User ID must be at least 8 characters').optional(),
});

export const UserFilterQuerySchema = z.object({
  role: z
    .union([
      z.enum(['admin', 'manager', 'tenant', 'staff', 'vendor']),
      z.array(z.enum(['admin', 'manager', 'tenant', 'staff', 'vendor'])),
      // Comma-separated string that gets transformed to array
      z
        .string()
        .transform((val) => val.split(',').map((r) => r.trim()))
        .pipe(z.array(z.enum(['admin', 'manager', 'tenant', 'staff', 'vendor']))),
    ])
    .optional(),
  department: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  search: z.string().optional(),
  page: z.string().regex(/^\d+$/).transform(Number).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).optional(),
  sortBy: z.string().optional(),
  sort: z.enum(['asc', 'desc']).optional(),
});

export const UserRoleParamSchema = z.object({
  cuid: z.string().trim().min(8, 'Client ID must be at least 8 characters'),
  role: z.enum(['admin', 'manager', 'tenant', 'staff', 'vendor'], {
    errorMap: () => ({
      message: 'Invalid role. Must be one of: admin, manager, tenant, staff, vendor',
    }),
  }),
});
