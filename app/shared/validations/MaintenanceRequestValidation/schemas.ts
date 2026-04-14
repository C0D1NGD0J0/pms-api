import { z } from 'zod';
import { VendorDAO } from '@dao/vendorDAO';
import { PropertyDAO } from '@dao/propertyDAO';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { MaintenanceRequestDAO } from '@dao/maintenanceRequestDAO';
import {
  MaintenanceRequestPriority,
  MaintenanceRequestStatus,
  MaintenanceCategory,
  AvailabilityWindow,
} from '@interfaces/maintenanceRequest.interface';

import { getContainer } from '../UtilsValidation';

export const MaintenanceSchemas = {
  mruidParam: z.object({
    mruid: z
      .string()
      .min(1, 'Maintenance request ID is required')
      .refine(async (mruid) => {
        try {
          const { maintenanceRequestDAO }: { maintenanceRequestDAO: MaintenanceRequestDAO } = (
            await getContainer()
          ).cradle;
          const maintenanceRequest = await maintenanceRequestDAO.findFirst({
            mruid,
            deletedAt: null,
          });
          return !!maintenanceRequest;
        } catch {
          return false;
        }
      }, 'Maintenance request not found'),
  }),

  createBody: z
    .object({
      pid: z
        .string()
        .min(1, 'Property ID is required')
        .refine(async (pid) => {
          try {
            const { propertyDAO }: { propertyDAO: PropertyDAO } = (await getContainer()).cradle;
            const property = await propertyDAO.findFirst({ pid, deletedAt: null });
            return !!property;
          } catch {
            return false;
          }
        }, 'Property not found'),

      puid: z
        .string()
        .refine(async (puid) => {
          try {
            const { propertyUnitDAO }: { propertyUnitDAO: PropertyUnitDAO } = (await getContainer())
              .cradle;
            const unit = await propertyUnitDAO.findFirst({ puid, deletedAt: null });
            return !!unit;
          } catch {
            return false;
          }
        }, 'Unit not found')
        .optional(),

      title: z.string().min(5).max(200),
      description: z.object({
        text: z.string().min(10).max(2000),
        html: z.string().optional(),
      }),
      category: z.nativeEnum(MaintenanceCategory),
      priority: z.nativeEnum(MaintenanceRequestPriority).optional(),
      locationDescription: z.string().max(500).optional(),
      permissionToEnter: z.boolean(),
      hasPet: z.boolean().optional(),
      media: z.array(z.any()).optional().default([]),
      availabilityInfo: z
        .object({
          preferredDate: z
            .string()
            .refine((d) => new Date(d) > new Date(), 'Preferred date must be in the future')
            .optional(),
          options: z.array(z.nativeEnum(AvailabilityWindow)).optional().default([]),
        })
        .optional(),
    })
    .superRefine(async (data, ctx) => {
      if (data.puid && data.pid) {
        try {
          const container = await getContainer();
          const {
            propertyDAO,
            propertyUnitDAO,
          }: { propertyDAO: PropertyDAO; propertyUnitDAO: PropertyUnitDAO } = container.cradle;
          const property = await propertyDAO.findFirst({ pid: data.pid, deletedAt: null });
          if (!property) return;
          const unit = await propertyUnitDAO.findFirst({
            puid: data.puid,
            propertyId: property._id,
            deletedAt: null,
          });
          if (!unit) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Unit does not belong to the specified property',
              path: ['puid'],
            });
          }
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Unable to verify unit ownership',
            path: ['puid'],
          });
        }
      }
    }),

  assignBody: z.object({
    vuid: z
      .string()
      .min(1, 'Vendor ID is required')
      .refine(async (vuid) => {
        try {
          const { vendorDAO }: { vendorDAO: VendorDAO } = (await getContainer()).cradle;
          const vendor = await vendorDAO.findFirst({ vuid, deletedAt: null });
          return !!vendor;
        } catch {
          return false;
        }
      }, 'Vendor not found'),
    scheduledDate: z
      .string()
      .refine((d) => !isNaN(Date.parse(d)), 'Invalid date')
      .refine((d) => new Date(d) > new Date(), 'Scheduled date must be in the future')
      .optional(),
    estimatedCost: z.number().positive().optional(),
  }),

  statusBody: z.object({
    status: z.nativeEnum(MaintenanceRequestStatus),
  }),

  completeBody: z.object({
    completionNotes: z.string().max(2000).optional(),
    actualCost: z.number().positive().optional(),
  }),

  cancelBody: z.object({
    reason: z.string().max(500).optional(),
  }),

  assignmentBody: z
    .object({
      action: z.enum(['accept', 'decline']),
      reason: z.string().max(500).optional(),
      technician: z
        .object({
          name: z.string().min(1).max(100),
          phone: z.string().max(20).optional(),
          email: z.string().email().optional(),
        })
        .optional(),
    })
    .refine((d) => d.action !== 'decline' || !!d.reason, {
      message: 'Reason is required when declining',
      path: ['reason'],
    }),

  workOrderBody: z.object({
    scope: z.string().min(10).max(2000),
    estimatedCostInCents: z.number().int().positive(),
    lineItems: z
      .array(
        z.object({
          description: z.string().min(1),
          quantity: z.number().positive(),
          unitPriceInCents: z.number().int().positive(),
          amountInCents: z.number().int().positive(),
        })
      )
      .optional(),
    notes: z.string().max(500).optional(),
  }),

  workOrderReviewBody: z
    .object({
      action: z.enum(['approve', 'reject']),
      rejectionReason: z.string().min(10, 'Provide at least 10 characters').max(500).optional(),
    })
    .refine((d) => d.action !== 'reject' || !!d.rejectionReason, {
      message: 'Rejection reason is required when rejecting',
      path: ['rejectionReason'],
    }),

  invoiceBody: z.object({
    amount: z.number().int().positive('Amount must be a positive integer in cents'),
    currency: z.string().length(3, 'Currency must be a 3-character code').optional(),
    description: z.string().min(1).max(500),
    lineItems: z
      .array(
        z.object({
          description: z.string().min(1),
          quantity: z.number().positive(),
          unitPriceInCents: z.number().int().positive(),
          amountInCents: z.number().int().positive(),
        })
      )
      .optional(),
    source: z.enum(['manual', 'quickbooks', 'freshbooks', 'jobber']).optional(),
    externalInvoiceId: z.string().optional(),
    externalInvoiceUrl: z.string().url().optional(),
  }),

  invoiceReviewBody: z
    .object({
      action: z.enum(['approve', 'reject']),
      isBillable: z.boolean().optional(),
      rejectionReason: z
        .string()
        .min(10, 'Please provide a reason of at least 10 characters')
        .optional(),
    })
    .refine((d) => d.action !== 'reject' || !!d.rejectionReason, {
      message: 'Rejection reason is required when rejecting',
      path: ['rejectionReason'],
    }),

  listQuery: z.object({
    status: z.nativeEnum(MaintenanceRequestStatus).optional(),
    priority: z.nativeEnum(MaintenanceRequestPriority).optional(),
    category: z.nativeEnum(MaintenanceCategory).optional(),
    pid: z.string().optional(),
    puid: z.string().optional(),
    vendorUid: z.string().optional(),
    tenantUid: z.string().optional(),
    isBillable: z.coerce.boolean().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  }),

  webhookSourceParam: z.object({
    source: z.enum(['manual', 'quickbooks', 'freshbooks', 'jobber']),
  }),

  webhookBody: z.object({
    mruid: z.string().min(1, 'Maintenance request ID is required'),
    amount: z.number().int().positive('Amount must be a positive integer in cents'),
    currency: z.string().length(3, 'Currency must be a 3-character code'),
    description: z.string().min(1).max(500),
    externalInvoiceId: z.string().min(1, 'External invoice ID is required'),
    externalInvoiceUrl: z.string().url().optional(),
    source: z.enum(['manual', 'quickbooks', 'freshbooks', 'jobber']),
    lineItems: z
      .array(
        z.object({
          description: z.string().min(1),
          quantity: z.number().positive(),
          unitPriceInCents: z.number().int().positive(),
          amountInCents: z.number().int().positive(),
        })
      )
      .optional(),
    rawPayload: z.record(z.unknown()).optional().default({}),
  }),
};
