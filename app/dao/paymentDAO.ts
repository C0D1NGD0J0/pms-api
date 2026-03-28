import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { FilterQuery, Model } from 'mongoose';
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

      const query: FilterQuery<IPaymentDocument> = { cuid, deletedAt: null };

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
        dueDate: { $lt: new Date() },
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
          ? Math.round((onTimePayments.length / paymentsWithDueDate.length) * 100)
          : 0;

      const delaysInDays = paymentsWithDueDate.map((p: any) => {
        const dueDate = new Date(p.dueDate);
        const paidDate = new Date(p.paidAt);
        const diffMs = paidDate.getTime() - dueDate.getTime();
        return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
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
}
