import { z } from 'zod';

export const createPayment = z.object({
  paymentType: z.enum(['rent', 'maintenance', 'late_fee']),
  leaseId: z.string().min(1, 'Lease ID is required'),
  tenantId: z.string().min(1, 'Tenant ID is required'),
  dueDate: z.coerce.date(),
  daysLate: z.number().int().min(0).optional(),
  description: z.string().optional(),
  period: z
    .object({
      month: z.number().int().min(1).max(12),
      year: z.number().int().min(2020),
    })
    .optional(),
});

export const recordManualPayment = z.object({
  paymentType: z.enum(['rent', 'maintenance', 'late_fee']),
  paymentMethod: z.enum(['online', 'cash', 'check', 'bank_transfer', 'other']),
  amount: z.number().int().min(0, 'Amount must be a positive number'),
  paidAt: z.coerce.date(),
  tenantId: z.string().min(1, 'Tenant ID is required'),
  leaseId: z.string().optional(),
  description: z.string().optional(),
  receipt: z
    .object({
      url: z.string().url(),
      filename: z.string(),
      key: z.string(),
    })
    .optional(),
  period: z
    .object({
      month: z.number().int().min(1).max(12),
      year: z.number().int().min(2020),
    })
    .optional(),
});

export const createConnectAccount = z.object({
  email: z.string().email(),
  country: z.string().length(2).toUpperCase(),
  businessType: z.enum(['individual', 'company']),
});
