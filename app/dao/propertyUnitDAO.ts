import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { FilterQuery, Model, Types } from 'mongoose';
import { ListResultWithPagination, IPaginationQuery } from '@interfaces/utils.interface';
import {
  PropertyUnitStatusEnum,
  PropertyUnitInspection,
  IPropertyUnitDocument,
  PropertyUnitStatus,
} from '@interfaces/property-unit.interface';

import { BaseDAO } from './baseDAO';
import { IPropertyUnitDAO } from './interfaces/propertyUnitDAO.interface';

export class PropertyUnitDAO extends BaseDAO<IPropertyUnitDocument> implements IPropertyUnitDAO {
  protected logger: Logger;

  constructor({ propertyUnitModel }: { propertyUnitModel: Model<IPropertyUnitDocument> }) {
    super(propertyUnitModel);
    this.logger = createLogger('PropertyUnitDAO');
  }

  /**
   * Find all units for a specific property
   * @param propertyId - The property ID
   * @returns A promise that resolves to an array of property unit documents
   */
  async findUnitsByProperty(
    propertyId: string,
    opts: IPaginationQuery
  ): ListResultWithPagination<IPropertyUnitDocument[]> {
    try {
      if (!propertyId) {
        throw new Error('Property ID is required');
      }

      const query: FilterQuery<IPropertyUnitDocument> = {
        propertyId: new Types.ObjectId(propertyId),
        deletedAt: null,
      };

      const result = await this.list(query, opts);
      return result.data;
    } catch (error) {
      this.logger.error('Error in findUnitsByProperty:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Find a specific unit by its number within a property
   * @param unitNumber - The unit number
   * @param propertyId - The property ID
   * @returns A promise that resolves to the property unit document or null if not found
   */
  async findUnitByNumberAndProperty(
    unitNumber: string,
    propertyId: string
  ): Promise<IPropertyUnitDocument | null> {
    try {
      if (!unitNumber || !propertyId) {
        throw new Error('Unit number and property ID are required');
      }

      const query: FilterQuery<IPropertyUnitDocument> = {
        unitNumber,
        propertyId: new Types.ObjectId(propertyId),
        deletedAt: null,
      };

      return await this.findFirst(query);
    } catch (error) {
      this.logger.error('Error in findUnitByNumberAndProperty:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Find units with available status
   * @param propertyId - Optional property ID to filter by
   * @returns A promise that resolves to an array of available property unit documents
   */
  async findAvailableUnits(propertyId?: string): Promise<IPropertyUnitDocument[]> {
    try {
      const query: FilterQuery<IPropertyUnitDocument> = {
        status: PropertyUnitStatusEnum.AVAILABLE,
        isActive: true,
        deletedAt: null,
      };

      if (propertyId) {
        query.propertyId = new Types.ObjectId(propertyId);
      }

      const result = await this.list(query);
      return result.data;
    } catch (error) {
      this.logger.error('Error in findAvailableUnits:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Find units by specific status
   * @param status - The property unit status to filter by
   * @param propertyId - Optional property ID to filter by
   * @returns A promise that resolves to an array of property unit documents with the specified status
   */
  async findUnitsByStatus(
    status: PropertyUnitStatus,
    propertyId?: string
  ): Promise<IPropertyUnitDocument[]> {
    try {
      if (!status) {
        throw new Error('Status is required');
      }

      const query: FilterQuery<IPropertyUnitDocument> = {
        status,
        isActive: true,
        deletedAt: null,
      };

      if (propertyId) {
        query.propertyId = new Types.ObjectId(propertyId);
      }

      const result = await this.list(query);
      return result.data;
    } catch (error) {
      this.logger.error('Error in findUnitsByStatus:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Get count of units grouped by status
   * @param propertyId - Optional property ID to filter by
   * @returns A promise that resolves to an object with counts for each status
   */
  async getUnitCountsByStatus(propertyId?: string): Promise<Record<PropertyUnitStatus, number>> {
    try {
      const match: FilterQuery<IPropertyUnitDocument> = {
        isActive: true,
        deletedAt: null,
      };

      if (propertyId) {
        match.propertyId = new Types.ObjectId(propertyId);
      }

      const aggregationResults = await this.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
      ]);

      // Initialize counts for all statuses to 0
      const result: Record<PropertyUnitStatus, number> = {
        [PropertyUnitStatusEnum.AVAILABLE]: 0,
        [PropertyUnitStatusEnum.OCCUPIED]: 0,
        [PropertyUnitStatusEnum.RESERVED]: 0,
        [PropertyUnitStatusEnum.MAINTENANCE]: 0,
        [PropertyUnitStatusEnum.INACTIVE]: 0,
      };

      // Update counts based on aggregation results
      aggregationResults.forEach((item: any) => {
        if (item._id && typeof item._id === 'string') {
          result[item._id as PropertyUnitStatus] = item.count;
        }
      });

      return result;
    } catch (error) {
      this.logger.error('Error in getUnitCountsByStatus:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Update unit status with appropriate validation
   * @param unitId - The property unit ID
   * @param status - The new status
   * @param userId - The ID of the user performing the update
   * @returns A promise that resolves to the updated property unit document or null if not found
   */
  async updateUnitStatus(
    unitId: string,
    status: PropertyUnitStatus,
    userId: string
  ): Promise<IPropertyUnitDocument | null> {
    try {
      if (!unitId || !status || !userId) {
        throw new Error('Property unit ID, status, and user ID are required');
      }

      // Status-specific validation logic
      const unit = await this.findById(unitId);
      if (!unit) {
        throw new Error('Property unit not found');
      }

      // Prevent changing occupied units unless explicitly marking as available
      if (
        unit.status === PropertyUnitStatusEnum.OCCUPIED &&
        status !== PropertyUnitStatusEnum.AVAILABLE
      ) {
        // If unit is occupied and has a current lease, require lease closure first
        if (unit.currentLease) {
          throw new Error('Cannot change status of occupied unit with active lease');
        }
      }

      // For handling occupied status, we would check for a lease
      // This would typically be handled in a service layer that manages
      // the relationship between properties, units, tenants, and leases

      // Update status
      const updateOperation = {
        $set: {
          status,
          lastModifiedBy: new Types.ObjectId(userId),
        },
      };

      return await this.updateById(unitId, updateOperation);
    } catch (error) {
      this.logger.error('Error in updateUnitStatus:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Add a new inspection record to a property unit
   * @param unitId - The property unit ID
   * @param inspectionData - The inspection data
   * @param userId - The ID of the user performing the action
   * @returns A promise that resolves to the updated property unit document or null if not found
   */
  async addInspection(
    unitId: string,
    inspectionData: Partial<PropertyUnitInspection>,
    userId: string
  ): Promise<IPropertyUnitDocument | null> {
    try {
      if (!unitId || !inspectionData || !userId) {
        throw new Error('Property unit ID, inspection data, and user ID are required');
      }

      // Validate required inspection fields
      if (!inspectionData.inspectionDate) {
        inspectionData.inspectionDate = new Date();
      }

      if (!inspectionData.status) {
        throw new Error('Inspection status is required');
      }

      // Set inspector if not provided
      if (!inspectionData.inspector) {
        inspectionData.inspector = {
          name: 'System User',
          contact: 'system',
        };
      }

      // Update unit with new inspection
      const newInspection = {
        ...inspectionData,
        inspectionDate: new Date(inspectionData.inspectionDate),
      };

      const updateOperation = {
        $push: { inspections: newInspection },
        $set: {
          lastInspectionDate: new Date(inspectionData.inspectionDate),
          lastModifiedBy: new Types.ObjectId(userId),
        },
      };

      return await this.updateById(unitId, updateOperation);
    } catch (error) {
      this.logger.error('Error in addInspection:', error);
      throw this.throwErrorHandler(error);
    }
  }
}
