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

  /**
   * Find payments by client with filters
   */
  async findByCuid(
    cuid: string,
    filters?: {
      status?: PaymentRecordStatus;
      paymentType?: PaymentRecordType;
      tenantId?: string;
      leaseId?: string;
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

  /**
   * Find payment by pid (multi-tenant safe)
   */
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

  /**
   * Find payments by tenant
   */
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

  /**
   * Find payments by lease
   */
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

  /**
   * Find overdue payments (for cron)
   */
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

  /**
   * Find payment for specific month/year (rent generation check)
   */
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

  /**
   * Find by gateway payment ID (Stripe invoice ID)
   */
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

  /**
   * Update payment status
   */
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
}
