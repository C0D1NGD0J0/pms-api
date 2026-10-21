import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { PaymentDAO } from '@dao/paymentDAO';
import { PropertyDAO } from '@dao/propertyDAO';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { IPromiseReturnedData } from '@interfaces/utils.interface';
import { IExpenseDAO } from '@dao/interfaces/expenseDAO.interface';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import {
  IExpenseCreateInput,
  IExpenseUpdateInput,
  IExpenseListQuery,
  IExpenseDocument,
  IExpenseResponse,
  IExpenseFilters,
  IExpenseService,
  IPnLSummary,
  IExpense,
} from '@interfaces/expense.interface';

interface IPropertyRef {
  _id: Types.ObjectId;
  address?: unknown;
  name?: string;
  pid?: string;
}

interface IUnitRef {
  _id: Types.ObjectId;
  unitNumber?: string;
  puid?: string;
}

// A ref field is either an ObjectId or (when populated) the referenced document.
const refObjectId = (ref: unknown): Types.ObjectId | undefined => {
  if (!ref) return undefined;
  if (ref instanceof Types.ObjectId) return ref;
  const populatedId = (ref as { _id?: unknown })._id;
  return populatedId instanceof Types.ObjectId ? populatedId : undefined;
};

interface ICreatedByRef {
  profile?: { personalInfo?: { firstName?: string; lastName?: string } };
  email?: string;
  uid?: string;
}

// createdBy is populated with uid/email/profile names on reads; an unpopulated ObjectId has no uid.
const toPublicCreatedBy = (createdBy: unknown): IExpenseResponse['createdBy'] => {
  const author = createdBy as ICreatedByRef | undefined;
  if (!author?.uid) return null;
  const { firstName = '', lastName = '' } = author.profile?.personalInfo ?? {};
  const fullName = `${firstName} ${lastName}`.trim();
  return { uid: author.uid, displayName: fullName || author.email };
};

/**
 * Maps an expense document to its public shape: property/unit are exposed by pid/puid and the
 * author by uid; the expense _id and every internal ObjectId ref stay server-side.
 */
export const toExpenseResponse = (
  expense: IExpenseDocument,
  refs: { property?: IPropertyRef | null; unit?: IUnitRef | null } = {}
): IExpenseResponse => {
  const plain: Record<string, any> =
    typeof (expense as any).toObject === 'function' ? expense.toObject() : { ...expense };
  const { _id, id, __v, propertyId, unitId, createdBy, receipt, ...rest } = plain;
  void _id;
  void id;
  void __v;

  const propertyRef = (refs.property ?? propertyId) as IPropertyRef | undefined;
  const unitRef = (refs.unit ?? unitId) as IUnitRef | undefined;
  const property = propertyRef?.pid
    ? { pid: propertyRef.pid, name: propertyRef.name, address: propertyRef.address }
    : null;
  const unit = unitRef?.puid ? { puid: unitRef.puid, unitNumber: unitRef.unitNumber } : null;
  const publicReceipt = receipt
    ? {
        url: receipt.url,
        filename: receipt.filename,
        key: receipt.key,
        uploadedAt: receipt.uploadedAt,
      }
    : undefined;

  return {
    ...(rest as Omit<IExpense, 'propertyId' | 'unitId' | 'createdBy' | 'receipt'>),
    ...(publicReceipt ? { receipt: publicReceipt } : {}),
    createdBy: toPublicCreatedBy(createdBy),
    pid: property?.pid,
    puid: unit?.puid,
    property,
    unit,
  };
};

const UPDATABLE_FIELDS: Array<keyof IExpense> = [
  'amount',
  'currency',
  'category',
  'date',
  'description',
  'vendor',
  'paymentMethod',
  'notes',
  'receipt',
];

export class ExpenseService implements IExpenseService {
  private readonly log: Logger;
  private readonly expenseDAO: IExpenseDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly paymentDAO: PaymentDAO;
  private readonly emitterService: EventEmitterService;

  constructor({
    expenseDAO,
    propertyDAO,
    propertyUnitDAO,
    paymentDAO,
    emitterService,
  }: {
    expenseDAO: IExpenseDAO;
    propertyDAO: PropertyDAO;
    propertyUnitDAO: PropertyUnitDAO;
    paymentDAO: PaymentDAO;
    emitterService: EventEmitterService;
  }) {
    this.expenseDAO = expenseDAO;
    this.propertyDAO = propertyDAO;
    this.propertyUnitDAO = propertyUnitDAO;
    this.paymentDAO = paymentDAO;
    this.emitterService = emitterService;
    this.log = createLogger('ExpenseService');
  }

