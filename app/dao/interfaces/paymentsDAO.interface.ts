import { ListResultWithPagination } from '@interfaces/utils.interface';
import { PaymentRecordStatus, PaymentRecordType, IPaymentDocument } from '@interfaces/index';

import { IFindOptions } from './baseDAO.interface';

export interface IPaymentDAO {
  /**
   * Find payments by client with optional filters
   * @param cuid - Client ID
   * @param filters - Optional filters (status, paymentType, tenantId, leaseId)
   * @param opts - Additional query options (populate, select, sort)
   * @returns Paginated list of payments
   */
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

  /**
   * Find payments by tenant
   * @param tenantId - Tenant ID
   * @param cuid - Client ID
   * @param status - Optional payment status filter
   * @param opts - Additional query options
   * @returns Paginated list of tenant's payments
   */
  findByTenant(
    tenantId: string,
    cuid: string,
    status?: PaymentRecordStatus,
    opts?: IFindOptions
  ): ListResultWithPagination<IPaymentDocument[]>;

  /**
   * Find payment for specific month/year (duplicate rent prevention)
   * Critical for preventing duplicate rent invoices
   * @param cuid - Client ID
   * @param leaseId - Lease ID
   * @param month - Month (1-12)
   * @param year - Year (2020+)
   * @param opts - Additional query options
   * @returns Payment document or null
   */
  findByPeriod(
    cuid: string,
    leaseId: string,
    month: number,
    year: number,
    opts?: IFindOptions
  ): Promise<IPaymentDocument | null>;

  /**
   * Update payment status with optional additional data
   * Automatically sets paidAt when status is 'paid'
   * @param pid - Payment ID
   * @param cuid - Client ID
   * @param status - New payment status
   * @param additionalData - Optional additional fields to update
   * @returns Updated payment document or null
   */
  updateStatus(
    pid: string,
    cuid: string,
    status: PaymentRecordStatus,
    additionalData?: any
  ): Promise<IPaymentDocument | null>;

  /**
   * Find payments by lease
   * @param leaseId - Lease ID
   * @param cuid - Client ID
   * @param opts - Additional query options
   * @returns Paginated list of lease payments
   */
  findByLease(
    leaseId: string,
    cuid: string,
    opts?: IFindOptions
  ): ListResultWithPagination<IPaymentDocument[]>;

  /**
   * Find by gateway payment ID (Stripe invoice ID)
   * Used for webhook processing to locate payment by external ID
   * @param gatewayPaymentId - Stripe invoice ID or other gateway ID
   * @param opts - Additional query options
   * @returns Payment document or null
   */
  findByGatewayId(gatewayPaymentId: string, opts?: IFindOptions): Promise<IPaymentDocument | null>;

  /**
   * Find payment by pid (multi-tenant safe)
   * @param pid - Payment ID
   * @param cuid - Client ID
   * @param opts - Additional query options
   * @returns Payment document or null
   */
  findByPid(pid: string, cuid: string, opts?: IFindOptions): Promise<IPaymentDocument | null>;

  /**
   * Find overdue payments (for cron jobs)
   * Used to identify payments that need status updates or notifications
   * @returns Paginated list of overdue payments
   */
  findOverduePayments(): ListResultWithPagination<IPaymentDocument[]>;
}
