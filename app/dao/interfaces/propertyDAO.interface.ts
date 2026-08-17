import { type QueryFilter, ClientSession } from 'mongoose';
import { IPropertyUnitDocument } from '@interfaces/propertyUnit.interface';
import {
  ListResultWithPagination,
  IPaginationQuery,
  UploadResult,
} from '@interfaces/utils.interface';
import {
  IPropertyDocument,
  OccupancyStatus,
  PropertyStatus,
  PropertyType,
} from '@interfaces/property.interface';

import { IFindOptions } from './baseDAO.interface';

export interface IPropertyDAO {
  getFilteredProperties(
    clientId: string,
    filters: {
      propertyType?: PropertyType[];
      operationalStatus?: PropertyStatus[];
      occupancyStatus?: OccupancyStatus[];
      priceRange?: { min?: number; max?: number };
      areaRange?: { min?: number; max?: number };
      amenities?: string[];
      location?: { city?: string; state?: string; postCode?: string };
    },
    pagination: { page: number; limit: number; sort?: string }
  ): ListResultWithPagination<IPropertyDocument[]>;

  getUnitCountsByStatus(propertyId: string): Promise<{
    total: number;
    available: number;
    occupied: number;
    reserved: number;
    maintenance: number;
    inactive: number;
  }>;

  // checkPropertyAvailability(
  //   propertyId: string,
  //   startDate: Date,
  //   endDate: Date
  // ): Promise<{ isAvailable: boolean; conflictingLeases?: any[] }>;

  getPropertiesByClientId(
    clientId: string,
    filter?: QueryFilter<IPropertyDocument>,
    opts?: IPaginationQuery
  ): ListResultWithPagination<IPropertyDocument[]>;

  canAddUnitToProperty(
    propertyId: string,
    session?: ClientSession
  ): Promise<{
    canAdd: boolean;
    currentCount: number;
    maxCapacity: number;
  }>;

  updatePropertyOccupancy(
    propertyId: string,
    status: OccupancyStatus,
    maxAllowedUnits: number,
    userId: string
  ): Promise<IPropertyDocument | null>;

  getPropertyUnits(
    propertyId: string,
    opts: IPaginationQuery,
    session?: ClientSession
  ): ListResultWithPagination<IPropertyUnitDocument[]>;

  canArchiveProperty(propertyId: string): Promise<{
    canArchive: boolean;
    activeUnitCount?: number;
    occupiedUnitCount?: number;
  }>;

  updatePropertyDocument(
    propertyId: string,
    documentData: UploadResult[],
    userId: string
  ): Promise<IPropertyDocument | null>;

  findPropertiesNearby(
    clientId: string,
    coordinates: [number, number],
    radiusInKm: number
  ): Promise<IPropertyDocument[]>;

  removePropertyDocument(
    propertyId: string,
    documentId: string,
    userId: string
  ): Promise<IPropertyDocument | null>;

  findPropertyByAddress(
    address: string,
    clientId: string,
    opts?: IFindOptions
  ): Promise<IPropertyDocument | null>;

  createProperty(
    propertyData: Partial<IPropertyDocument>,
    session?: ClientSession
  ): Promise<IPropertyDocument>;

  syncPropertyOccupancyWithUnits(
    propertyId: string,
    userId: string
  ): Promise<IPropertyDocument | null>;

  searchProperties(query: string, clientId: string): ListResultWithPagination<IPropertyDocument[]>;

  archiveProperty(propertyId: string, userId: string): Promise<boolean>;
}
