import { z } from 'zod';

// User model fields that can be updated
const userInfoSchema = z.object({
  email: z.string().email().optional(),
  // Note: password updates should be handled separately via password reset flow
});

// Profile model fields that can be updated
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
});

const settingsSchema = z.object({
  theme: z.enum(['light', 'dark']).optional(),
  loginType: z.enum(['otp', 'password']).optional(),
  notifications: z
    .object({
      messages: z.boolean().optional(),
      comments: z.boolean().optional(),
      announcements: z.boolean().optional(),
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

// Updated vendor info schema for profile references only
// Business data is now stored in the vendor collection
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

export const ProfileValidations = {
  updateUserInfo: userInfoSchema,
  updatePersonalInfo: personalInfoSchema,
  updateSettings: settingsSchema,
  updateIdentification: identificationSchema,
  updateProfileMeta: profileMetaSchema,
  updateEmployeeInfo: employeeInfoSchema,
  updateVendorInfo: vendorInfoSchema,
  profileUpdate: z
    .object({
      userInfo: userInfoSchema.optional(),
      personalInfo: personalInfoSchema.optional(),
      settings: settingsSchema.optional(),
      identification: identificationSchema.optional(),
      profileMeta: profileMetaSchema.optional(),
      documents: documentsSchema.optional(),
      employeeInfo: employeeInfoSchema.optional(),
      vendorInfo: vendorInfoSchema.optional(),
    })
    .refine(
      (data) => {
        // Ensure only one role-specific info is provided
        const hasEmployee = data.employeeInfo && Object.keys(data.employeeInfo).length > 0;
        const hasVendor = data.vendorInfo && Object.keys(data.vendorInfo).length > 0;
        return !hasEmployee || !hasVendor;
      },
      {
        message: 'Cannot have both employee and vendor information',
      }
    ),
};
