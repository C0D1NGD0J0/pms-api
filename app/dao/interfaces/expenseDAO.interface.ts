import type { QueryFilter } from 'mongoose';
import { ListResultWithPagination } from '@interfaces/utils.interface';
import { IExpenseDocument, IExpenseFilters } from '@interfaces/expense.interface';

import { IFindOptions, IBaseDAO } from './baseDAO.interface';

export interface IExpenseDAO extends IBaseDAO<IExpenseDocument> {
  aggregateByProperty(
    cuid: string,
    match: QueryFilter<IExpenseDocument>
  ): Promise<Array<{ _id: { propertyId: string; currency: string }; total: number }>>;
  aggregateByCategory(
    cuid: string,
    match: QueryFilter<IExpenseDocument>
  ): Promise<Array<{ _id: { category: string; currency: string }; total: number }>>;
  getExpenseStats(cuid: string): Promise<{
    byCurrency: Array<{ currency: string; totalExpenses: number; monthExpenses: number }>;
    totalCount: number;
  }>;
  findByClient(
    cuid: string,
    filters: IExpenseFilters,
    opts?: IFindOptions
  ): ListResultWithPagination<IExpenseDocument[]>;
  findByExpuid(expuid: string, cuid: string): Promise<IExpenseDocument | null>;
}
