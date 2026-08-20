import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { ListResultWithPagination } from '@interfaces/utils.interface';
import { type QueryFilter, isValidObjectId, Model, Types } from 'mongoose';
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

  async findByExpuid(expuid: string, cuid: string): Promise<IExpenseDocument | null> {
    try {
      return await this.findFirst(
        { expuid, cuid, deletedAt: null },
        {
          populate: [
            { path: 'propertyId', select: 'name address pid' },
            { path: 'unitId', select: 'unitNumber puid' },
            {
              path: 'createdBy',
              select: 'email uid',
              populate: { path: 'profile', select: 'personalInfo.firstName personalInfo.lastName' },
            },
          ],
        }
      );
    } catch (error: any) {
      this.log.error({ error }, 'Error finding expense by expuid');
      throw this.throwErrorHandler(error);
    }
  }

  async findByClient(
    cuid: string,
    filters: IExpenseFilters,
    opts?: IFindOptions
  ): ListResultWithPagination<IExpenseDocument[]> {
    try {
      const query: QueryFilter<IExpenseDocument> = { cuid, deletedAt: null };

      if (filters.propertyId && isValidObjectId(filters.propertyId))
        query.propertyId = new Types.ObjectId(filters.propertyId);
      if (filters.unitId && isValidObjectId(filters.unitId))
        query.unitId = new Types.ObjectId(filters.unitId);
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
          {
            path: 'createdBy',
            select: 'email uid',
            populate: { path: 'profile', select: 'personalInfo.firstName personalInfo.lastName' },
          },
        ],
      });
    } catch (error: any) {
      this.log.error({ error }, 'Error listing expenses');
      throw this.throwErrorHandler(error);
    }
  }

  async aggregateByCategory(
    cuid: string,
    match: QueryFilter<IExpenseDocument>
  ): Promise<Array<{ _id: { category: string; currency: string }; total: number }>> {
    try {
      return (await this.aggregate([
        { $match: { cuid, deletedAt: null, ...match } },
        {
          $group: {
            _id: { category: '$category', currency: '$currency' },
            total: { $sum: '$amount' },
          },
        },
        { $sort: { total: -1 } },
      ])) as any;
    } catch (error: any) {
      this.log.error({ error }, 'Error aggregating expenses by category');
      throw this.throwErrorHandler(error);
    }
  }

  async aggregateByProperty(
    cuid: string,
    match: QueryFilter<IExpenseDocument>
  ): Promise<Array<{ _id: { propertyId: string; currency: string }; total: number }>> {
    try {
      return (await this.aggregate([
        { $match: { cuid, deletedAt: null, ...match } },
        {
          $group: {
            _id: { propertyId: '$propertyId', currency: '$currency' },
            total: { $sum: '$amount' },
          },
        },
        { $sort: { total: -1 } },
      ])) as any;
    } catch (error: any) {
      this.log.error({ error }, 'Error aggregating expenses by property');
      throw this.throwErrorHandler(error);
    }
  }

  async getExpenseStats(cuid: string): Promise<{
    byCurrency: Array<{ currency: string; totalExpenses: number; monthExpenses: number }>;
    totalCount: number;
  }> {
    try {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const result = (await this.aggregate([
        { $match: { cuid, deletedAt: null } },
        {
          $facet: {
            byCurrency: [
              {
                $group: {
                  _id: '$currency',
                  totalExpenses: { $sum: '$amount' },
                  monthExpenses: {
                    $sum: {
                      $cond: [{ $gte: ['$date', monthStart] }, '$amount', 0],
                    },
                  },
                },
              },
            ],
            totalCount: [{ $count: 'count' }],
          },
        },
      ])) as any[];

      const facet = result[0] || { byCurrency: [], totalCount: [] };
      return {
        byCurrency: (facet.byCurrency || []).map((r: any) => ({
          currency: (r._id || 'USD').toUpperCase(),
          totalExpenses: r.totalExpenses || 0,
          monthExpenses: r.monthExpenses || 0,
        })),
        totalCount: facet.totalCount?.[0]?.count || 0,
      };
    } catch (error: any) {
      this.log.error({ error }, 'Error getting expense stats');
      throw this.throwErrorHandler(error);
    }
  }
}
