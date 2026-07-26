import { z } from 'zod';
import {
  InspectionStatus,
  ConditionRating,
  InspectionType,
} from '@interfaces/inspection.interface';

const conditionEnum = z.enum(Object.values(ConditionRating) as [string, ...string[]]);

const inspectionItemSchema = z.object({
  name: z.string().min(1).max(100),
  condition: conditionEnum.optional(),
  notes: z.string().max(500).optional(),
});

const inspectionRoomSchema = z.object({
  name: z.string().min(1).max(100),
  condition: conditionEnum.optional(),
  notes: z.string().max(1000).optional(),
  items: z.array(inspectionItemSchema).optional(),
});

export const InspectionValidations = {
  createBody: z.object({
    type: z.enum(Object.values(InspectionType) as [string, ...string[]]),
    leaseId: z.string().min(1),
    inspectorId: z.string().optional(), // defaults to current user in service layer
    scheduledDate: z.string().datetime(),
    overallNotes: z.string().max(2000).optional(),
    rooms: z.array(inspectionRoomSchema).optional(),
  }),

  updateBody: z.object({
    overallCondition: conditionEnum.optional(),
    overallNotes: z.string().max(2000).optional(),
    rooms: z.array(inspectionRoomSchema).optional(),
  }),

  disputeBody: z.object({
    disputeNotes: z.string().min(10, 'Dispute notes must be at least 10 characters').max(2000),
  }),

  rejectBody: z.object({
    reason: z.string().min(10, 'Rejection reason must be at least 10 characters').max(2000),
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
};
