import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { ClientSession, FilterQuery, Model } from 'mongoose';
import { ListResultWithPagination, IPaginationQuery } from '@interfaces/utils.interface';
import {
  ILeaseFilterOptions,
  ILeaseDocument,
  ILeaseFormData,
  IRentRollItem,
  ILeaseStats,
  LeaseStatus,
} from '@interfaces/lease.interface';

import { BaseDAO } from './baseDAO';
import { ILeaseDAO } from './interfaces/leaseDAO.interface';
import { IFindOptions } from './interfaces/baseDAO.interface';

export class LeaseDAO extends BaseDAO<ILeaseDocument> implements ILeaseDAO {
  private readonly log: Logger;
  private readonly leaseModel: Model<ILeaseDocument>;

  constructor({ leaseModel }: { leaseModel: Model<ILeaseDocument> }) {
    super(leaseModel);
    this.log = createLogger('LeaseDAO');
    this.leaseModel = leaseModel;
  }

  async createLease(
    cuid: string,
    data: ILeaseFormData,
    session?: ClientSession
  ): Promise<ILeaseDocument> {
    try {
      const [lease] = await this.leaseModel.create([data], { session });
      return lease;
    } catch (error: any) {
      this.log.error('Error creating lease:', error);
      throw error;
    }
  }

  async getLeaseById(
    cuid: string,
    leaseId: string,
    opts?: IFindOptions
  ): Promise<ILeaseDocument | null> {
    try {
      this.log.info(`Getting lease ${leaseId} for client ${cuid}`);

      const query: FilterQuery<ILeaseDocument> = {
        _id: leaseId,
        cuid,
        deletedAt: null,
      };

      let dbQuery = this.leaseModel.findOne(query);

      if (opts?.populate) {
        if (Array.isArray(opts.populate)) {
          dbQuery = dbQuery.populate(opts.populate);
        } else if (typeof opts.populate === 'string') {
          dbQuery = dbQuery.populate(opts.populate);
        } else {
          dbQuery = dbQuery.populate(opts.populate);
        }
      }

      if (opts?.select) {
        dbQuery = dbQuery.select(opts.select);
      }

      return await dbQuery.exec();
    } catch (error: any) {
      this.log.error('Error getting lease by ID:', error);
      throw error;
    }
  }

