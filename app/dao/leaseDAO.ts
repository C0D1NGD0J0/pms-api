import Logger from 'bunyan';
import { Types } from 'mongoose';
import { paginateResult, createLogger } from '@utils/index';
import { ClientSession, FilterQuery, Model } from 'mongoose';
import {
  ListResultWithPagination,
  IPaginationQuery,
  UploadResult,
} from '@interfaces/utils.interface';
import {
  ILeaseFilterOptions,
  ILeaseDocument,
  ILeaseFormData,
  ILeaseListItem,
  IRentRollItem,
  ILeaseStats,
  LeaseStatus,
} from '@interfaces/lease.interface';

import { BaseDAO } from './baseDAO';
import { ILeaseDAO } from './interfaces/leaseDAO.interface';
import { IFindOptions } from './interfaces/baseDAO.interface';

export class LeaseDAO extends BaseDAO<ILeaseDocument> implements ILeaseDAO {
  private readonly log: Logger;

  constructor({ leaseModel }: { leaseModel: Model<ILeaseDocument> }) {
    super(leaseModel);
    this.log = createLogger('LeaseDAO');
  }

  async createLease(
    cuid: string,
    data: ILeaseFormData,
    session?: ClientSession
  ): Promise<ILeaseDocument> {
    try {
      const leaseData: any = {
        ...data,
        cuid,
      };

      const lease = await this.insert(leaseData, session);
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

      return await this.findFirst(query, opts);
    } catch (error: any) {
      this.log.error('Error getting lease by ID:', error);
      throw error;
    }
  }

