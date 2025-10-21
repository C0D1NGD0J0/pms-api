import { z } from 'zod';

// User model fields that can be updated
const userInfoSchema = z
  .object({
    email: z.string().email().optional(),
    password: z.string().min(8).max(20).optional(),
    cpassword: z.string().min(8).max(20).optional(),
  })
  .refine((data) => !data.password || !data.cpassword || data.password === data.cpassword, {
    message: 'Passwords do not match',
  });

// profile model fields that can be updated
const personalInfoSchema = z.object({
  firstName: z.string().min(2).max(25).optional(),
  lastName: z.string().min(2).max(25).optional(),
  displayName: z.string().min(2).max(45).optional(),
  location: z.string().max(100).optional(),
  dob: z.date().optional(),
  avatar: z
    .object({
      url: z.string().url().optional(),
      filename: z.string().optional(),
      key: z.string().optional(),
    })
    .optional(),
  phoneNumber: z.string().max(20).optional(),
  bio: z.string().min(2).max(700).optional(),
  headline: z.string().min(2).max(50).optional(),
  identification: z
    .object({
      idType: z
        .enum(['passport', 'drivers-license', 'national-id', 'corporation-license'])
        .optional(),
      issueDate: z.date().optional(),
      expiryDate: z.date().optional(),
      idNumber: z.string().optional(),
      authority: z.string().optional(),
      issuingState: z.string().optional(),
    })
    .optional(),
});

const settingsSchema = z.object({
  theme: z.enum(['light', 'dark']).optional(),
  loginType: z.enum(['otp', 'password']).optional(),
  notifications: z
    .object({
      messages: z.boolean().optional(),
      comments: z.boolean().optional(),
      announcements: z.boolean().optional(),
      maintenance: z.boolean().optional(),
      payments: z.boolean().optional(),
      system: z.boolean().optional(),
      propertyUpdates: z.boolean().optional(),
      emailNotifications: z.boolean().optional(),
      inAppNotifications: z.boolean().optional(),
      emailFrequency: z.enum(['immediate', 'daily']).optional(),
    })
    .optional(),
  gdprSettings: z
    .object({
      dataRetentionPolicy: z.enum(['standard', 'extended', 'minimal']).optional(),
      dataProcessingConsent: z.boolean().optional(),
    })
    .optional(),
});

const identificationSchema = z.object({
  idType: z.enum(['passport', 'drivers-license', 'national-id', 'corporation-license']).optional(),
  issueDate: z.date().optional(),
  expiryDate: z.date().optional(),
  idNumber: z.string().optional(),
  authority: z.string().optional(),
  issuingState: z.string().optional(),
});

const profileMetaSchema = z.object({
  timeZone: z.string().optional(),
  lang: z.string().min(2).max(5).optional(), // e.g., 'en', 'fr'
});

const employeeInfoSchema = z.object({
  jobTitle: z.string().min(2).max(100).optional(),
  department: z.string().min(2).max(50).optional(),
  reportsTo: z.string().min(2).max(100).optional(),
  employeeId: z.string().min(3).max(20).optional(),
  startDate: z.date().optional(),
  permissions: z.array(z.string()).optional(),
});

const vendorInfoSchema = z.object({
  vendorId: z
    .string()
    .length(24, 'Vendor ID must be a valid MongoDB ObjectId')
    .regex(/^[0-9a-fA-F]{24}$/, 'Vendor ID must contain only hexadecimal characters')
    .optional(),
  linkedVendorUid: z
    .string()
    .length(24, 'Linked vendor ID must be a valid MongoDB ObjectId')
    .regex(/^[0-9a-fA-F]{24}$/, 'Linked vendor ID must contain only hexadecimal characters')
    .optional(),
  isLinkedAccount: z.boolean().default(false),
});

const documentSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Document name is required'),
  type: z.enum([
    'passport',
    'utility_bill',
    'certification',
    'drivers_license',
    'employment_verification',
    'other',
  ]),
  file: z.any().optional(), // File object from multer
  filename: z.string().optional(),
  url: z.string().optional(),
  key: z.string().optional(),
  uploadedAt: z.date().optional(),
  expiryDate: z.date().optional(),
  status: z.enum(['valid', 'expiring', 'expired', 'uploaded']).default('uploaded'),
});

const documentsSchema = z.object({
  items: z.array(documentSchema).default([]).optional(),
});

