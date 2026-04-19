import { z } from 'zod';
import { ExpensePaymentMethod, ExpenseCategory } from '@interfaces/expense.interface';

const categories = Object.values(ExpenseCategory) as [string, ...string[]];
const paymentMethods = Object.values(ExpensePaymentMethod) as [string, ...string[]];
const objectIdRegex = /^[a-fA-F0-9]{24}$/;
const objectId = z.string().regex(objectIdRegex, 'Must be a valid ID');

export const ExpenseValidations = {
  createExpense: z.object({
    propertyId: objectId.describe('Property ID is required'),
    unitId: objectId.optional(),
    amount: z.number().int().min(1, 'Amount must be at least 1 cent'),
    currency: z.string().length(3).toUpperCase().optional(),
    category: z.enum(categories, { message: `Category must be one of: ${categories.join(', ')}` }),
    date: z.coerce.date({ invalid_type_error: 'Date must be a valid date' }),
    description: z.string().min(1).max(500),
    vendor: z.string().max(200).optional(),
    paymentMethod: z.enum(paymentMethods, {
      message: `Payment method must be one of: ${paymentMethods.join(', ')}`,
    }),
    notes: z.string().max(2000).optional(),
  }),

  updateExpense: z
    .object({
      propertyId: objectId.optional(),
      unitId: objectId.optional(),
      amount: z.number().int().min(1).optional(),
      currency: z.string().length(3).toUpperCase().optional(),
      category: z.enum(categories).optional(),
      date: z.coerce.date({ invalid_type_error: 'Date must be a valid date' }).optional(),
      description: z.string().min(1).max(500).optional(),
      vendor: z.string().max(200).optional(),
      paymentMethod: z.enum(paymentMethods).optional(),
      notes: z.string().max(2000).optional(),
    })
    .partial(),

  listExpensesQuery: z.object({
    propertyId: objectId.optional(),
    unitId: objectId.optional(),
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
