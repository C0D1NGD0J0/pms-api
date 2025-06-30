import { Job } from 'bull';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { EventEmitterService } from '@services/index';
import { DiskStorage, S3Service } from '@services/fileUpload';
import { UploadJobData, EventTypes } from '@interfaces/index';

interface IConstructor {
  emitterService: EventEmitterService;
  s3Service: S3Service;
}

export class UploadWorker {
  private readonly awsS3Service: S3Service;
  private readonly emitterService: EventEmitterService;
  private diskStorage: DiskStorage;
  private log: Logger;

  constructor({ s3Service, emitterService }: IConstructor) {
    this.log = createLogger('FileUploadWorker');
    this.awsS3Service = s3Service;
    this.emitterService = emitterService;
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

      const result = await this.awsS3Service.uploadFiles(files, resource);

      job.progress(70);
      this.log.info('S3 upload completed, emitting UPLOAD_COMPLETED event');

      this.emitterService.emit(EventTypes.UPLOAD_COMPLETED, {
        results: result,
        actorId: resource.actorId,
        resourceType: resource.resourceType || 'document',
        resourceName: resource.resourceName,
        resourceId: resource.resourceId,
      });

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
