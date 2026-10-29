import { z } from 'zod';
import { ExpensePaymentMethod, ExpenseCategory } from '@interfaces/expense.interface';

import { typeErrors } from '../zodConfig';
import { shortUidString } from '../UtilsValidation';

const categories = Object.values(ExpenseCategory) as [string, ...string[]];
const paymentMethods = Object.values(ExpensePaymentMethod) as [string, ...string[]];

export const ExpenseValidations = {
  createExpense: z.object({
    pid: shortUidString.describe('Property is required'),
    puid: shortUidString.optional(),
    amount: z.number().int().min(1, 'Amount must be at least 1 cent'),
    currency: z.string().length(3).toUpperCase().optional(),
    category: z.enum(categories, { message: `Category must be one of: ${categories.join(', ')}` }),
    date: z.coerce.date({ error: typeErrors({ invalidType: 'Date must be a valid date' }) }),
    description: z.string().min(1).max(500),
    vendor: z.string().max(200).optional(),
    paymentMethod: z.enum(paymentMethods, {
      message: `Payment method must be one of: ${paymentMethods.join(', ')}`,
    }),
    notes: z
      .object({
        html: z.string().max(10000),
        text: z.string().max(2000),
      })
      .optional(),
  }),

  updateExpense: z.object({
    pid: shortUidString.optional(),
    puid: shortUidString.optional(),
    amount: z.number().int().min(1).optional(),
    currency: z.string().length(3).toUpperCase().optional(),
    category: z.enum(categories).optional(),
    date: z.coerce
      .date({ error: typeErrors({ invalidType: 'Date must be a valid date' }) })
      .optional(),
    description: z.string().min(1).max(500).optional(),
    vendor: z.string().max(200).optional(),
    paymentMethod: z.enum(paymentMethods).optional(),
    notes: z
      .object({
        html: z.string().max(10000),
        text: z.string().max(2000),
      })
      .optional(),
  }),

  listExpensesQuery: z.object({
    pid: shortUidString.optional(),
    puid: shortUidString.optional(),
    category: z.enum(categories).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).optional(),
  }),

  pnlQuery: z.object({
    from: z.string().min(1, 'from date is required'),
    to: z.string().min(1, 'to date is required'),
  }),
};
