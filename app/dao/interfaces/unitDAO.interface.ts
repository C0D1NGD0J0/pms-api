import { UnitInspection } from '@interfaces/unit.interface';
import { IUnitDocument, UnitStatus } from '@interfaces/unit.interface';

import { IBaseDAO } from './baseDAO.interface';

export interface IUnitDAO extends IBaseDAO<IUnitDocument> {
  /**
   * Add a new inspection record to a unit
   * @param unitId - The unit ID
   * @param inspectionData - The inspection data
   * @param userId - The ID of the user performing the action
   * @returns A promise that resolves to the updated unit document or null if not found
   */
  addInspection(
    unitId: string,
    inspectionData: Partial<UnitInspection>,
    userId: string
  ): Promise<IUnitDocument | null>;

  /**
   * Update unit status with appropriate validation
   * @param unitId - The unit ID
   * @param status - The new status
   * @param userId - The ID of the user performing the update
   * @returns A promise that resolves to the updated unit document or null if not found
   */
  updateUnitStatus(
    unitId: string,
    status: UnitStatus,
    userId: string
  ): Promise<IUnitDocument | null>;

  /**
   * Find a specific unit by its number within a property
   * @param unitNumber - The unit number
   * @param propertyId - The property ID
   * @returns A promise that resolves to the unit document or null if not found
   */
  findUnitByNumberAndProperty(
    unitNumber: string,
    propertyId: string
  ): Promise<IUnitDocument | null>;

  /**
   * Find units by specific status
   * @param status - The unit status to filter by
   * @param propertyId - Optional property ID to filter by
   * @returns A promise that resolves to an array of unit documents with the specified status
   */
  findUnitsByStatus(status: UnitStatus, propertyId?: string): Promise<IUnitDocument[]>;

  /**
   * Get count of units grouped by status
   * @param propertyId - Optional property ID to filter by
   * @returns A promise that resolves to an object with counts for each status
   */
  getUnitCountsByStatus(propertyId?: string): Promise<Record<UnitStatus, number>>;

  /**
   * Find all units for a specific property
   * @param propertyId - The property ID
   * @returns A promise that resolves to an array of unit documents
   */
  findUnitsByProperty(propertyId: string): Promise<IUnitDocument[]>;

  /**
   * Find units with available status
   * @param propertyId - Optional property ID to filter by
   * @returns A promise that resolves to an array of available unit documents
   */
  findAvailableUnits(propertyId?: string): Promise<IUnitDocument[]>;
}
