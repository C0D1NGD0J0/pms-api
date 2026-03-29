import { z } from 'zod';

import { calendarDate } from '../UtilsValidation';

export const createPayment = z.object({
  paymentType: z.enum(['rent', 'maintenance', 'late_fee']),
  leaseId: z.string().min(1, 'Lease ID is required'),
  tenantId: z.string().min(1, 'Tenant ID is required'),
  dueDate: calendarDate(),
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
  status: z.enum(['paid', 'pending', 'overdue', 'failed', 'cancelled']).optional(),
  baseAmount: z.number().int().min(0, 'Base amount must be a positive number'),
  processingFee: z.number().int().min(0, 'Processing fee cannot be negative').optional(),
  paidAt: calendarDate(),
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

export const refundPayment = z.object({
  amount: z.number().int().positive('Refund amount must be positive').optional(),
  reason: z.string().trim().max(500, 'Reason cannot exceed 500 characters').optional(),
});

export const createConnectAccount = z.object({
  email: z.string().email(),
  country: z.string().length(2).toUpperCase(),
});
