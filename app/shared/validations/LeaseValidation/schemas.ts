import { z } from 'zod';
import { Types } from 'mongoose';
import { UserDAO } from '@dao/userDAO';
import { PropertyDAO } from '@dao/propertyDAO';

import { getContainer } from '../UtilsValidation';

export const isValidProperty = async (propertyId: string, cuid: string) => {
  try {
    if (!propertyId || !Types.ObjectId.isValid(propertyId)) {
      return false;
    }

    const { propertyDAO }: { propertyDAO: PropertyDAO } = (await getContainer()).cradle;
    const property = await propertyDAO.findFirst({
      _id: new Types.ObjectId(propertyId),
      cuid,
      deletedAt: null,
    });

    return !!property;
  } catch (error) {
    console.error('Error validating property:', error);
    return false;
  }
};

export const isValidTenant = async (tenantId: string, cuid: string) => {
  try {
    if (!tenantId || !Types.ObjectId.isValid(tenantId)) {
      return false;
    }

    const { userDAO }: { userDAO: UserDAO } = (await getContainer()).cradle;
    const user = await userDAO.findFirst({
      _id: new Types.ObjectId(tenantId),
      activecuid: cuid,
      deletedAt: null,
    });

    if (!user) {
      return false;
    }

    // Verify user has 'tenant' role for this client
    const clientAccess = user.cuids.find((c: any) => c.cuid === cuid);
    return clientAccess && clientAccess.roles.includes('tenant');
  } catch (error) {
    console.error('Error validating tenant:', error);
    return false;
  }
};

// Enum Schemas
export const LeaseStatusEnum = z.enum([
  'draft',
  'pending_signature',
  'active',
  'expired',
  'terminated',
  'cancelled',
]);

export const LeaseTypeEnum = z.enum(['fixed_term', 'month_to_month']);

export const SigningMethodEnum = z.enum(['electronic', 'manual', 'pending']);

export const PaymentMethodEnum = z.enum(['e-transfer', 'credit_card', 'crypto']);

export const UtilityEnum = z.enum([
  'water',
  'gas',
  'electricity',
  'internet',
  'cable',
  'trash',
  'sewer',
  'heating',
  'cooling',
]);

export const SignatureRoleEnum = z.enum(['tenant', 'co_tenant', 'landlord', 'property_manager']);

export const SignatureActionEnum = z.enum(['send', 'manual', 'cancel']);

export const ESignatureProviderEnum = z.enum(['hellosign', 'boldsign', 'docusign', 'pandadoc']);

export const ESignatureStatusEnum = z.enum(['draft', 'sent', 'signed', 'declined', 'voided']);

// Nested Object Schemas
export const LeaseFeesSchema = z.object({
  monthlyRent: z.coerce.number().positive('Monthly rent must be a positive number'),
  currency: z.string().length(3, 'Currency must be a 3-letter code').default('USD'),
  rentDueDay: z.coerce.number().int().min(1, 'Rent due day must be between 1-31').max(31),
  securityDeposit: z.coerce.number().min(0, 'Security deposit must be non-negative'),
  lateFeeAmount: z.number().min(0, 'Late fee amount must be non-negative').optional(),
  lateFeeDays: z.number().int().min(1, 'Late fee days must be at least 1').optional(),
  lateFeeType: z.enum(['fixed', 'percentage']).optional(),
  lateFeePercentage: z
    .number()
    .min(0, 'Late fee percentage must be non-negative')
    .max(100, 'Late fee percentage cannot exceed 100')
    .optional(),
  acceptedPaymentMethod: PaymentMethodEnum.optional(),
});

export const LeaseDurationSchema = z.object({
  startDate: z.coerce.date({
    errorMap: () => ({ message: 'Start date must be a valid date' }),
  }),
  endDate: z.coerce.date({
    errorMap: () => ({ message: 'End date must be a valid date' }),
  }),
  moveInDate: z.coerce
    .date({
      errorMap: () => ({ message: 'Move-in date must be a valid date' }),
    })
    .optional(),
  moveOutDate: z.coerce
    .date({
      errorMap: () => ({ message: 'Move-out date must be a valid date' }),
    })
    .optional(),
  terminationDate: z.coerce
    .date({
      errorMap: () => ({ message: 'Termination date must be a valid date' }),
    })
    .optional(),
});

