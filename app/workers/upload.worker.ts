import { Job } from 'bull';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { EventEmitterService } from '@services/index';
import { SSEService } from '@services/sse/sse.service';
import { DiskStorage, S3Service } from '@services/fileUpload';
import { UploadJobData, EventTypes } from '@interfaces/index';
import { MaintenanceRequestService } from '@services/maintenanceRequest/serviceRequest.service';

interface IConstructor {
  maintenanceRequestService: MaintenanceRequestService;
  emitterService: EventEmitterService;
  sseService: SSEService;
  s3Service: S3Service;
}

export class UploadWorker {
  private readonly awsS3Service: S3Service;
  private readonly emitterService: EventEmitterService;
  private readonly maintenanceRequestService: MaintenanceRequestService;
  private readonly sseService: SSEService;
  private diskStorage: DiskStorage;
  private log: Logger;

  constructor({ s3Service, emitterService, maintenanceRequestService, sseService }: IConstructor) {
    this.log = createLogger('FileUploadWorker');
    this.awsS3Service = s3Service;
    this.sseService = sseService;
    this.emitterService = emitterService;
    this.maintenanceRequestService = maintenanceRequestService;
  }

  uploadAsset = async (job: Job): Promise<void> => {
    const { files, resource } = job.data as UploadJobData;
    if (!files || files.length === 0) {
      this.log.error('No files to upload');
      return Promise.reject(new Error('No files to upload'));
    }

    if (!resource.resourceName || !resource.resourceId) {
      this.log.error('resource details are missing');
      return Promise.reject(new Error('Invalid resource details'));
    }

    try {
      job.progress(20);
      this.log.info(`Starting S3 upload for ${files.length} files`, {
        resourceName: resource.resourceName,
        resourceId: resource.resourceId,
      });

      // Map ExtractedMediaFile[] to UploadedFile[] format
      const uploadFiles = files.map((file) => ({
        originalFileName: file.originalFileName,
        fileSize: file.fileSize,
        fieldName: file.fieldName,
        mimeType: file.mimeType,
        fileName: file.filename, // Map filename to fileName
        path: file.path,
      }));

      const result = await this.awsS3Service.uploadFiles(uploadFiles, resource);

      job.progress(70);
      this.log.info('S3 upload completed, emitting UPLOAD_COMPLETED event');

      this.emitterService.emit(EventTypes.UPLOAD_COMPLETED, {
        results: result,
        actorId: resource.actorId,
        resourceType: resource.resourceType || 'document',
        resourceName: resource.resourceName,
        resourceId: resource.resourceId,
        fieldName: resource.fieldName,
      });

      // Direct dispatch for maintenance — the event-based listener in
      // MaintenanceRequestService is never registered in the worker process
      // (the service isn't in any queue's dependency chain), so we call it
      // directly here, mirroring the PropertyMediaWorker pattern.
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

      job.progress(90);

      const filesNames = result.map((file) => file.filename);
      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, filesNames);

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
        resourceId: resource.resourceId,
      });

      return Promise.reject(new Error(error.message));
    }
  };

  deleteAsset = async (job: Job): Promise<void> => {
    const { data } = job.data;

    if (!data || data.length === 0) {
      this.log.error('No remote data-asset to delete.');
      return Promise.reject(new Error('No remote data-asset to delete.'));
    }

    try {
      const result = await this.awsS3Service.deleteFile(data);
      if (result) {
        this.log.info('Remote asset deleted successfully');
        Promise.resolve('Remote asset deleted successfully');
      } else {
        return Promise.reject(new Error('Remote asset deletion failed'));
      }
    } catch (error: any) {
      this.log.error(`Error uploading image: ${error.message}`);
      return Promise.reject(new Error(error.message));
    }
    this.log.info('Deleting remote asset');
  };
}
