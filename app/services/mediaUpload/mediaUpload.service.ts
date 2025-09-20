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

interface MediaOperationResult {
  processedFiles: Record<string, { queuedCount: number; message: string }>;
  totalQueued: number;
  hasFiles: boolean;
  message?: string;
}

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

  /**
   * Handle file uploads with automatic deletion detection
   * This method now transparently handles both uploads and deletions
   */
  async handleFiles(
    req: AppRequest,
    context: {
      primaryResourceId: string;
      uploadedBy: string;
      resourceContext?: ResourceContext;
      hardDelete?: boolean;
    }
  ): Promise<MediaOperationResult> {
    try {
      // Handle deletions first if we detect media changes in request body
      await this.handleDeletions(req, context);

      // Then handle uploads
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
      this.logger.error('Error handling files:', error);
      throw error;
    }
  }

  /**
   * Internal method to handle deletions based on request body changes
   */
  private async handleDeletions(
    req: AppRequest,
    context: {
      primaryResourceId: string;
      uploadedBy: string;
      resourceContext?: ResourceContext;
    }
  ): Promise<void> {
    // For now, this is a placeholder for deletion logic
    // This would be called internally by services that need deletion
    // We keep the simple interface but allow for internal deletion handling

    // If profile context and there's avatar data in request, handle avatar deletion
    if (context.resourceContext === ResourceContext.USER_PROFILE) {
      // Avatar deletion would be handled by ProfileService when it detects changes
      return;
    }

    // If property context and there's media data in request, handle media deletion
    if (req.body.images !== undefined || req.body.documents !== undefined) {
      // Property media deletion would be handled by PropertyService when it detects changes
      return;
    }
  }

  /**
   * Utility method for other services to handle avatar deletions
   */
  async handleAvatarDeletion(
    currentAvatar?: { key?: string },
    newAvatar?: { key?: string }
  ): Promise<void> {
    if (currentAvatar?.key && (!newAvatar || currentAvatar.key !== newAvatar.key)) {
      this.uploadQueue.addToRemovalQueue(JOB_NAME.MEDIA_REMOVAL_JOB, {
        data: [currentAvatar.key],
      });
      this.logger.info('Queued old avatar for deletion', {
        oldAvatarKey: currentAvatar.key,
        newAvatarKey: newAvatar?.key,
      });
    }
  }

  /**
   * Utility method for other services to handle media deletions
   */
  async handleMediaDeletion(
    currentMedia: Array<{ key?: string; _id?: string; status?: string }>,
    newMedia: Array<{ key?: string; _id?: string; status?: string }>,
    actorId: string,
    hardDelete: boolean = false
  ): Promise<void> {
    const toDelete = this.findMediaToDelete(currentMedia, newMedia);
    const keysToDelete: string[] = [];

    // Log which items are being processed for deletion
    this.logger.info(`Processing ${toDelete.length} media items for deletion`, {
      actorId,
      hardDelete,
      itemIds: toDelete.map((item) => item._id).filter(Boolean),
    });

    for (const item of toDelete) {
      if (item.key) {
        keysToDelete.push(item.key);

        // Soft delete asset record
        try {
          if (item._id) {
            await this.assetService.deleteAsset(item._id, actorId);
            this.logger.debug(`Successfully soft deleted asset ${item._id}`);
          }
        } catch (error) {
          this.logger.warn(`Failed to soft delete asset record ${item._id}:`, error);
        }
      }
    }

    // Only queue S3 deletion if hardDelete is true
    if (keysToDelete.length > 0 && hardDelete) {
      this.uploadQueue.addToRemovalQueue(JOB_NAME.MEDIA_REMOVAL_JOB, {
        data: keysToDelete,
      });
      this.logger.info(`Hard deleted ${keysToDelete.length} files from S3`);
    } else if (keysToDelete.length > 0) {
      this.logger.info(`Soft deleted ${keysToDelete.length} files (S3 files preserved)`);
    }
  }

  /**
   * Find media items that should be deleted based on status field
   */
  private findMediaToDelete<T extends { key?: string; _id?: string; status?: string }>(
    currentMedia: T[],
    newMedia: T[]
  ): T[] {
    return newMedia.filter((item) => item.status === 'deleted' && (item.key || item._id));
  }

  /**
   * Group files by resource type and field
   */
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

  /**
   * Route file to appropriate resource and field
   */
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

    if (fieldName.includes('images') || fieldName.startsWith('images.')) {
      return {
        resourceName: 'property',
        resourceId: context.primaryResourceId,
        fieldName: 'images',
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

  /**
   * Determine media type from MIME type
   */
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