  async getFilteredLeases(
    cuid: string,
    filters: ILeaseFilterOptions,
    pagination: IPaginationQuery
  ): ListResultWithPagination<ILeaseListItem[]> {
    try {
      this.log.info(`Getting filtered leases for client ${cuid}`, { filters, pagination });

      const query: FilterQuery<ILeaseDocument> = { cuid, deletedAt: null };

      if (filters.approvalStatus) {
        query.approvalStatus = Array.isArray(filters.approvalStatus)
          ? { $in: filters.approvalStatus }
          : filters.approvalStatus;
      }

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

      if (pagination.sortBy && pagination.sort) {
        const sortDirection = pagination.sort === 'asc' ? 1 : -1;
        sortOption = { [pagination.sortBy]: sortDirection };
      }

      const [result, totalCount] = await Promise.all([
        this.list(query, {
          sort: sortOption,
          skip,
          limit,
          projection:
            'luid leaseNumber status duration.startDate duration.endDate fees.monthlyRent property.unitId tenantId signingMethod eSignature.status',
          populate: [
            {
              path: 'tenantId',
              select: 'email',
              populate: {
                path: 'profile',
                select: 'personalInfo.firstName personalInfo.lastName',
              },
            },
            { path: 'property.id', select: 'address.fullAddress' },
            { path: 'property.unitId', select: 'unitNumber' },
          ],
        }),
        this.countDocuments(query),
      ]);

      const transformedList = result.items.map((lease: any) => {
        const leaseObj = lease.toObject ? lease.toObject() : lease;

        const tenant = leaseObj.tenantId;
        const profile = tenant?.profile;
        const tenantName =
          profile?.personalInfo?.firstName && profile?.personalInfo?.lastName
            ? `${profile.personalInfo.firstName} ${profile.personalInfo.lastName}`
            : tenant?.email || 'N/A';

        const propertyAddress = leaseObj.property?.id?.address?.fullAddress || 'N/A';
        const unitNumber = leaseObj.property?.unitId?.unitNumber || null;

        return {
          luid: leaseObj.luid,
          leaseNumber: leaseObj.leaseNumber,
          tenantName,
          propertyAddress,
          unitNumber,
          monthlyRent: leaseObj.fees?.monthlyRent,
          startDate: leaseObj.duration?.startDate,
          endDate: leaseObj.duration?.endDate,
          status: leaseObj.status,
          sentForSignature:
            leaseObj.signingMethod === 'electronic' && leaseObj.eSignature?.status === 'sent',
          tenantActivated: leaseObj.status === 'active',
        };
      });

      const paginationInfo = paginateResult(totalCount, skip, limit);

      return {
        items: transformedList,
        pagination: paginationInfo,
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

      const lease = await this.update(
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

      const lease = await this.update(
        { _id: leaseId, cuid, deletedAt: null },
        { $set: { deletedAt: new Date() } }
      );

      return lease !== null;
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

      const result = await this.list(query, {}, true);
      return result.items;
    } catch (error: any) {
      this.log.error('Error checking overlapping leases:', error);
      throw error;
    }
  }

  async getActiveLeaseByTenant(cuid: string, tenantId: string): Promise<ILeaseDocument | null> {
    try {
      this.log.info(`Getting active lease for tenant ${tenantId}`);

      return await this.findFirst(
        {
          cuid,
          tenantId,
          status: LeaseStatus.ACTIVE,
          deletedAt: null,
        },
        {
          populate: { path: 'property.id', select: 'name address' },
        }
      );
    } catch (error: any) {
      this.log.error('Error getting active lease by tenant:', error);
      throw error;
    }
  }

  async getActiveLeaseByUnit(cuid: string, unitId: string): Promise<ILeaseDocument | null> {
    try {
      this.log.info(`Getting active lease for unit ${unitId}`);

      return await this.findFirst(
        {
          cuid,
          'property.unitId': unitId,
          status: LeaseStatus.ACTIVE,
          deletedAt: null,
        },
        {
          populate: { path: 'tenantId', select: 'firstName lastName email' },
        }
      );
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

      const result = await this.list(
        {
          cuid,
          status: LeaseStatus.ACTIVE,
          deletedAt: null,
          'duration.endDate': {
            $gte: today,
            $lte: futureDate,
          },
        },
        {
          populate: [
            { path: 'tenantId', select: 'firstName lastName email' },
            { path: 'property.id', select: 'name address' },
          ],
          sort: { 'duration.endDate': 1 },
        }
      );

      return result.items;
    } catch (error: any) {
      this.log.error('Error getting expiring leases:', error);
      throw error;
    }
  }

  async updateLeaseStatus(cuid: string, leaseId: string, status: LeaseStatus): Promise<boolean> {
    try {
      this.log.info(`Updating status for lease ${leaseId} to ${status}`);

      const lease = await this.update(
        { _id: leaseId, cuid, deletedAt: null },
        { $set: { status } }
      );

      return lease !== null;
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

      return await this.update(
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
        this.countDocuments(baseQuery),
        this.aggregate([{ $match: baseQuery }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
        this.aggregate([
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
        this.aggregate([
          { $match: { ...baseQuery, status: LeaseStatus.ACTIVE } },
          {
            $group: {
              _id: null,
              totalRent: { $sum: '$fees.monthlyRent' },
            },
          },
        ]),
        this.countDocuments({
          ...baseQuery,
          status: LeaseStatus.ACTIVE,
          'duration.endDate': { $gte: today, $lte: thirtyDaysFromNow },
        }),
        this.countDocuments({
          ...baseQuery,
          status: LeaseStatus.ACTIVE,
          'duration.endDate': { $gte: today, $lte: sixtyDaysFromNow },
        }),
        this.countDocuments({
          ...baseQuery,
          status: LeaseStatus.ACTIVE,
          'duration.endDate': { $gte: today, $lte: ninetyDaysFromNow },
        }),
        this.countDocuments({ ...baseQuery, 'property.unitId': { $exists: true } }),
        this.countDocuments({
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

      this.log.info('leasesByStatus aggregation result:', { leasesByStatus, baseQuery });

      leasesByStatus.forEach((item: any) => {
        statusMap[item._id] = item.count;
      });

      const averageLeaseDuration =
        avgDuration.length > 0
          ? (avgDuration[0] as any).avgDurationMs / (1000 * 60 * 60 * 24 * 30)
          : 0;

      const totalMonthlyRent = totalRent.length > 0 ? (totalRent[0] as any).totalRent : 0;

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

      const rentRoll = await this.aggregate([
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
                  $divide: [{ $subtract: ['$duration.endDate', new Date()] }, 1000 * 60 * 60 * 24],
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
      ]);

      return rentRoll as unknown as IRentRollItem[];
    } catch (error: any) {
      this.log.error('Error getting rent roll data:', error);
      throw error;
    }
  }

  /**
   * Update lease with uploaded document information
   */
  async updateLeaseDocuments(
    leaseId: string,
    uploadResults: UploadResult[],
    userId: string
  ): Promise<ILeaseDocument | null> {
    try {
      if (!leaseId || !uploadResults.length) {
        throw new Error('Lease ID and upload results are required');
      }

      const lease = await this.findFirst({ _id: new Types.ObjectId(leaseId), deletedAt: null });
      if (!lease) {
        throw new Error('Lease not found');
      }

      // Process lease document uploads
      const processedDocuments = uploadResults.map((upload) => {
        // Derive mimeType from filename extension
        const ext = upload.filename.split('.').pop()?.toLowerCase();
        let mimeType = 'application/pdf'; // default
        if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
        else if (ext === 'png') mimeType = 'image/png';

        return {
          documentType: (upload as any).documentType || 'lease_agreement',
          filename: upload.filename,
          url: upload.url,
          key: upload.key,
          mimeType,
          size: upload.size,
          uploadedBy: new Types.ObjectId((upload as any).actorId || userId),
          uploadedAt: new Date(),
        };
      });

      // Check if any of the new documents is a lease_agreement
      const hasLeaseAgreement = processedDocuments.some(
        (doc) => doc.documentType === 'lease_agreement'
      );

      // If uploading a lease_agreement, mark existing active lease_agreements as inactive
      if (hasLeaseAgreement) {
        this.log.info('Marking existing active lease_agreement documents as inactive', {
          leaseId,
        });

        await this.update(
          { _id: new Types.ObjectId(leaseId), deletedAt: null },
          {
            $set: {
              'leaseDocuments.$[elem].status': 'inactive',
            },
          },
          {
            arrayFilters: [
              {
                'elem.documentType': 'lease_agreement',
                'elem.status': 'active',
              },
            ],
          }
        );
      }

      // Now push the new documents
      const updateOperation: any = {
        $push: {
          leaseDocuments: { $each: processedDocuments },
        },
        $set: {
          lastModifiedBy: [
            {
              userId: new Types.ObjectId(userId),
              timestamp: new Date(),
            },
          ],
        },
      };

      this.log.info('Updating lease documents', {
        leaseId,
        documentCount: processedDocuments.length,
        hasLeaseAgreement,
      });

      return await this.update(
        { _id: new Types.ObjectId(leaseId), deletedAt: null },
        updateOperation
      );
    } catch (error: any) {
      this.log.error('Error updating lease documents:', error);
      throw error;
    }
  }

  /**
   * Update lease document status (active, failed, deleted)
   */
  async updateLeaseDocumentStatus(
    leaseId: string,
    status: 'active' | 'failed' | 'deleted',
    errorMessage?: string
  ): Promise<ILeaseDocument | null> {
    try {
      const updateData: any = {
        'leaseDocument.$[].status': status,
      };

      if (errorMessage) {
        updateData['leaseDocument.$[].error'] = errorMessage;
      }

      this.log.info('Updating lease document status', {
        leaseId,
        status,
        hasError: !!errorMessage,
      });

      // leaseId could be either luid or _id, try to determine which
      const query = Types.ObjectId.isValid(leaseId)
        ? { _id: new Types.ObjectId(leaseId), deletedAt: null }
        : { luid: leaseId, deletedAt: null };

      return await this.update(query, { $set: updateData });
    } catch (error: any) {
      this.log.error('Error updating lease document status:', error);
      throw error;
    }
  }

  /**
   * Get tenant information for a lease (handles both invitation and user)
   */
  async getTenantInfo(lease: ILeaseDocument): Promise<{
    type: 'invitation' | 'user';
    email: string;
    name: string;
    isActive: boolean;
    data: any;
  }> {
    try {
      if (lease.useInvitationIdAsTenantId) {
        const InvitationModel = (await import('@models/invitation/invitation.model')).default;
        const invitation = await InvitationModel.findById(lease.tenantId);

        return {
          type: 'invitation',
          email: invitation?.inviteeEmail || '',
          name: invitation?.inviteeFullName || '',
          isActive: false,
          data: invitation,
        };
      } else {
        const UserModel = (await import('@models/user/user.model')).default;
        const user = await UserModel.findById(lease.tenantId).populate('profile');

        return {
          type: 'user',
          email: user?.email || '',
          name: (user as any)?.profile?.fullname || user?.email || '',
          isActive: user?.isActive || false,
          data: user,
        };
      }
    } catch (error: any) {
      this.log.error('Error getting tenant info:', error);
      throw error;
    }
  }

  /**
   * Get leases pending tenant acceptance (using invitation as temporary tenant)
   */
  async getLeasesPendingTenantAcceptance(cuid: string): Promise<ILeaseDocument[]> {
    try {
      const result = await this.list(
        {
          cuid,
          useInvitationIdAsTenantId: true,
          deletedAt: null,
        },
        {
          sort: { createdAt: -1 },
        }
      );
      return result.items;
    } catch (error: any) {
      this.log.error('Error getting leases pending tenant acceptance:', error);
      throw error;
    }
  }
}
