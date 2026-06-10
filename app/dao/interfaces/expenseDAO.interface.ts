import { FilterQuery } from 'mongoose';
import { ListResultWithPagination } from '@interfaces/utils.interface';
import { IExpenseDocument, IExpenseFilters } from '@interfaces/expense.interface';

import { IFindOptions, IBaseDAO } from './baseDAO.interface';

export interface IExpenseDAO extends IBaseDAO<IExpenseDocument> {
  aggregateByProperty(
    clientId: string,
    match: FilterQuery<IExpenseDocument>
  ): Promise<Array<{ _id: { propertyId: string; currency: string }; total: number }>>;
  aggregateByCategory(
    clientId: string,
    match: FilterQuery<IExpenseDocument>
  ): Promise<Array<{ _id: { category: string; currency: string }; total: number }>>;
  findByClient(
    clientId: string,
    filters: IExpenseFilters,
    opts?: IFindOptions
  ): ListResultWithPagination<IExpenseDocument[]>;
  findByExpuid(expuid: string, clientId: string): Promise<IExpenseDocument | null>;
}
