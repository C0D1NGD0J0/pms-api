import { z } from 'zod';
import { IUserRole } from '@interfaces/user.interface';

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
  token: z.string().min(10, 'Invalid invitation token').max(255, 'Invalid invitation token'),
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
      .transform((str) => (str && str.trim() !== '' ? str : undefined))
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
        const emailSchema = z.string().email();
        const result = emailSchema.safeParse(str);
        if (!result.success) {
          throw new Error('Please provide a valid contact person email');
        }
        return str;
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

    // Build vendorInfo if any vendor fields are provided
    const vendorInfo =
      data.vendorInfo_companyName ||
      data.vendorInfo_businessType ||
      data.vendorInfo_taxId ||
      data.vendorInfo_registrationNumber ||
      data.vendorInfo_yearsInBusiness ||
      data.vendorInfo_contactPerson_name ||
      data.vendorInfo_contactPerson_jobTitle ||
      data.vendorInfo_contactPerson_email ||
      data.vendorInfo_contactPerson_phone
        ? {
            companyName: data.vendorInfo_companyName,
            businessType: data.vendorInfo_businessType,
            taxId: data.vendorInfo_taxId,
            registrationNumber: data.vendorInfo_registrationNumber,
            yearsInBusiness: data.vendorInfo_yearsInBusiness,
            contactPerson:
              data.vendorInfo_contactPerson_name || data.vendorInfo_contactPerson_jobTitle
                ? {
                    name: data.vendorInfo_contactPerson_name || '',
                    jobTitle: data.vendorInfo_contactPerson_jobTitle || '',
                    email: data.vendorInfo_contactPerson_email,
                    phone: data.vendorInfo_contactPerson_phone,
                  }
                : undefined,
          }
        : undefined;

    return {
      inviteeEmail: data.inviteeEmail,
      role: data.role,
      status: data.status,
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
