import { z } from 'zod';
import dayjs from 'dayjs';
import { User } from '@models/index';
import { isValidPhoneNumber, isValidLocation } from '@utils/index';
import { IUserRelationshipsEnum } from '@interfaces/user.interface';
import { ROLE_VALIDATION } from '@shared/constants/roles.constants';

const isUniqueEmail = async (value: string) => {
  try {
    const existingUser = await User.findOne({
      email: value,
    });

    if (existingUser) {
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error checking email uniqueness', error);
    if (error instanceof Error && error.message.includes('buffering timed out')) {
      throw new Error('Database connection timeout. Please try again.');
    }
    return false;
  }
};

export const UserSignupSchema = z
  .object({
    firstName: z
      .string()
      .min(2, 'First name must be at least 2 characters')
      .max(25, 'First name must be at most 25 characters'),
    lastName: z
      .string()
      .min(2, 'Last name must be at least 2 characters')
      .max(25, 'Last name must be at most 25 characters'),
    email: z
      .string()
      .email('Invalid email address')
      .refine(
        async (email) => {
          const isUsed = await isUniqueEmail(email);
          return isUsed;
        },
        { message: 'Email already in use.' }
      ),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(15, 'Password must be less than 15 characters')
      .regex(
        /^(?=.*[A-Z])(?=.*\d)[A-Za-z\d@$!%*?&]/,
        'Password must contain at least one uppercase letter, and one number'
      ),
    location: z
      .string()
      .min(2, 'Location must be at least 2 characters')
      .max(100, 'Location must be at most 100 characters')
      .refine((location) => isValidLocation(location), {
        message: 'Please enter a valid city or country',
      }),
    phoneNumber: z.string().optional(),
    accountType: z
      .object({
        planId: z.string(),
        lookUpKey: z.string().optional(),
        isEnterpriseAccount: z.boolean(),
        planName: z.enum(['starter', 'personal', 'professional'], {
          message: 'Invalid plan name provided.',
        }),
        billingInterval: z.enum(['monthly', 'annual'], {
          message: 'Invalid billing interval. Must be either monthly or annual',
        }),
      })
      .refine(
        (data) => {
          // Starter plan (free) doesn't need a valid Stripe price ID
          if (data.planName === 'starter') {
            return true;
          }
          // Paid plans must have a valid Stripe price ID
          return /^price_[a-zA-Z0-9]{14,}$/.test(data.planId);
        },
        {
          message: 'Invalid Stripe price ID format for paid plan. Must follow pattern: price_xxxxx',
          path: ['planId'],
        }
      ),
    cpassword: z.string().min(8, 'Confirm password must be at least 8 characters'),
    lang: z.string().optional(),
    timeZone: z.string().optional(),
    companyProfile: z
      .object({
        website: z.string().url('Invalid URL provided.').optional().or(z.literal('')),
        tradingName: z.string().min(2, 'Company name is required'),
        companyEmail: z.string().email('Invalid company email').optional(),
        companyPhone: z
          .string()
          .optional()
          .refine(
            (val) => {
              if (!val) return true; // Allow empty
              return isValidPhoneNumber(val);
            },
            { message: 'Invalid company phone number' }
          ),
        legalEntityName: z.string().min(2, 'Legal entity name is required'),
        contactInfo: z
          .object({
            email: z.string().email('Invalid company email'),
            address: z.string().min(1, 'Company address is required'),
            phoneNumber: z.string().min(1, 'Company phone number is required'),
            contactPerson: z.string().min(1, 'Contact person is required'),
          })
          .optional(),
        registrationNumber: z.string().min(1, 'Business registration number is required'),
        identification: z
          .object({
            idType: z.enum(['passport', 'national-id', 'drivers-license', 'corporation-license']),
            idNumber: z.string().min(1, 'ID number is required'),
            authority: z.string().min(1, 'Issuing authority is required'),
            issueDate: z.string().or(z.date()),
            expiryDate: z.string().or(z.date()),
            issuingState: z.string().min(1, 'Issuing state is required'),
          })
          .optional(),
      })
      .partial()
      .optional(),
  })
  .superRefine((data, ctx) => {
    // Make company information required for business accounts
    if (data.accountType.isEnterpriseAccount) {
      if (!data.companyProfile) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Company profile is required for business accounts',
          path: ['companyProfile'],
        });
        return;
      }

      // Validate company profile fields for business accounts
      if (!data.companyProfile.tradingName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Company name is required for business accounts',
          path: ['companyProfile', 'companyName'],
        });
      }

      if (!data.companyProfile.legalEntityName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Legal entity name is required for business accounts',
          path: ['companyProfile', 'legalEntityName'],
        });
      }
    }
    if (data.password !== data.cpassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Passwords do not match',
      });
    }
  });

