import { Job } from 'bull';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { EventEmitterService } from '@services/index';
import { PdfJobResult, PdfJobData } from '@interfaces/pdfGenerator.interface';
import {
  PdfGenerationRequestedPayload,
  PdfGenerationFailedPayload,
  PdfGeneratedPayload,
  EventTypes,
} from '@interfaces/events.interface';

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
    const { resource, templateType, cuid } = job.data;
    this.log.info(`Processing PDF generation job ${job.id} for client ${cuid}`);
    job.progress(10);

    try {
      job.progress(30);
      this.emitterService.emit(EventTypes.PDF_GENERATION_REQUESTED, {
        jobId: job.id,
        templateType,
        resource,
        cuid,
      } as PdfGenerationRequestedPayload);
      return new Promise<PdfJobResult>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('PDF generation timeout after 5 minutes'));
        }, 300000);

        const onGenerated = (payload: PdfGeneratedPayload) => {
          if (payload.jobId === job.id) {
            cleanup();
            job.progress(100);
            resolve({
              success: true,
              resource,
              pdfUrl: payload.pdfUrl,
              s3Key: payload.s3Key,
              fileSize: payload.fileSize,
              generationTime: payload.generationTime,
            });
          }
        };

        const onFailed = (payload: PdfGenerationFailedPayload) => {
          if (payload.jobId === job.id) {
            cleanup();
            resolve({
              success: false,
              resource: resource,
              error: payload.error,
            });
          }
        };

        const cleanup = () => {
          clearTimeout(timeout);
          this.emitterService.off(EventTypes.PDF_GENERATED, onGenerated);
          this.emitterService.off(EventTypes.PDF_GENERATION_FAILED, onFailed);
        };

        this.emitterService.on(EventTypes.PDF_GENERATED, onGenerated);
        this.emitterService.on(EventTypes.PDF_GENERATION_FAILED, onFailed);
      });
    } catch (error) {
      this.log.error(`Error processing PDF generation job ${job.id}:`, error);
      return {
        success: false,
        resource,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  };
}