export const LeasePropertySchema = z.object({
  id: z.string().min(1, 'Property ID is required'),
  address: z.string().min(5, 'Property address must be at least 5 characters').optional(),
  unitId: z.string().optional(),
});

export const CoTenantSchema = z.object({
  name: z.string().min(2, 'Co-tenant name must be at least 2 characters'),
  email: z.string().email('Invalid email format'),
  phone: z.string().min(10, 'Phone number must be at least 10 characters'),
  occupation: z.string().optional(),
});

export const PetPolicySchema = z.object({
  allowed: z.boolean().default(false),
  types: z.array(z.string()).optional(),
  maxPets: z.number().int().min(0).optional(),
  deposit: z.number().min(0, 'Pet deposit must be non-negative').optional(),
  monthlyFee: z.number().min(0, 'Pet monthly fee must be non-negative').optional(),
});

export const RenewalOptionsSchema = z.object({
  autoRenew: z.boolean().default(false),
  noticePeriodDays: z.number().int().min(1, 'Notice period must be at least 1 day').optional(),
  renewalTermMonths: z.number().int().min(1, 'Renewal term must be at least 1 month').optional(),
});

export const LegalTermsSchema = z.object({
  text: z.string().max(10000, 'Legal terms text must be at most 10000 characters').optional(),
  html: z.string().max(15000, 'Legal terms HTML must be at most 15000 characters').optional(),
  url: z.string().url('Invalid URL format for legal terms').optional(),
});

export const TenantInfoSchema = z.object({
  id: z.string().min(1, 'Tenant ID must be provided').nullable().optional(),
  email: z.string().email('Invalid email format').nullable().optional(),
});

export const LeaseDocumentItemSchema = z.object({
  documentType: z
    .enum(['lease_agreement', 'addendum', 'amendment', 'renewal', 'termination', 'other'])
    .optional(),
  filename: z.string().min(1, 'Filename is required'),
  url: z.string().url('Document URL must be valid'),
  key: z.string().min(1, 'Document key is required'),
  mimeType: z.string().optional(),
  size: z.number().int().positive('File size must be positive').optional(),
  uploadedBy: z.string().optional(),
  uploadedAt: z.coerce.date().optional(),
});

// E-Signature Schema
export const ESignatureSchema = z.object({
  provider: ESignatureProviderEnum.optional(),
  envelopeId: z.string().optional(),
  status: ESignatureStatusEnum.optional(),
  sentAt: z.coerce.date().optional(),
  completedAt: z.coerce.date().optional(),
  signingUrl: z.string().url('Signing URL must be valid').optional(),
  declinedReason: z.string().max(500, 'Declined reason must be at most 500 characters').optional(),
});

const BaseLeaseSchemaObject = z.object({
  cuid: z.string().min(1, 'Client ID is required'),
  tenantInfo: TenantInfoSchema,
  property: LeasePropertySchema,
  duration: LeaseDurationSchema,
  fees: LeaseFeesSchema,
  type: LeaseTypeEnum,
  signingMethod: SigningMethodEnum.optional(),
  eSignature: ESignatureSchema.optional(),
  utilitiesIncluded: z.array(UtilityEnum).optional(),
  coTenants: z.array(CoTenantSchema).optional(),
  petPolicy: PetPolicySchema.optional(),
  renewalOptions: RenewalOptionsSchema.optional(),
  legalTerms: LegalTermsSchema.optional(),
  internalNotes: z.string().max(2000, 'Internal notes must be at most 2000 characters').optional(),
  leaseDocument: z.array(LeaseDocumentItemSchema).optional(),
});

export const CreateLeaseSchema = BaseLeaseSchemaObject.omit({ cuid: true })
  .refine(
    (data) => {
      return (
        (data.tenantInfo.id && data.tenantInfo.id.trim() !== '') ||
        (data.tenantInfo.email && data.tenantInfo.email.trim() !== '')
      );
    },
    {
      message: 'Either tenant ID or email is required',
      path: ['tenantInfo'],
    }
  )
  .refine(
    (data) => {
      const start = new Date(data.duration.startDate);
      const end = new Date(data.duration.endDate);
      return end > start;
    },
    {
      message: 'End date must be after start date',
      path: ['duration', 'endDate'],
    }
  )
  .refine(
    (data) => {
      if (data.duration.moveInDate) {
        const start = new Date(data.duration.startDate);
        const moveIn = new Date(data.duration.moveInDate);
        return moveIn >= start;
      }
      return true;
    },
    {
      message: 'Move-in date cannot be before start date',
      path: ['duration', 'moveInDate'],
    }
  );

