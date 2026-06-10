import Logger from 'bunyan';
import { Types } from 'mongoose';
import { createLogger } from '@utils/index';
import { PaymentDAO } from '@dao/paymentDAO';
import { PropertyDAO } from '@dao/propertyDAO';
import { IPromiseReturnedData } from '@interfaces/utils.interface';
import { IExpenseDAO } from '@dao/interfaces/expenseDAO.interface';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
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
  private readonly paymentDAO: PaymentDAO;

  constructor({
    expenseDAO,
    propertyDAO,
    paymentDAO,
  }: {
    expenseDAO: IExpenseDAO;
    propertyDAO: PropertyDAO;
    paymentDAO: PaymentDAO;
  }) {
    this.expenseDAO = expenseDAO;
    this.propertyDAO = propertyDAO;
    this.paymentDAO = paymentDAO;
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

      // Income: join Payment → Lease, group by (currency, propertyId)
      const incomeRaw = await this.paymentDAO.getIncomeByPropertyAndCurrency(cuid, dateMatch);

      // Expenses: group by (currency, category) and (currency, propertyId)
      const expMatch = { date: dateMatch };
      const [expByCategory, expByPropertyRaw] = await Promise.all([
        this.expenseDAO.aggregateByCategory(cuid, expMatch),
        this.expenseDAO.aggregateByProperty(cuid, expMatch),
      ]);

      // Hydrate property names for expense aggregation
      const expPropIds = expByPropertyRaw
        .map((r) => r._id.propertyId)
        .filter(Boolean)
        .map((id) => new Types.ObjectId(id));
      const expProperties = expPropIds.length
        ? await this.propertyDAO.aggregate([
            { $match: { _id: { $in: expPropIds } } },
            { $project: { _id: 1, name: 1 } },
          ])
        : [];
      const propNameMap = new Map(
        (expProperties as any[]).map((p: any) => [p._id.toString(), p.name])
      );

      // Collect all currencies across income and expenses
      const allCurrencies = new Set<string>([
        ...expByPropertyRaw.map((r) => r._id.currency),
        ...expByCategory.map((r) => r._id.currency),
        ...incomeRaw.map((r) => r._id.currency),
      ]);

      const byCurrency = [...allCurrencies].map((currency) => {
        const incomeItems = incomeRaw.filter((r) => r._id.currency === currency);
        const incomeTotal = incomeItems.reduce((sum, r) => sum + r.total, 0);

        const expCatItems = expByCategory.filter((r) => r._id.currency === currency);
        const expPropItems = expByPropertyRaw.filter((r) => r._id.currency === currency);
        const expenseTotal = expCatItems.reduce((sum, r) => sum + r.total, 0);

        return {
          currency,
          income: {
            total: incomeTotal,
            byProperty: incomeItems.map((r) => ({
              propertyId: r._id.propertyId.toString(),
              name: r.propertyName || 'Unknown',
              amount: r.total,
            })),
          },
          expenses: {
            total: expenseTotal,
            byCategory: expCatItems.map((r) => ({
              category: r._id.category,
              amount: r.total,
            })),
            byProperty: expPropItems.map((r) => ({
              propertyId: r._id.propertyId.toString(),
              name: propNameMap.get(r._id.propertyId.toString()) || 'Unknown',
              amount: r.total,
            })),
          },
          netIncome: incomeTotal - expenseTotal,
        };
      });

      return {
        success: true,
        data: { period: { from, to }, byCurrency },
        message: 'P&L summary generated',
      };
    } catch (error) {
      this.log.error({ error }, 'Error generating P&L summary');
      throw error;
    }
  }
}
