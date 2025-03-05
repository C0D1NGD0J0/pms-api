import { z } from 'zod';
import dayjs from 'dayjs';
import { User } from '@models/index';
import { IUserRelationshipsEnum } from '@interfaces/user.interface';

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
    return false;
  }
};

export const UserSignupSchema = z.object({
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
  password: z.string().min(6, 'Password must be at least 6 characters'),
  location: z.string().max(35, 'Location must be at most 35 characters').optional(),
  phoneNumber: z.string().optional(),
  emergencyContact: z
    .object({
      name: z.string(),
      email: z.string().email('Invalid emergency contact email').optional(),
      phoneNumber: z.string(),
      relationship: z.enum(Object.values(IUserRelationshipsEnum) as [string, ...string[]]),
    })
    .optional(),
  accountType: z.object({
    planId: z.string(),
    name: z.string(),
    isEnterpriseAccount: z.boolean(),
  }),
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

export const InviteUserSignupSchema = z.object({
  cid: z.string(),
  firstName: z.string().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().min(2, 'Last name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  phoneNumber: z.string().optional(),
  location: z.string().optional(),
  userType: z.enum(['admin', 'tenant', 'manager', 'employee']),
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
  token: z
    .string()
    .length(64, {
      message: 'Invalid token provided',
    })
    .refine(
      async (token: string) => {
        const user = await User.findOne({ activationToken: token });
        if (!user || dayjs().isAfter(dayjs(user.activationTokenExpiresAt))) {
          return false;
        }
        return true;
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
        const user = await User.findOne({ email });
        if (!user) {
          return false;
        }
        return true;
      },
      {
        message: 'No account found with this email address',
      }
    ),
});

export const ResetPasswordSchema = z.object({
  resetToken: z.string({ message: 'Invalid url, token missing.' }).refine(
    async (token) => {
      const user = await User.findOne({
        passwordResetToken: token,
        passwordResetTokenExpiresAt: { $gt: new Date() },
      });
      if (!user) {
        return false;
      }
      return true;
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
});

export const TenantSchema = z.object({
  cid: z.string(),
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