export const UpdateLeaseSchema = BaseLeaseSchemaObject.partial()
  .omit({ cuid: true, tenantInfo: true })
  .extend({
    status: LeaseStatusEnum.optional(),
  })
  .refine(
    (data) => {
      if (data.duration?.startDate && data.duration?.endDate) {
        const start = new Date(data.duration.startDate);
        const end = new Date(data.duration.endDate);
        return end > start;
      }
      return true;
    },
    {
      message: 'End date must be after start date',
      path: ['duration', 'endDate'],
    }
  )
  .refine(
    (data) => {
      if (data.duration?.moveInDate && data.duration?.startDate) {
        const start = new Date(data.duration.startDate);
        const moveIn = new Date(data.duration.moveInDate);
        return moveIn >= start;
      }
      return true;
    },
    {
      message: 'Move-in date cannot be before start date',
      path: ['duration', 'moveInDate'],
    }
  );

export const FilterLeasesSchema = z.object({
  filter: z
    .object({
      status: z.string().optional(),
      cuid: z.string().optional(),
      search: z.string().max(100, 'Search term must be less than 100 characters').optional(),
    })
    .optional(),
  pagination: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
      order: z.string().optional(),
      sortBy: z.string().optional(),
    })
    .optional(),
  meta: z
    .object({
      includeFormattedData: z
        .union([z.boolean(), z.string().transform((val) => val === 'true')])
        .optional(),
    })
    .optional(),
});

// Activate Lease Schema
export const ActivateLeaseSchema = z.object({
  moveInDate: z.coerce
    .date({
      errorMap: () => ({ message: 'Move-in date must be a valid date' }),
    })
    .optional(),
  signedDate: z.coerce
    .date({
      errorMap: () => ({ message: 'Signed date must be a valid date' }),
    })
    .optional(),
  notes: z.string().max(500, 'Notes must be at most 500 characters').optional(),
});

// Terminate Lease Schema
export const TerminateLeaseSchema = z
  .object({
    terminationDate: z.coerce.date({
      errorMap: () => ({ message: 'Termination date must be a valid date' }),
    }),
    moveOutDate: z.coerce
      .date({
        errorMap: () => ({ message: 'Move-out date must be a valid date' }),
      })
      .optional(),
    terminationReason: z
      .string()
      .min(10, 'Termination reason must be at least 10 characters')
      .max(500, 'Termination reason must be at most 500 characters'),
    notes: z.string().max(1000, 'Notes must be at most 1000 characters').optional(),
  })
  .refine(
    (data) => {
      if (data.moveOutDate) {
        const termination = new Date(data.terminationDate);
        const moveOut = new Date(data.moveOutDate);
        return moveOut >= termination;
      }
      return true;
    },
    {
      message: 'Move-out date cannot be before termination date',
      path: ['moveOutDate'],
    }
  );

// Signature Action Schema
export const SignatureActionSchema = z
  .object({
    action: SignatureActionEnum,
    signers: z
      .array(
        z.object({
          name: z.string().min(2, 'Signer name must be at least 2 characters'),
          email: z.string().email('Invalid email format'),
          role: SignatureRoleEnum,
          order: z.number().int().min(1).optional(),
        })
      )
      .optional(),
    signedBy: z
      .array(
        z.object({
          userId: z.string().min(1, 'User ID is required'),
          name: z.string().min(2, 'Name must be at least 2 characters'),
          role: SignatureRoleEnum,
          signedAt: z.coerce
            .date()
            .optional()
            .default(() => new Date()),
        })
      )
      .optional(),
    provider: ESignatureProviderEnum.optional().default('boldsign'),
    message: z.string().max(500, 'Message must be at most 500 characters').optional(),
    testMode: z.boolean().optional().default(false),
  })
  .refine(
    (data) => {
      if (data.action === 'send' && (!data.signers || data.signers.length === 0)) {
        return false;
      }
      return true;
    },
    {
      message: 'Signers are required when action is "send"',
      path: ['signers'],
    }
  )
  .refine(
    (data) => {
      if (data.action === 'manual' && (!data.signedBy || data.signedBy.length === 0)) {
        return false;
      }
      return true;
    },
    {
      message: 'SignedBy is required when action is "manual"',
      path: ['signedBy'],
    }
  );

