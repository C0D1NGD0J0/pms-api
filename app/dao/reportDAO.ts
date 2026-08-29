import Logger from 'bunyan';
import { Model } from 'mongoose';
import { createLogger } from '@utils/index';
import { IPaginationQuery } from '@interfaces/utils.interface';
import { IReportDocument, ReportStatus } from '@interfaces/report.interface';

import { BaseDAO } from './baseDAO';

export class ReportDAO extends BaseDAO<IReportDocument> {
  private readonly log: Logger;

  constructor({ reportModel }: { reportModel: Model<IReportDocument> }) {
    super(reportModel);
    this.log = createLogger('ReportDAO');
  }

  async createReport(data: Partial<IReportDocument>): Promise<IReportDocument> {
    try {
      return await this.insert(data);
    } catch (error: any) {
      this.log.error({ error }, 'Error creating report');
      throw this.throwErrorHandler(error);
    }
  }

  async updateStatus(
    reportId: string,
    status: ReportStatus,
    additionalFields?: Record<string, any>
  ): Promise<IReportDocument | null> {
    try {
      return await this.updateById(reportId, {
        $set: { status, ...additionalFields },
      });
    } catch (error: any) {
      this.log.error({ error, reportId }, 'Error updating report status');
      throw this.throwErrorHandler(error);
    }
  }

  async listByClient(cuid: string, query?: IPaginationQuery) {
    try {
      return await this.list({ cuid }, { ...query, sort: { createdAt: -1 }, projection: '-file' });
    } catch (error: any) {
      this.log.error({ error, cuid }, 'Error listing reports');
      throw this.throwErrorHandler(error);
    }
  }
}
