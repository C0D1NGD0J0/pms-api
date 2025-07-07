import { z } from 'zod';

// Client ID parameter validation
export const ClientIdParamSchema = z.object({
  cid: z.string().trim().min(8, 'Client ID must be at least 8 characters'),
});

// Client settings validation
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

// Company profile validation
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

// Client identification validation
export const ClientIdentificationSchema = z.object({
  idType: z.enum(['passport', 'driverLicense', 'nationalId', 'other']),
  issueDate: z.string().datetime('Invalid issue date format'),
  expiryDate: z.string().datetime('Invalid expiry date format'),
  idNumber: z.string().trim().min(1, 'ID number is required'),
  authority: z.string().trim().optional(),
  issuingState: z.string().trim().min(1, 'Issuing state is required'),
  dataProcessingConsent: z.boolean().default(false),
});

// Client subscription validation
export const ClientSubscriptionSchema = z.object({
  subscriptionId: z.string().trim().nullable(),
});

// Display name validation
export const ClientDisplayNameSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name is required'),
});

// User management parameter validation
export const UserIdParamSchema = z.object({
  cid: z.string().trim().min(8, 'Client ID must be at least 8 characters'),
  uid: z.string().trim().min(8, 'User ID must be at least 8 characters'),
});

// Role management parameter validation  
export const RoleParamSchema = z.object({
  cid: z.string().trim().min(8, 'Client ID must be at least 8 characters'),
  uid: z.string().trim().min(8, 'User ID must be at least 8 characters'),
  role: z.string().trim().min(1, 'Role is required'),
});

// Role assignment body validation
export const AssignRoleSchema = z.object({
  role: z.enum(['admin', 'manager', 'tenant', 'staff', 'vendor'], {
    errorMap: () => ({ message: 'Invalid role. Must be one of: admin, manager, tenant, staff, vendor' })
  }),
});

// Comprehensive client details update validation
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
      // If identification is provided, ensure required fields are present when updating idType
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
      // Validate email format in company profile if provided
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
