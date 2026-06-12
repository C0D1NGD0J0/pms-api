import { z } from 'zod';
import { SMSMessageType, SMSStatus } from '@interfaces/index';

const e164Phone = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Must be E.164 format (e.g., +14155551234)');
const smsStatuses = Object.values(SMSStatus) as [string, ...string[]];

export const SMSValidations = {
  sendOTP: z.object({
    phone: e164Phone,
  }),

  verifyOTP: z.object({
    phone: e164Phone,
    code: z
      .string()
      .length(6, 'Code must be 6 digits')
      .regex(/^\d+$/, 'Code must contain only digits'),
  }),

  updateConsent: z.object({
    consented: z.boolean(),
  }),

  logsQuery: z.object({
    messageType: z.enum(Object.values(SMSMessageType) as [string, ...string[]]).optional(),
    status: z.enum(smsStatuses).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).optional(),
  }),
};
