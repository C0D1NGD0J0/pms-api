import Logger from 'bunyan';
import { UploadQueue } from '@queues/upload.queue';
import { createLogger, JOB_NAME } from '@utils/index';
import { AssetService } from '@services/asset/asset.service';
import {
  ExtractedMediaFile,
  ResourceContext,
  ResourceInfo,
  AppRequest,
} from '@interfaces/utils.interface';

interface IConstructor {
  assetService: AssetService;
  uploadQueue: UploadQueue;
}

export class MediaUploadService {
  private readonly assetService: AssetService;
  private readonly uploadQueue: UploadQueue;
  private readonly logger: Logger;

  constructor({ assetService, uploadQueue }: IConstructor) {
    this.assetService = assetService;
    this.uploadQueue = uploadQueue;
    this.logger = createLogger('MediaUploadService');
  }

  async handleFiles(
    req: AppRequest,
    context: {
      primaryResourceId: string;
      uploadedBy: string;
      resourceContext?: ResourceContext;
    }
  ): Promise<{
    hasFiles: boolean;
    processedFiles: Record<string, { queuedCount: number; message: string }>;
    totalQueued: number;
    message?: string;
  }> {
    try {
      const files = req.body.scannedFiles as ExtractedMediaFile[] | undefined;

      if (!files || files.length === 0) {
        this.logger.debug('No files found in request');
        return {
          hasFiles: false,
          processedFiles: {},
          totalQueued: 0,
          message: 'No files to process',
        };
      }

      const groupedFiles = this.groupFilesByResource(files, context);

      const processedFiles: Record<string, { queuedCount: number; message: string }> = {};
      let totalQueued = 0;

      for (const [resourceKey, { resourceInfo, fileGroup }] of Object.entries(groupedFiles)) {
        if (fileGroup.length > 0) {
          this.uploadQueue.addToUploadQueue(JOB_NAME.MEDIA_UPLOAD_JOB, {
            resource: resourceInfo,
            files: fileGroup,
          });

          processedFiles[resourceKey] = {
            queuedCount: fileGroup.length,
            message: `${fileGroup.length} ${resourceKey} file(s) queued for processing`,
          };

          totalQueued += fileGroup.length;

          this.logger.info(`Queued ${fileGroup.length} ${resourceKey} files for processing`, {
            resourceName: resourceInfo.resourceName,
            resourceId: resourceInfo.resourceId,
            fieldName: resourceInfo.fieldName,
            fileCount: fileGroup.length,
          });
        }
      }

      return {
        hasFiles: true,
        processedFiles,
        totalQueued,
        message: `${totalQueued} file(s) queued for processing across ${Object.keys(processedFiles).length} resource type(s)`,
      };
    } catch (error) {
      this.logger.error('Error handling file uploads:', error);
      throw error;
    }
  }

  private groupFilesByResource(
    files: ExtractedMediaFile[],
    context: {
      primaryResourceId: string;
      uploadedBy: string;
      resourceContext?: ResourceContext;
    }
  ): Record<string, { resourceInfo: ResourceInfo; fileGroup: ExtractedMediaFile[] }> {
    const groups: Record<string, { resourceInfo: ResourceInfo; fileGroup: ExtractedMediaFile[] }> =
      {};

    for (const file of files) {
      const routingInfo = this.getFileRouting(file.fieldName, context);
      const groupKey = `${routingInfo.resourceName}_${routingInfo.fieldName}`;

      if (!groups[groupKey]) {
        groups[groupKey] = {
          resourceInfo: {
            resourceType: this.determineMediaType(file.mimeType),
            resourceName: routingInfo.resourceName,
            resourceId: routingInfo.resourceId,
            fieldName: routingInfo.fieldName,
            actorId: context.uploadedBy,
          },
          fileGroup: [],
        };
      }

      groups[groupKey].fileGroup.push(file);
    }

    return groups;
  }

  private getFileRouting(
    fieldName: string,
    context: {
      primaryResourceId: string;
      resourceContext?: ResourceContext;
    }
  ): {
    resourceName: 'property' | 'profile' | 'client';
    resourceId: string;
    fieldName: string;
  } {
    if (fieldName.includes('avatar') || fieldName.startsWith('personalInfo.avatar')) {
      return {
        resourceName: 'profile',
        resourceId: context.primaryResourceId,
        fieldName: 'avatar',
      };
    }

    if (fieldName.includes('documents') || fieldName.startsWith('documents.')) {
      return {
        resourceName: 'property',
        resourceId: context.primaryResourceId,
        fieldName: 'documents',
      };
    }

    if (context.resourceContext === ResourceContext.USER_PROFILE) {
      return {
        resourceName: 'profile',
        resourceId: context.primaryResourceId,
        fieldName: fieldName.split('.')[0] || 'media',
      };
    }

    return {
      resourceName: 'property',
      resourceId: context.primaryResourceId,
      fieldName: fieldName.split('.')[0] || 'media',
    };
  }

  private determineMediaType(mimeType?: string): 'image' | 'video' | 'document' | 'unknown' {
    if (!mimeType) return 'unknown';

    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (
      mimeType === 'application/pdf' ||
      mimeType.startsWith('application/') ||
      mimeType.startsWith('text/') ||
      mimeType.includes('document')
    )
      return 'document';

    return 'unknown';
  }
}
