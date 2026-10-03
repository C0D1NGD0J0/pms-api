import { Job } from 'bull';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { EventEmitterService } from '@services/index';
import { SSEService } from '@services/sse/sse.service';
import { DiskStorage, S3Service } from '@services/fileUpload';
import { UploadJobData, EventTypes } from '@interfaces/index';
import { InspectionService } from '@services/inspection/inspection.service';
import { PropertyMediaService } from '@services/property/propertyMedia.service';
import { MaintenanceRequestService } from '@services/maintenanceRequest/serviceRequest.service';

interface IConstructor {
  maintenanceRequestService: MaintenanceRequestService;
  propertyMediaService: PropertyMediaService;
  inspectionService: InspectionService;
  emitterService: EventEmitterService;
  sseService: SSEService;
  s3Service: S3Service;
}

export class UploadWorker {
  private readonly awsS3Service: S3Service;
  private readonly emitterService: EventEmitterService;
  private readonly maintenanceRequestService: MaintenanceRequestService;
  private readonly propertyMediaService: PropertyMediaService;
  private readonly inspectionService: InspectionService;
  private readonly sseService: SSEService;
  private diskStorage: DiskStorage;
  private log: Logger;

  constructor({
    s3Service,
    emitterService,
    maintenanceRequestService,
    propertyMediaService,
    inspectionService,
    sseService,
  }: IConstructor) {
    this.log = createLogger('FileUploadWorker');
    this.awsS3Service = s3Service;
    this.sseService = sseService;
    this.emitterService = emitterService;
    this.maintenanceRequestService = maintenanceRequestService;
    this.propertyMediaService = propertyMediaService;
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
      // The files are already in S3 (uploaded by the process that received them);
      // this job only persists the results and notifies.
      job.progress(20);
      this.log.info(`Persisting ${result.length} uploaded file(s)`, {
        resourceName: resource.resourceName,
        resourceId: resource.resourceId,
      });

      this.emitterService.emit(EventTypes.UPLOAD_COMPLETED, {
        results: result,
        actorId: resource.actorId,
        resourceType: resource.resourceType || 'document',
        resourceName: resource.resourceName,
        resourceId: resource.resourceId,
        fieldName: resource.fieldName,
      });

      // Upload results are persisted by calling each resource's service directly
      // (maintenance, property, inspection below), so the job only completes once
      // the DB write succeeds.
      if (resource.resourceName === 'maintenance' && result.length > 0) {
        this.log.info(
          { mruid: resource.resourceId, fileCount: result.length },
          '[UploadWorker] persisting maintenance media to DB'
        );
        const cuid = await this.maintenanceRequestService.persistUploadedMedia(
          resource.resourceId,
          result,
          resource.actorId
        );
        this.log.info(
          { mruid: resource.resourceId },
          '[UploadWorker] maintenance media persisted successfully'
        );
        if (cuid) {
          try {
            await this.sseService.sendToUser(
              resource.actorId,
              cuid,
              {
                resource: 'maintenance',
                action: 'media-updated',
                resourceUId: resource.resourceId,
                count: result.length,
              },
              'resource-event'
            );
          } catch (err) {
            this.log.warn({ err }, '[UploadWorker] SSE notify failed (non-fatal)');
          }
        }
      }

      if (resource.resourceName === 'property' && result.length > 0) {
        this.log.info(
          { pid: resource.resourceId, fileCount: result.length },
          '[UploadWorker] persisting property media to DB'
        );
        await this.propertyMediaService.updatePropertyDocuments(
          resource.resourceId,
          result,
          resource.actorId
        );
        this.log.info(
          { pid: resource.resourceId },
          '[UploadWorker] property media persisted successfully'
        );
      }

      // Inspection report document — update DB and notify PM
      if (
        resource.resourceName === 'inspection' &&
        resource.fieldName === 'reportDocument' &&
        result.length > 0
      ) {
        const pdfResult = result.find((r) => r.key && r.url);
        if (pdfResult) {
          this.log.info(
            { resourceId: resource.resourceId },
            '[UploadWorker] updating inspection report document'
          );
          const cuid = await this.inspectionService.updateReportDocument(
            resource.resourceId,
            pdfResult
          );
          if (cuid) {
            try {
              await this.sseService.broadcastToClient(
                cuid,
                { resource: 'inspection', action: 'report-ready' },
                'resource-event'
              );
            } catch (err) {
              this.log.warn({ err }, '[UploadWorker] SSE notify failed (non-fatal)');
            }
          }
        }
      }

      // Inspection room media — persist to DB and notify user
      if (
        resource.resourceName === 'inspection' &&
        resource.fieldName !== 'reportDocument' &&
        result.length > 0
      ) {
        this.log.info(
          { iuid: resource.resourceId, fileCount: result.length, roomIndex: resource.roomIndex },
          '[UploadWorker] persisting inspection media to DB'
        );
        const cuid = await this.inspectionService.persistUploadedMedia(
          resource.resourceId,
          result,
          resource.actorId,
          resource.roomIndex
        );
        this.log.info(
          { iuid: resource.resourceId },
          '[UploadWorker] inspection media persisted successfully'
        );
        if (cuid) {
          try {
            await this.sseService.sendToUser(
              resource.actorId,
              cuid,
              {
                resource: 'inspection',
                action: 'media-updated',
                resourceUId: resource.resourceId,
                count: result.length,
              },
              'resource-event'
            );
          } catch (err) {
            this.log.warn({ err }, '[UploadWorker] SSE notify failed (non-fatal)');
          }
        }
      }

      job.progress(100);
      this.log.info('Document upload process completed successfully');

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
