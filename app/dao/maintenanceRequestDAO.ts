import { FilterQuery, Model, Types } from 'mongoose';
import { ListResultWithPagination, IPaginationQuery } from '@interfaces/utils.interface';
import {
  IMaintenanceRequestDocument,
  MaintenanceRequestStatus,
  IMaintenanceStats,
  IVendorStats,
} from '@interfaces/maintenanceRequest.interface';

import { BaseDAO } from './baseDAO';
import { IMaintenanceRequestDAO } from './interfaces/maintenanceRequestDAO.interface';

export class MaintenanceRequestDAO
  extends BaseDAO<IMaintenanceRequestDocument>
  implements IMaintenanceRequestDAO
{
  constructor({
    maintenanceRequestModel,
  }: {
    maintenanceRequestModel: Model<IMaintenanceRequestDocument>;
  }) {
    super(maintenanceRequestModel);
  }

  async getByMruid(mruid: string, cuid: string): Promise<IMaintenanceRequestDocument | null> {
    return this.findFirst({ mruid, cuid, deletedAt: null });
  }

  async findByMruid(mruid: string): Promise<IMaintenanceRequestDocument | null> {
    return this.findFirst({ mruid, deletedAt: null });
  }

  async listWithDetails(
    filter: FilterQuery<IMaintenanceRequestDocument>,
    pagination?: IPaginationQuery
  ): ListResultWithPagination<IMaintenanceRequestDocument[]> {
    return this.list(filter, {
      ...pagination,
      populate: [
        { path: 'propertyId', select: 'address pid title' },
        {
          path: 'vendorId',
          select: 'email uid',
          populate: { path: 'profile', select: 'personalInfo.firstName personalInfo.lastName' },
        },
        {
          path: 'tenantId',
          select: 'email uid',
          populate: { path: 'profile', select: 'personalInfo.firstName personalInfo.lastName' },
        },
      ],
    });
  }

  async getVendorQueue(vendorId: string): Promise<IMaintenanceRequestDocument[]> {
    const result = await this.list({
      vendorId: new Types.ObjectId(vendorId),
      status: { $in: [MaintenanceRequestStatus.ASSIGNED, MaintenanceRequestStatus.IN_PROGRESS] },
      deletedAt: null,
    });
    return result.items || [];
  }

  async getVendorStats(vendorId: string): Promise<IVendorStats> {
    const results = await this.aggregate([
      { $match: { vendorId: new Types.ObjectId(vendorId), deletedAt: null } },
      {
        $facet: {
          byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          avgCompletion: [
            {
              $match: {
                status: MaintenanceRequestStatus.COMPLETED,
                completedAt: { $exists: true },
                assignedAt: { $exists: true },
              },
            },
            {
              $group: {
                _id: null,
                avgDays: {
                  $avg: {
                    $divide: [
                      { $subtract: ['$completedAt', '$assignedAt'] },
                      86400000, // ms → days
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    ]);

    const raw = (results[0] || {}) as any;
    const toMap = (arr: { _id: string; count: number }[]) =>
      Object.fromEntries((arr || []).map((i) => [i._id, i.count]));

    const statusMap = toMap(raw.byStatus || []);
    const total = Object.values(statusMap as Record<string, number>).reduce((a, b) => a + b, 0);

    return {
      total,
      completed: statusMap[MaintenanceRequestStatus.COMPLETED] || 0,
      inProgress: statusMap[MaintenanceRequestStatus.IN_PROGRESS] || 0,
      assigned: statusMap[MaintenanceRequestStatus.ASSIGNED] || 0,
      cancelled: statusMap[MaintenanceRequestStatus.CANCELLED] || 0,
      avgCompletionDays: raw.avgCompletion?.[0]?.avgDays ?? undefined,
    };
  }

  async getStats(cuid: string, propertyId?: string): Promise<IMaintenanceStats> {
    const matchStage: FilterQuery<IMaintenanceRequestDocument> = { cuid, deletedAt: null };
    if (propertyId) {
      matchStage.propertyId = new Types.ObjectId(propertyId);
    }

    const results = await this.aggregate([
      { $match: matchStage },
      {
        $facet: {
          byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          byCategory: [{ $group: { _id: '$category', count: { $sum: 1 } } }],
          byPriority: [{ $group: { _id: '$priority', count: { $sum: 1 } } }],
          pendingInvoices: [{ $match: { 'invoice.status': 'pending' } }, { $count: 'count' }],
        },
      },
    ]);

    const raw = (results[0] || {}) as any;
    const toMap = (arr: { _id: string; count: number }[]) =>
      Object.fromEntries((arr || []).map((i) => [i._id, i.count]));

    const statusMap = toMap(raw.byStatus || []);
    const total = Object.values(statusMap as Record<string, number>).reduce((a, b) => a + b, 0);

    return {
      total,
      open: statusMap[MaintenanceRequestStatus.OPEN] || 0,
      inProgress: statusMap[MaintenanceRequestStatus.IN_PROGRESS] || 0,
      completed: statusMap[MaintenanceRequestStatus.COMPLETED] || 0,
      cancelled: statusMap[MaintenanceRequestStatus.CANCELLED] || 0,
      pending: statusMap[MaintenanceRequestStatus.PENDING] || 0,
      byCategory: toMap(raw.byCategory || []),
      byPriority: toMap(raw.byPriority || []),
      pendingInvoices: raw.pendingInvoices?.[0]?.count || 0,
    };
  }
}
