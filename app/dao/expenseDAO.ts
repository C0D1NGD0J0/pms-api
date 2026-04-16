import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { FilterQuery, Model, Types } from 'mongoose';
import { ListResultWithPagination } from '@interfaces/utils.interface';
import { IExpenseDocument, IExpenseFilters } from '@interfaces/expense.interface';

import { BaseDAO } from './baseDAO';
import { IFindOptions } from './interfaces/baseDAO.interface';
import { IExpenseDAO } from './interfaces/expenseDAO.interface';

export class ExpenseDAO extends BaseDAO<IExpenseDocument> implements IExpenseDAO {
  private readonly log: Logger;

  constructor({ expenseModel }: { expenseModel: Model<IExpenseDocument> }) {
    super(expenseModel);
    this.log = createLogger('ExpenseDAO');
  }

  async findByExpuid(expuid: string, clientId: string): Promise<IExpenseDocument | null> {
    try {
      return await this.findFirst({ expuid, clientId, isDeleted: false });
    } catch (error: any) {
      this.log.error({ error }, 'Error finding expense by expuid');
      throw this.throwErrorHandler(error);
    }
  }

  async findByClient(
    clientId: string,
    filters: IExpenseFilters,
    opts?: IFindOptions
  ): ListResultWithPagination<IExpenseDocument[]> {
    try {
      const query: FilterQuery<IExpenseDocument> = { clientId, isDeleted: false };

      if (filters.propertyId) query.propertyId = new Types.ObjectId(filters.propertyId);
      if (filters.unitId) query.unitId = new Types.ObjectId(filters.unitId);
      if (filters.category) query.category = filters.category;

      if (filters.from || filters.to) {
        query.date = {} as any;
        if (filters.from) (query.date as any).$gte = new Date(filters.from);
        if (filters.to) (query.date as any).$lte = new Date(filters.to);
      }

      return await this.list(query, {
        ...opts,
        sort: { date: -1 },
        populate: [
          { path: 'propertyId', select: 'name address pid' },
          { path: 'unitId', select: 'unitNumber puid' },
          { path: 'createdBy', select: 'personalInfo.firstName personalInfo.lastName' },
        ],
      });
    } catch (error: any) {
      this.log.error({ error }, 'Error listing expenses');
      throw this.throwErrorHandler(error);
    }
  }

  async aggregateByCategory(
    clientId: string,
    match: FilterQuery<IExpenseDocument>
  ): Promise<Array<{ _id: string; total: number }>> {
    try {
      return (await this.aggregate([
        { $match: { clientId, isDeleted: false, ...match } },
        { $group: { _id: '$category', total: { $sum: '$amount' } } },
        { $sort: { total: -1 } },
      ])) as any;
    } catch (error: any) {
      this.log.error({ error }, 'Error aggregating expenses by category');
      throw this.throwErrorHandler(error);
    }
  }

  async aggregateByProperty(
    clientId: string,
    match: FilterQuery<IExpenseDocument>
  ): Promise<Array<{ _id: string; total: number }>> {
    try {
      return (await this.aggregate([
        { $match: { clientId, isDeleted: false, ...match } },
        { $group: { _id: '$propertyId', total: { $sum: '$amount' } } },
        { $sort: { total: -1 } },
      ])) as any;
    } catch (error: any) {
      this.log.error({ error }, 'Error aggregating expenses by property');
      throw this.throwErrorHandler(error);
    }
  }
}
