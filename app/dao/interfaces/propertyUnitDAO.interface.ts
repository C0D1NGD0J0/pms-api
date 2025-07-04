import { ListResultWithPagination, IPaginationQuery } from '@interfaces/utils.interface';
import {
  PropertyUnitInspection,
  IPropertyUnitDocument,
  PropertyUnitStatus,
} from '@interfaces/propertyUnit.interface';

import { IBaseDAO } from './baseDAO.interface';

export interface IPropertyUnitDAO extends IBaseDAO<IPropertyUnitDocument> {
  /**
   * Get comprehensive unit information for a property
   * @param propertyId - The property ID
   * @returns A promise that resolves to unit information and statistics
   */
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

  /**
   * Add a new inspection record to a unit
   * @param unitId - The property unit ID
   * @param inspectionData - The inspection data
   * @param userId - The ID of the user performing the action
   * @returns A promise that resolves to the updated property unit document or null if not found
   */
  addInspection(
    unitId: string,
    inspectionData: Partial<PropertyUnitInspection>,
    userId: string
  ): Promise<IPropertyUnitDocument | null>;

  /**
   * Update unit status with appropriate validation
   * @param unitId - The property unit ID
   * @param status - The new status
   * @param userId - The ID of the user performing the update
   * @returns A promise that resolves to the updated property unit document or null if not found
   */
  updateUnitStatus(
    unitId: string,
    status: PropertyUnitStatus,
    userId: string
  ): Promise<IPropertyUnitDocument | null>;

  /**
   * Find all units for a specific property
   * @param propertyId - The property ID
   * @returns A promise that resolves to an array of property unit documents
   */
  findUnitsByPropertyId(
    propertyId: string,
    opts?: IPaginationQuery
  ): ListResultWithPagination<IPropertyUnitDocument[]>;

  /**
   * Find units by specific status
   * @param status - The property unit status to filter by
   * @param propertyId - Optional property ID to filter by
   * @returns A promise that resolves to an array of property unit documents with the specified status
   */
  findUnitsByStatus(
    status: PropertyUnitStatus,
    propertyId: string
  ): ListResultWithPagination<IPropertyUnitDocument[]>;

  /**
   * Find a specific unit by its number within a property
   * @param unitNumber - The unit number
   * @param propertyId - The property ID
   * @returns A promise that resolves to the property unit document or null if not found
   */
  findUnitByNumberAndProperty(
    unitNumber: string,
    propertyId: string
  ): Promise<IPropertyUnitDocument | null>;

  /**
   * Find units with available status
   * @param propertyId - Optional property ID to filter by
   * @returns A promise that resolves to an array of available property unit documents
   */
  findAvailableUnits(propertyId: string): ListResultWithPagination<IPropertyUnitDocument[]>;

  /**
   * Get count of units grouped by status
   * @param propertyId - Optional property ID to filter by
   * @returns A promise that resolves to an object with counts for each status
   */
  getUnitCountsByStatus(propertyId: string): Promise<Record<PropertyUnitStatus, number>>;

  getSuggestedStartingUnitNumber(propertyType: string): string | null;
}
