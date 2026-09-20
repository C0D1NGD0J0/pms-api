/**
 * OpenAPI Response Schemas
 *
 * Thin Zod schemas describing the `data` field of API responses.
 * Mirrors the existing TypeScript interfaces in @interfaces/ and reuses
 * enum values from the codebase. Uses .passthrough() so undocumented
 * fields don't break validation.
 */
import { z } from 'zod';

// ─── Shared / Reusable ────────────────────────────────────────────────

export const PaginationMetaSchema = z
  .object({
    total: z.number(),
    perPage: z.number(),
    totalPages: z.number(),
    currentPage: z.number(),
    hasMoreResource: z.boolean(),
  })
  .openapi('PaginationMeta');

export const AddressSchema = z
  .object({
    street: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    postCode: z.string().optional(),
    fullAddress: z.string().optional(),
  })
  .passthrough()
  .openapi('Address');

export const DescriptionSchema = z
  .object({
    text: z.string(),
    html: z.string().optional(),
  })
  .openapi('Description');

export const MediaSchema = z
  .object({
    url: z.string(),
    key: z.string().optional(),
    filename: z.string().optional(),
    uploadedAt: z.string().optional(),
  })
  .passthrough()
  .openapi('Media');

// ─── Properties ───────────────────────────────────────────────────────

const propertyTypes = [
  'apartment',
  'house',
  'condominium',
  'townhouse',
  'commercial',
  'industrial',
] as const;
const operationalStatuses = ['available', 'maintenance', 'construction', 'inactive'] as const;
const occupancyStatuses = ['vacant', 'occupied', 'partially_occupied'] as const;

export const PropertySummarySchema = z
  .object({
    pid: z.string(),
    name: z.string(),
    propertyType: z.enum(propertyTypes),
    operationalStatus: z.enum(operationalStatuses),
    occupancyStatus: z.enum(occupancyStatuses),
    address: AddressSchema.optional(),
    fees: z
      .object({
        currency: z.string().optional(),
        rentAmount: z.number().optional(),
        securityDeposit: z.number().optional(),
      })
      .passthrough()
      .optional(),
    specifications: z
      .object({
        totalArea: z.number().optional(),
        bedrooms: z.number().optional(),
        bathrooms: z.number().optional(),
        floors: z.number().optional(),
      })
      .passthrough()
      .optional(),
    approvalStatus: z.enum(['pending', 'approved', 'rejected', 'draft']).optional(),
    createdAt: z.string().optional(),
  })
  .passthrough()
  .openapi('PropertySummary');

export const PropertyDetailSchema = PropertySummarySchema.extend({
  yearBuilt: z.number().optional(),
  maxAllowedUnits: z.number().optional(),
  description: DescriptionSchema.optional(),
  financialDetails: z
    .object({
      purchasePrice: z.number().optional(),
      marketValue: z.number().optional(),
      propertyTax: z.number().optional(),
    })
    .passthrough()
    .optional(),
  images: z.array(MediaSchema).optional(),
  documents: z
    .array(z.object({ documentType: z.string(), url: z.string() }).passthrough())
    .optional(),
})
  .passthrough()
  .openapi('PropertyDetail');

// ─── Property Units ───────────────────────────────────────────────────

