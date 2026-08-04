import { type QueryFilter, Model, Types } from 'mongoose';
import {
  IListInspectionsQuery,
  IInspectionDocument,
  IInspectionStats,
  InspectionStatus,
} from '@interfaces/inspection.interface';

import { BaseDAO } from './baseDAO';

const LEASE_POPULATE = {
  path: 'leaseId',
  select: 'property.unitId',
  populate: { path: 'propertyUnitInfo', select: 'unitNumber' },
};

const TENANT_POPULATE = {
  path: 'tenantId',
  select: 'uid email',
  populate: { path: 'profile', select: 'personalInfo.firstName personalInfo.lastName' },
};

export class InspectionDAO extends BaseDAO<IInspectionDocument> {
  constructor({ inspectionModel }: { inspectionModel: Model<IInspectionDocument> }) {
    super(inspectionModel);
  }

  async getByIuid(
    iuid: string,
    cuid: string,
    tenantId?: string
  ): Promise<IInspectionDocument | null> {
    const filter: Record<string, any> = { iuid, cuid, deletedAt: null };
    if (tenantId) filter.tenantId = tenantId;

    return this.findFirst(filter, {
      populate: [
        { path: 'propertyId', select: 'address pid name' },
        LEASE_POPULATE,
        TENANT_POPULATE,
      ],
    });
  }

  async listByClient(cuid: string, query?: IListInspectionsQuery) {
    const filter: QueryFilter<IInspectionDocument> = { cuid, deletedAt: null };
    if (query?.propertyId) filter.propertyId = new Types.ObjectId(query.propertyId);
    if (query?.type) filter.type = query.type;
    if (query?.status) filter.status = query.status;

    const page = Math.max(1, query?.page || 1);
    const limit = Math.max(1, Math.min(query?.limit || 10, 100));
    const skip = (page - 1) * limit;

    return this.list(filter, {
      skip,
      limit,
      sort: query?.sort,
      populate: [
        { path: 'propertyId', select: 'address pid name' },
        LEASE_POPULATE,
        TENANT_POPULATE,
      ],
    });
  }

  async getStats(cuid: string): Promise<IInspectionStats> {
    const results = await this.aggregate([
      { $match: { cuid, deletedAt: null } },
      {
        $facet: {
          byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          byType: [{ $group: { _id: '$type', count: { $sum: 1 } } }],
          // Measures scheduledDate → approvedAt (full lifecycle duration, not just active work time)
          avgCompletion: [
            {
              $match: {
                status: InspectionStatus.APPROVED,
                approvedAt: { $exists: true },
              },
            },
            {
              $group: {
                _id: null,
                avgMs: { $avg: { $subtract: ['$approvedAt', '$scheduledDate'] } },
              },
            },
          ],
        },
      },
    ]);

    interface IFacetResult {
      avgCompletion: { _id: null; avgMs: number }[];
      byStatus: { _id: string; count: number }[];
      byType: { _id: string; count: number }[];
    }

    const raw = (results[0] ?? {}) as Partial<IFacetResult>;
    const toMap = (arr: { _id: string; count: number }[]) =>
      Object.fromEntries((arr || []).map((i) => [i._id, i.count]));

    const statusMap = toMap(raw.byStatus || []);
    const total = Object.values(statusMap as Record<string, number>).reduce((a, b) => a + b, 0);
    const avgMs = raw.avgCompletion?.[0]?.avgMs || 0;

    return {
      total,
      scheduled: statusMap[InspectionStatus.SCHEDULED] || 0,
      inProgress: statusMap[InspectionStatus.IN_PROGRESS] || 0,
      submitted: statusMap[InspectionStatus.SUBMITTED] || 0,
      approved: statusMap[InspectionStatus.APPROVED] || 0,
      rejected: statusMap[InspectionStatus.REJECTED] || 0,
      disputed: statusMap[InspectionStatus.DISPUTED] || 0,
      cancelled: statusMap[InspectionStatus.CANCELLED] || 0,
      byType: toMap(raw.byType || []),
      avgCompletionDays: avgMs > 0 ? Math.round(avgMs / (1000 * 60 * 60 * 24)) : 0,
    };
  }

  async listForTenant(tenantId: string, cuid: string, query?: IListInspectionsQuery) {
    const filter: QueryFilter<IInspectionDocument> = { tenantId, cuid, deletedAt: null };
    if (query?.type) filter.type = query.type;
    if (query?.status) filter.status = query.status;

    const page = Math.max(1, query?.page || 1);
    const limit = Math.max(1, Math.min(query?.limit || 10, 100));
    const skip = (page - 1) * limit;

    return this.list(filter, {
      skip,
      limit,
      sort: query?.sort,
      populate: [
        { path: 'propertyId', select: 'address pid name' },
        LEASE_POPULATE,
        TENANT_POPULATE,
      ],
    });
  }
}