  private async resolveProperty(cuid: string, pid: string): Promise<IPropertyRef> {
    const property = await this.propertyDAO.findFirst({ pid, cuid, deletedAt: null });
    if (!property) {
      throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Property' }) });
    }
    return property as unknown as IPropertyRef;
  }

  private async resolveUnit(
    cuid: string,
    puid: string,
    propertyObjectId?: Types.ObjectId
  ): Promise<IUnitRef> {
    const unit = await this.propertyUnitDAO.findFirst({
      puid,
      cuid,
      deletedAt: null,
      ...(propertyObjectId ? { propertyId: propertyObjectId } : {}),
    });
    if (!unit) {
      throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Unit' }) });
    }
    return unit as unknown as IUnitRef;
  }

  async createExpense(
    cuid: string,
    userId: string,
    data: IExpenseCreateInput
  ): IPromiseReturnedData<IExpenseResponse> {
    try {
      const { pid, puid, ...expenseData } = data;
      const property = await this.resolveProperty(cuid, pid);
      const unit = puid ? await this.resolveUnit(cuid, puid, property._id) : null;

      const expense = await this.expenseDAO.insert({
        ...expenseData,
        propertyId: property._id,
        ...(unit ? { unitId: unit._id } : {}),
        cuid,
        createdBy: new Types.ObjectId(userId),
      });

      this.log.info({ expuid: expense.expuid, cuid }, 'Expense created');
      this.emitterService.emit(EventTypes.EXPENSE_CREATED, {
        expuid: expense.expuid,
        cuid,
        amount: expense.amount,
        category: expense.category,
      });
      // Re-read with refs populated so the response names the author by uid like reads do
      const hydrated = (await this.expenseDAO.findByExpuid(expense.expuid, cuid)) ?? expense;
      return {
        success: true,
        data: toExpenseResponse(hydrated, { property, unit }),
        message: t('common.success.created', { resource: 'Expense' }),
      };
    } catch (error) {
      this.log.error({ error }, 'Error creating expense');
      throw error;
    }
  }

  async listExpenses(cuid: string, query: IExpenseListQuery): IPromiseReturnedData<any> {
    try {
      const { pid, puid, ...rest } = query;
      const page = rest.page || 1;
      const limit = rest.limit || 20;
      const skip = (page - 1) * limit;

      const property = pid ? await this.resolveProperty(cuid, pid) : null;
      const unit = puid ? await this.resolveUnit(cuid, puid, property?._id) : null;
      const filters: IExpenseFilters = {
        ...rest,
        ...(property ? { propertyId: property._id.toString() } : {}),
        ...(unit ? { unitId: unit._id.toString() } : {}),
      };

      const result = await this.expenseDAO.findByClient(cuid, filters, { limit, skip });
      return {
        success: true,
        data: { ...result, items: result.items.map((expense) => toExpenseResponse(expense)) },
        message: t('common.success.retrieved', { resource: 'Expenses' }),
      };
    } catch (error) {
      this.log.error({ error }, 'Error listing expenses');
      throw error;
    }
  }

  async getExpenseById(expuid: string, cuid: string): IPromiseReturnedData<IExpenseResponse> {
    try {
      const expense = await this.expenseDAO.findByExpuid(expuid, cuid);
      if (!expense)
        throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Expense' }) });
      return {
        success: true,
        data: toExpenseResponse(expense),
        message: t('common.success.retrieved', { resource: 'Expense' }),
      };
    } catch (error) {
      this.log.error({ error }, 'Error getting expense');
      throw error;
    }
  }

