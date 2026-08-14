import { ListResultWithPagination } from '@interfaces/utils.interface';
import { PaymentRecordStatus, PaymentRecordType, IPaymentDocument } from '@interfaces/index';

import { IFindOptions } from './baseDAO.interface';

export interface IPaymentDAO {
  findByCuid(
    cuid: string,
    filters?: {
      status?: PaymentRecordStatus;
      paymentType?: PaymentRecordType;
      tenantId?: string;
      leaseId?: string;
    },
    opts?: IFindOptions
  ): ListResultWithPagination<IPaymentDocument[]>;

  getIncomeByPropertyAndCurrency(
    cuid: string,
    dateMatch: { $gte: Date; $lte: Date }
  ): Promise<
    Array<{ _id: { currency: string; propertyId: string }; total: number; propertyName: string }>
  >;

  findByTenant(
    tenantId: string,
    cuid: string,
    status?: PaymentRecordStatus,
    opts?: IFindOptions
  ): ListResultWithPagination<IPaymentDocument[]>;

  /** Critical for duplicate rent prevention — finds existing payment for a specific month/year. */
  findByPeriod(
    cuid: string,
    leaseId: string,
    month: number,
    year: number,
    opts?: IFindOptions
  ): Promise<IPaymentDocument | null>;

  /** Automatically sets paidAt when status is 'paid'. */
  updateStatus(
    pid: string,
    cuid: string,
    status: PaymentRecordStatus,
    additionalData?: any
  ): Promise<IPaymentDocument | null>;

  findByGatewayId(
    gatewayPaymentId: string,
    cuid: string,
    opts?: IFindOptions
  ): Promise<IPaymentDocument | null>;

  findByLease(
    leaseId: string,
    cuid: string,
    opts?: IFindOptions
  ): ListResultWithPagination<IPaymentDocument[]>;

  findOverduePayments(
    extraFilter?: Record<string, any>
  ): ListResultWithPagination<IPaymentDocument[]>;

  findByPid(pid: string, cuid: string, opts?: IFindOptions): Promise<IPaymentDocument | null>;
}
