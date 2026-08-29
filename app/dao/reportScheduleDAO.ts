import Logger from 'bunyan';
import { Model } from 'mongoose';
import { createLogger } from '@utils/index';
import { IReportScheduleDocument } from '@interfaces/report.interface';

import { BaseDAO } from './baseDAO';

export class ReportScheduleDAO extends BaseDAO<IReportScheduleDocument> {
  private readonly log: Logger;

  constructor({ reportScheduleModel }: { reportScheduleModel: Model<IReportScheduleDocument> }) {
    super(reportScheduleModel);
    this.log = createLogger('ReportScheduleDAO');
  }

  async upsertSchedule(
    cuid: string,
    data: Partial<IReportScheduleDocument>
  ): Promise<IReportScheduleDocument> {
    try {
      const { createdBy, cuid: _cuid, ...mutableData } = data;
      const result = await this.upsert(
        {
          $set: mutableData,
          $setOnInsert: { createdBy, cuid },
        },
        { cuid } as any,
        { runValidators: true }
      );

      if (!result) {
        throw new Error(`Failed to upsert schedule for cuid: ${cuid}`);
      }

      return result as unknown as IReportScheduleDocument;
    } catch (error: any) {
      this.log.error({ error, cuid }, 'Error upserting report schedule');
      throw this.throwErrorHandler(error);
    }
  }

  async getSchedule(cuid: string): Promise<IReportScheduleDocument | null> {
    try {
      return await this.findFirst({ cuid } as any);
    } catch (error: any) {
      this.log.error({ error, cuid }, 'Error getting report schedule');
      throw this.throwErrorHandler(error);
    }
  }

  async deactivateSchedule(cuid: string): Promise<IReportScheduleDocument | null> {
    try {
      return await this.update({ cuid } as any, { $set: { isActive: false } });
    } catch (error: any) {
      this.log.error({ error, cuid }, 'Error deactivating report schedule');
      throw this.throwErrorHandler(error);
    }
  }

  async getDueSchedules(now: Date): Promise<IReportScheduleDocument[]> {
    try {
      const result = await this.list({ isActive: true, nextRunAt: { $lte: now } } as any);
      return result.items;
    } catch (error: any) {
      this.log.error({ error }, 'Error fetching due report schedules');
      throw this.throwErrorHandler(error);
    }
  }

  async advanceNextRunAt(scheduleId: string, nextRunAt: Date): Promise<void> {
    try {
      const updated = await this.updateById(scheduleId, { $set: { nextRunAt } });
      if (!updated) {
        this.log.warn({ scheduleId }, 'advanceNextRunAt: schedule not found');
      }
    } catch (error: any) {
      this.log.error({ error, scheduleId }, 'Error advancing schedule nextRunAt');
      throw this.throwErrorHandler(error);
    }
  }
}
