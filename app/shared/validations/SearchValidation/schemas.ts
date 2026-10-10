import { z } from 'zod';
import { SEARCH_CONSTANTS } from '@utils/constants';

export const SearchSchemas = {
  globalSearchQuery: z.object({
    q: z
      .string({ required_error: 'Search term is required' })
      .trim()
      .min(
        SEARCH_CONSTANTS.MIN_TERM_LENGTH,
        `Search term must be at least ${SEARCH_CONSTANTS.MIN_TERM_LENGTH} characters`
      )
      .max(
        SEARCH_CONSTANTS.MAX_TERM_LENGTH,
        `Search term must be at most ${SEARCH_CONSTANTS.MAX_TERM_LENGTH} characters`
      ),
  }),
};