  async getFilteredLeases(
    cuid: string,
    filters: ILeaseFilterOptions,
    pagination: IPaginationQuery
  ): ListResultWithPagination<ILeaseDocument[]> {
    try {
      this.log.info(`Getting filtered leases for client ${cuid}`, { filters });

      const query: FilterQuery<ILeaseDocument> = { cuid, deletedAt: null };

      if (filters.status) {
        query.status = Array.isArray(filters.status) ? { $in: filters.status } : filters.status;
      }

      if (filters.propertyId) {
        query['property.id'] = filters.propertyId;
      }

      if (filters.unitId) {
        query['property.unitId'] = filters.unitId;
      }

      if (filters.tenantId) {
        query.tenantId = filters.tenantId;
      }

      if (filters.type) {
        query.type = Array.isArray(filters.type) ? { $in: filters.type } : filters.type;
      }

      if (filters.signingMethod) {
        query.signingMethod = filters.signingMethod;
      }

      if (filters.startDateFrom || filters.startDateTo) {
        query['duration.startDate'] = {};
        if (filters.startDateFrom) {
          query['duration.startDate'].$gte = filters.startDateFrom;
        }
        if (filters.startDateTo) {
          query['duration.startDate'].$lte = filters.startDateTo;
        }
      }

      if (filters.endDateFrom || filters.endDateTo) {
        query['duration.endDate'] = {};
        if (filters.endDateFrom) {
          query['duration.endDate'].$gte = filters.endDateFrom;
        }
        if (filters.endDateTo) {
          query['duration.endDate'].$lte = filters.endDateTo;
        }
      }

      if (filters.minRent || filters.maxRent) {
        query['fees.monthlyRent'] = {};
        if (filters.minRent) {
          query['fees.monthlyRent'].$gte = filters.minRent;
        }
        if (filters.maxRent) {
          query['fees.monthlyRent'].$lte = filters.maxRent;
        }
      }

      if (filters.createdAfter || filters.createdBefore) {
        query.createdAt = {};
        if (filters.createdAfter) {
          query.createdAt.$gte = filters.createdAfter;
        }
        if (filters.createdBefore) {
          query.createdAt.$lte = filters.createdBefore;
        }
      }

      if (filters.isExpiringSoon) {
        const today = new Date();
        const sixtyDaysFromNow = new Date();
        sixtyDaysFromNow.setDate(today.getDate() + 60);

        query['duration.endDate'] = {
          $gte: today,
          $lte: sixtyDaysFromNow,
        };
        query.status = LeaseStatus.ACTIVE;
      }

      if (filters.search) {
        query.$or = [
          { leaseNumber: { $regex: filters.search, $options: 'i' } },
          { 'property.address': { $regex: filters.search, $options: 'i' } },
        ];
      }

      const page = Math.max(1, pagination.page || 1);
      const limit = Math.max(1, Math.min(pagination.limit || 10, 100));
      const skip = (page - 1) * limit;

      let sortOption: Record<string, 1 | -1> = { createdAt: -1 };
      if (pagination.sort && typeof pagination.sort === 'string') {
        const sortParts = pagination.sort.split(':');
        const field = sortParts[0];
        const order = sortParts[1];
        sortOption = { [field]: order === 'desc' ? -1 : 1 };
      }

      const [leases, totalCount] = await Promise.all([
        this.leaseModel
          .find(query)
          .sort(sortOption)
          .skip(skip)
          .limit(limit)
          .populate('tenantId', 'firstName lastName email')
          .populate('property.id', 'name address')
          .exec(),
        this.leaseModel.countDocuments(query),
      ]);

      return {
        items: leases,
        pagination: {
          currentPage: page,
          perPage: limit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit),
          hasMoreResource: page < Math.ceil(totalCount / limit),
        },
      };
    } catch (error: any) {
      this.log.error('Error getting filtered leases:', error);
      throw error;
    }
  }

  async updateLease(
    cuid: string,
    leaseId: string,
    data: Partial<ILeaseDocument>
  ): Promise<ILeaseDocument | null> {
    try {
      this.log.info(`Updating lease ${leaseId} for client ${cuid}`);

      const lease = await this.leaseModel.findOneAndUpdate(
        { _id: leaseId, cuid, deletedAt: null },
        { $set: data },
        { new: true, runValidators: true }
      );

      return lease;
    } catch (error: any) {
      this.log.error('Error updating lease:', error);
      throw error;
    }
  }

  async deleteLease(cuid: string, leaseId: string): Promise<boolean> {
    try {
      this.log.info(`Soft deleting lease ${leaseId} for client ${cuid}`);

      const result = await this.leaseModel.updateOne(
        { _id: leaseId, cuid, deletedAt: null },
        { $set: { deletedAt: new Date() } }
      );

      return result.modifiedCount > 0;
    } catch (error: any) {
      this.log.error('Error deleting lease:', error);
      throw error;
    }
  }

  async checkOverlappingLeases(
    cuid: string,
    propertyId: string,
    unitId: string | undefined,
    startDate: Date,
    endDate: Date,
    excludeLeaseId?: string
  ): Promise<ILeaseDocument[]> {
    try {
      this.log.info(
        `Checking overlapping leases for property ${propertyId}${unitId ? `, unit ${unitId}` : ' (property-level)'}`
      );

      const query: FilterQuery<ILeaseDocument> = {
        cuid,
        deletedAt: null,
        status: { $in: [LeaseStatus.ACTIVE, LeaseStatus.PENDING_SIGNATURE, LeaseStatus.DRAFT] },
        $and: [
          { 'duration.startDate': { $lte: endDate } },
          { 'duration.endDate': { $gte: startDate } },
        ],
      };

      // Handle unit-level vs property-level leases
      if (unitId) {
        // Checking for unit-level lease: find leases on this specific unit
        query['property.unitId'] = unitId;
      } else {
        // Checking for property-level lease: find other property-level leases only
        query['property.id'] = propertyId;
        query['property.unitId'] = { $exists: false };
      }

      if (excludeLeaseId) {
        query._id = { $ne: excludeLeaseId };
      }

      return await this.leaseModel.find(query).exec();
    } catch (error: any) {
      this.log.error('Error checking overlapping leases:', error);
      throw error;
    }
  }

  async getActiveLeaseByTenant(cuid: string, tenantId: string): Promise<ILeaseDocument | null> {
    try {
      this.log.info(`Getting active lease for tenant ${tenantId}`);

      return await this.leaseModel
        .findOne({
          cuid,
          tenantId,
          status: LeaseStatus.ACTIVE,
          deletedAt: null,
        })
        .populate('property.id', 'name address')
        .exec();
    } catch (error: any) {
      this.log.error('Error getting active lease by tenant:', error);
      throw error;
    }
  }

  async getActiveLeaseByUnit(cuid: string, unitId: string): Promise<ILeaseDocument | null> {
    try {
      this.log.info(`Getting active lease for unit ${unitId}`);

      return await this.leaseModel
        .findOne({
          cuid,
          'property.unitId': unitId,
          status: LeaseStatus.ACTIVE,
          deletedAt: null,
        })
        .populate('tenantId', 'firstName lastName email')
        .exec();
    } catch (error: any) {
      this.log.error('Error getting active lease by unit:', error);
      throw error;
    }
  }

  async getExpiringLeases(cuid: string, daysAhead: number): Promise<ILeaseDocument[]> {
    try {
      this.log.info(`Getting leases expiring within ${daysAhead} days for client ${cuid}`);

      const today = new Date();
      const futureDate = new Date();
      futureDate.setDate(today.getDate() + daysAhead);

      return await this.leaseModel
        .find({
          cuid,
          status: LeaseStatus.ACTIVE,
          deletedAt: null,
          'duration.endDate': {
            $gte: today,
            $lte: futureDate,
          },
        })
        .populate('tenantId', 'firstName lastName email')
        .populate('property.id', 'name address')
        .sort({ 'duration.endDate': 1 })
        .exec();
    } catch (error: any) {
      this.log.error('Error getting expiring leases:', error);
      throw error;
    }
  }

  async updateLeaseStatus(cuid: string, leaseId: string, status: LeaseStatus): Promise<boolean> {
    try {
      this.log.info(`Updating status for lease ${leaseId} to ${status}`);

      const result = await this.leaseModel.updateOne(
        { _id: leaseId, cuid, deletedAt: null },
        { $set: { status } }
      );

      return result.modifiedCount > 0;
    } catch (error: any) {
      this.log.error('Error updating lease status:', error);
      throw error;
    }
  }

  async terminateLease(
    cuid: string,
    leaseId: string,
    terminationData: {
      terminationDate: Date;
      terminationReason: string;
      moveOutDate?: Date;
      notes?: string;
    }
  ): Promise<ILeaseDocument | null> {
    try {
      this.log.info(`Terminating lease ${leaseId} for client ${cuid}`);

      const updateData: any = {
        status: LeaseStatus.TERMINATED,
        'duration.terminationDate': terminationData.terminationDate,
        terminationReason: terminationData.terminationReason,
      };

      if (terminationData.moveOutDate) {
        updateData['duration.moveOutDate'] = terminationData.moveOutDate;
      }

      if (terminationData.notes) {
        updateData.internalNotes = terminationData.notes;
      }

      return await this.leaseModel.findOneAndUpdate(
        { _id: leaseId, cuid, deletedAt: null },
        { $set: updateData },
        { new: true }
      );
    } catch (error: any) {
      this.log.error('Error terminating lease:', error);
      throw error;
    }
  }

  async getLeaseStats(cuid: string, filters?: FilterQuery<ILeaseDocument>): Promise<ILeaseStats> {
    try {
      this.log.info(`Getting lease stats for client ${cuid}`, { filters });

      const baseQuery: FilterQuery<ILeaseDocument> = { cuid, deletedAt: null, ...filters };

      const today = new Date();
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(today.getDate() + 30);
      const sixtyDaysFromNow = new Date();
      sixtyDaysFromNow.setDate(today.getDate() + 60);
      const ninetyDaysFromNow = new Date();
      ninetyDaysFromNow.setDate(today.getDate() + 90);

      const [
        totalLeases,
        leasesByStatus,
        avgDuration,
        totalRent,
        expiring30,
        expiring60,
        expiring90,
        totalUnits,
        occupiedUnits,
      ] = await Promise.all([
        this.leaseModel.countDocuments(baseQuery),
        this.leaseModel.aggregate([
          { $match: baseQuery },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        this.leaseModel.aggregate([
          { $match: { ...baseQuery, status: LeaseStatus.ACTIVE } },
          {
            $project: {
              durationMs: {
                $subtract: ['$duration.endDate', '$duration.startDate'],
              },
            },
          },
          {
            $group: {
              _id: null,
              avgDurationMs: { $avg: '$durationMs' },
            },
          },
        ]),
        this.leaseModel.aggregate([
          { $match: { ...baseQuery, status: LeaseStatus.ACTIVE } },
          {
            $group: {
              _id: null,
              totalRent: { $sum: '$fees.monthlyRent' },
            },
          },
        ]),
        this.leaseModel.countDocuments({
          ...baseQuery,
          status: LeaseStatus.ACTIVE,
          'duration.endDate': { $gte: today, $lte: thirtyDaysFromNow },
        }),
        this.leaseModel.countDocuments({
          ...baseQuery,
          status: LeaseStatus.ACTIVE,
          'duration.endDate': { $gte: today, $lte: sixtyDaysFromNow },
        }),
        this.leaseModel.countDocuments({
          ...baseQuery,
          status: LeaseStatus.ACTIVE,
          'duration.endDate': { $gte: today, $lte: ninetyDaysFromNow },
        }),
        this.leaseModel.countDocuments({ ...baseQuery, 'property.unitId': { $exists: true } }),
        this.leaseModel.countDocuments({
          ...baseQuery,
          status: LeaseStatus.ACTIVE,
          'property.unitId': { $exists: true },
        }),
      ]);

      const statusMap: any = {
        draft: 0,
        pending_signature: 0,
        active: 0,
        expired: 0,
        terminated: 0,
        cancelled: 0,
      };

      leasesByStatus.forEach((item: any) => {
        statusMap[item._id] = item.count;
      });

      const averageLeaseDuration =
        avgDuration.length > 0 ? avgDuration[0].avgDurationMs / (1000 * 60 * 60 * 24 * 30) : 0;

      const totalMonthlyRent = totalRent.length > 0 ? totalRent[0].totalRent : 0;

      const occupancyRate = totalUnits > 0 ? (occupiedUnits / totalUnits) * 100 : 0;

      return {
        totalLeases,
        leasesByStatus: statusMap,
        averageLeaseDuration: Math.round(averageLeaseDuration),
        totalMonthlyRent,
        expiringIn30Days: expiring30,
        expiringIn60Days: expiring60,
        expiringIn90Days: expiring90,
        occupancyRate: Math.round(occupancyRate * 100) / 100,
      };
    } catch (error: any) {
      this.log.error('Error getting lease stats:', error);
      throw error;
    }
  }

  async getRentRollData(cuid: string, propertyId?: string): Promise<IRentRollItem[]> {
    try {
      this.log.info(`Getting rent roll data for client ${cuid}`, { propertyId });

      const matchQuery: FilterQuery<ILeaseDocument> = {
        cuid,
        deletedAt: null,
        status: { $in: [LeaseStatus.ACTIVE, LeaseStatus.PENDING_SIGNATURE] },
      };

      if (propertyId) {
        matchQuery['property.id'] = propertyId;
      }

      const rentRoll = await this.leaseModel
        .aggregate([
          { $match: matchQuery },
          {
            $lookup: {
              from: 'users',
              localField: 'tenantId',
              foreignField: '_id',
              as: 'tenant',
            },
          },
          { $unwind: '$tenant' },
          {
            $lookup: {
              from: 'properties',
              localField: 'property.id',
              foreignField: '_id',
              as: 'propertyDetails',
            },
          },
          { $unwind: '$propertyDetails' },
          {
            $lookup: {
              from: 'propertyunits',
              localField: 'property.unitId',
              foreignField: '_id',
              as: 'unitDetails',
            },
          },
          {
            $addFields: {
              unitNumber: {
                $cond: {
                  if: { $gt: [{ $size: '$unitDetails' }, 0] },
                  then: { $arrayElemAt: ['$unitDetails.unitNumber', 0] },
                  else: null,
                },
              },
              daysUntilExpiry: {
                $cond: {
                  if: { $ne: ['$duration.endDate', null] },
                  then: {
                    $divide: [
                      { $subtract: ['$duration.endDate', new Date()] },
                      1000 * 60 * 60 * 24,
                    ],
                  },
                  else: null,
                },
              },
            },
          },
          {
            $project: {
              leaseId: '$_id',
              luid: 1,
              leaseNumber: 1,
              status: 1,
              tenantName: {
                $concat: ['$tenant.firstName', ' ', '$tenant.lastName'],
              },
              tenantEmail: '$tenant.email',
              propertyName: '$propertyDetails.name',
              propertyAddress: '$property.address',
              unitNumber: 1,
              monthlyRent: '$fees.monthlyRent',
              securityDeposit: '$fees.securityDeposit',
              startDate: '$duration.startDate',
              endDate: '$duration.endDate',
              daysUntilExpiry: { $ceil: '$daysUntilExpiry' },
            },
          },
          { $sort: { 'propertyDetails.name': 1, unitNumber: 1 } },
        ])
        .exec();

      return rentRoll;
    } catch (error: any) {
      this.log.error('Error getting rent roll data:', error);
      throw error;
    }
  }
}
