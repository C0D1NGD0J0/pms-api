import { z } from 'zod';
import {
  InspectionStatus,
  ConditionRating,
  InspectionType,
} from '@interfaces/inspection.interface';

const conditionEnum = z.enum(Object.values(ConditionRating) as [string, ...string[]], {
  errorMap: () => ({ message: 'Please select a valid condition rating' }),
});

const richTextSchema = (maxLen: number, fieldLabel = 'Notes') =>
  z.object({
    text: z
      .string()
      .min(1, `${fieldLabel} cannot be empty`)
      .max(maxLen, `${fieldLabel} cannot exceed ${maxLen} characters`),
    html: z.string().optional(),
  });

const inspectionItemSchema = z.object({
  name: z
    .string()
    .min(1, 'Item name is required')
    .max(100, 'Item name cannot exceed 100 characters'),
  condition: conditionEnum.optional(),
  notes: z.string().max(500, 'Item notes cannot exceed 500 characters').optional(),
});

const inspectionRoomSchema = z.object({
  name: z
    .string()
    .min(1, 'Room name is required')
    .max(100, 'Room name cannot exceed 100 characters'),
  condition: conditionEnum.optional(),
  notes: richTextSchema(1000, 'Room notes').optional(),
  items: z.array(inspectionItemSchema).optional(),
});

export const InspectionValidations = {
  createBody: z
    .object({
      type: z.enum(Object.values(InspectionType) as [string, ...string[]], {
        errorMap: () => ({ message: 'Please select a valid inspection type' }),
      }),
      leaseId: z.string().min(1, 'Lease selection is required').optional(),
      propertyId: z.string().optional(),
      propertyUnitId: z.string().optional(),
      inspectorId: z.string().optional(),
      scheduledDate: z.string().datetime({ message: 'Please provide a valid scheduled date' }),
      overallNotes: richTextSchema(2000, 'Overall notes').optional(),
      refundDeposit: z.boolean().optional(),
      rooms: z.array(inspectionRoomSchema).optional(),
    })
    .refine((data) => data.leaseId || data.propertyId, {
      message: 'Please select a lease or property for this inspection',
      path: ['leaseId'],
    })
    .refine((data) => data.type === InspectionType.ROUTINE || data.leaseId, {
      message: 'A lease is required for move-in and move-out inspections',
      path: ['leaseId'],
    }),

  approveBody: z.object({
    refundAmount: z
      .number({ invalid_type_error: 'Refund amount must be a number' })
      .min(0, 'Refund amount cannot be negative')
      .optional(),
  }),

  updateBody: z
    .object({
      overallCondition: conditionEnum.optional(),
      overallNotes: richTextSchema(2000, 'Overall notes').optional(),
      rooms: z.array(inspectionRoomSchema).optional(),
      mediaToRemove: z
        .array(
          z.object({
            roomIndex: z.number().int().min(0),
            mediaIndex: z.number().int().min(0),
          })
        )
        .optional(),
    })
    .refine((data) => Object.values(data).some((v) => v !== undefined), {
      message: 'Please provide at least one field to update',
    }),

  disputeBody: z.object({
    disputeNotes: richTextSchema(2000, 'Dispute notes').refine((data) => data.text.length >= 10, {
      message: 'Dispute notes must be at least 10 characters — please describe the issue',
    }),
  }),

  rejectBody: z.object({
    reason: richTextSchema(2000, 'Rejection reason').refine((data) => data.text.length >= 10, {
      message: 'Rejection reason must be at least 10 characters — please explain why',
    }),
  }),

  listQuery: z.object({
    propertyId: z.string().optional(),
    type: z.enum(Object.values(InspectionType) as [string, ...string[]]).optional(),
    status: z.enum(Object.values(InspectionStatus) as [string, ...string[]]).optional(),
    page: z.coerce.number().int().min(1, 'Page must be at least 1').optional(),
    limit: z.coerce.number().int().min(1).max(100, 'Limit cannot exceed 100').optional(),
  }),

  iuidParam: z.object({
    cuid: z.string().min(1, 'Client ID is required'),
    iuid: z.string().min(1, 'Inspection ID is required'),
  }),

  addNoteBody: z.object({
    note: z.string().min(1, 'Note cannot be empty').max(2000, 'Note cannot exceed 2000 characters'),
    html: z.string().max(2000).optional(),
  }),

  reportQuery: z.object({
    includePhotos: z.enum(['true', 'false']).optional().default('true'),
    forceRegenerate: z.enum(['true', 'false']).optional().default('false'),
  }),
};
