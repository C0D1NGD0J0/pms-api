import Logger from 'bunyan';
import { Model, Types } from 'mongoose';
import { createLogger } from '@utils/index';
import { IAssetDocument } from '@models/asset/asset.model';
import { ListResultWithPagination } from '@interfaces/index';

import { BaseDAO } from './baseDAO';
import { IFindOptions } from './interfaces/baseDAO.interface';

export interface IAssetDAO {
  getAssetsByResource(
    resourceType: string,
    resourceId: string,
    opts?: IFindOptions
  ): Promise<ListResultWithPagination<IAssetDocument[]>>;
  getAssetsByFieldName(
    resourceType: string,
    resourceId: string,
    fieldName: string,
    opts?: IFindOptions
  ): Promise<IAssetDocument[]>;
  getAssetById(id: string, opts?: IFindOptions): Promise<IAssetDocument | null>;
  createAsset(assetData: Partial<IAssetDocument>): Promise<IAssetDocument>;
  deleteAssetsByS3Keys(s3Keys: string[]): Promise<boolean>;
  softDeleteAsset(id: string): Promise<boolean>;
}

export class AssetDAO extends BaseDAO<IAssetDocument> implements IAssetDAO {
  protected logger: Logger;

  constructor({ assetModel }: { assetModel: Model<IAssetDocument> }) {
    super(assetModel);
    this.logger = createLogger('AssetDAO');
  }

  /**
   * Create a new asset record.
   *
   * @param assetData - The data for the new asset.
   * @returns A promise that resolves to the created asset document.
   */
  async createAsset(assetData: Partial<IAssetDocument>): Promise<IAssetDocument> {
    try {
      return await this.insert(assetData);
    } catch (error) {
      this.logger.error('Error creating asset:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Get an asset by ID.
   *
   * @param id - The ID of the asset.
   * @param opts - Additional options for the query.
   * @returns A promise that resolves to the found asset document or null if no asset is found.
   */
  async getAssetById(id: string, opts?: IFindOptions): Promise<IAssetDocument | null> {
    try {
      if (!id) {
        throw new Error('Asset ID missing.');
      }

      const query = { _id: new Types.ObjectId(id), status: 'active' };
      return await this.findFirst(query, opts);
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Get assets by resource type and ID.
   *
   * @param resourceType - The type of resource (e.g., 'User', 'Property').
   * @param resourceId - The ID of the resource.
   * @param opts - Additional options for the query.
   * @returns A promise that resolves to an array of asset documents.
   */
  async getAssetsByResource(
    resourceType: string,
    resourceId: string,
    opts?: IFindOptions
  ): Promise<ListResultWithPagination<IAssetDocument[]>> {
    try {
      const query = {
        'resource.name': resourceType,
        'resource.id': resourceId,
        status: 'active',
      };

      return await this.list(query, opts);
    } catch (error) {
      this.logger.error(`Error getting assets for ${resourceType}:${resourceId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Get assets by field name for a specific resource.
   *
   * @param resourceType - The type of resource (e.g., 'User', 'Property').
   * @param resourceId - The ID of the resource.
   * @param fieldName - The field name (e.g., 'avatar', 'documents').
   * @param opts - Additional options for the query.
   * @returns A promise that resolves to an array of asset documents.
   */
  async getAssetsByFieldName(
    resourceType: string,
    resourceId: string,
    fieldName: string,
    opts?: IFindOptions
  ): Promise<IAssetDocument[]> {
    try {
      const query = {
        'resource.name': resourceType,
        'resource.id': resourceId,
        fieldName,
        status: 'active',
      };

      const result = await this.list(query, opts);
      return result.items;
    } catch (error) {
      this.logger.error(
        `Error getting assets for ${resourceType}:${resourceId} field ${fieldName}:`,
        error
      );
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Soft delete an asset by setting its status to 'deleted'.
   *
   * @param id - The ID of the asset to delete.
   * @returns A promise that resolves to true if the asset was successfully soft deleted.
   */
  async softDeleteAsset(id: string): Promise<boolean> {
    try {
      const result = await this.updateById(id, {
        status: 'deleted',
        deletedAt: new Date(),
      });

      return !!result;
    } catch (error) {
      this.logger.error(`Error soft deleting asset ${id}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Delete assets by their S3 keys (for cleanup operations).
   *
   * @param s3Keys - Array of S3 keys to delete.
   * @returns A promise that resolves to true if all assets were successfully deleted.
   */
  async deleteAssetsByS3Keys(s3Keys: string[]): Promise<boolean> {
    try {
      if (!s3Keys || s3Keys.length === 0) {
        return true;
      }

      const result = await this.updateMany(
        { 's3Info.key': { $in: s3Keys } },
        {
          status: 'deleted',
          deletedAt: new Date(),
        }
      );

      return result.acknowledged;
    } catch (error) {
      this.logger.error('Error deleting assets by S3 keys:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Get asset statistics for a resource.
   *
   * @param resourceType - The type of resource.
   * @param resourceId - The ID of the resource.
   * @returns A promise that resolves to asset statistics.
   */
  async getAssetStats(
    resourceType: string,
    resourceId: string
  ): Promise<{
    totalAssets: number;
    totalSize: number;
    assetsByType: Record<string, number>;
  }> {
    try {
      const pipeline = [
        {
          $match: {
            'resource.name': resourceType,
            'resource.id': resourceId,
            status: 'active',
          },
        },
        {
          $group: {
            _id: null,
            totalAssets: { $sum: 1 },
            totalSize: { $sum: '$size' },
            assetsByType: {
              $push: {
                type: '$type',
                size: '$size',
              },
            },
          },
        },
      ];

      const result = await this.aggregate(pipeline);

      if (!result || result.length === 0) {
        return {
          totalAssets: 0,
          totalSize: 0,
          assetsByType: {},
        };
      }

      const stats = result[0] as any;
      const assetsByType: Record<string, number> = {};

      stats.assetsByType.forEach((asset: any) => {
        assetsByType[asset.type] = (assetsByType[asset.type] || 0) + 1;
      });

      return {
        totalAssets: stats.totalAssets,
        totalSize: stats.totalSize,
        assetsByType,
      };
    } catch (error) {
      this.logger.error(`Error getting asset stats for ${resourceType}:${resourceId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }
}
