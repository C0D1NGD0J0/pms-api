import { z } from 'zod';
import { IUserRole } from '@interfaces/user.interface';

export const invitationDataSchema = z.object({
  inviteeEmail: z
    .string()
    .email('Please provide a valid email address')
    .max(255, 'Email must be less than 255 characters'),

  role: z.nativeEnum(IUserRole, {
    errorMap: () => ({ message: 'Please provide a valid role' }),
  }),

  personalInfo: z.object({
    firstName: z
      .string()
      .min(2, 'First name must be at least 2 characters')
      .max(50, 'First name must be less than 50 characters')
      .regex(/^[a-zA-Z\s\-']+$/, 'First name contains invalid characters'),

    lastName: z
      .string()
      .min(2, 'Last name must be at least 2 characters')
      .max(50, 'Last name must be less than 50 characters')
      .regex(/^[a-zA-Z\s\-']+$/, 'Last name contains invalid characters'),

    phoneNumber: z
      .string()
      .regex(/^\+?[\d\s\-()]+$/, 'Please provide a valid phone number')
      .min(10, 'Phone number must be at least 10 digits')
      .max(20, 'Phone number must be less than 20 characters')
      .optional(),
  }),

  metadata: z
    .object({
      inviteMessage: z
        .string()
        .max(500, 'Invitation message must be less than 500 characters')
        .optional(),

      expectedStartDate: z
        .string()
        .datetime('Please provide a valid date')
        .transform((str) => new Date(str))
        .optional(),
    })
    .optional(),
});

export const sendInvitationSchema = invitationDataSchema;

export const acceptInvitationSchema = z.object({
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be less than 128 characters')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
      'Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character'
    ),

  location: z
    .string()
    .min(2, 'Location must be at least 2 characters')
    .max(100, 'Location must be less than 100 characters')
    .optional(),

  timeZone: z.string().min(3, 'Invalid timezone').max(50, 'Invalid timezone').optional(),

  lang: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Invalid language code')
    .optional(),

  bio: z.string().max(700, 'Bio must be less than 700 characters').optional(),

  headline: z.string().max(50, 'Headline must be less than 50 characters').optional(),
});

export const revokeInvitationSchema = z.object({
  reason: z.string().max(200, 'Reason must be less than 200 characters').optional(),
});

export const resendInvitationSchema = z.object({
  customMessage: z.string().max(500, 'Custom message must be less than 500 characters').optional(),
});

export const getInvitationsQuerySchema = z.object({
  status: z
    .enum(['pending', 'accepted', 'expired', 'revoked'], {
      errorMap: () => ({ message: 'Invalid status value' }),
    })
    .optional(),

  role: z
    .nativeEnum(IUserRole, {
      errorMap: () => ({ message: 'Invalid role value' }),
    })
    .optional(),

  page: z
    .string()
    .regex(/^\d+$/, 'Page must be a positive number')
    .transform((str) => parseInt(str, 10))
    .refine((num) => num > 0, 'Page must be greater than 0')
    .optional(),

  limit: z
    .string()
    .regex(/^\d+$/, 'Limit must be a positive number')
    .transform((str) => parseInt(str, 10))
    .refine((num) => num > 0 && num <= 100, 'Limit must be between 1 and 100')
    .optional(),

  sortBy: z
    .enum(['createdAt', 'expiresAt', 'inviteeEmail'], {
      errorMap: () => ({ message: 'Invalid sortBy value' }),
    })
    .optional(),

  sortOrder: z
    .enum(['asc', 'desc'], {
      errorMap: () => ({ message: 'Invalid sortOrder value' }),
    })
    .optional(),
});

export const invitationTokenSchema = z.object({
  token: z.string().min(10, 'Invalid invitation token').max(255, 'Invalid invitation token'),
});

export const iuidSchema = z.object({
  iuid: z.string().min(10, 'Invalid invitation ID').max(255, 'Invalid invitation ID'),
});

// CSV invitation schema for bulk import
export const invitationCsvSchema = z.object({
  inviteeEmail: z
    .string()
    .email('Please provide a valid email address')
    .max(255, 'Email must be less than 255 characters'),

  role: z.nativeEnum(IUserRole, {
    errorMap: () => ({ message: 'Please provide a valid role' }),
  }),

  firstName: z
    .string()
    .min(2, 'First name must be at least 2 characters')
    .max(50, 'First name must be less than 50 characters')
    .regex(/^[a-zA-Z\s\-']+$/, 'First name contains invalid characters'),

  lastName: z
    .string()
    .min(2, 'Last name must be at least 2 characters')
    .max(50, 'Last name must be less than 50 characters')
    .regex(/^[a-zA-Z\s\-']+$/, 'Last name contains invalid characters'),

  phoneNumber: z
    .string()
    .regex(/^\+?[\d\s\-()]+$/, 'Please provide a valid phone number')
    .min(10, 'Phone number must be at least 10 digits')
    .max(20, 'Phone number must be less than 20 characters')
    .optional(),

  inviteMessage: z
    .string()
    .max(500, 'Invitation message must be less than 500 characters')
    .optional(),

  expectedStartDate: z
    .string()
    .datetime('Please provide a valid date')
    .transform((str) => new Date(str))
    .optional(),

  // Client ID will be added by the processor
  cid: z.string().optional(),
});
