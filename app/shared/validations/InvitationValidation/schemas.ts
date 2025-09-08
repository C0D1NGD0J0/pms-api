import { z } from 'zod';
import { IUserRole } from '@interfaces/user.interface';
import { EmployeeDepartment } from '@interfaces/profile.interface';

const employeeInfoSchema = z
  .object({
    permissions: z.array(z.string()).optional(),
    department: z.string().max(100, 'Department must be less than 100 characters').optional(),
    employeeId: z.string().max(50, 'Employee ID must be less than 50 characters').optional(),
    reportsTo: z.string().max(100, 'Reports to must be less than 100 characters').optional(),
    jobTitle: z.string().max(100, 'Job title must be less than 100 characters').optional(),
    startDate: z
      .string()
      .datetime('Please provide a valid start date')
      .transform((str) => new Date(str))
      .optional(),
  })
  .optional();

const vendorInfoSchema = z
  .object({
    servicesOffered: z
      .object({
        applianceRepair: z.boolean().optional(),
        carpentry: z.boolean().optional(),
        cleaning: z.boolean().optional(),
        electrical: z.boolean().optional(),
        hvac: z.boolean().optional(),
        landscaping: z.boolean().optional(),
        maintenance: z.boolean().optional(),
        other: z.boolean().optional(),
        painting: z.boolean().optional(),
        pestControl: z.boolean().optional(),
        plumbing: z.boolean().optional(),
        roofing: z.boolean().optional(),
        security: z.boolean().optional(),
      })
      .optional(),
    address: z
      .object({
        city: z.string().max(100, 'City must be less than 100 characters').optional(),
        country: z.string().max(100, 'Country must be less than 100 characters').optional(),
        fullAddress: z.string().max(500, 'Full address must be less than 500 characters'),
        postCode: z.string().max(20, 'Post code must be less than 20 characters').optional(),
        state: z.string().max(100, 'State must be less than 100 characters').optional(),
        street: z.string().max(200, 'Street must be less than 200 characters').optional(),
        streetNumber: z
          .string()
          .max(20, 'Street number must be less than 20 characters')
          .optional(),
        unitNumber: z.string().max(20, 'Unit number must be less than 20 characters').optional(),
      })
      .optional(),
    serviceAreas: z
      .object({
        baseLocation: z
          .object({
            address: z.string().max(500, 'Base location address must be less than 500 characters'),
            coordinates: z.tuple([z.number(), z.number()]),
          })
          .optional(),
        maxDistance: z.union([z.literal(10), z.literal(15), z.literal(25), z.literal(50)], {
          errorMap: () => ({ message: 'Max distance must be 10, 15, 25, or 50 km' }),
        }),
      })
      .optional(),
    insuranceInfo: z
      .object({
        coverageAmount: z.number().positive('Coverage amount must be positive').optional(),
        expirationDate: z
          .string()
          .datetime('Please provide a valid expiration date')
          .transform((str) => new Date(str))
          .optional(),
        policyNumber: z
          .string()
          .max(100, 'Policy number must be less than 100 characters')
          .optional(),
        provider: z.string().max(100, 'Provider must be less than 100 characters').optional(),
      })
      .optional(),
    contactPerson: z
      .object({
        department: z.string().max(100, 'Department must be less than 100 characters').optional(),
        email: z.string().email('Please provide a valid email address').optional(),
        jobTitle: z.string().max(100, 'Job title must be less than 100 characters'),
        name: z.string().max(100, 'Name must be less than 100 characters'),
        phone: z.string().max(20, 'Phone must be less than 20 characters').optional(),
      })
      .optional(),
    registrationNumber: z
      .string()
      .max(100, 'Registration number must be less than 100 characters')
      .optional(),
    yearsInBusiness: z
      .number()
      .min(0, 'Years in business must be non-negative')
      .max(150, 'Years in business must be realistic')
      .optional(),
    businessType: z.string().max(100, 'Business type must be less than 100 characters').optional(),
    companyName: z.string().max(200, 'Company name must be less than 200 characters').optional(),
    taxId: z.string().max(50, 'Tax ID must be less than 50 characters').optional(),
  })
  .optional();

