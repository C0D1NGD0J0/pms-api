import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { type QueryFilter, Model } from 'mongoose';
import { ListResultWithPagination, ISMSLogDocument, SMSMessageType } from '@interfaces/index';

import { BaseDAO } from './baseDAO';
import { ISMSLogDAO } from './interfaces/smsLogDAO.interface';
import { IFindOptions } from './interfaces/baseDAO.interface';

export class SMSLogDAO extends BaseDAO<ISMSLogDocument> implements ISMSLogDAO {
  private readonly log: Logger;

  constructor({ smsLogModel }: { smsLogModel: Model<ISMSLogDocument> }) {
    super(smsLogModel);
    this.log = createLogger('SMSLogDAO');
  }

  async createLog(data: Partial<ISMSLogDocument>): Promise<ISMSLogDocument> {
    try {
      return await this.insert(data);
    } catch (error: any) {
      this.log.error({ error }, 'Error creating SMS log');
      throw this.throwErrorHandler(error);
    }
  }

  async getLogsByCuid(
    cuid: string,
    filters?: { messageType?: SMSMessageType; status?: string },
    opts?: IFindOptions
  ): ListResultWithPagination<ISMSLogDocument[]> {
    try {
      const query: QueryFilter<ISMSLogDocument> = { cuid };

      if (filters?.messageType) query.messageType = filters.messageType;
      if (filters?.status) query.status = filters.status as any;

      return await this.list(query, {
        ...opts,
        sort: { createdAt: -1 },
      });
    } catch (error: any) {
      this.log.error({ error }, 'Error fetching SMS logs');
      throw this.throwErrorHandler(error);
    }
  }

  async updateBySid(
    twilioSid: string,
    updateFields: Record<string, unknown>
  ): Promise<ISMSLogDocument | null> {
    try {
      return await this.update({ twilioSid } as any, { $set: updateFields });
    } catch (error: any) {
      this.log.error({ error, twilioSid }, 'Error updating SMS log by SID');
      throw this.throwErrorHandler(error);
    }
  }

  async getUsageByType(cuid: string, from: Date, to: Date): Promise<Record<string, number>> {
    try {
      const result = (await this.aggregate([
        {
          $match: {
            cuid,
            sentAt: { $gte: from, $lte: to },
          },
        },
        {
          $group: {
            _id: '$messageType',
            count: { $sum: 1 },
          },
        },
      ])) as unknown as Array<{ _id: string; count: number }>;

      const byType: Record<string, number> = {};
      for (const item of result) {
        byType[String(item._id)] = item.count;
      }
      return byType;
    } catch (error: any) {
      this.log.error({ error }, 'Error aggregating SMS usage by type');
      throw this.throwErrorHandler(error);
    }
  }
}
