import { Document, Types } from 'mongoose';

import { IPromiseReturnedData, IPaginationQuery } from './utils.interface';

export enum ExpenseCategory {
  REPAIRS_MAINTENANCE = 'repairs_maintenance',
  LEGAL_PROFESSIONAL = 'legal_professional',
  MORTGAGE_INTEREST = 'mortgage_interest',
  MANAGEMENT_FEES = 'management_fees',
  PROPERTY_TAX = 'property_tax',
  DEPRECIATION = 'depreciation',
  ADVERTISING = 'advertising',
  LANDSCAPING = 'landscaping',
  UTILITIES = 'utilities',
  INSURANCE = 'insurance',
  CLEANING = 'cleaning',
  SUPPLIES = 'supplies',
  TRAVEL = 'travel',
  OTHER = 'other',
}

export enum ExpensePaymentMethod {
  BANK_TRANSFER = 'bank_transfer',
  CHECK = 'check',
  OTHER = 'other',
  CASH = 'cash',
  CARD = 'card',
}

export interface IExpenseService {
  createExpense(
    cuid: string,
    userId: string,
    data: Omit<
      IExpense,
      'expuid' | 'clientId' | 'createdBy' | 'isDeleted' | 'createdAt' | 'updatedAt'
    >
  ): IPromiseReturnedData<IExpenseDocument>;

  updateExpense(
    expuid: string,
    cuid: string,
    data: Partial<IExpense>
  ): IPromiseReturnedData<IExpenseDocument>;

  getPnLSummary(cuid: string, from: string, to: string): IPromiseReturnedData<IPnLSummary>;

  getExpenseById(expuid: string, cuid: string): IPromiseReturnedData<IExpenseDocument>;

  listExpenses(cuid: string, filters: IExpenseFilters): IPromiseReturnedData<any>;

  softDeleteExpense(expuid: string, cuid: string): IPromiseReturnedData<void>;
}

export interface IExpense {
  paymentMethod: ExpensePaymentMethod;
  propertyId: Types.ObjectId;
  category: ExpenseCategory;
  createdBy: Types.ObjectId;
  unitId?: Types.ObjectId;
  description: string;
  isDeleted: boolean;
  clientId: string;
  currency: string;
  deletedAt?: Date;
  vendor?: string;
  createdAt: Date;
  updatedAt: Date;
  expuid: string;
  amount: number;
  notes?: string;
  date: Date;
}

export interface IPnLSummary {
  expenses: {
    total: number;
    byCategory: Array<{ category: string; amount: number }>;
    byProperty: Array<{ propertyId: string; name: string; amount: number }>;
  };
  income: {
    total: number;
    byProperty: Array<{ propertyId: string; name: string; amount: number }>;
  };
  period: { from: string; to: string };
  netIncome: number;
}

export interface IExpenseFilters extends IPaginationQuery {
  category?: ExpenseCategory;
  propertyId?: string;
  unitId?: string;
  from?: string;
  to?: string;
}

export interface IExpenseDocument extends IExpense, Document {
  _id: Types.ObjectId;
}
