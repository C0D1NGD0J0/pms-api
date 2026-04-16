import { FilterQuery } from 'mongoose';
import { ListResultWithPagination } from '@interfaces/utils.interface';
import { IExpenseDocument, IExpenseFilters } from '@interfaces/expense.interface';

import { IFindOptions, IBaseDAO } from './baseDAO.interface';

export interface IExpenseDAO extends IBaseDAO<IExpenseDocument> {
  findByClient(
    clientId: string,
    filters: IExpenseFilters,
    opts?: IFindOptions
  ): ListResultWithPagination<IExpenseDocument[]>;
  aggregateByCategory(
    clientId: string,
    match: FilterQuery<IExpenseDocument>
  ): Promise<Array<{ _id: string; total: number }>>;
  aggregateByProperty(
    clientId: string,
    match: FilterQuery<IExpenseDocument>
  ): Promise<Array<{ _id: string; total: number }>>;
  findByExpuid(expuid: string, clientId: string): Promise<IExpenseDocument | null>;
}