export const invitationDataSchema = z.object({
  inviteeEmail: z
    .string()
    .email('Please provide a valid email address')
    .max(255, 'Email must be less than 255 characters'),

  role: z.nativeEnum(IUserRole, {
    errorMap: () => ({ message: 'Please provide a valid role' }),
  }),

  linkedVendorUid: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val) return true;
        // Check if valid vendor UID (12 alphanumeric chars) or MongoDB ObjectId (24 hex chars)
        return /^[A-Z0-9]{12}$/.test(val) || /^[0-9a-fA-F]{24}$/.test(val);
      },
      {
        message:
          'Vendor ID must be a valid vendor UID (12 alphanumeric characters) or MongoDB ObjectId (24 hex characters)',
      }
    ),

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
      .max(20, 'Phone number must be less than 20 characters')
      .refine((val) => {
        if (!val) return true; // optional field
        const digitsOnly = val.replace(/\D/g, '');
        return digitsOnly.length >= 10;
      }, 'Phone number must contain at least 10 digits')
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

      employeeInfo: employeeInfoSchema,
      vendorInfo: vendorInfoSchema,
    })
    .optional(),

  status: z
    .enum(['draft', 'pending'], {
      errorMap: () => ({ message: 'Status must be either draft or pending' }),
    })
    .default('pending'),
});

export const validateTokenAndCuidSchema = z.object({
  cuid: z.string().min(12).max(32, 'Invalid cuid format'),
  token: z.string().min(4).max(64, 'Invalid token format'),
});

export const sendInvitationSchema = invitationDataSchema;

export const updateInvitationSchema = invitationDataSchema;

const policiesSchema = z.object({
  tos: z.object({
    accepted: z.boolean(),
    acceptedOn: z.date().optional().nullable(),
  }),
  privacy: z.object({
    accepted: z.boolean(),
    acceptedOn: z.date().optional().nullable(),
  }),
  marketing: z.object({
    accepted: z.boolean(),
    acceptedOn: z.date().optional().nullable(),
  }),
});

export const acceptInvitationSchema = z
  .object({
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(15, 'Password must be less than 15 characters')
      .regex(
        /^(?=.*[A-Z])(?=.*\d)[A-Za-z\d@$!%*?&]/,
        'Password must contain at least one uppercase letter, and one number'
      ),
    confirmPassword: z.string().min(8, 'Confirm password must be at least 8 characters'),
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

    policies: policiesSchema.optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
  })
  .refine(
    (data) => {
      // If marketing is accepted, tos and privacy must be accepted
      if (data.policies?.marketing?.accepted) {
        return data.policies.tos.accepted && data.policies.privacy.accepted;
      }
      return true;
    },
    { message: 'You must accept the Terms of Service and Privacy Policy to opt into marketing' }
  );

export const resendInvitationSchema = z.object({
  customMessage: z.string().max(500, 'Custom message must be less than 500 characters').optional(),
});

export const revokeInvitationSchema = z.object({
  reason: z.string().max(500, 'Reason must be less than 500 characters').optional(),
});