export const InviteUserSignupSchema = z.object({
  cuid: z.string(),
  firstName: z.string().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().min(2, 'Last name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  phoneNumber: z.string().optional(),
  location: z.string().optional(),
  userType: z.enum(ROLE_VALIDATION.ALL_ROLES),
  emergencyContact: z
    .object({
      name: z.string(),
      email: z.string().email('Invalid emergency contact email').optional(),
      phoneNumber: z.string(),
      relationship: z.enum(Object.values(IUserRelationshipsEnum) as [string, ...string[]]),
    })
    .optional(),
});

export const ClientUpdateSchema = z.object({
  companyName: z.string(),
  legalEntityName: z.string(),
  contactInfo: z
    .object({
      email: z.string().email('Invalid company email'),
      address: z.string(),
      phoneNumber: z.string(),
      contactPerson: z.string(),
    })
    .optional(),
  businessRegistrationNumber: z.string(),
  identification: z
    .object({
      idType: z.enum(['passport', 'national-id', 'drivers-license', 'corporation-license']),
      idNumber: z.string(),
      authority: z.string(),
      issueDate: z.string().or(z.date()),
      expiryDate: z.string().or(z.date()),
      issuingState: z.string(),
    })
    .optional(),
  userId: z.string().optional(),
  admin: z.string().optional(),
  subscription: z.string().optional(),
});

export const AccountActivationSchema = z.object({
  t: z
    .string()
    .max(64, {
      message: 'Invalid token provided',
    })
    .refine(
      async (token: string) => {
        try {
          const user = await User.findOne({ activationToken: token });
          if (!user || dayjs().isAfter(dayjs(user.activationTokenExpiresAt))) {
            return false;
          }
          return true;
        } catch (error) {
          console.error('Error validating activation token', error);
          return false;
        }
      },
      {
        message: 'Token is invalid or has expired',
      }
    ),
});

export const ForgotPasswordSchema = z.object({
  email: z
    .string({ message: "Email can't be blank" })
    .email({ message: 'Invalid email format.' })
    .refine(
      async (email) => {
        try {
          const user = await User.findOne({ email });
          if (!user) {
            return false;
          }
          return true;
        } catch (error) {
          console.error('Error validating forgot password email', error);
          return false;
        }
      },
      {
        message: 'Invalid email address provided.',
      }
    ),
});

export const ResendActivationSchema = z.object({
  email: z
    .string({ message: "Email can't be blank" })
    .email({ message: 'Invalid email format.' })
    .refine(
      async (email) => {
        try {
          const user = await User.findOne({ email, isActive: false });
          if (!user) {
            return false;
          }
          return true;
        } catch (error) {
          console.error('Error validating resend activation email', error);
          return false;
        }
      },
      {
        message: 'Invalid email address provided.',
      }
    ),
});

export const ResetPasswordSchema = z.object({
  resetToken: z.string({ message: 'Invalid url, token missing.' }).refine(
    async (token) => {
      try {
        const user = await User.findOne({
          passwordResetToken: token,
          passwordResetTokenExpiresAt: { $gt: new Date() },
        });
        if (!user) {
          return false;
        }
        return true;
      } catch (error) {
        console.error('Error validating password reset token', error);
        return false;
      }
    },
    {
      message: 'Password reset token is invalid or has expired',
    }
  ),
  password: z
    .string()
    .nonempty({ message: "Password field can't be blank" })
    .min(6, { message: 'Password must be at least 6 characters long.' })
    .max(15, { message: 'Password must be no longer than 15 characters.' }),
});

export const LoginSchema = z.object({
  email: z
    .string({ message: "Email field can't be blank." })
    .email({ message: 'Invalid email format.' }),
  password: z
    .string({ message: "Password field can't be blank." })
    .min(6, { message: 'Password must be at least 6 characters long.' })
    .max(20, { message: 'Invalid password value provided.' }),
  rememberMe: z.boolean().optional(),
});

export const TenantSchema = z.object({
  cuid: z.string(),
  user: z.string(),
  managedBy: z.string(),
  activationCode: z.string().optional(),
  rentalHistory: z.array(z.string()).optional(),
  paymentRecords: z.array(z.string()).optional(),
  leaseAgreements: z.array(z.string()).optional(),
  activeLeaseAgreement: z.string().optional(),
  maintenanceRequests: z.array(z.string()).optional(),
});

export const ClientSchema = z.object({
  admin: z.string(),
  accountType: z.object({
    planId: z.string(),
    name: z.string(),
    isEnterpriseAccount: z.boolean(),
  }),
  subscription: z.string().nullable(),
  enterpriseProfile: z
    .object({
      companyName: z.string(),
      legalEntityName: z.string(),
      contactInfo: z
        .object({
          email: z.string().email('Invalid company email'),
          address: z.string(),
          phoneNumber: z.string(),
          contactPerson: z.string(),
        })
        .optional(),
      businessRegistrationNumber: z.string(),
      identification: z
        .object({
          idType: z.enum(['passport', 'national-id', 'drivers-license', 'corporation-license']),
          idNumber: z.string(),
          authority: z.string(),
          issueDate: z.string().or(z.date()),
          expiryDate: z.string().or(z.date()),
          issuingState: z.string(),
        })
        .optional(),
    })
    .optional(),
});
