import { Job } from 'bull';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { EventEmitterService } from '@services/index';
import { PdfJobResult, PdfJobData } from '@interfaces/pdfGenerator.interface';
import { PdfGenerationRequestedPayload, EventTypes } from '@interfaces/events.interface';

interface IConstructor {
  emitterService: EventEmitterService;
}

export class PdfWorker {
  private readonly emitterService: EventEmitterService;
  private log: Logger;

  constructor({ emitterService }: IConstructor) {
    this.log = createLogger('PdfWorker');
    this.emitterService = emitterService;
  }

  generatePdf = async (job: Job<PdfJobData>): Promise<PdfJobResult> => {
    const { resource, templateType, cuid, senderInfo } = job.data;

    job.progress(50);
    this.emitterService.emit(EventTypes.PDF_GENERATION_REQUESTED, {
      jobId: job.id,
      resource,
      templateType,
      cuid,
      senderInfo,
    } as PdfGenerationRequestedPayload);

    job.progress(100);
    this.log.info(`PDF generation request emitted for job ${job.id}`);
    return {
      success: true,
      resource,
    };
  };
}
