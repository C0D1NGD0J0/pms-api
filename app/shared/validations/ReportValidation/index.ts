import { z } from 'zod';
import {
  MAX_REPORT_EMAIL_RECIPIENTS,
  ScheduleFrequency,
  REPORT_SECTIONS,
  ReportPeriod,
} from '@interfaces/report.interface';

import { UtilsValidations } from '../UtilsValidation';

const sectionsSchema = z
  .array(z.enum(REPORT_SECTIONS as unknown as [string, ...string[]]))
  .min(1, 'At least one section is required')
  .optional();

const emailRecipientsSchema = z
  .array(z.string().email('Invalid email address'))
  .max(MAX_REPORT_EMAIL_RECIPIENTS, `Cannot exceed ${MAX_REPORT_EMAIL_RECIPIENTS} recipients`)
  .optional();

export const ReportValidations = {
  generateBody: z
    .object({
      period: z.nativeEnum(ReportPeriod),
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
      propertyId: z.string().optional(),
      sections: sectionsSchema,
      emailRecipients: emailRecipientsSchema,
    })
    .refine((d) => d.period !== ReportPeriod.CUSTOM || (!!d.startDate && !!d.endDate), {
      message: 'startDate and endDate are required for custom period',
    })
    .refine((d) => !d.startDate || !d.endDate || new Date(d.startDate) <= new Date(d.endDate), {
      path: ['startDate'],
      message: 'startDate must be before endDate',
    })
    .refine(
      (d) => {
        if (!d.startDate || !d.endDate) return true;
        return new Date(d.endDate).getTime() - new Date(d.startDate).getTime() <= 366 * 86400000;
      },
      { path: ['endDate'], message: 'Date range cannot exceed 1 year' }
    ),

  scheduleBody: z.object({
    frequency: z.nativeEnum(ScheduleFrequency),
    sections: sectionsSchema,
    emailRecipients: emailRecipientsSchema,
    propertyId: z.string().optional(),
    isActive: z.boolean().optional(),
  }),

  reportIdParam: UtilsValidations.cuid.extend({
    reportId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid report ID format'),
  }),
};
