import { type QueryFilter, Model, Types } from 'mongoose';
import { IListInspectionsQuery, IInspectionDocument } from '@interfaces/inspection.interface';

import { BaseDAO } from './baseDAO';

const LEASE_POPULATE = {
  path: 'leaseId',
  select: 'property.unitId',
  populate: { path: 'propertyUnitInfo', select: 'unitNumber' },
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
        { path: 'propertyId', select: 'address pid title' },
        LEASE_POPULATE,
        { path: 'inspectorId', select: 'firstName lastName email' },
        { path: 'tenantId', select: 'firstName lastName email' },
      ],
    });
  }

  async listByClient(cuid: string, query?: IListInspectionsQuery) {
    const filter: QueryFilter<IInspectionDocument> = { cuid, deletedAt: null };
    if (query?.propertyId) filter.propertyId = new Types.ObjectId(query.propertyId);
    if (query?.type) filter.type = query.type;
    if (query?.status) filter.status = query.status;

    return this.list(filter, {
      ...query,
      populate: [
        { path: 'propertyId', select: 'address pid title' },
        LEASE_POPULATE,
        { path: 'inspectorId', select: 'firstName lastName email' },
        { path: 'tenantId', select: 'firstName lastName email' },
      ],
    });
  }

  async listForTenant(tenantId: string, cuid: string, query?: IListInspectionsQuery) {
    const filter: QueryFilter<IInspectionDocument> = { tenantId, cuid, deletedAt: null };
    if (query?.type) filter.type = query.type;
    if (query?.status) filter.status = query.status;

    return this.list(filter, {
      ...query,
      populate: [
        { path: 'propertyId', select: 'address pid title' },
        LEASE_POPULATE,
        { path: 'inspectorId', select: 'firstName lastName email' },
      ],
    });
  }
}
