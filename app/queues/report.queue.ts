import { ReportWorker } from '@workers/index';
import { QUEUE_NAMES, JOB_NAME } from '@utils/index';
import { IReportJobData } from '@interfaces/report.interface';

import { BaseQueue } from './base.queue';

export class ReportQueue extends BaseQueue<IReportJobData> {
  constructor({ reportWorker }: { reportWorker: ReportWorker }) {
    super({ queueName: QUEUE_NAMES.REPORT_QUEUE });
    this.processQueueJobs(JOB_NAME.GENERATE_REPORT_JOB, 2, reportWorker.handleGenerateReport);
  }

  addReportJob(data: IReportJobData) {
    return this.addJobToQueue(JOB_NAME.GENERATE_REPORT_JOB, data, {
      timeout: 600000, // 10 minutes
      attempts: 2,
      backoff: { type: 'fixed', delay: 15000 },
    });
  }
}
