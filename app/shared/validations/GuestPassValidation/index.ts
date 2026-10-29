import { z } from 'zod';
import { GuestPassStatus } from '@interfaces/index';

import { optionalBlank, phoneNumber } from '../UtilsValidation';

const statuses = Object.values(GuestPassStatus) as [string, ...string[]];
// pid / puid
const resourceId = z.string().trim().min(1).max(64);
const vpuid = z
  .string()
  .min(10, 'Visitor pass ID is corrupted')
  .max(32, 'Visitor pass ID is corrupted');

export const GuestPassValidations = {
  createPass: z
    .object({
      propertyId: resourceId.describe('Property ID is missing or invalid'),
      unitId: optionalBlank(resourceId),
      visitorName: z.string().min(1, 'Visitor name is required').max(100),
      visitorPhone: optionalBlank(z.string()),
      visitorEmail: optionalBlank(z.string().email('Invalid email')),
      purpose: optionalBlank(z.string().trim().max(200)),
      // GuestPass model caps expiryMinutes at 60
      expiryMinutes: z.coerce.number().int().min(15).max(60).default(30),
      sendViaSms: z.boolean(),
      sendViaEmail: z.boolean(),
      // Host's note for security — visible to the host and to staff/security for the property
      hostNotes: optionalBlank(z.string().trim().max(500)),
      // Host the visitor is coming to see, when staff issue the pass on someone's behalf
      hostName: optionalBlank(z.string().trim().max(100)),
      hostPhone: optionalBlank(phoneNumber.max(20, 'Phone number is too long')),
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
      reason: optionalBlank(z.string().trim().max(500)),
    })
    .prefault({}),

  statsQuery: z.object({
    propertyId: resourceId.optional(),
  }),

  propertyIdParam: z.object({
    propertyId: resourceId.describe('Property ID is missing or invalid'),
  }),

  unacknowledgedCountQuery: z.object({
    propertyId: resourceId.optional(),
  }),
};
