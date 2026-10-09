import { z } from 'zod';

import { calendarDate, safeString } from '../UtilsValidation';
import { isAllowedCheckoutReturnUrl } from './checkoutReturnUrl';

export const vendorPayoutParams = z.object({
  mruid: z.string().min(1, 'Maintenance request ID is required'),
});

export const cardCheckoutParams = z.object({
  pytuid: z.string().min(1, 'Payment ID is required'),
});

const checkoutReturnUrl = z.string().trim().max(2048).refine(isAllowedCheckoutReturnUrl, {
  message: 'Return URL must be a path in this app or on the app domain',
});

export const cardCheckoutBody = z.object({
  successUrl: checkoutReturnUrl.optional(),
  cancelUrl: checkoutReturnUrl.optional(),
});

export const chargeForMaintenance = z.object({
  mruid: z.string().min(1, 'Maintenance request ID is required'),
  tenantId: safeString.pipe(z.string().min(1, 'Tenant ID is required')),
  amount: z.number().int().positive('Amount must be a positive integer (cents)'),
  description: z.string().trim().max(500).optional(),
});

export const createPayment = z.object({
  paymentType: z.enum(['rent', 'maintenance', 'late_fee', 'security_deposit', 'deposit_refund']),
  leaseId: safeString.pipe(z.string().min(1, 'Lease ID is required')),
  tenantId: safeString.pipe(z.string().min(1, 'Tenant ID is required')),
  dueDate: calendarDate(),
  daysLate: z.number().int().min(0).optional(),
  description: z.string().optional(),
  notifyByEmail: z.boolean().optional(),
  period: z
    .object({
      month: z.number().int().min(1).max(12),
      year: z.number().int().min(2020),
    })
    .optional(),
});

// Dates arrive as calendar days at UTC midnight; one day of slack keeps "today" valid in
// timezones ahead of UTC.
const isNotFutureDate = (date: Date) => date.getTime() <= Date.now() + 24 * 60 * 60 * 1000;

export const recordManualPayment = z
  .object({
    paymentType: z.enum(['rent', 'maintenance', 'late_fee', 'security_deposit', 'deposit_refund']),
    // Online payments only come from the payment gateway — never from a manual entry
    paymentMethod: z.enum(['cash', 'check', 'bank_transfer', 'other']),
    // A manual entry records money already received, so it can only be saved as paid
    status: z.literal('paid').optional(),
    baseAmount: z.coerce.number().int().min(1, 'Base amount must be at least 1 cent'),
    processingFee: z.coerce.number().int().min(0, 'Processing fee cannot be negative').optional(),
    paidAt: calendarDate().refine(isNotFutureDate, {
      message: 'Payment date cannot be in the future',
    }),
    tenantId: safeString.pipe(z.string().min(1, 'Tenant ID is required')),
    leaseId: safeString.optional(),
    propertyId: safeString.optional(),
    unitId: safeString.optional(),
    pytuid: safeString.pipe(z.string().trim().min(1).max(64)).optional(),
    mruid: safeString.pipe(z.string().trim().min(1).max(64)).optional(),
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
        month: z.coerce.number().int().min(1).max(12),
        year: z.coerce.number().int().min(2020),
      })
      .optional(),
  })
  .refine((data) => data.leaseId || data.propertyId || data.pytuid || data.mruid, {
    message: 'Either a lease, a property, a charge or a maintenance request must be provided',
    path: ['leaseId'],
  });

export const refundPayment = z.object({
  amount: z.number().int().positive('Refund amount must be positive').optional(),
  reason: z.string().trim().max(500, 'Reason cannot exceed 500 characters').optional(),
  reverseVendorTransfer: z.boolean().optional(),
});

export const cancelPayment = z.object({
  reason: z.string().trim().max(500, 'Reason cannot exceed 500 characters').optional(),
});

export const createConnectAccount = z.object({
  email: z.string().email(),
  country: z.string().length(2).toUpperCase(),
});

export const payoutHistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
  cursor: z.string().optional(),
});

export const updatePayoutScheduleBody = z.object({
  interval: z.enum(['daily', 'weekly', 'monthly']),
  weeklyAnchor: z
    .enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
    .optional(),
});

export const listPaymentsQuery = z.object({
  status: z.string().optional(),
  type: z.string().optional(),
  tenantId: z.string().optional(),
  leaseId: z.string().optional(),
  luid: z.string().optional(),
  pendingReview: z.string().optional(), // 'true' | 'false' — coerced to boolean in controller
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
});

export const releaseDeposit = z.object({
  isManualRelease: z.boolean().optional(),
  reason: z.string().trim().max(500, 'Reason cannot exceed 500 characters').optional(),
});

export const reviewPayment = z.object({
  notes: z.string().trim().max(500, 'Notes cannot exceed 500 characters').optional(),
});
