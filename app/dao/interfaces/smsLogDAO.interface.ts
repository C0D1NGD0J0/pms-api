import { ListResultWithPagination, ISMSLogDocument, SMSMessageType } from '@interfaces/index';

import { IFindOptions, IBaseDAO } from './baseDAO.interface';

export interface ISMSLogDAO extends IBaseDAO<ISMSLogDocument> {
  getLogsByCuid(
    cuid: string,
    filters?: { messageType?: SMSMessageType; status?: string },
    opts?: IFindOptions
  ): ListResultWithPagination<ISMSLogDocument[]>;
  getUsageByType(cuid: string, from: Date, to: Date): Promise<Record<string, number>>;
  createLog(data: Partial<ISMSLogDocument>): Promise<ISMSLogDocument>;
}