export const PropertyUnitSummarySchema = z
  .object({
    puid: z.string(),
    unitNumber: z.string(),
    status: z.string(),
    floor: z.number().optional(),
    specifications: z
      .object({
        bedrooms: z.number().optional(),
        bathrooms: z.number().optional(),
        totalArea: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .openapi('PropertyUnitSummary');

// ─── Leases ───────────────────────────────────────────────────────────

const leaseStatuses = [
  'draft',
  'active',
  'expired',
  'terminated',
  'cancelled',
  'completed',
  'renewed',
  'ready_for_signature',
  'pending_signature',
  'draft_renewal',
] as const;

const leaseTypes = ['fixed_term', 'month_to_month'] as const;

export const LeaseSummarySchema = z
  .object({
    luid: z.string(),
    leaseNumber: z.string().optional(),
    status: z.enum(leaseStatuses),
    type: z.enum(leaseTypes),
    duration: z
      .object({
        startDate: z.string(),
        endDate: z.string(),
        moveInDate: z.string().optional(),
      })
      .passthrough(),
    fees: z
      .object({
        rentAmount: z.number(),
        securityDeposit: z.number().optional(),
        currency: z.string().optional(),
        rentDueDay: z.number().optional(),
      })
      .passthrough(),
  })
  .passthrough()
  .openapi('LeaseSummary');

export const LeaseDetailSchema = LeaseSummarySchema.extend({
  coTenants: z
    .array(z.object({ name: z.string(), email: z.string().optional() }).passthrough())
    .optional(),
  petPolicy: z
    .object({
      allowed: z.boolean(),
      deposit: z.number().optional(),
      monthlyFee: z.number().optional(),
    })
    .passthrough()
    .optional(),
  renewalOptions: z
    .object({
      autoRenew: z.boolean().optional(),
      renewalTermMonths: z.number().optional(),
      noticePeriodDays: z.number().optional(),
    })
    .passthrough()
    .optional(),
  signingMethod: z.enum(['manual', 'electronic', 'pending']).optional(),
})
  .passthrough()
  .openapi('LeaseDetail');

// ─── Users ────────────────────────────────────────────────────────────

export const UserProfileSchema = z
  .object({
    uid: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    fullName: z.string().optional(),
    email: z.string(),
    phoneNumber: z.string().optional(),
    avatar: z.string().nullable().optional(),
    roles: z.array(z.string()).optional(),
    isActive: z.boolean().optional(),
  })
  .passthrough()
  .openapi('UserProfile');

export const TenantDetailSchema = z
  .object({
    profile: UserProfileSchema,
    tenantMetrics: z
      .object({
        onTimePaymentRate: z.number().optional(),
        totalMaintenanceRequests: z.number().optional(),
        currentRentStatus: z.string().optional(),
        totalRentPaid: z.number().optional(),
      })
      .passthrough()
      .optional(),
    isFormerTenant: z.boolean().optional(),
    status: z.enum(['Active', 'Inactive']),
    joinedDate: z.string().optional(),
    roles: z.array(z.string()).optional(),
  })
  .passthrough()
  .openapi('TenantDetail');

// ─── Vendors ──────────────────────────────────────────────────────────

export const VendorDetailSchema = z
  .object({
    profile: UserProfileSchema,
    vendorInfo: z
      .object({
        vuid: z.string(),
        companyName: z.string().optional(),
        businessType: z.string().optional(),
        yearsInBusiness: z.number().optional(),
        servicesOffered: z.record(z.boolean()).optional(),
        contactPerson: z
          .object({
            name: z.string().optional(),
            email: z.string().optional(),
            phone: z.string().optional(),
          })
          .passthrough()
          .optional(),
        stats: z
          .object({
            completedJobs: z.number().optional(),
            activeJobs: z.number().optional(),
            rating: z.number().optional(),
          })
          .passthrough()
          .optional(),
        payoutAccount: z
          .object({
            isSetup: z.boolean(),
            payoutsEnabled: z.boolean().optional(),
            chargesEnabled: z.boolean().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    status: z.enum(['Active', 'Inactive']),
  })
  .passthrough()
  .openapi('VendorDetail');

// ─── Payments ─────────────────────────────────────────────────────────

const paymentStatuses = [
  'pending',
  'paid',
  'overdue',
  'failed',
  'processing',
  'cancelled',
  'refunded',
  'pending_refund',
] as const;
const paymentMethods = ['bank_transfer', 'online', 'check', 'cash', 'other'] as const;
const paymentTypes = [
  'rent',
  'security_deposit',
  'deposit_refund',
  'maintenance',
  'late_fee',
] as const;

export const PaymentSummarySchema = z
  .object({
    pytuid: z.string(),
    invoiceNumber: z.string().optional(),
    paymentType: z.enum(paymentTypes),
    paymentMethod: z.enum(paymentMethods).optional(),
    status: z.enum(paymentStatuses),
    baseAmount: z.number(),
    currency: z.string().optional(),
    dueDate: z.string().optional(),
    paidAt: z.string().nullable().optional(),
  })
  .passthrough()
  .openapi('PaymentSummary');

// ─── Maintenance Requests ─────────────────────────────────────────────

const maintenanceCategories = [
  'plumbing',
  'electrical',
  'hvac',
  'appliance',
  'structural',
  'cosmetic',
  'landscaping',
  'pest_control',
  'general',
  'other',
] as const;

const maintenanceStatuses = [
  'open',
  'assigned',
  'in_progress',
  'awaiting_invoice',
  'completed',
  'cancelled',
  'pending',
] as const;
const maintenancePriorities = ['low', 'medium', 'high', 'urgent'] as const;

export const MaintenanceRequestSummarySchema = z
  .object({
    mruid: z.string(),
    title: z.string(),
    category: z.enum(maintenanceCategories),
    priority: z.enum(maintenancePriorities),
    status: z.enum(maintenanceStatuses),
    createdAt: z.string(),
  })
  .passthrough()
  .openapi('MaintenanceRequestSummary');

export const MaintenanceRequestDetailSchema = MaintenanceRequestSummarySchema.extend({
  description: DescriptionSchema.optional(),
  locationDescription: z.string().optional(),
  permissionToEnter: z.boolean().optional(),
  scheduledDate: z.string().optional(),
  estimatedCost: z.number().optional(),
  actualCost: z.number().optional(),
  completedAt: z.string().nullable().optional(),
  tenantFeedback: z
    .object({
      status: z.enum(['confirmed', 'disputed']).optional(),
      rating: z.number().optional(),
      comment: z.string().optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
  workOrder: z
    .object({
      status: z.string().optional(),
      scope: DescriptionSchema.optional(),
      estimatedCostInCents: z.number().optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
  assignedTechnician: z
    .object({
      name: z.string(),
      phone: z.string().optional(),
      email: z.string().optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
  media: z.array(MediaSchema).optional(),
})
  .passthrough()
  .openapi('MaintenanceRequestDetail');

// ─── Invitations ──────────────────────────────────────────────────────

const invitationStatuses = [
  'draft',
  'pending',
  'accepted',
  'expired',
  'revoked',
  'sent',
  'declined',
] as const;

export const InvitationSummarySchema = z
  .object({
    iuid: z.string(),
    inviteeEmail: z.string(),
    role: z.string(),
    status: z.enum(invitationStatuses),
    personalInfo: z
      .object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        phoneNumber: z.string().optional(),
      })
      .passthrough()
      .optional(),
    expiresAt: z.string().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough()
  .openapi('InvitationSummary');

// ─── Inspections ──────────────────────────────────────────────────────

const inspectionTypes = ['move_in', 'move_out', 'routine'] as const;
const inspectionStatuses = [
  'scheduled',
  'in_progress',
  'submitted',
  'pending_review',
  'approved',
  'rejected',
  'disputed',
  'cancelled',
] as const;
const conditionRatings = ['excellent', 'good', 'fair', 'poor', 'na'] as const;

export const InspectionSummarySchema = z
  .object({
    iuid: z.string(),
    type: z.enum(inspectionTypes),
    status: z.enum(inspectionStatuses),
    scheduledDate: z.string().optional(),
    completedDate: z.string().nullable().optional(),
    overallCondition: z.enum(conditionRatings).optional(),
    conditionScore: z.number().optional(),
  })
  .passthrough()
  .openapi('InspectionSummary');

export const InspectionDetailSchema = InspectionSummarySchema.extend({
  overallNotes: DescriptionSchema.optional(),
  rooms: z
    .array(
      z
        .object({
          name: z.string(),
          condition: z.enum(conditionRatings).optional(),
          notes: DescriptionSchema.optional(),
          items: z
            .array(
              z
                .object({
                  name: z.string(),
                  condition: z.enum(conditionRatings).optional(),
                  notes: z.string().optional(),
                })
                .passthrough()
            )
            .optional(),
          media: z.array(MediaSchema).optional(),
        })
        .passthrough()
    )
    .optional(),
  media: z.array(MediaSchema).optional(),
  reportDocument: z
    .object({
      url: z.string().optional(),
      status: z.string().optional(),
      generatedAt: z.string().optional(),
    })
    .passthrough()
    .optional(),
})
  .passthrough()
  .openapi('InspectionDetail');
