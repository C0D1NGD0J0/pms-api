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
        { path: 'invoiceId', select: 'status' },
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

  /**
   * Aggregated maintenance stats for a client.
   *
   * Optional scoping:
   *   opts.propertyId  — scope to a single property
   *   opts.tenantUserId — scope to a specific tenant (User._id)
   *   opts.vendorUserId — scope to a specific vendor (User._id)
   *
   * Used by MetricsService (no opts), UserService (tenantUserId),
   * VendorService (vendorUserId), and MaintenanceController (propertyId).
   */
  async getStats(
    cuid: string,
    opts?: { propertyId?: string; tenantUserId?: string; vendorUserId?: string }
  ): Promise<IMaintenanceStats> {
    const matchStage: FilterQuery<IMaintenanceRequestDocument> = { cuid, deletedAt: null };
    if (opts?.propertyId) matchStage.propertyId = new Types.ObjectId(opts.propertyId);
    if (opts?.tenantUserId) matchStage.tenantId = new Types.ObjectId(opts.tenantUserId);
    if (opts?.vendorUserId) matchStage.vendorId = new Types.ObjectId(opts.vendorUserId);

    const results = await this.aggregate([
      { $match: matchStage },
      {
        $facet: {
          byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          byCategory: [{ $group: { _id: '$category', count: { $sum: 1 } } }],
          byPriority: [{ $group: { _id: '$priority', count: { $sum: 1 } } }],
          pendingInvoices: [
            {
              $lookup: {
                from: 'invoices',
                localField: '_id',
                foreignField: 'maintenanceRequestId',
                pipeline: [{ $match: { status: 'pending', isDeleted: { $ne: true } } }],
                as: 'pendingInvoiceDocs',
              },
            },
            { $match: { $expr: { $gt: [{ $size: '$pendingInvoiceDocs' }, 0] } } },
            { $count: 'count' },
          ],
          avgResolution: [
            {
              $match: {
                status: MaintenanceRequestStatus.COMPLETED,
                completedAt: { $exists: true },
              },
            },
            {
              $group: {
                _id: null,
                avgMs: { $avg: { $subtract: ['$completedAt', '$createdAt'] } },
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
    const avgMs = raw.avgResolution?.[0]?.avgMs || 0;

    return {
      total,
      open: statusMap[MaintenanceRequestStatus.OPEN] || 0,
      assigned: statusMap[MaintenanceRequestStatus.ASSIGNED] || 0,
      inProgress: statusMap[MaintenanceRequestStatus.IN_PROGRESS] || 0,
      completed: statusMap[MaintenanceRequestStatus.COMPLETED] || 0,
      cancelled: statusMap[MaintenanceRequestStatus.CANCELLED] || 0,
      pending: statusMap[MaintenanceRequestStatus.PENDING] || 0,
      byCategory: toMap(raw.byCategory || []),
      byPriority: toMap(raw.byPriority || []),
      pendingInvoices: raw.pendingInvoices?.[0]?.count || 0,
      avgResolutionDays: avgMs > 0 ? Math.round(avgMs / (1000 * 60 * 60 * 24)) : 0,
    };
  }

  /**
   * Average tenant feedback rating for a vendor across all completed requests.
   * Returns 0 if the vendor has no rated completions.
   */
  async getVendorAvgRating(vendorId: string): Promise<number> {
    const result = await this.aggregate([
      {
        $match: {
          vendorId: new Types.ObjectId(vendorId),
          status: MaintenanceRequestStatus.COMPLETED,
          'tenantFeedback.rating': { $exists: true, $ne: null },
          deletedAt: null,
        },
      },
      {
        $group: {
          _id: null,
          avgRating: { $avg: '$tenantFeedback.rating' },
          count: { $sum: 1 },
        },
      },
    ]);

    const row = (result as any[])[0];
    return row?.avgRating ?? 0;
  }
}
