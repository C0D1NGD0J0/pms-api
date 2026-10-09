import { z } from 'zod';

export const SearchSchemas = {
  globalSearchQuery: z.object({
    q: z
      .string({ required_error: 'Search term is required' })
      .trim()
      .min(2, 'Search term must be at least 2 characters')
      .max(100, 'Search term must be at most 100 characters'),
  }),
};
