import { PdfWorker } from '@workers/index';
import { QUEUE_NAMES, JOB_NAME } from '@utils/index';
import { PdfJobData } from '@interfaces/pdfGenerator.interface';

import { BaseQueue } from './base.queue';

export class PdfQueue extends BaseQueue<PdfJobData> {
  constructor({ pdfGeneratorWorker }: { pdfGeneratorWorker: PdfWorker }) {
    super(QUEUE_NAMES.PDF_GENERATION_QUEUE);
    this.processQueueJobs(JOB_NAME.PDF_GENERATION_JOB, 2, pdfGeneratorWorker.generatePdf);
  }

  addToPdfQueue(data: PdfJobData): void {
    this.addJobToQueue(JOB_NAME.PDF_GENERATION_JOB, data);
  }
}
