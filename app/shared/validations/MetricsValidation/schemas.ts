import { z } from 'zod';
import { MetricType } from '@interfaces/metrics.interface';

import { typeErrors } from '../zodConfig';

export const MetricsSchemas = {
  metricTypeParam: z.object({
    metricType: z.nativeEnum(MetricType, { error: 'Invalid metric type' }),
  }),

  historyQuery: z
    .object({
      from: z
        .string({ error: typeErrors({ required: 'from date is required' }) })
        .refine((d) => !isNaN(Date.parse(d)), 'Invalid from date'),
      to: z
        .string({ error: typeErrors({ required: 'to date is required' }) })
        .refine((d) => !isNaN(Date.parse(d)), 'Invalid to date'),
    })
    .refine((d) => new Date(d.from) <= new Date(d.to), {
      message: 'from must be before to',
      path: ['from'],
    }),

  trendQuery: z.object({
    days: z.coerce.number().int().positive().max(365).optional(),
  }),
};
