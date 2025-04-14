import { Job } from 'bull';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { PropertyService } from '@services/index';
import { UploadJobData, ResourceInfo } from '@interfaces/index';
import { UploadResult, DiskStorage, S3Service } from '@services/fileUpload';

interface IConstructor {
  propertyService: PropertyService;
  diskStorage: DiskStorage;
  s3Service: S3Service;
}

export class UploadWorker {
  private readonly awsS3Service: S3Service;
  private propertyService: PropertyService;
  private diskStorage: DiskStorage;
  private log: Logger;

  constructor({ s3Service, propertyService, diskStorage }: IConstructor) {
    this.log = createLogger('FileUploadWorker');
    this.awsS3Service = s3Service;
    this.diskStorage = diskStorage;
    this.propertyService = propertyService;
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
      const result = await this.awsS3Service.uploadFiles(files, resource);
      await this.updateResourceWithFileInfo(result, resource);
      const filesNames = result.map((file) => file.filename);
      this.diskStorage.deleteFiles(filesNames);
      console.log(result, '-------------upload-worker----------');
      Promise.resolve('Image uploaded successfully');
    } catch (error: any) {
      this.log.error(`Error uploading image: ${error.message}`);
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

  private async updateResourceWithFileInfo(
    uploadResults: UploadResult[],
    resource: ResourceInfo
  ): Promise<void> {
    switch (resource.resourceName) {
      case 'property':
        await this.propertyService.updateDocuments(resource.resourceId, uploadResults);
        break;
      default:
        this.log.warn(`Unknown resource type: ${resource.resourceName}`);
    }
  }
}
