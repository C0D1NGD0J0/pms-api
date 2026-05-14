import dayjs from 'dayjs';
import Logger from 'bunyan';
import { FilterQuery, Model } from 'mongoose';
import { calcPercentage, createLogger, msToDays } from '@utils/index';
import { ListResultWithPagination } from '@interfaces/utils.interface';
import { PaymentRecordStatus, PaymentRecordType, IPaymentDocument } from '@interfaces/index';

import { BaseDAO } from './baseDAO';
import { IFindOptions } from './interfaces/baseDAO.interface';
import { IPaymentDAO } from './interfaces/paymentsDAO.interface';

export class PaymentDAO extends BaseDAO<IPaymentDocument> implements IPaymentDAO {
  private readonly log: Logger;

  constructor({ paymentModel }: { paymentModel: Model<IPaymentDocument> }) {
    super(paymentModel);
    this.log = createLogger('PaymentDAO');
  }

  async findByCuid(
    cuid: string,
    filters?: {
      status?: PaymentRecordStatus;
      paymentType?: PaymentRecordType;
      tenantId?: string;
      leaseId?: string;
      dueDate?: any;
    },
    opts?: IFindOptions
  ): ListResultWithPagination<IPaymentDocument[]> {
    try {
      if (!cuid) {
        throw new Error('Client ID is required');
      }

      // Exclude vendor expense records — those have vendorId set and are internal
      // accounting entries (cost side of a billable maintenance request), not
      // tenant-facing payments. Including them skews metrics and the payments list.
      const query: FilterQuery<IPaymentDocument> = {
        cuid,
        deletedAt: null,
        vendorId: { $exists: false },
      };

      if (filters?.status) query.status = filters.status;
      if (filters?.paymentType) query.paymentType = filters.paymentType;
      if (filters?.tenantId) query.tenant = filters.tenantId;
      if (filters?.leaseId) query.lease = filters.leaseId;
      if (filters?.dueDate) query.dueDate = filters.dueDate;

      const populateOpts = {
        ...opts,
        sort: opts?.sort || { dueDate: -1 },
        populate: opts?.populate || [
          { path: 'tenant', select: 'personalInfo.firstName personalInfo.lastName user' },
          { path: 'lease', select: 'luid leaseNumber status property duration' },
        ],
      };

      return await this.list(query, populateOpts);
    } catch (error: any) {
      this.log.error('Error finding payments by cuid:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async findByPid(
    pid: string,
    cuid: string,
    opts?: IFindOptions
  ): Promise<IPaymentDocument | null> {
    try {
      if (!pid || !cuid) {
        throw new Error('Payment ID and Client ID are required');
      }

      return await this.findFirst({ pid, cuid, deletedAt: null }, opts);
    } catch (error: any) {
      this.log.error('Error finding payment by pid:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async findByTenant(
    tenantId: string,
    cuid: string,
    status?: PaymentRecordStatus,
    opts?: IFindOptions
  ): ListResultWithPagination<IPaymentDocument[]> {
    try {
      if (!tenantId || !cuid) {
        throw new Error('Tenant ID and Client ID are required');
      }

      const query: FilterQuery<IPaymentDocument> = {
        tenant: tenantId,
        cuid,
        deletedAt: null,
      };

      if (status) query.status = status;

      const populateOpts = {
        ...opts,
        sort: opts?.sort || { dueDate: -1 },
        populate: opts?.populate || [
          { path: 'lease', select: 'luid leaseNumber status property duration' },
        ],
      };

      return await this.list(query, populateOpts);
    } catch (error: any) {
      this.log.error('Error finding payments by tenant:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async findByLease(
    leaseId: string,
    cuid: string,
    opts?: IFindOptions
  ): ListResultWithPagination<IPaymentDocument[]> {
    try {
      if (!leaseId || !cuid) {
        throw new Error('Lease ID and Client ID are required');
      }

      const populateOpts = {
        ...opts,
        sort: opts?.sort || { dueDate: -1 },
        populate: opts?.populate || [
          { path: 'tenant', select: 'personalInfo.firstName personalInfo.lastName user' },
        ],
      };

      return await this.list({ lease: leaseId, cuid, deletedAt: null }, populateOpts);
    } catch (error: any) {
      this.log.error('Error finding payments by lease:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async findOverduePayments(): ListResultWithPagination<IPaymentDocument[]> {
    try {
      return await this.list({
        status: { $in: [PaymentRecordStatus.PENDING, PaymentRecordStatus.OVERDUE] },
        dueDate: { $lt: dayjs().toDate() },
        deletedAt: null,
      });
    } catch (error: any) {
      this.log.error('Error finding overdue payments:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async findByPeriod(
    cuid: string,
    leaseId: string,
    month: number,
    year: number,
    opts?: IFindOptions
  ): Promise<IPaymentDocument | null> {
    try {
      if (!cuid || !leaseId) {
        throw new Error('Client ID and Lease ID are required');
      }

      if (!month || month < 1 || month > 12) {
        throw new Error('Valid month (1-12) is required');
      }

      if (!year || year < 2020) {
        throw new Error('Valid year (2020 or later) is required');
      }

      return await this.findFirst(
        {
          cuid,
          lease: leaseId,
          paymentType: PaymentRecordType.RENT,
          'period.month': month,
          'period.year': year,
          deletedAt: null,
        },
        opts
      );
    } catch (error: any) {
      this.log.error('Error finding payment by period:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async findByGatewayId(
    gatewayPaymentId: string,
    opts?: IFindOptions
  ): Promise<IPaymentDocument | null> {
    try {
      if (!gatewayPaymentId) {
        throw new Error('Gateway payment ID is required');
      }

      return await this.findFirst({ gatewayPaymentId, deletedAt: null }, opts);
    } catch (error: any) {
      this.log.error('Error finding payment by gateway ID:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async updateStatus(
    pid: string,
    cuid: string,
    status: PaymentRecordStatus,
    additionalData?: any
  ): Promise<IPaymentDocument | null> {
    try {
      if (!pid || !cuid) {
        throw new Error('Payment ID and Client ID are required');
      }

      if (!status || !Object.values(PaymentRecordStatus).includes(status)) {
        throw new Error('Valid payment status is required');
      }

      const update: any = { status, ...additionalData };

      if (status === PaymentRecordStatus.PAID) {
        update.paidAt = new Date();
      }

      return await this.update({ pid, cuid, deletedAt: null }, update);
    } catch (error: any) {
      this.log.error('Error updating payment status:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async getTenantPaymentMetrics(
    cuid: string,
    tenantId: string,
    options?: {
      includeHistory?: boolean;
      historyLimit?: number;
    }
  ): Promise<{
    payments: any[];
    metrics: {
      totalRentPaid: number;
      onTimePaymentRate: number;
      averagePaymentDelay: number;
    };
  }> {
    if (!cuid || !tenantId) {
      throw new Error('Client ID and Tenant ID are required');
    }

    try {
      const result = await this.list(
        {
          cuid,
          tenant: tenantId,
          deletedAt: null,
        },
        {
          sort: { dueDate: -1 },
        },
        true
      );

      const allPayments = result.items;

      const paidPayments = allPayments.filter((p: any) => p.status === PaymentRecordStatus.PAID);
      const totalRentPaid = paidPayments.reduce(
        (sum: number, p: any) => sum + (p.baseAmount || 0) + (p.processingFee || 0),
        0
      );

      const paymentsWithDueDate = paidPayments.filter((p: any) => p.dueDate && p.paidAt);
      const onTimePayments = paymentsWithDueDate.filter((p: any) => {
        const dueDate = new Date(p.dueDate);
        const paidDate = new Date(p.paidAt);
        return paidDate <= dueDate;
      });
      const onTimePaymentRate =
        paymentsWithDueDate.length > 0
          ? calcPercentage(onTimePayments.length, paymentsWithDueDate.length)
          : 0;

      const delaysInDays = paymentsWithDueDate.map((p: any) => {
        const dueDate = new Date(p.dueDate);
        const paidDate = new Date(p.paidAt);
        const diffMs = paidDate.getTime() - dueDate.getTime();
        return Math.max(0, msToDays(diffMs));
      });
      const averagePaymentDelay =
        delaysInDays.length > 0
          ? Math.round(
              delaysInDays.reduce((a: number, b: number) => a + b, 0) / delaysInDays.length
            )
          : 0;

      const historyLimit = options?.historyLimit || 50;
      const paymentHistory = options?.includeHistory
        ? allPayments.slice(0, historyLimit).map((payment: any) => ({
            id: payment._id.toString(),
            pytuid: payment.pytuid,
            invoiceNumber: payment.invoiceNumber,
            paymentType: payment.paymentType,
            amount: (payment.baseAmount || 0) + (payment.processingFee || 0),
            status: payment.status,
            dueDate: payment.dueDate,
            paidAt: payment.paidAt,
            createdAt: payment.createdAt,
          }))
        : [];

      return {
        payments: paymentHistory,
        metrics: {
          totalRentPaid,
          onTimePaymentRate,
          averagePaymentDelay,
        },
      };
    } catch (error: any) {
      this.log.error('Error getting tenant payment metrics:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Aggregated payment stats for a client (or a specific tenant's profile).
   * Used by MetricsService for the PM dashboard and by UserService for the tenant detail page.
   *
   * @param cuid  Client unique ID
   * @param opts  Optional scoping — if profileId is provided, stats are scoped to that tenant
   */
  async getPaymentStats(
    cuid: string,
    opts?: { profileId?: string }
  ): Promise<{
    byCurrency: Array<{
      currency: string;
      totalRevenue: number;
      monthRevenue: number;
      pendingAmount: number;
    }>;
    overdueCount: number;
    totalCount: number;
    onTimeRate: number;
    avgPaymentDelayDays: number;
  }> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Exclude vendor expense records — same reason as findByCuid().
    // These are internal cost-side accounting entries (vendorId set), not
    // tenant-facing payments. Including them skews dashboard stats.
    const match: Record<string, any> = { cuid, deletedAt: null, vendorId: { $exists: false } };
    if (opts?.profileId) {
      match.tenant = opts.profileId;
    }

    const results = await this.aggregate([
      { $match: match },
      {
        $facet: {
          revenue: [
            { $match: { status: PaymentRecordStatus.PAID } },
            {
              $group: {
                _id: '$currency',
                totalRevenue: { $sum: '$baseAmount' },
                monthRevenue: {
                  $sum: {
                    $cond: [{ $gte: ['$paidAt', monthStart] }, '$baseAmount', 0],
                  },
                },
              },
            },
          ],
          pending: [
            { $match: { status: PaymentRecordStatus.PENDING } },
            { $group: { _id: '$currency', pendingAmount: { $sum: '$baseAmount' } } },
          ],
          overdue: [{ $match: { status: PaymentRecordStatus.OVERDUE } }, { $count: 'count' }],
          timing: [
            {
              $match: {
                status: PaymentRecordStatus.PAID,
                dueDate: { $exists: true },
                paidAt: { $exists: true },
              },
            },
            {
              $project: {
                delayMs: { $subtract: ['$paidAt', '$dueDate'] },
                onTime: { $lte: ['$paidAt', '$dueDate'] },
              },
            },
            {
              $group: {
                _id: null,
                totalPaid: { $sum: 1 },
                onTimeCount: { $sum: { $cond: ['$onTime', 1, 0] } },
                avgDelayMs: { $avg: { $max: ['$delayMs', 0] } },
              },
            },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ]);

    const raw = (results[0] || {}) as any;
    const timing = raw.timing?.[0] || {};
    const totalPaid = timing.totalPaid || 0;
    const onTimeCount = timing.onTimeCount || 0;
    const avgDelayMs = timing.avgDelayMs || 0;

    // Zip revenue and pending arrays by currency
    const revMap = new Map<string, { totalRevenue: number; monthRevenue: number }>(
      (raw.revenue || []).map((r: any) => [
        r._id,
        { totalRevenue: r.totalRevenue || 0, monthRevenue: r.monthRevenue || 0 },
      ])
    );
    const pendMap = new Map<string, number>(
      (raw.pending || []).map((p: any) => [p._id, p.pendingAmount || 0])
    );
    const allCurrencies = new Set([...pendMap.keys(), ...revMap.keys()]);
    const byCurrency = [...allCurrencies].map((currency) => ({
      currency,
      totalRevenue: revMap.get(currency)?.totalRevenue ?? 0,
      monthRevenue: revMap.get(currency)?.monthRevenue ?? 0,
      pendingAmount: pendMap.get(currency) ?? 0,
    }));

    return {
      byCurrency,
      overdueCount: raw.overdue?.[0]?.count || 0,
      totalCount: raw.total?.[0]?.count || 0,
      onTimeRate: totalPaid > 0 ? calcPercentage(onTimeCount, totalPaid) : 0,
      avgPaymentDelayDays: avgDelayMs > 0 ? Math.round(msToDays(avgDelayMs)) : 0,
    };
  }

  /**
   * Aggregate paid payment income grouped by (currency, propertyId) for the P&L summary.
   * Joins Payment → Lease to resolve the property reference stored on the lease.
   *
   * @param cuid      Client unique ID (tenant isolation)
   * @param dateMatch Mongoose date filter applied to paidAt
   */
  async getIncomeByPropertyAndCurrency(
    cuid: string,
    dateMatch: { $gte: Date; $lte: Date }
  ): Promise<
    Array<{ _id: { currency: string; propertyId: string }; total: number; propertyName: string }>
  > {
    const results = await this.aggregate([
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
          _id: { currency: '$currency', propertyId: '$leaseDoc.property.id' },
          total: { $sum: '$baseAmount' },
          propertyName: { $first: '$leaseDoc.property.name' },
        },
      },
    ]);
    return results as unknown as Array<{
      _id: { currency: string; propertyId: string };
      total: number;
      propertyName: string;
    }>;
  }
}
