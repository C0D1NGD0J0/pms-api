import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { type QueryFilter, Types, Model } from 'mongoose';
import {
  IGuestPassDocument,
  GuestPassStatus,
  IGuestPassStats,
} from '@interfaces/guestPass.interface';

import { BaseDAO } from './baseDAO';
import { IGuestPassDAO } from './interfaces/guestpassDAO.interface';

export class GuestPassDAO extends BaseDAO<IGuestPassDocument> implements IGuestPassDAO {
  protected logger: Logger;

  constructor({ guestPassModel }: { guestPassModel: Model<IGuestPassDocument> }) {
    super(guestPassModel);
    this.logger = createLogger('GuestPassDAO');
  }

  async findByCode(code: string, cuid: string): Promise<IGuestPassDocument | null> {
    try {
      const now = new Date();
      return await this.findFirst(
        {
          code,
          cuid,
          status: GuestPassStatus.ACTIVE,
          validUntil: { $gt: now },
        },
        {
          populate: [
            { path: 'propertyId', select: 'name address puid' },
            { path: 'propertyUnitId', select: 'puid unitNumber floor' },
          ],
        }
      );
    } catch (error) {
      this.logger.error('Error finding pass by code:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async markAsUsed(
    id: string,
    cuid: string,
    validatedBy: string,
    notes?: string
  ): Promise<IGuestPassDocument | null> {
    try {
      const now = new Date();
      return await this.update(
        {
          _id: new Types.ObjectId(id),
          cuid,
          status: GuestPassStatus.ACTIVE,
          validUntil: { $gt: now },
        },
        {
          $set: {
            status: GuestPassStatus.USED,
            validatedBy: new Types.ObjectId(validatedBy),
            ...(notes && { entryNotes: notes }),
          },
        }
      );
    } catch (error) {
      this.logger.error('Error marking pass as used:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async revokePass(
    id: string,
    cuid: string,
    revokedBy: string
  ): Promise<IGuestPassDocument | null> {
    try {
      const now = new Date();
      return await this.update(
        {
          _id: new Types.ObjectId(id),
          cuid,
          status: { $in: [GuestPassStatus.ACTIVE, GuestPassStatus.PENDING] },
          validUntil: { $gt: now },
        },
        {
          $set: {
            status: GuestPassStatus.REVOKED,
            revokedAt: new Date(),
            revokedBy: new Types.ObjectId(revokedBy),
          },
        }
      );
    } catch (error) {
      this.logger.error('Error revoking pass:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async expireOldPasses(cuid?: string): Promise<number> {
    try {
      const now = new Date();
      const filter: QueryFilter<IGuestPassDocument> = {
        status: { $in: [GuestPassStatus.PENDING, GuestPassStatus.ACTIVE] },
        validUntil: { $lte: now },
      };
      if (cuid) filter.cuid = cuid;

      const result = await this.updateMany(filter, {
        $set: { status: GuestPassStatus.EXPIRED },
      });
      return result.modifiedCount;
    } catch (error) {
      this.logger.error('Error expiring old passes:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async acknowledgePass(
    cuid: string,
    passId: string,
    acknowledgedBy: string
  ): Promise<IGuestPassDocument | null> {
    try {
      return await this.update(
        {
          _id: new Types.ObjectId(passId),
          cuid,
          isAcknowledged: false,
          status: { $in: [GuestPassStatus.ACTIVE, GuestPassStatus.USED] },
        },
        {
          $set: {
            isAcknowledged: true,
            acknowledgedAt: new Date(),
            acknowledgedBy: new Types.ObjectId(acknowledgedBy),
          },
        }
      );
    } catch (error) {
      this.logger.error('Error acknowledging pass:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async bulkAcknowledge(cuid: string, passIds: string[], acknowledgedBy: string): Promise<number> {
    try {
      const result = await this.updateMany(
        {
          _id: { $in: passIds.map((id) => new Types.ObjectId(id)) },
          cuid,
          isAcknowledged: false,
          status: { $in: [GuestPassStatus.ACTIVE, GuestPassStatus.USED] },
        },
        {
          $set: {
            isAcknowledged: true,
            acknowledgedAt: new Date(),
            acknowledgedBy: new Types.ObjectId(acknowledgedBy),
          },
        }
      );
      return result.modifiedCount;
    } catch (error) {
      this.logger.error('Error bulk acknowledging passes:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async getUnacknowledgedPasses(cuid: string, propertyId: string): Promise<IGuestPassDocument[]> {
    try {
      const now = new Date();
      const result = await this.list(
        {
          cuid,
          propertyId: new Types.ObjectId(propertyId),
          status: { $in: [GuestPassStatus.ACTIVE, GuestPassStatus.USED] },
          isAcknowledged: false,
          validUntil: { $gt: now },
        },
        {
          sort: { createdAt: -1 },
          populate: [
            { path: 'propertyUnitId', select: 'puid unitNumber floor' },
            { path: 'createdBy', select: 'email uid' },
          ],
        }
      );
      return result.items;
    } catch (error) {
      this.logger.error('Error getting unacknowledged passes:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async getUnacknowledgedCount(cuid: string, propertyId?: string): Promise<number> {
    try {
      const now = new Date();
      const query: QueryFilter<IGuestPassDocument> = {
        cuid,
        status: { $in: [GuestPassStatus.ACTIVE, GuestPassStatus.USED] },
        isAcknowledged: false,
        validUntil: { $gt: now },
      };
      if (propertyId) {
        query.propertyId = new Types.ObjectId(propertyId);
      }
      return await this.countDocuments(query);
    } catch (error) {
      this.logger.error('Error getting unacknowledged count:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async getStats(
    cuid: string,
    propertyId?: string | string[],
    createdBy?: string
  ): Promise<IGuestPassStats> {
    try {
      const now = new Date();
      const matchStage: any = { cuid };
      if (Array.isArray(propertyId)) {
        matchStage.propertyId = { $in: propertyId.map((id) => new Types.ObjectId(id)) };
      } else if (propertyId) {
        matchStage.propertyId = new Types.ObjectId(propertyId);
      }
      if (createdBy) matchStage.createdBy = new Types.ObjectId(createdBy);

      type FacetBucket = { count: number }[];
      type FacetResult = Record<keyof IGuestPassStats, FacetBucket>;

      const result = (await this.aggregate([
        { $match: matchStage },
        {
          $facet: {
            active: [
              { $match: { status: GuestPassStatus.ACTIVE, validUntil: { $gt: now } } },
              { $count: 'count' },
            ],
            pending: [{ $match: { status: GuestPassStatus.PENDING } }, { $count: 'count' }],
            used: [{ $match: { status: GuestPassStatus.USED } }, { $count: 'count' }],
            expired: [
              {
                $match: {
                  $or: [
                    { status: GuestPassStatus.EXPIRED },
                    { status: GuestPassStatus.ACTIVE, validUntil: { $lte: now } },
                  ],
                },
              },
              { $count: 'count' },
            ],
            revoked: [{ $match: { status: GuestPassStatus.REVOKED } }, { $count: 'count' }],
            unacknowledged: [
              {
                $match: {
                  status: { $in: [GuestPassStatus.ACTIVE, GuestPassStatus.USED] },
                  isAcknowledged: false,
                  validUntil: { $gt: now },
                },
              },
              { $count: 'count' },
            ],
            total: [{ $count: 'count' }],
          },
        },
      ])) as unknown as FacetResult[];

      const r = result[0] || ({} as FacetResult);
      return {
        active: r.active?.[0]?.count || 0,
        pending: r.pending?.[0]?.count || 0,
        used: r.used?.[0]?.count || 0,
        expired: r.expired?.[0]?.count || 0,
        revoked: r.revoked?.[0]?.count || 0,
        unacknowledged: r.unacknowledged?.[0]?.count || 0,
        total: r.total?.[0]?.count || 0,
      };
    } catch (error) {
      this.logger.error('Error getting stats:', error);
      throw this.throwErrorHandler(error);
    }
  }
}