export const getInvitationsQuerySchema = z.object({
  status: z
    .enum(['draft', 'pending', 'accepted', 'expired', 'revoked', 'sent'], {
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
    .enum(['createdAt', 'inviteeEmail', 'status'], {
      errorMap: () => ({ message: 'Invalid sortBy value' }),
    })
    .optional(),

  sort: z
    .enum(['asc', 'desc'], {
      errorMap: () => ({ message: 'Invalid sortOrder value' }),
    })
    .optional(),
});

export const invitationTokenSchema = z.object({
  token: z.string().min(4, 'Invalid invitation token').max(64, 'Invalid invitation token'),
});

export const iuidSchema = z.object({
  iuid: z.string().min(10, 'Invalid invitation ID').max(255, 'Invalid invitation ID'),
});

export const invitationCsvSchema = z
  .object({
    inviteeEmail: z
      .string()
      .email('Please provide a valid email address')
      .max(255, 'Email must be less than 255 characters'),

    role: z.nativeEnum(IUserRole, {
      errorMap: () => ({ message: 'Please provide a valid role' }),
    }),

    linkedVendorUid: z
      .string()
      .transform((str) => {
        // Handle empty strings
        if (!str || str.trim() === '') {
          return undefined;
        }
        const trimmed = str.trim();
        // Check if valid vendor UID (12 chars with letters, numbers, dashes, underscores) or MongoDB ObjectId (24 hex chars)
        if (!/^[A-Z0-9_-]{12}$/.test(trimmed) && !/^[0-9a-fA-F]{24}$/.test(trimmed)) {
          throw new Error(
            'linkedVendorUid must be a valid vendor UID (12 characters: letters, numbers, dashes, underscores) or MongoDB ObjectId (24 hex characters)'
          );
        }
        return trimmed;
      })
      .optional(),

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
      .max(20, 'Phone number must be less than 20 characters')
      .refine((val) => {
        if (!val) return true; // optional field
        const digitsOnly = val.replace(/\D/g, '');
        return digitsOnly.length >= 10;
      }, 'Phone number must contain at least 10 digits')
      .optional(),

    status: z
      .enum(['draft', 'pending'], {
        errorMap: () => ({ message: 'Status must be either draft or pending' }),
      })
      .default('pending'),

    inviteMessage: z
      .string()
      .max(500, 'Invitation message must be less than 500 characters')
      .optional(),

    expectedStartDate: z
      .string()
      .transform((str) => {
        if (!str || str.trim() === '') {
          return undefined;
        }

        const trimmed = str.trim();
        let parsedDate: Date;

        if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(trimmed)) {
          parsedDate = new Date(trimmed);
        } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
          parsedDate = new Date(trimmed);
        } else {
          parsedDate = new Date(trimmed);
        }

        if (isNaN(parsedDate.getTime())) {
          throw new Error('Please provide a valid date (formats: YYYY-MM-DD, MM/DD/YYYY)');
        }

        return parsedDate;
      })
      .optional(),

    employeeInfo_department: z
      .string()
      .transform((str) => {
        if (!str || str.trim() === '') {
          return undefined;
        }
        const trimmed = str.trim().toLowerCase();
        // Map string values to enum values
        const departmentMap: Record<string, EmployeeDepartment> = {
          maintenance: EmployeeDepartment.MAINTENANCE,
          operations: EmployeeDepartment.OPERATIONS,
          accounting: EmployeeDepartment.ACCOUNTING,
          management: EmployeeDepartment.MANAGEMENT,
        };

        const department = departmentMap[trimmed];
        if (!department) {
          throw new Error(
            `Invalid department. Must be one of: ${Object.keys(departmentMap).join(', ')}`
          );
        }
        return department;
      })
      .optional(),
    employeeInfo_jobTitle: z
      .string()
      .transform((str) => (str && str.trim() !== '' ? str : undefined))
      .optional(),
    employeeInfo_employeeId: z
      .string()
      .transform((str) => (str && str.trim() !== '' ? str : undefined))
      .optional(),
    employeeInfo_reportsTo: z
      .string()
      .transform((str) => (str && str.trim() !== '' ? str : undefined))
      .optional(),
    employeeInfo_startDate: z
      .string()
      .transform((str) => {
        if (!str || str.trim() === '') {
          return undefined;
        }
        const date = new Date(str);
        if (isNaN(date.getTime())) {
          throw new Error('Please provide a valid start date');
        }
        return date;
      })
      .optional(),

    // Vendor Info fields
    vendorInfo_companyName: z
      .string()
      .transform((str) => (str && str.trim() !== '' ? str : undefined))
      .optional(),
    vendorInfo_businessType: z
      .string()
      .transform((str) => (str && str.trim() !== '' ? str : undefined))
      .optional(),
    vendorInfo_taxId: z
      .string()
      .transform((str) => (str && str.trim() !== '' ? str : undefined))
      .optional(),
    vendorInfo_registrationNumber: z
      .string()
      .transform((str) => (str && str.trim() !== '' ? str : undefined))
      .optional(),
    vendorInfo_yearsInBusiness: z
      .string()
      .transform((str) => {
        if (!str || str.trim() === '') return undefined;
        const num = parseInt(str, 10);
        if (isNaN(num) || num < 0 || num > 150) {
          throw new Error('Years in business must be between 0 and 150');
        }
        return num;
      })
      .optional(),
    vendorInfo_contactPerson_name: z
      .string()
      .transform((str) => (str && str.trim() !== '' ? str : undefined))
      .optional(),
    vendorInfo_contactPerson_jobTitle: z
      .string()
      .transform((str) => (str && str.trim() !== '' ? str : undefined))
      .optional(),
    vendorInfo_contactPerson_email: z
      .string()
      .transform((str) => {
        if (!str || str.trim() === '') {
          return undefined;
        }
        // Validate email format
        const trimmed = str.trim();
        const emailSchema = z.string().email();
        const result = emailSchema.safeParse(trimmed);
        if (!result.success) {
          throw new Error('Please provide a valid contact person email');
        }
        return trimmed;
      })
      .optional(),
    vendorInfo_contactPerson_phone: z
      .string()
      .transform((str) => (str && str.trim() !== '' ? str : undefined))
      .optional(),

    cuid: z.string().optional(),
  })
  .transform((data) => {
    // Build employeeInfo if any employee fields are provided
    const employeeInfo =
      data.employeeInfo_department ||
      data.employeeInfo_jobTitle ||
      data.employeeInfo_employeeId ||
      data.employeeInfo_reportsTo ||
      data.employeeInfo_startDate
        ? {
            department: data.employeeInfo_department,
            jobTitle: data.employeeInfo_jobTitle,
            employeeId: data.employeeInfo_employeeId,
            reportsTo: data.employeeInfo_reportsTo,
            startDate: data.employeeInfo_startDate,
          }
        : undefined;

    // Determine if this is a primary vendor (has business data) or team member (linkedVendorUid without business data)
    const isPrimaryVendor = Boolean(data.role === 'vendor' && data.vendorInfo_companyName);
    const isVendorTeamMember = Boolean(
      data.role === 'vendor' && data.linkedVendorUid && !data.vendorInfo_companyName
    );

    // Build vendor data for primary vendor creation
    const vendorEntityData =
      isPrimaryVendor && data.vendorInfo_companyName
        ? {
            companyName: data.vendorInfo_companyName as string,
            businessType: data.vendorInfo_businessType || 'professional_services',
            taxId: data.vendorInfo_taxId,
            registrationNumber: data.vendorInfo_registrationNumber,
            yearsInBusiness: data.vendorInfo_yearsInBusiness || 0,
            contactPerson:
              data.vendorInfo_contactPerson_name || data.vendorInfo_contactPerson_email
                ? {
                    name:
                      data.vendorInfo_contactPerson_name || data.firstName + ' ' + data.lastName,
                    jobTitle: data.vendorInfo_contactPerson_jobTitle || 'Owner',
                    email: data.vendorInfo_contactPerson_email || data.inviteeEmail,
                    phone: data.vendorInfo_contactPerson_phone || data.phoneNumber,
                  }
                : {
                    name: data.firstName + ' ' + data.lastName,
                    jobTitle: 'Owner',
                    email: data.inviteeEmail,
                    phone: data.phoneNumber || '',
                  },
          }
        : undefined;

    // Build legacy vendorInfo for profile references
    const vendorInfo =
      data.role === 'vendor'
        ? {
            isLinkedAccount: Boolean(isVendorTeamMember),
            // For primary vendors, linkedVendorUid will be populated after vendor entity creation
            // For team members, use the CSV linkedVendorUid as a temporary group identifier
            linkedVendorUid: isVendorTeamMember ? data.linkedVendorUid : undefined,
          }
        : undefined;

    return {
      inviteeEmail: data.inviteeEmail,
      role: data.role,
      status: data.status,
      linkedVendorUid: data.linkedVendorUid,
      personalInfo: {
        firstName: data.firstName,
        lastName: data.lastName,
        phoneNumber: data.phoneNumber,
      },
      metadata: {
        inviteMessage: data.inviteMessage,
        expectedStartDate: data.expectedStartDate,
        employeeInfo,
        vendorInfo,
        vendorEntityData, // New field for vendor entity creation
        isPrimaryVendor,
        isVendorTeamMember,
        csvGroupId: data.linkedVendorUid, // CSV group identifier for linking vendors and team members
      },
    };
  });

