import Logger from 'bunyan';
import { Model, Types } from 'mongoose';
import { createLogger } from '@utils/index';
import { PropertyDAO } from '@dao/propertyDAO';
import { IPromiseReturnedData } from '@interfaces/utils.interface';
import { IExpenseDAO } from '@dao/interfaces/expenseDAO.interface';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { PaymentRecordStatus, IPaymentDocument } from '@interfaces/payments.interface';
import {
  IExpenseDocument,
  IExpenseFilters,
  IExpenseService,
  IPnLSummary,
  IExpense,
} from '@interfaces/expense.interface';

export class ExpenseService implements IExpenseService {
  private readonly log: Logger;
  private readonly expenseDAO: IExpenseDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly paymentModel: Model<IPaymentDocument>;

  constructor({
    expenseDAO,
    propertyDAO,
    paymentModel,
  }: {
    expenseDAO: IExpenseDAO;
    propertyDAO: PropertyDAO;
    paymentModel: Model<IPaymentDocument>;
  }) {
    this.expenseDAO = expenseDAO;
    this.propertyDAO = propertyDAO;
    this.paymentModel = paymentModel;
    this.log = createLogger('ExpenseService');
  }

  async createExpense(
    cuid: string,
    userId: string,
    data: Omit<
      IExpense,
      'expuid' | 'clientId' | 'createdBy' | 'isDeleted' | 'createdAt' | 'updatedAt'
    >
  ): IPromiseReturnedData<IExpenseDocument> {
    try {
      const property = await this.propertyDAO.findFirst({
        _id: new Types.ObjectId(data.propertyId as any),
        cuid,
        deletedAt: null,
      });

      if (!property) {
        throw new NotFoundError({ message: 'Property not found' });
      }

      const expense = await this.expenseDAO.insert({
        ...data,
        clientId: cuid,
        createdBy: new Types.ObjectId(userId),
        isDeleted: false,
      });

      this.log.info({ expuid: expense.expuid, cuid }, 'Expense created');
      return { success: true, data: expense, message: 'Expense created successfully' };
    } catch (error) {
      this.log.error({ error }, 'Error creating expense');
      throw error;
    }
  }

  async listExpenses(cuid: string, filters: IExpenseFilters): IPromiseReturnedData<any> {
    try {
      const page = filters.page || 1;
      const limit = filters.limit || 20;
      const skip = (page - 1) * limit;

      const result = await this.expenseDAO.findByClient(cuid, filters, { limit, skip });
      return { success: true, data: result as any, message: 'Expenses retrieved' };
    } catch (error) {
      this.log.error({ error }, 'Error listing expenses');
      throw error;
    }
  }

  async getExpenseById(expuid: string, cuid: string): IPromiseReturnedData<IExpenseDocument> {
    try {
      const expense = await this.expenseDAO.findByExpuid(expuid, cuid);
      if (!expense) throw new NotFoundError({ message: 'Expense not found' });
      return { success: true, data: expense, message: 'Expense retrieved' };
    } catch (error) {
      this.log.error({ error }, 'Error getting expense');
      throw error;
    }
  }

  async updateExpense(
    expuid: string,
    cuid: string,
    data: Partial<IExpense>
  ): IPromiseReturnedData<IExpenseDocument> {
    try {
      const expense = await this.expenseDAO.findByExpuid(expuid, cuid);
      if (!expense) throw new NotFoundError({ message: 'Expense not found' });

      const { expuid: _e, clientId: _c, createdBy: _cb, isDeleted: _d, ...safeData } = data as any;

      const updated = await this.expenseDAO.update({ expuid, clientId: cuid }, { $set: safeData });
      return { success: true, data: updated!, message: 'Expense updated' };
    } catch (error) {
      this.log.error({ error }, 'Error updating expense');
      throw error;
    }
  }

  async softDeleteExpense(expuid: string, cuid: string): IPromiseReturnedData<void> {
    try {
      const expense = await this.expenseDAO.findByExpuid(expuid, cuid);
      if (!expense) throw new NotFoundError({ message: 'Expense not found' });

      await this.expenseDAO.update(
        { expuid, clientId: cuid },
        { $set: { isDeleted: true, deletedAt: new Date() } }
      );
      return { success: true, data: undefined, message: 'Expense deleted' };
    } catch (error) {
      this.log.error({ error }, 'Error deleting expense');
      throw error;
    }
  }

  async getPnLSummary(cuid: string, from: string, to: string): IPromiseReturnedData<IPnLSummary> {
    try {
      const fromDate = new Date(from);
      const toDate = new Date(to);

      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        throw new BadRequestError({ message: 'Invalid date range' });
      }

      const dateMatch = { $gte: fromDate, $lte: toDate };

      // Income: join Payment → Lease → Property
      const incomeByPropertyRaw: Array<{
        _id: Types.ObjectId;
        total: number;
        propertyName: string;
      }> = await this.paymentModel.aggregate([
        {
          $match: {
            cuid,
            status: PaymentRecordStatus.PAID,
            paidAt: dateMatch,
            deletedAt: null,
          },
        },
        {
          $lookup: {
            from: 'leases',
            localField: 'lease',
            foreignField: '_id',
            as: 'leaseDoc',
          },
        },
        { $unwind: { path: '$leaseDoc', preserveNullAndEmptyArrays: false } },
        {
          $group: {
            _id: '$leaseDoc.property.id',
            total: { $sum: '$baseAmount' },
            propertyName: { $first: '$leaseDoc.property.name' },
          },
        },
      ]);

      const incomeTotalCents = incomeByPropertyRaw.reduce((sum, r) => sum + r.total, 0);

      // Expenses
      const expMatch = { date: dateMatch };
      const [expByCategory, expByPropertyRaw] = await Promise.all([
        this.expenseDAO.aggregateByCategory(cuid, expMatch),
        this.expenseDAO.aggregateByProperty(cuid, expMatch),
      ]);

      // Hydrate property names for expense aggregation
      const propIds = expByPropertyRaw.map((r) => new Types.ObjectId(r._id));
      const properties = propIds.length
        ? await this.propertyDAO.aggregate([
            { $match: { _id: { $in: propIds } } },
            { $project: { _id: 1, name: 1 } },
          ])
        : [];

      const propNameMap = new Map(
        (properties as any[]).map((p: any) => [p._id.toString(), p.name])
      );
      const expenseTotalCents = expByCategory.reduce((sum, r) => sum + r.total, 0);

      const summary: IPnLSummary = {
        period: { from, to },
        income: {
          total: incomeTotalCents,
          byProperty: incomeByPropertyRaw.map((r) => ({
            propertyId: r._id.toString(),
            name: r.propertyName || 'Unknown',
            amount: r.total,
          })),
        },
        expenses: {
          total: expenseTotalCents,
          byCategory: expByCategory.map((r) => ({ category: r._id, amount: r.total })),
          byProperty: expByPropertyRaw.map((r) => ({
            propertyId: r._id.toString(),
            name: propNameMap.get(r._id.toString()) || 'Unknown',
            amount: r.total,
          })),
        },
        netIncome: incomeTotalCents - expenseTotalCents,
      };

      return { success: true, data: summary, message: 'P&L summary generated' };
    } catch (error) {
      this.log.error({ error }, 'Error generating P&L summary');
      throw error;
    }
  }
}
