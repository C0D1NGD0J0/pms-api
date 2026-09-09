import { ClientSession } from 'mongoose';
import { ListResultWithPagination, IPaginationQuery } from '@interfaces/utils.interface';
import {
  PropertyUnitInspection,
  IPropertyUnitDocument,
  PropertyUnitStatus,
} from '@interfaces/propertyUnit.interface';

import { IBaseDAO } from './baseDAO.interface';

export interface IPropertyUnitDAO extends IBaseDAO<IPropertyUnitDocument> {
  getPropertyUnitInfo(propertyId: string): Promise<{
    currentUnits: number;
    unitStats: {
      occupied: number;
      vacant: number;
      maintenance: number;
      available: number;
      reserved: number;
      inactive: number;
    };
  }>;

  findUnitsByPropertyId(
    propertyId: string,
    opts?: IPaginationQuery,
    session?: ClientSession
  ): ListResultWithPagination<IPropertyUnitDocument[]>;

  addInspection(
    unitId: string,
    inspectionData: Partial<PropertyUnitInspection>,
    userId: string
  ): Promise<IPropertyUnitDocument | null>;

  updateUnitStatus(
    unitId: string,
    status: PropertyUnitStatus,
    userId: string
  ): Promise<IPropertyUnitDocument | null>;

  findUnitsByStatus(
    status: PropertyUnitStatus,
    propertyId: string
  ): ListResultWithPagination<IPropertyUnitDocument[]>;

  findUnitByNumberAndProperty(
    unitNumber: string,
    propertyId: string
  ): Promise<IPropertyUnitDocument | null>;

  findAvailableUnits(propertyId: string): ListResultWithPagination<IPropertyUnitDocument[]>;

  getUnitCountsByStatus(propertyId: string): Promise<Record<PropertyUnitStatus, number>>;

  /** Looks up by public identifier (puid), not MongoDB _id. Returns the unit with currentLease and tenantId populated. */
  getUnitWithDetails(unitId: string): Promise<IPropertyUnitDocument | null>;

  getSuggestedStartingUnitNumber(propertyType: string): string | null;
}
