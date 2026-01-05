import Logger from 'bunyan';
import { AssetDAO } from '@dao/assetDAO';
import { createLogger } from '@utils/index';
import { EventTypes } from '@interfaces/index';
import { IAssetDocument } from '@models/asset/asset.model';
import { EventEmitterService } from '@services/eventEmitter';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { ISuccessReturnData, UploadResult } from '@interfaces/utils.interface';

interface IConstructor {
  emitterService: EventEmitterService;
  assetDAO: AssetDAO;
}

export class AssetService {
  private readonly assetDAO: AssetDAO;
  private readonly emitterService: EventEmitterService;
  private readonly logger: Logger;

  constructor({ assetDAO, emitterService }: IConstructor) {
    this.assetDAO = assetDAO;
    this.emitterService = emitterService;
    this.logger = createLogger('AssetService');
    this.setupEventListeners();
  }

  /**
   * Create asset records for document library from successful upload results
   * Only called for property documents/images, NOT for user avatars
   *
   * @param uploadResults - Array of successful upload results
   * @returns Promise resolving to array of created asset documents
   */
  async createAssets(uploadResults: UploadResult[]): Promise<IAssetDocument[]> {
    try {
      if (!uploadResults || uploadResults.length === 0) {
        return [];
      }

      const assets: IAssetDocument[] = [];

      for (const result of uploadResults) {
        // Only create asset records for document library items
        const assetData = {
          originalName: result.filename,
          s3Info: {
            url: result.url,
            filename: result.filename,
            key: result.publicuid,
          },
          resource: {
            name: result.resourceName || 'Property',
            id: result.resourceId,
          },
          size: result.size || 0,
          mimeType: this.getMimeTypeFromUrl(result.url),
          type: result.mediatype || 'document',
          fieldName: result.fieldName,
          uploadedBy: result.actorId || 'system',
          status: 'active' as const,
        };

        const asset = await this.assetDAO.createAsset(assetData);
        assets.push(asset);

        this.logger.info(`Created document library asset for ${result.filename} (${asset._id})`);
      }

      return assets;
    } catch (error) {
      this.logger.error('Error creating document library asset records:', error);
      throw error;
    }
  }

  /**
   * Get assets for a specific resource
   *
   * @param resourceType - Type of resource (e.g., 'User', 'Property')
   * @param resourceId - ID of the resource
   * @param options - Query options for pagination and filtering
   * @returns Promise resolving to success response with assets and pagination
   */
  async getAssetsByResource(
    resourceType: string,
    resourceId: string,
    options?: {
      limit?: number;
      skip?: number;
      fieldName?: string;
      type?: 'image' | 'video' | 'document';
    }
  ): Promise<ISuccessReturnData<IAssetDocument[]>> {
    try {
      if (!resourceType || !resourceId) {
        throw new BadRequestError({
          message: 'Resource type and ID are required',
        });
      }

      const queryOptions = {
        limit: options?.limit || 50,
        skip: options?.skip || 0,
      };

      let assets;
      if (options?.fieldName) {
        assets = await this.assetDAO.getAssetsByFieldName(
          resourceType,
          resourceId,
          options.fieldName,
          queryOptions
        );
        return {
          success: true,
          data: assets,
          message: `Retrieved ${assets.length} assets for ${resourceType}:${resourceId} field ${options.fieldName}`,
        };
      } else {
        const result = await this.assetDAO.getAssetsByResource(
          resourceType,
          resourceId,
          queryOptions
        );
        return {
          success: true,
          data: result.items,
          message: `Retrieved ${result.items.length} assets for ${resourceType}:${resourceId}`,
          ...(result.pagination && { pagination: result.pagination }),
        };
      }
    } catch (error) {
      this.logger.error(`Error getting assets for ${resourceType}:${resourceId}:`, error);
      throw error;
    }
  }

  /**
   * Get a single asset by ID
   *
   * @param assetId - The asset ID
   * @returns Promise resolving to success response with asset data
   */
  async getAssetById(assetId: string): Promise<ISuccessReturnData<IAssetDocument>> {
    try {
      if (!assetId) {
        throw new BadRequestError({
          message: 'Asset ID is required',
        });
      }

      const asset = await this.assetDAO.getAssetById(assetId);
      if (!asset) {
        throw new NotFoundError({
          message: 'Asset not found',
        });
      }

      return {
        success: true,
        data: asset,
        message: 'Asset retrieved successfully',
      };
    } catch (error) {
      this.logger.error(`Error getting asset ${assetId}:`, error);
      throw error;
    }
  }