  async updateExpense(
    expuid: string,
    cuid: string,
    data: IExpenseUpdateInput
  ): IPromiseReturnedData<IExpenseResponse> {
    try {
      const expense = await this.expenseDAO.findByExpuid(expuid, cuid);
      if (!expense)
        throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Expense' }) });

      const { pid, puid, ...fields } = data;
      const safeData: Record<string, any> = {};
      for (const field of UPDATABLE_FIELDS) {
        if (field in fields) {
          safeData[field] = fields[field as keyof typeof fields];
        }
      }

      const currentPropertyId = refObjectId(expense.propertyId);
      const property = pid ? await this.resolveProperty(cuid, pid) : null;
      const propertyChanged =
        !!property && (!currentPropertyId || !property._id.equals(currentPropertyId));
      if (property) safeData.propertyId = property._id;

      if (puid) {
        const unit = await this.resolveUnit(cuid, puid, property?._id ?? currentPropertyId);
        safeData.unitId = unit._id;
      } else if (propertyChanged) {
        // A unit from the previous property no longer applies once the property changes
        safeData.unitId = null;
      }

      const updated = await this.expenseDAO.update({ expuid, cuid }, { $set: safeData });
      this.emitterService.emit(EventTypes.EXPENSE_UPDATED, {
        expuid,
        cuid,
        amount: updated?.amount,
        category: updated?.category,
      });
      const hydrated = (await this.expenseDAO.findByExpuid(expuid, cuid)) ?? updated!;
      return {
        success: true,
        data: toExpenseResponse(hydrated),
        message: t('common.success.updated', { resource: 'Expense' }),
      };
    } catch (error) {
      this.log.error({ error }, 'Error updating expense');
      throw error;
    }
  }

  async softDeleteExpense(expuid: string, cuid: string): IPromiseReturnedData<void> {
    try {
      const expense = await this.expenseDAO.findByExpuid(expuid, cuid);
      if (!expense)
        throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Expense' }) });

      await this.expenseDAO.update({ expuid, cuid }, { $set: { deletedAt: new Date() } });
      this.emitterService.emit(EventTypes.EXPENSE_DELETED, {
        expuid,
        cuid,
        amount: expense.amount,
        category: expense.category,
      });
      return {
        success: true,
        data: undefined,
        message: t('common.success.deleted', { resource: 'Expense' }),
      };
    } catch (error) {
      this.log.error({ error }, 'Error deleting expense');
      throw error;
    }
  }

  async getPnLSummary(
    cuid: string,
    from: string,
    to: string,
    propertyId?: string
  ): IPromiseReturnedData<IPnLSummary> {
    try {
      const fromDate = new Date(from);
      const toDate = new Date(to);

      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        throw new BadRequestError({ message: 'Invalid date range' });
      }

      const dateMatch = { $gte: fromDate, $lte: toDate };

      // Income: join Payment → Lease, group by (currency, propertyId)
      const incomeRaw = await this.paymentDAO.getIncomeByPropertyAndCurrency(
        cuid,
        dateMatch,
        propertyId
      );

      // Expenses: group by (currency, category) and (currency, propertyId)
      const expMatch: Record<string, any> = { date: dateMatch };
      if (propertyId) expMatch.propertyId = new Types.ObjectId(propertyId);

      const [expByCategory, expByPropertyRaw] = await Promise.all([
        this.expenseDAO.aggregateByCategory(cuid, expMatch),
        this.expenseDAO.aggregateByProperty(cuid, expMatch),
      ]);

      // Resolve every grouped property (income + expenses) to its pid and name in one query —
      // the internal propertyId the aggregations group by never leaves the API
      const groupedPropertyIds = [
        ...new Set(
          [...incomeRaw, ...expByPropertyRaw]
            .map((r) => r._id.propertyId?.toString())
            .filter((id): id is string => !!id && Types.ObjectId.isValid(id))
        ),
      ];
      const groupedProperties = groupedPropertyIds.length
        ? await this.propertyDAO.aggregate([
            { $match: { _id: { $in: groupedPropertyIds.map((id) => new Types.ObjectId(id)) } } },
            { $project: { _id: 1, name: 1, pid: 1 } },
          ])
        : [];
      const propertyById = new Map<string, { pid?: string; name?: string }>(
        (groupedProperties as any[]).map((p: any) => [
          p._id.toString(),
          { pid: p.pid, name: p.name },
        ])
      );
      const propertyFor = (propertyId: unknown) =>
        propertyById.get(propertyId?.toString() ?? '') ?? {};

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
              pid: propertyFor(r._id.propertyId).pid,
              name: r.propertyName || propertyFor(r._id.propertyId).name || 'Unknown',
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
              pid: propertyFor(r._id.propertyId).pid,
              name: propertyFor(r._id.propertyId).name || 'Unknown',
              amount: r.total,
            })),
          },
          netIncome: incomeTotal - expenseTotal,
        };
      });

      return {
        success: true,
        data: { period: { from, to }, byCurrency },
        message: t('common.success.retrieved', { resource: 'P&L Summary' }),
      };
    } catch (error) {
      this.log.error({ error }, 'Error generating P&L summary');
      throw error;
    }
  }
}
