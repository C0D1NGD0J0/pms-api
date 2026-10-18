import { Job } from 'bull';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { EventEmitterService } from '@services/index';
import { SSEService } from '@services/sse/sse.service';
import { DiskStorage, S3Service } from '@services/fileUpload';
import { UploadJobData, UploadResult, EventTypes } from '@interfaces/index';
import { InspectionService } from '@services/inspection/inspection.service';

interface IConstructor {
  inspectionService: InspectionService;
  emitterService: EventEmitterService;
  sseService: SSEService;
  s3Service: S3Service;
}

export class UploadWorker {
  private readonly awsS3Service: S3Service;
  private readonly emitterService: EventEmitterService;
  private readonly inspectionService: InspectionService;
  private readonly sseService: SSEService;
  private diskStorage: DiskStorage;
  private log: Logger;

  constructor({ s3Service, emitterService, inspectionService, sseService }: IConstructor) {
    this.log = createLogger('FileUploadWorker');
    this.awsS3Service = s3Service;
    this.sseService = sseService;
    this.emitterService = emitterService;
    this.inspectionService = inspectionService;
  }

  uploadAsset = async (job: Job): Promise<void> => {
    const { results: result, resource } = job.data as UploadJobData;
    if (!result || result.length === 0) {
      this.log.error('No upload results to persist');
      return Promise.reject(new Error('No upload results to persist'));
    }

    if (!resource.resourceName || !resource.resourceId) {
      this.log.error('resource details are missing');
      return Promise.reject(new Error('Invalid resource details'));
    }

    try {
      // Only generated files (lease, invoice and inspection-report PDFs) are queued here: they
      // are already in S3, and this job saves the result and tells the client. User uploads
      // are saved during their own request (MediaUploadService.uploadRequestFiles).
      job.progress(20);
      this.log.info(`Persisting ${result.length} generated file(s)`, {
        resourceName: resource.resourceName,
        resourceId: resource.resourceId,
      });

      // Lease and invoice PDFs are saved by their UPLOAD_COMPLETED listeners (LeasePdfService,
      // InvoiceService), which then refresh caches and broadcast to the client.
      this.emitterService.emit(EventTypes.UPLOAD_COMPLETED, {
        results: result,
        actorId: resource.actorId,
        resourceType: resource.resourceType || 'document',
        resourceName: resource.resourceName,
        resourceId: resource.resourceId,
        fieldName: resource.fieldName,
      });

      if (resource.resourceName === 'inspection' && resource.fieldName === 'reportDocument') {
        await this.saveInspectionReport(resource.resourceId, result);
      }

      job.progress(100);
      this.log.info('Generated file persisted successfully');

      Promise.resolve('Documents uploaded successfully');
    } catch (error: any) {
      this.log.error(
        {
          resourceName: resource.resourceName,
          resourceId: resource.resourceId,
          error: error.stack,
        },
        `Error uploading documents: ${error.message}`
      );

      this.emitterService.emit(EventTypes.UPLOAD_FAILED, {
        error: {
          message: error.message,
          code: error.code,
          stack: error.stack,
        },
        resourceType: resource.resourceType || 'document',
        resourceName: resource.resourceName,
        resourceId: resource.resourceId,
      });

      return Promise.reject(new Error(error.message));
    }
  };

  /** Saves the report PDF, then tells everyone in the client it is ready. */
  private async saveInspectionReport(inspectionId: string, results: UploadResult[]) {
    const pdfResult = results.find((r) => r.key && r.url);
    if (!pdfResult) return;

    this.log.info(
      { resourceId: inspectionId },
      '[UploadWorker] updating inspection report document'
    );
    const saved = await this.inspectionService.updateReportDocument(inspectionId, pdfResult);
    if (!saved) return;

    // Inspections have no read cache; the client refetches on this event
    try {
      await this.sseService.broadcastToClient(
        saved.cuid,
        { resource: 'inspection', action: 'report-ready', resourceUId: saved.iuid },
        'resource-event'
      );
    } catch (err) {
      this.log.warn({ err }, '[UploadWorker] SSE notify failed (non-fatal)');
    }
  }

  deleteAsset = async (job: Job): Promise<void> => {
    const { data: s3Keys } = job.data as { data?: string[] };

    if (!s3Keys?.length) {
      this.log.error('No remote data-asset to delete.');
      return Promise.reject(new Error('No remote data-asset to delete.'));
    }

    this.log.info({ count: s3Keys.length }, 'Deleting remote assets');
    const deleted = await this.awsS3Service.deleteFiles(s3Keys);
    if (!deleted) {
      this.log.error({ s3Keys }, 'Remote asset deletion failed');
      return Promise.reject(new Error('Remote asset deletion failed'));
    }

    this.log.info({ count: s3Keys.length }, 'Remote assets deleted successfully');
  };
}
