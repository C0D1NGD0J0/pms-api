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
    data: IExpenseCreateInput
  ): IPromiseReturnedData<IExpenseResponse>;

  updateExpense(
    expuid: string,
    cuid: string,
    data: IExpenseUpdateInput
  ): IPromiseReturnedData<IExpenseResponse>;

  getPnLSummary(cuid: string, from: string, to: string): IPromiseReturnedData<IPnLSummary>;

  getExpenseById(expuid: string, cuid: string): IPromiseReturnedData<IExpenseResponse>;

  listExpenses(cuid: string, query: IExpenseListQuery): IPromiseReturnedData<any>;

  softDeleteExpense(expuid: string, cuid: string): IPromiseReturnedData<void>;
}

export interface IExpense {
  receipt?: {
    url: string;
    filename: string;
    key: string;
    uploadedAt: Date;
    uploadedBy: Types.ObjectId;
  };
  notes?: { html: string; text: string };
  paymentMethod: ExpensePaymentMethod;
  propertyId: Types.ObjectId;
  category: ExpenseCategory;
  createdBy: Types.ObjectId;
  unitId?: Types.ObjectId;
  description: string;
  currency: string;
  deletedAt?: Date;
  vendor?: string;
  createdAt: Date;
  updatedAt: Date;
  expuid: string;
  amount: number;
  cuid: string;
  date: Date;
}

/**
 * Public expense shape — property/unit are exposed by pid/puid and the author by uid;
 * no Mongo ObjectId (the expense _id, refs, receipt uploader) leaves the API.
 */
export type IExpenseResponse = {
  receipt?: Omit<NonNullable<IExpense['receipt']>, 'uploadedBy'>;
  createdBy: { uid: string; displayName?: string } | null;
  property: { pid: string; name?: string; address?: unknown } | null;
  unit: { puid: string; unitNumber?: string } | null;
  puid?: string;
  pid?: string;
} & Omit<IExpense, ExpenseRefFields | 'createdBy' | 'receipt'>;

export interface IPnLByCurrency {
  expenses: {
    total: number;
    byCategory: Array<{ category: string; amount: number }>;
    byProperty: IPnLPropertyAmount[];
  };
  income: {
    total: number;
    byProperty: IPnLPropertyAmount[];
  };
  netIncome: number;
  currency: string;
}

/** Request body for creating an expense — the API boundary speaks pid/puid, never Mongo _ids. */
export type IExpenseCreateInput = Omit<
  IExpense,
  ExpenseRefFields | 'expuid' | 'cuid' | 'createdBy' | 'createdAt' | 'updatedAt' | 'deletedAt'
> & {
  puid?: string;
  pid: string;
};

/** Internal DAO filters — propertyId/unitId are Mongo _id strings resolved from pid/puid. */
export interface IExpenseFilters extends IPaginationQuery {
  category?: ExpenseCategory;
  propertyId?: string;
  unitId?: string;
  from?: string;
  to?: string;
}

export interface IExpenseListQuery extends Omit<IExpenseFilters, ExpenseRefFields> {
  puid?: string;
  pid?: string;
}

export type IExpenseUpdateInput = Partial<Omit<IExpense, ExpenseRefFields>> & {
  puid?: string;
  pid?: string;
};

export interface IPnLSummary {
  period: { from: string; to: string };
  byCurrency: IPnLByCurrency[];
}

/** P&L line for one property — identified publicly by pid (absent if the property is gone). */
export interface IPnLPropertyAmount {
  amount: number;
  pid?: string;
  name: string;
}

export interface IExpenseDocument extends IExpense, Document {
  _id: Types.ObjectId;
}

type ExpenseRefFields = 'propertyId' | 'unitId';
