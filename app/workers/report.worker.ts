import { Job } from 'bull';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { IReportJobData } from '@interfaces/report.interface';
import { ReportService } from '@services/report/report.service';

interface IConstructor {
  reportService: ReportService;
}

export class ReportWorker {
  private readonly reportService: ReportService;
  private log: Logger;

  constructor({ reportService }: IConstructor) {
    this.log = createLogger('ReportWorker');
    this.reportService = reportService;
  }

  handleGenerateReport = async (job: Job<IReportJobData>): Promise<{ success: boolean }> => {
    this.log.info({ reportId: job.data.reportId }, 'Starting report generation');
    await job.progress(5);
    await this.reportService.processReport(job);
    await job.progress(100);
    return { success: true };
  };
}
