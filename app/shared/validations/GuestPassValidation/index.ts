import { z } from 'zod';
import { Types } from 'mongoose';
import { GuestPassStatus } from '@interfaces/index';

const objectId = z.string().refine((val) => Types.ObjectId.isValid(val), {
  message: 'Must be a valid ID',
});
const statuses = Object.values(GuestPassStatus) as [string, ...string[]];

export const GuestPassValidations = {
  createPass: z
    .object({
      propertyId: objectId.describe('Property ID is missing or invalid'),
      unitId: objectId.optional(),
      visitorName: z.string().min(1, 'Visitor name is required').max(100),
      visitorPhone: z.string().optional(),
      visitorEmail: z.string().email('Invalid email').optional(),
      purpose: z.string().max(200).optional(),
      expiryMinutes: z.coerce.number().int().min(15).max(120).default(30),
      sendViaSms: z.boolean(),
      sendViaEmail: z.boolean(),
      externalNote: z.string().max(250).optional(),
    })
    .refine((data) => data.sendViaSms || data.sendViaEmail, {
      message: 'At least one delivery method (SMS or email) must be selected',
    })
    .refine((data) => !data.sendViaSms || data.visitorPhone, {
      message: 'Visitor phone is required when sending via SMS',
    })
    .refine((data) => !data.sendViaEmail || data.visitorEmail, {
      message: 'Visitor email is required when sending via email',
    }),

  validateCode: z.object({
    code: z
      .string()
      .length(6, 'Code must be 6 digits')
      .regex(/^\d{6}$/, 'Code must be numeric'),
    propertyId: objectId.describe('Property ID is missing or invalid'),
    entryNotes: z.string().max(500).optional(),
  }),

  listQuery: z.object({
    status: z.enum(statuses).optional(),
    propertyId: objectId.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),

  expectedVisitorsQuery: z.object({
    propertyId: objectId.optional(),
    timeWindow: z.enum(['next_hour', 'today', 'all']).default('today'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),

  bulkAcknowledge: z.object({
    passIds: z
      .array(objectId)
      .min(1, 'At least one pass ID is required')
      .max(50, 'Cannot acknowledge more than 50 passes at once'),
  }),

  vpuid: z.object({
    vpuid: z
      .string()
      .min(10, 'Visitor pass ID is corrupted')
      .max(32, 'Visitor pass ID is corrupted'),
  }),

  propertyIdParam: z.object({
    propertyId: objectId.describe('Property ID is missing or invalid'),
  }),

  unacknowledgedCountQuery: z.object({
    propertyId: objectId.optional(),
  }),
};
