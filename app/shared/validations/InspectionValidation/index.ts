import { z } from 'zod';
import {
  InspectionStatus,
  ConditionRating,
  InspectionType,
} from '@interfaces/inspection.interface';

const conditionEnum = z.enum(Object.values(ConditionRating) as [string, ...string[]]);

const richTextSchema = (maxLen: number) =>
  z.object({
    text: z.string().min(1).max(maxLen),
    html: z.string().optional(),
  });

const inspectionItemSchema = z.object({
  name: z.string().min(1).max(100),
  condition: conditionEnum.optional(),
  notes: z.string().max(500).optional(),
});

const inspectionRoomSchema = z.object({
  name: z.string().min(1).max(100),
  condition: conditionEnum.optional(),
  notes: richTextSchema(1000).optional(),
  items: z.array(inspectionItemSchema).optional(),
});

export const InspectionValidations = {
  createBody: z.object({
    type: z.enum(Object.values(InspectionType) as [string, ...string[]]),
    leaseId: z.string().min(1),
    inspectorId: z.string().optional(),
    scheduledDate: z.string().datetime(),
    overallNotes: richTextSchema(2000).optional(),
    refundDeposit: z.boolean().optional(),
    rooms: z.array(inspectionRoomSchema).optional(),
  }),

  approveBody: z.object({
    refundAmount: z.number().min(0).optional(),
  }),

  updateBody: z
    .object({
      overallCondition: conditionEnum.optional(),
      overallNotes: richTextSchema(2000).optional(),
      rooms: z.array(inspectionRoomSchema).optional(),
    })
    .refine((data) => Object.values(data).some((v) => v !== undefined), {
      message: 'At least one field must be provided',
    }),

  disputeBody: z.object({
    disputeNotes: richTextSchema(2000).refine((data) => data.text.length >= 10, {
      message: 'Dispute notes must be at least 10 characters',
    }),
  }),

  rejectBody: z.object({
    reason: richTextSchema(2000).refine((data) => data.text.length >= 10, {
      message: 'Rejection reason must be at least 10 characters',
    }),
  }),

  listQuery: z.object({
    propertyId: z.string().optional(),
    type: z.enum(Object.values(InspectionType) as [string, ...string[]]).optional(),
    status: z.enum(Object.values(InspectionStatus) as [string, ...string[]]).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),

  iuidParam: z.object({
    cuid: z.string().min(1),
    iuid: z.string().min(1),
  }),

  addNoteBody: z.object({
    note: z.string().min(1).max(2000),
    html: z.string().max(2000).optional(),
  }),

  reportQuery: z.object({
    includePhotos: z.enum(['true', 'false']).optional().default('true'),
    forceRegenerate: z.enum(['true', 'false']).optional().default('false'),
  }),
};