const tenantInfoSchema = z.object({
  activeLease: z
    .object({
      leaseId: z
        .string()
        .length(24, 'Lease ID must be a valid MongoDB ObjectId')
        .regex(/^[0-9a-fA-F]{24}$/, 'Lease ID must contain only hexadecimal characters')
        .optional(),
      propertyId: z
        .string()
        .length(24, 'Property ID must be a valid MongoDB ObjectId')
        .regex(/^[0-9a-fA-F]{24}$/, 'Property ID must contain only hexadecimal characters')
        .optional(),
      unitId: z
        .string()
        .length(24, 'Unit ID must be a valid MongoDB ObjectId')
        .regex(/^[0-9a-fA-F]{24}$/, 'Unit ID must contain only hexadecimal characters')
        .optional(),
      durationMonths: z
        .number()
        .int('Duration must be a whole number')
        .min(1, 'Duration must be at least 1 month')
        .max(60, 'Duration cannot exceed 60 months')
        .optional(),
      rentAmount: z.number().min(0, 'Rent amount cannot be negative').optional(),
      paymentDueDate: z.date().optional(),
    })
    .optional(),

  employerInfo: z
    .object({
      companyName: z
        .string()
        .min(2, 'Company name must be at least 2 characters')
        .max(100, 'Company name cannot exceed 100 characters')
        .trim()
        .optional(),
      position: z
        .string()
        .min(2, 'Position must be at least 2 characters')
        .max(100, 'Position cannot exceed 100 characters')
        .trim()
        .optional(),
      monthlyIncome: z.number().min(0, 'Monthly income cannot be negative').optional(),
    })
    .optional(),

  rentalReferences: z
    .array(
      z.object({
        landlordName: z
          .string()
          .min(2, 'Landlord name must be at least 2 characters')
          .max(100, 'Landlord name cannot exceed 100 characters')
          .trim(),
        propertyAddress: z
          .string()
          .min(5, 'Property address must be at least 5 characters')
          .max(200, 'Property address cannot exceed 200 characters')
          .trim(),
      })
    )
    .optional(),

  pets: z
    .array(
      z.object({
        type: z
          .string()
          .min(2, 'Pet type must be at least 2 characters')
          .max(50, 'Pet type cannot exceed 50 characters')
          .trim(),
        breed: z
          .string()
          .min(2, 'Pet breed must be at least 2 characters')
          .max(50, 'Pet breed cannot exceed 50 characters')
          .trim(),
        isServiceAnimal: z.boolean().default(false),
      })
    )
    .optional(),

  emergencyContact: z
    .object({
      name: z
        .string()
        .min(2, 'Contact name must be at least 2 characters')
        .max(100, 'Contact name cannot exceed 100 characters')
        .trim()
        .optional(),
      phone: z
        .string()
        .min(10, 'Phone number must be at least 10 digits')
        .max(20, 'Phone number cannot exceed 20 characters')
        .regex(/^[+]?[\s\-()0-9]+$/, 'Invalid phone number format')
        .trim()
        .optional(),
      relationship: z
        .string()
        .min(2, 'Relationship must be at least 2 characters')
        .max(50, 'Relationship cannot exceed 50 characters')
        .trim()
        .optional(),
      email: z.string().email('Invalid email format').toLowerCase().optional(),
    })
    .optional(),

  backgroundCheckStatus: z
    .enum(['pending', 'approved', 'failed', 'not_required'])
    .default('not_required')
    .optional(),
});

const notificationPreferencesSchema = z.object({
  messages: z.boolean().optional(),
  comments: z.boolean().optional(),
  announcements: z.boolean().optional(),
  maintenance: z.boolean().optional(),
  payments: z.boolean().optional(),
  system: z.boolean().optional(),
  propertyUpdates: z.boolean().optional(),
  emailNotifications: z.boolean().optional(),
  inAppNotifications: z.boolean().optional(),
  emailFrequency: z.enum(['immediate', 'daily']).optional(),
});

export const ProfileValidations = {
  updateUserInfo: userInfoSchema,
  updatePersonalInfo: personalInfoSchema,
  updateSettings: settingsSchema,
  updateIdentification: identificationSchema,
  updateProfileMeta: profileMetaSchema,
  updateEmployeeInfo: employeeInfoSchema,
  updateVendorInfo: vendorInfoSchema,
  updateTenantInfo: tenantInfoSchema,
  tenantInfo: tenantInfoSchema,
  updateNotificationPreferences: notificationPreferencesSchema,
  profileUpdate: z
    .object({
      userInfo: userInfoSchema.optional(),
      personalInfo: personalInfoSchema.optional(),
      settings: settingsSchema.optional(),
      profileMeta: profileMetaSchema.optional(),
      documents: documentsSchema.optional(),
      employeeInfo: employeeInfoSchema.optional(),
      vendorInfo: vendorInfoSchema.optional(),
      tenantInfo: tenantInfoSchema.optional(),
    })
    .refine(
      (data) => {
        // Ensure only one role-specific info is provided
        const hasEmployee = data.employeeInfo && Object.keys(data.employeeInfo).length > 0;
        const hasVendor = data.vendorInfo && Object.keys(data.vendorInfo).length > 0;
        const hasTenant = data.tenantInfo && Object.keys(data.tenantInfo).length > 0;
        const roleCount = [hasEmployee, hasVendor, hasTenant].filter(Boolean).length;
        return roleCount <= 1;
      },
      {
        message: 'Cannot have multiple role-specific info in one update',
      }
    ),
};
