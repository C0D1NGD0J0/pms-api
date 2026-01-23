import { z } from 'zod';

export const InitiateCheckoutSchema = z.object({
  successUrl: z.string().url('Invalid success URL'),
  cancelUrl: z.string().url('Invalid cancel URL'),
});