export const processPendingQuerySchema = z.object({
  timeline: z
    .enum(['24h', '48h', '72h', '7d'], {
      errorMap: () => ({ message: 'Timeline must be one of: 24h, 48h, 72h, 7d' }),
    })
    .optional(),

  role: z
    .nativeEnum(IUserRole, {
      errorMap: () => ({ message: 'Invalid role value' }),
    })
    .optional(),

  limit: z
    .string()
    .regex(/^\d+$/, 'Limit must be a positive number')
    .transform((str) => parseInt(str, 10))
    .refine((num) => num > 0 && num <= 100, 'Limit must be between 1 and 100')
    .optional(),

  dry_run: z
    .string()
    .transform((str) => str.toLowerCase() === 'true')
    .optional(),
});

export const bulkCreationQuerySchema = z.object({
  mode: z
    .enum(['invite', 'bulk_create'], {
      errorMap: () => ({ message: 'Mode must be either invite or bulk_create' }),
    })
    .default('invite'),

  send_notifications: z
    .string()
    .optional()
    .default('false')
    .transform((str) => str.toLowerCase() === 'true'),

  password_length: z
    .string()
    .regex(/^\d+$/, 'Password length must be a positive number')
    .optional()
    .default('12')
    .transform((str) => parseInt(str, 10))
    .refine((num) => num >= 8 && num <= 20, 'Password length must be between 8 and 20'),
});
