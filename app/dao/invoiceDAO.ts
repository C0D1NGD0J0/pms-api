import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { type QueryFilter, Model, Types } from 'mongoose';
import { ListResultWithPagination } from '@interfaces/utils.interface';
import {
  TenantPaymentStatus,
  IInvoiceDocument,
  InvoiceStatus,
} from '@interfaces/invoice.interface';

import { BaseDAO } from './baseDAO';

export class InvoiceDAO extends BaseDAO<IInvoiceDocument> {
  private readonly log: Logger;

  constructor({ invoiceModel }: { invoiceModel: Model<IInvoiceDocument> }) {
    super(invoiceModel);
    this.log = createLogger('InvoiceDAO');
  }

  async findByInvuid(invuid: string, cuid: string): Promise<IInvoiceDocument | null> {
    try {
      return await this.findFirst({ invuid, cuid, isDeleted: false });
    } catch (error: any) {
      this.log.error({ error }, 'Error finding invoice by invuid');
      throw this.throwErrorHandler(error);
    }
  }

  async findByMaintenanceRequest(mruid: string, cuid: string): Promise<IInvoiceDocument | null> {
    try {
      return await this.findFirst({ mruid, cuid, isDeleted: false }, { sort: { createdAt: -1 } });
    } catch (error: any) {
      this.log.error({ error }, 'Error finding invoice by maintenance request');
      throw this.throwErrorHandler(error);
    }
  }

  async listAllByMaintenanceRequest(mruid: string, cuid: string): Promise<IInvoiceDocument[]> {
    try {
      const { items } = await this.list(
        { mruid, cuid, isDeleted: false },
        { sort: { createdAt: -1 } }
      );
      return items;
    } catch (error: any) {
      this.log.error({ error }, 'Error listing all invoices by maintenance request');
      throw this.throwErrorHandler(error);
    }
  }

  async listByClient(
    cuid: string,
    filters?: { status?: InvoiceStatus; page?: number; limit?: number }
  ): ListResultWithPagination<IInvoiceDocument[]> {
    try {
      const query: QueryFilter<IInvoiceDocument> = { cuid, isDeleted: false };
      if (filters?.status) query.status = filters.status;

      return await this.list(query, {
        page: filters?.page,
        limit: filters?.limit,
        sort: { createdAt: -1 },
      });
    } catch (error: any) {
      this.log.error({ error }, 'Error listing invoices');
      throw this.throwErrorHandler(error);
    }
  }

  async sumByVendor(
    vendorId: Types.ObjectId,
    cuid: string,
    statuses: InvoiceStatus[]
  ): Promise<number> {
    try {
      const result = await this.aggregate([
        {
          $match: {
            cuid,
            submittedBy: vendorId,
            status: { $in: statuses },
            isDeleted: false,
          },
        },
        { $group: { _id: null, total: { $sum: '$amountInCents' } } },
      ]);
      return (result as unknown as Array<{ total: number }>)[0]?.total ?? 0;
    } catch (error: any) {
      this.log.error({ error }, 'Error summing vendor invoices');
      throw this.throwErrorHandler(error);
    }
  }

  async findPendingFundsCheck(limit = 500): Promise<IInvoiceDocument[]> {
    try {
      const { items } = await this.list(
        {
          vendorPayoutStatus: 'pending',
          tenantPaymentStatus: TenantPaymentStatus.PAID,
          fundsAvailable: false,
          isDeleted: false,
        },
        { limit, sort: { createdAt: 1 } }
      );
      return items;
    } catch (error: any) {
      this.log.error({ error }, 'Error finding invoices pending funds check');
      throw this.throwErrorHandler(error);
    }
  }

  async findReadyForAutoPayout(limit = 100): Promise<IInvoiceDocument[]> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 5);

      const { items } = await this.list(
        {
          vendorPayoutStatus: 'pending',
          tenantPaymentStatus: TenantPaymentStatus.PAID,
          fundsAvailable: true,
          fundsAvailableAt: { $lte: cutoff },
          status: InvoiceStatus.APPROVED,
          isDeleted: false,
        },
        { limit, sort: { fundsAvailableAt: 1 } }
      );
      return items;
    } catch (error: any) {
      this.log.error({ error }, 'Error finding invoices ready for auto-payout');
      throw this.throwErrorHandler(error);
    }
  }

  async listByVendor(
    vendorId: string | string[],
    cuid: string,
    filters?: { status?: InvoiceStatus; page?: number; limit?: number }
  ): ListResultWithPagination<IInvoiceDocument[]> {
    try {
      const submittedBy = Array.isArray(vendorId)
        ? { $in: vendorId.map((id) => new Types.ObjectId(id)) }
        : new Types.ObjectId(vendorId);

      const query: QueryFilter<IInvoiceDocument> = {
        cuid,
        submittedBy,
        isDeleted: false,
      };
      if (filters?.status) query.status = filters.status;

      return await this.list(query, {
        page: filters?.page,
        limit: filters?.limit,
        sort: { createdAt: -1 },
      });
    } catch (error: any) {
      this.log.error({ error }, 'Error listing vendor invoices');
      throw this.throwErrorHandler(error);
    }
  }
}
