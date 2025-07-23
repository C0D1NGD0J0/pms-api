import { z } from 'zod';

export const EmailTemplateValidations = {
  templateType: z.object({
    templateType: z
      .string()
      .min(1, 'Template type is required')
      .max(50, 'Template type must be 50 characters or less')
      .regex(
        /^[a-zA-Z][a-zA-Z0-9]*$/,
        'Template type must contain only letters and numbers, starting with a letter'
      ),
  }),
};