export const ExpiringLeasesQuerySchema = z.object({
  daysThreshold: z.coerce.number().int().min(1).max(365).default(30),
  status: z.array(LeaseStatusEnum).optional(),
  propertyId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const LeaseStatsQuerySchema = z.object({
  propertyId: z.string().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

export const ExportLeasesQuerySchema = z.object({
  format: z.enum(['csv', 'excel']).default('csv'),
  status: z.array(LeaseStatusEnum).optional(),
  propertyId: z.string().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

// Lease Preview Schema - All fields optional since this is for preview only
export const LeasePreviewSchema = z.object({
  // Template Selection
  templateType: z
    .enum([
      'residential-single-family',
      'residential-apartment',
      'commercial-office',
      'commercial-retail',
      'short-term-rental',
    ])
    .optional(),
  leaseNumber: z.string().optional(),
  currentDate: z.string().optional(),
  jurisdiction: z.string().optional(),
  signedDate: z.string().optional(),
  landlordName: z.string().optional(),
  landlordAddress: z.string().optional(),
  landlordEmail: z.string().email('Invalid landlord email').optional().or(z.literal('')),
  landlordPhone: z.string().optional(),
  tenantName: z.string().optional(),
  tenantEmail: z.string().email('Invalid tenant email').optional().or(z.literal('')),
  tenantPhone: z.string().optional(),
  coTenants: z
    .array(
      z.object({
        name: z.string(),
        email: z.string().email('Invalid co-tenant email'),
        phone: z.string(),
        occupation: z.string().optional(),
      })
    )
    .optional(),
  propertyAddress: z.string().optional(),
  leaseType: z.string().optional(),
  startDate: z.union([z.string(), z.coerce.date()]).optional(),
  endDate: z.union([z.string(), z.coerce.date()]).optional(),
  monthlyRent: z.number().min(0).optional(),
  securityDeposit: z.number().min(0).optional(),
  rentDueDay: z.number().int().min(1).max(31).optional(),
  currency: z.string().length(3).optional(),
  petPolicy: z
    .object({
      allowed: z.boolean(),
      maxPets: z.number().int().min(1).optional(),
      types: z.union([z.string(), z.array(z.string())]).optional(),
      deposit: z.number().min(0).optional(),
    })
    .optional(),
  renewalOptions: z
    .object({
      autoRenew: z.boolean(),
      renewalTermMonths: z.number().int().min(1).optional(),
      noticePeriodDays: z.number().int().min(1).optional(),
    })
    .optional(),
  legalTerms: z
    .object({
      html: z.string().optional(),
      text: z.string().optional(),
    })
    .optional(),
  utilitiesIncluded: z.union([z.string(), z.array(z.string())]).optional(),

  signingMethod: z.enum(['electronic', 'manual', 'pending']).optional(),
  landlordSignatureUrl: z
    .string()
    .url('Invalid landlord signature URL')
    .optional()
    .or(z.literal('')),
  tenantSignatureUrl: z.string().url('Invalid tenant signature URL').optional().or(z.literal('')),
  requiresNotarization: z.boolean().optional(),
});

export const GetLeaseByIdQuerySchema = z.object({
  include: z
    .union([
      z.enum(['payments', 'documents', 'activity', 'timeline', 'all']),
      z.array(z.enum(['payments', 'documents', 'activity', 'timeline', 'all'])),
      z
        .string()
        .transform((val) => val.split(',').map((item) => item.trim()))
        .pipe(z.array(z.enum(['payments', 'documents', 'activity', 'timeline', 'all']))),
    ])
    .optional(),
});

export const LeaseIdParamSchema = z.object({
  leaseId: z.string().refine((id) => Types.ObjectId.isValid(id), {
    message: 'Invalid lease ID format',
  }),
});
