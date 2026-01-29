import { z } from 'zod';

export const InitiateCheckoutSchema = z.object({
  priceId: z.string().min(1, 'Price ID is required'),
  billingInterval: z.enum(['monthly', 'annual'], {
    errorMap: () => ({ message: 'Billing interval must be monthly or annual' }),
  }),
  lookUpKey: z.string().optional(),
  // Optional for updates (ACTIVE subscriptions), required for initial payment (PENDING)
  successUrl: z.string().url('Invalid success URL').optional(),
  cancelUrl: z.string().url('Invalid cancel URL').optional(),
});
