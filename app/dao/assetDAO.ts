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

  async createAsset(assetData: Partial<IAssetDocument>): Promise<IAssetDocument> {
    try {
      return await this.insert(assetData);
    } catch (error) {
      this.logger.error('Error creating asset:', error);
      throw this.throwErrorHandler(error);
    }
  }

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
