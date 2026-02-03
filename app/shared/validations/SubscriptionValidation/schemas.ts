import { z } from 'zod';

export const InitiateCheckoutSchema = z.object({
  priceId: z.string().min(1, 'Price ID is required'),
  billingInterval: z.enum(['monthly', 'annual'], {
    errorMap: () => ({ message: 'Billing interval must be monthly or annual' }),
  }),
  lookUpKey: z.string().optional(),
  successUrl: z.string().url('Invalid success URL').optional(),
  cancelUrl: z.string().url('Invalid cancel URL').optional(),
});

export const ManageSeatsSchema = z.object({
  seatDelta: z
    .number({
      required_error: 'Seat delta is required',
      invalid_type_error: 'Seat delta must be a number',
    })
    .int('Seat delta must be an integer')
    .refine((val) => val !== 0, {
      message: 'Seat delta must be non-zero (positive to purchase, negative to remove)',
    })
    .refine((val) => val >= -1000 && val <= 1000, {
      message: 'Seat delta must be between -1000 and 1000',
    }),
});