  /**
   * Soft delete an asset
   *
   * @param assetId - The asset ID to delete
   * @param userId - The user performing the delete
   * @returns Promise resolving to success response
   */
  async deleteAsset(
    assetId: string,
    userId: string
  ): Promise<ISuccessReturnData<{ deletedAssetId: string }>> {
    try {
      if (!assetId || !userId) {
        throw new BadRequestError({
          message: 'Asset ID and user ID are required',
        });
      }

      // Verify asset exists first
      const asset = await this.assetDAO.getAssetById(assetId);
      if (!asset) {
        throw new NotFoundError({
          message: 'Asset not found',
        });
      }

      const deleted = await this.assetDAO.softDeleteAsset(assetId);
      if (!deleted) {
        throw new BadRequestError({
          message: 'Failed to delete asset',
        });
      }

      this.logger.info(`Asset ${assetId} soft deleted by user ${userId}`);

      return {
        success: true,
        data: { deletedAssetId: assetId },
        message: 'Asset deleted successfully',
      };
    } catch (error) {
      this.logger.error(`Error deleting asset ${assetId}:`, error);
      throw error;
    }
  }

  /**
   * Get asset statistics for a resource
   *
   * @param resourceType - Type of resource
   * @param resourceId - ID of the resource
   * @returns Promise resolving to asset statistics
   */
  async getAssetStats(
    resourceType: string,
    resourceId: string
  ): Promise<
    ISuccessReturnData<{
      totalAssets: number;
      totalSize: number;
      assetsByType: Record<string, number>;
    }>
  > {
    try {
      if (!resourceType || !resourceId) {
        throw new BadRequestError({
          message: 'Resource type and ID are required',
        });
      }

      const stats = await this.assetDAO.getAssetStats(resourceType, resourceId);

      return {
        success: true,
        data: stats,
        message: 'Asset statistics retrieved successfully',
      };
    } catch (error) {
      this.logger.error(`Error getting asset stats for ${resourceType}:${resourceId}:`, error);
      throw error;
    }
  }

  /**
   * Replace assets for a specific field (for document library management)
   *
   * @param resourceType - Type of resource (e.g., 'Property')
   * @param resourceId - ID of the resource
   * @param fieldName - Field name to replace assets for
   * @param newAssets - New assets to replace with
   * @returns Promise resolving to success response
   */
  async replaceAssetsByField(
    resourceType: string,
    resourceId: string,
    fieldName: string,
    newAssets: UploadResult[]
  ): Promise<ISuccessReturnData<IAssetDocument[]>> {
    try {
      // Get existing assets for the field
      const existingAssets = await this.assetDAO.getAssetsByFieldName(
        resourceType,
        resourceId,
        fieldName
      );

      // Soft delete existing assets
      for (const asset of existingAssets) {
        await this.assetDAO.softDeleteAsset(asset._id!.toString());
      }

      // Create new asset records for document library
      const createdAssets = await this.createAssets(newAssets);

      this.logger.info(
        `Replaced ${existingAssets.length} assets with ${createdAssets.length} new assets for ${resourceType}:${resourceId} field ${fieldName}`
      );

      return {
        success: true,
        data: createdAssets,
        message: `Document library assets replaced successfully for ${fieldName}`,
      };
    } catch (error) {
      this.logger.error(
        `Error replacing document library assets for ${resourceType}:${resourceId} field ${fieldName}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Helper method to determine MIME type from URL (fallback)
   */
  private getMimeTypeFromUrl(url: string): string {
    const extension = url.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      mp4: 'video/mp4',
      avi: 'video/avi',
      mov: 'video/quicktime',
    };

    return mimeTypes[extension || ''] || 'application/octet-stream';
  }

  /**
   * Setup event listeners for asset-related events
   */
  private setupEventListeners(): void {
    this.emitterService.on(EventTypes.UPLOAD_COMPLETED, this.handleUploadCompleted.bind(this));
    this.logger.info('Asset service event listeners initialized');
  }

  /**
   * Handle upload completion events - process document library uploads
   */
  private async handleUploadCompleted(data: any): Promise<void> {
    try {
      // Only handle document library uploads (property documents, images, etc.)
      // Skip profile/avatar uploads as they're handled by ProfileService
      if (this.shouldCreateAssetRecord(data)) {
        await this.createAssets(data.results);
        this.logger.info(`Created ${data.results.length} asset records for document library`);
      }
    } catch (error) {
      this.logger.error('Error handling upload completion in AssetService:', error);
    }
  }

  /**
   * Determine if upload results should create asset records for document library
   */
  private shouldCreateAssetRecord(data: any): boolean {
    // Must have valid results
    if (!data.results?.length) {
      return false;
    }

    // Skip profile-related uploads (handled by ProfileService)
    if (data.resourceName === 'profile') {
      return false;
    }

    // Handle property documents and other business document uploads
    const documentLibraryResources = ['property', 'client', 'vendor'];
    const resourceName = data.resourceName?.toLowerCase();

    return documentLibraryResources.includes(resourceName);
  }

  /**
   * Clean up event listeners when service is destroyed
   */
  destroy(): void {
    this.emitterService.off(EventTypes.UPLOAD_COMPLETED, this.handleUploadCompleted);
    this.logger.info('Asset service event listeners removed');
  }
}
