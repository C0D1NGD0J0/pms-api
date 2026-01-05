import { PdfWorker } from '@workers/index';
import { QUEUE_NAMES, JOB_NAME } from '@utils/index';
import { PdfJobData } from '@interfaces/pdfGenerator.interface';

import { BaseQueue } from './base.queue';

export class PdfQueue extends BaseQueue<PdfJobData> {
  constructor({ pdfGeneratorWorker }: { pdfGeneratorWorker: PdfWorker }) {
    super({ queueName: QUEUE_NAMES.PDF_GENERATION_QUEUE });
    this.processQueueJobs(JOB_NAME.PDF_GENERATION_JOB, 2, pdfGeneratorWorker.generatePdf);
  }

  addToPdfQueue(data: PdfJobData) {
    return this.addJobToQueue(JOB_NAME.PDF_GENERATION_JOB, data, {
      timeout: 360000, // 6 minutes - longer than worker timeout (5min)
      attempts: 1, // Only 1 retry - PDF generation is expensive
      backoff: { type: 'fixed', delay: 10000 },
    });
  }
}
