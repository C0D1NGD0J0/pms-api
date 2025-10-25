import { z } from 'zod';

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

export const PaymentMethodEnum = z.enum([
  'bank_transfer',
  'credit_card',
  'debit_card',
  'mobile_payment',
  'check',
  'cash',
]);

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
  monthlyRent: z.number().positive('Monthly rent must be a positive number'),
  currency: z.string().length(3, 'Currency must be a 3-letter code').default('USD'),
  rentDueDay: z.number().int().min(1, 'Rent due day must be between 1-31').max(31),
  securityDeposit: z.number().min(0, 'Security deposit must be non-negative'),
  lateFeeAmount: z.number().min(0, 'Late fee amount must be non-negative').optional(),
  lateFeeDays: z.number().int().min(1, 'Late fee days must be at least 1').optional(),
  lateFeeType: z.enum(['fixed', 'percentage']).optional(),
  lateFeePercentage: z
    .number()
    .min(0, 'Late fee percentage must be non-negative')
    .max(100, 'Late fee percentage cannot exceed 100')
    .optional(),
  acceptedPaymentMethods: z.array(PaymentMethodEnum).optional(),
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
  address: z.string().min(5, 'Property address must be at least 5 characters'),
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

// Base Lease Schema Object (without refinements)
const BaseLeaseSchemaObject = z.object({
  cuid: z.string().min(1, 'Client ID is required'),
  tenantId: z.string().min(1, 'Tenant ID is required'),
  propertyId: z.string().min(1, 'Property ID is required'),
  unitId: z.string().optional(),
  propertyAddress: z.string().min(5, 'Property address is required'),
  leaseNumber: z.string().min(1, 'Lease number is required'),
  type: LeaseTypeEnum,
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
  monthlyRent: z.number().positive('Monthly rent must be a positive number'),
  currency: z.string().length(3, 'Currency must be a 3-letter code').default('USD'),
  rentDueDay: z.number().int().min(1).max(31),
  securityDeposit: z.number().min(0, 'Security deposit must be non-negative'),
  lateFeeAmount: z.number().min(0).optional(),
  lateFeeDays: z.number().int().min(1).optional(),
  lateFeeType: z.enum(['fixed', 'percentage']).optional(),
  lateFeePercentage: z.number().min(0).max(100).optional(),
  acceptedPaymentMethods: z.array(PaymentMethodEnum).optional(),
  utilitiesIncluded: z.array(UtilityEnum).optional(),
  coTenants: z.array(CoTenantSchema).optional(),
  petPolicy: PetPolicySchema.optional(),
  renewalOptions: RenewalOptionsSchema.optional(),
  legalTerms: LegalTermsSchema.optional(),
  internalNotes: z.string().max(2000, 'Internal notes must be at most 2000 characters').optional(),
});

// Create Lease Schema - Base object with refinements
export const CreateLeaseSchema = BaseLeaseSchemaObject.refine(
  (data) => {
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    return end > start;
  },
  {
    message: 'End date must be after start date',
    path: ['endDate'],
  }
).refine(
  (data) => {
    if (data.moveInDate) {
      const start = new Date(data.startDate);
      const moveIn = new Date(data.moveInDate);
      return moveIn >= start;
    }
    return true;
  },
  {
    message: 'Move-in date cannot be before start date',
    path: ['moveInDate'],
  }
);

// Update Lease Schema - Apply transformations to base object, then add refinements
export const UpdateLeaseSchema = BaseLeaseSchemaObject.partial()
  .omit({ cuid: true, tenantId: true })
  .extend({
    status: LeaseStatusEnum.optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        const start = new Date(data.startDate);
        const end = new Date(data.endDate);
        return end > start;
      }
      return true;
    },
    {
      message: 'End date must be after start date',
      path: ['endDate'],
    }
  )
  .refine(
    (data) => {
      if (data.moveInDate && data.startDate) {
        const start = new Date(data.startDate);
        const moveIn = new Date(data.moveInDate);
        return moveIn >= start;
      }
      return true;
    },
    {
      message: 'Move-in date cannot be before start date',
      path: ['moveInDate'],
    }
  );

export const FilterLeasesSchema = z.object({
  status: z.union([LeaseStatusEnum, z.array(LeaseStatusEnum)]).optional(),
  type: z.union([LeaseTypeEnum, z.array(LeaseTypeEnum)]).optional(),
  signingMethod: SigningMethodEnum.optional(),
  propertyId: z.string().optional(),
  unitId: z.string().optional(),
  tenantId: z.string().optional(),
  isExpiringSoon: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => (typeof val === 'string' ? val === 'true' : val)),
  startDateFrom: z.coerce.date().optional(),
  startDateTo: z.coerce.date().optional(),
  endDateFrom: z.coerce.date().optional(),
  endDateTo: z.coerce.date().optional(),
  createdAfter: z.coerce.date().optional(),
  createdBefore: z.coerce.date().optional(),
  minRent: z.coerce.number().positive().optional(),
  maxRent: z.coerce.number().positive().optional(),
  search: z.string().max(100, 'Search term must be less than 100 characters').optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
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

// Expiring Leases Query Schema
export const ExpiringLeasesQuerySchema = z.object({
  daysThreshold: z.coerce.number().int().min(1).max(365).default(30),
  status: z.array(LeaseStatusEnum).optional(),
  propertyId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

// Lease Stats Query Schema
export const LeaseStatsQuerySchema = z.object({
  propertyId: z.string().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

// Export Leases Query Schema
export const ExportLeasesQuerySchema = z.object({
  format: z.enum(['csv', 'excel']).default('csv'),
  status: z.array(LeaseStatusEnum).optional(),
  propertyId: z.string().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});
