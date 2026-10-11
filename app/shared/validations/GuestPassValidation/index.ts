import { z } from 'zod';
import { Types } from 'mongoose';
import { GuestPassStatus } from '@interfaces/index';

const objectId = z.string().refine((val) => Types.ObjectId.isValid(val), {
  message: 'Must be a valid ID',
});
const statuses = Object.values(GuestPassStatus) as [string, ...string[]];
// pid/puid as sent by the UI (a Mongo _id is also accepted by the service)
const resourceId = z.string().trim().min(1).max(64);
// Form inputs left blank arrive as "" — treat them as not provided
const blankToUndefined = (value: unknown) => (value === '' ? undefined : value);
const phoneNumber = z
  .string()
  .trim()
  .max(20, 'Phone number is too long')
  .regex(/^\+?[\d\s\-()]+$/, 'Invalid phone number format');
const vpuid = z
  .string()
  .min(10, 'Visitor pass ID is corrupted')
  .max(32, 'Visitor pass ID is corrupted');

export const GuestPassValidations = {
  createPass: z
    .object({
      propertyId: resourceId.describe('Property ID is missing or invalid'),
      unitId: z.preprocess(blankToUndefined, resourceId.optional()),
      visitorName: z.string().min(1, 'Visitor name is required').max(100),
      visitorPhone: z.preprocess(blankToUndefined, z.string().optional()),
      visitorEmail: z.preprocess(blankToUndefined, z.string().email('Invalid email').optional()),
      purpose: z.preprocess(blankToUndefined, z.string().trim().max(200).optional()),
      // GuestPass model caps expiryMinutes at 60
      expiryMinutes: z.coerce.number().int().min(15).max(60).default(30),
      sendViaSms: z.boolean(),
      sendViaEmail: z.boolean(),
      // Host's note for security — visible to the host and to staff/security for the property
      hostNotes: z.preprocess(blankToUndefined, z.string().trim().max(500).optional()),
      // Host the visitor is coming to see, when staff issue the pass on someone's behalf
      hostName: z.preprocess(blankToUndefined, z.string().trim().max(100).optional()),
      hostPhone: z.preprocess(blankToUndefined, phoneNumber.optional()),
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
    propertyId: resourceId.describe('Property ID is missing or invalid'),
    entryNotes: z.string().max(500).optional(),
  }),

  listQuery: z.object({
    status: z.enum(statuses).optional(),
    propertyId: resourceId.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),

  expectedVisitorsQuery: z.object({
    propertyId: resourceId.optional(),
    timeWindow: z.enum(['next_hour', 'today', 'all']).default('today'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),

  bulkAcknowledge: z.object({
    passIds: z
      .array(vpuid)
      .min(1, 'At least one pass ID is required')
      .max(50, 'Cannot acknowledge more than 50 passes at once'),
  }),

  vpuid: z.object({ vpuid }),

  // DELETE requests usually carry no body — default it so the reason stays optional
  revokePass: z
    .object({
      reason: z.preprocess(blankToUndefined, z.string().trim().max(500).optional()),
    })
    .default({}),

  statsQuery: z.object({
    propertyId: resourceId.optional(),
  }),

  propertyIdParam: z.object({
    propertyId: objectId.describe('Property ID is missing or invalid'),
  }),

  unacknowledgedCountQuery: z.object({
    propertyId: objectId.optional(),
  }),
};
