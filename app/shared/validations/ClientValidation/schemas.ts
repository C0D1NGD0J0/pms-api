import { z } from 'zod';
import { ROLE_VALIDATION } from '@shared/constants/roles.constants';

export const ClientSettingsSchema = z.object({
  notificationPreferences: z
    .object({
      email: z.boolean().optional(),
      sms: z.boolean().optional(),
      inApp: z.boolean().optional(),
    })
    .optional(),
  timeZone: z
    .string()
    .optional()
    .refine(
      (tz) => {
        if (!tz) return true;
        try {
          Intl.DateTimeFormat(undefined, { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Invalid timezone' }
    ),
  lang: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Invalid language code format')
    .optional(),
});

export const CompanyProfileSchema = z.object({
  legalEntityName: z.string().trim().min(1, 'Legal entity name is required').optional(),
  tradingName: z.string().trim().min(1, 'Trading name is required').optional(),
  companyEmail: z.string().email('Invalid email format').optional(),
  registrationNumber: z.string().trim().optional(),
  website: z.string().url('Invalid website URL').optional(),
  companyPhone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s\-()]+$/, 'Invalid phone number format')
    .optional(),
  industry: z.string().trim().optional(),
  contactInfo: z
    .object({
      email: z.string().email('Invalid email format').optional(),
      phoneNumber: z
        .string()
        .trim()
        .regex(/^\+?[\d\s\-()]+$/, 'Invalid phone number format')
        .optional(),
      contactPerson: z.string().trim().optional(),
    })
    .optional(),
});

export const ClientIdentificationSchema = z.object({
  idType: z.enum(['passport', 'driverLicense', 'nationalId', 'other']),
  issueDate: z.string().datetime('Invalid issue date format'),
  expiryDate: z.string().datetime('Invalid expiry date format'),
  idNumber: z.string().trim().min(1, 'ID number is required'),
  authority: z.string().trim().optional(),
  issuingState: z.string().trim().min(1, 'Issuing state is required'),
  dataProcessingConsent: z.boolean().default(false),
});

export const ClientSubscriptionSchema = z.object({
  subscriptionId: z.string().trim().nullable(),
});

export const ClientDisplayNameSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name is required'),
});

export const UserIdParamSchema = z.object({
  cuid: z.string().trim().min(8, 'Client ID must be at least 8 characters'),
  uid: z.string().trim().min(8, 'User ID must be at least 8 characters'),
});

export const RoleParamSchema = z.object({
  cuid: z.string().trim().min(8, 'Client ID must be at least 8 characters'),
  role: z.string().trim().min(1, 'Role is required'),
});

export const AssignRoleSchema = z.object({
  role: z.enum(ROLE_VALIDATION.ALL_ROLES, {
    errorMap: () => ({
      message: 'Invalid role. Must be one of: admin, manager, tenant, staff, vendor',
    }),
  }),
});

export const FilteredUsersQuerySchema = z.object({
  role: z
    .union([
      z.enum(ROLE_VALIDATION.ALL_ROLES),
      z.array(z.enum(ROLE_VALIDATION.ALL_ROLES)),
      // Comma-separated string that gets transformed to array
      z
        .string()
        .transform((val) => val.split(',').map((r) => r.trim()))
        .pipe(z.array(z.enum(ROLE_VALIDATION.ALL_ROLES))),
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

export const TenantDetailsIncludeQuerySchema = z.object({
  include: z
    .union([
      z.enum(['lease', 'payments', 'maintenance', 'documents', 'notes', 'all']),
      z.array(z.enum(['lease', 'payments', 'maintenance', 'documents', 'notes', 'all'])),
      z
        .string()
        .transform((val) => val.split(',').map((item) => item.trim()))
        .pipe(z.array(z.enum(['lease', 'payments', 'maintenance', 'documents', 'notes', 'all']))),
    ])
    .optional(),
});

export const UpdateClientDetailsSchema = z
  .object({
    identification: ClientIdentificationSchema.partial().optional(),
    companyProfile: CompanyProfileSchema.partial().optional(),
    displayName: z.string().trim().min(1, 'Display name cannot be empty').optional(),
    settings: ClientSettingsSchema.partial().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  })
  .refine(
    (data) => {
      if (data.identification?.idType && !data.identification?.idNumber) {
        return false;
      }
      if (data.identification?.idNumber && !data.identification?.idType) {
        return false;
      }
      return true;
    },
    {
      message: 'When updating identification, both idType and idNumber are required',
      path: ['identification'],
    }
  )
  .refine(
    (data) => {
      if (data.companyProfile?.companyEmail) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(data.companyProfile.companyEmail);
      }
      return true;
    },
    {
      message: 'Invalid company email format',
      path: ['companyProfile', 'companyEmail'],
    }
  );

export const UpdateTenantProfileSchema = z.object({
  personalInfo: z
    .object({
      firstName: z.string().trim().min(1, 'First name is required').optional(),
      lastName: z.string().trim().min(1, 'Last name is required').optional(),
      email: z.string().email('Invalid email format').optional(),
      phoneNumber: z
        .string()
        .trim()
        .regex(/^\+?[\d\s\-()]+$/, 'Invalid phone number format')
        .optional(),
    })
    .optional(),
  tenantInfo: z
    .object({
      employerInfo: z
        .array(
          z.object({
            companyName: z.string().trim().min(1, 'Company name is required'),
            position: z.string().trim().min(1, 'Position is required'),
            monthlyIncome: z.number().min(0, 'Monthly income must be non-negative'),
            contactPerson: z.string().trim().optional(),
            companyAddress: z.string().trim().optional(),
            contactEmail: z.string().email('Invalid email format').optional(),
          })
        )
        .optional(),
      rentalReferences: z
        .array(
          z.object({
            landlordName: z.string().trim().min(1, 'Landlord name is required'),
            landlordEmail: z.string().email('Invalid email format').optional(),
            landlordContact: z.string().trim().optional(),
            durationMonths: z.number().int().min(0, 'Duration must be non-negative'),
            reasonForLeaving: z.string().trim().optional(),
            propertyAddress: z.string().trim().optional(),
          })
        )
        .optional(),
      pets: z
        .array(
          z.object({
            type: z.string().trim().min(1, 'Pet type is required'),
            breed: z.string().trim().optional(),
            isServiceAnimal: z.boolean().default(false),
          })
        )
        .optional(),
      emergencyContact: z
        .object({
          name: z.string().trim().min(1, 'Emergency contact name is required').optional(),
          phone: z
            .string()
            .trim()
            .regex(/^\+?[\d\s\-()]+$/, 'Invalid phone number format')
            .optional(),
          relationship: z.string().trim().optional(),
          email: z.string().email('Invalid email format').optional(),
        })
        .optional(),
      backgroundChecks: z
        .array(
          z.object({
            status: z.string().trim(),
            checkedDate: z.string().datetime('Invalid date format'),
            expiryDate: z.string().datetime('Invalid date format').optional(),
            notes: z.string().trim().optional(),
          })
        )
        .optional(),
    })
    .optional(),
});
