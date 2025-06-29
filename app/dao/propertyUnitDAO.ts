import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { FilterQuery, Model, Types } from 'mongoose';
import { ListResultWithPagination, IPaginationQuery } from '@interfaces/utils.interface';
import {
  PropertyUnitStatusEnum,
  PropertyUnitInspection,
  IPropertyUnitDocument,
  PropertyUnitStatus,
} from '@interfaces/propertyUnit.interface';

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
  async findUnitsByPropertyId(
    propertyId: string,
    opts: IPaginationQuery = {
      page: 1,
      limit: 1000,
    }
  ): ListResultWithPagination<IPropertyUnitDocument[]> {
    try {
      if (!propertyId) {
        throw new Error('Property ID is required');
      }

      const query: FilterQuery<IPropertyUnitDocument> = {
        propertyId: new Types.ObjectId(propertyId),
        deletedAt: null,
      };

      // sort data by floor (asc) and unitNumber (asc)
      let sortOption: Record<string, 1 | -1> = { floor: 1, unitNumber: 1 };

      // if user provided custom sorting, preserve it as secondary criteria
      if (opts.sort && typeof opts.sort === 'object') {
        sortOption = { ...sortOption, ...opts.sort };
      } else if (opts.sortBy && opts.sort) {
        const sortDirection: 1 | -1 = opts.sort === 'desc' ? -1 : 1;
        // Apply user sorting first, then default sorting as fallback
        sortOption = { [opts.sortBy]: sortDirection, floor: 1, unitNumber: 1 };
      }

      const updatedOpts = {
        ...opts,
        sort: sortOption,
      };

      const result = await this.list(query, updatedOpts);
      return result;
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
  async findAvailableUnits(propertyId?: string): ListResultWithPagination<IPropertyUnitDocument[]> {
    try {
      const query: FilterQuery<IPropertyUnitDocument> = {
        status: PropertyUnitStatusEnum.AVAILABLE,
        isActive: true,
        deletedAt: null,
      };

      if (propertyId) {
        query.propertyId = new Types.ObjectId(propertyId);
      }

      const result = await this.list(query, {
        limit: 1000,
        sort: { floor: 1, unitNumber: 1 },
      });
      return result;
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
  ): ListResultWithPagination<IPropertyUnitDocument[]> {
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

      const result = await this.list(query, {
        limit: 1000,
        sort: { floor: 1, unitNumber: 1 },
      });
      return result;
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
  async getUnitCountsByStatus(propertyId: string): Promise<Record<PropertyUnitStatus, number>> {
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

  /**
   * Get comprehensive unit information for a property
   * @param propertyId - The property ID
   * @returns A promise that resolves to unit information and statistics
   */
  async getPropertyUnitInfo(propertyId: string): Promise<{
    currentUnits: number;
    unitStats: {
      occupied: number;
      vacant: number;
      maintenance: number;
      available: number;
      reserved: number;
      inactive: number;
    };
  }> {
    try {
      if (!propertyId) {
        throw new Error('Property ID is required');
      }

      // Get ALL units for this property (including archived) to count toward limits
      const allUnits = await this.list(
        {
          propertyId: new Types.ObjectId(propertyId),
          // Note: Removed deletedAt: null to include archived units in total count
        },
        { limit: 1000 } // Get all units for counting
      );

      // Get only active units for status calculations
      const activeUnits = await this.list(
        {
          propertyId: new Types.ObjectId(propertyId),
          deletedAt: null,
        },
        { limit: 1000 }
      );

      // Use total count (including archived) for currentUnits to maintain consistency with canAddUnitToProperty
      const currentUnits = allUnits.items.length;

      // Count units by status (only for active/non-archived units)
      const unitStats = activeUnits.items.reduce(
        (
          stats: {
            occupied: number;
            vacant: number;
            maintenance: number;
            available: number;
            reserved: number;
            inactive: number;
          },
          unit: any
        ) => {
          switch (unit.status) {
            case PropertyUnitStatusEnum.MAINTENANCE:
              stats.maintenance++;
              break;
            case PropertyUnitStatusEnum.AVAILABLE:
              // Count both vacant and available as available
              stats.available++;
              break;
            case PropertyUnitStatusEnum.INACTIVE:
              stats.inactive++;
              break;
            case PropertyUnitStatusEnum.OCCUPIED:
              stats.occupied++;
              break;
            case PropertyUnitStatusEnum.RESERVED:
              stats.reserved++;
              break;
            default:
              // Count unknown status as available
              stats.available++;
          }
          return stats;
        },
        { occupied: 0, vacant: 0, maintenance: 0, available: 0, reserved: 0, inactive: 0 }
      );

      return {
        currentUnits,
        unitStats,
      };
    } catch (error) {
      this.logger.error(`Error getting unit info for property ${propertyId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Get existing unit numbers for a property
   * @param propertyId - The property ID
   * @returns A promise that resolves to an array of existing unit numbers
   */
  async getExistingUnitNumbers(propertyId: string): Promise<string[]> {
    try {
      if (!propertyId) {
        throw new Error('Property ID is required');
      }

      const units = await this.list(
        {
          propertyId: new Types.ObjectId(propertyId),
          deletedAt: null,
        },
        { limit: 1000, projection: 'unitNumber' }
      );

      return units.items.map((unit: any) => unit.unitNumber).filter(Boolean);
    } catch (error) {
      this.logger.error(`Error getting existing unit numbers for property ${propertyId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Generate next available unit number using different patterns
   * @param propertyId - The property ID
   * @param pattern - The numbering pattern to use
   * @returns A promise that resolves to the next available unit number
   */
  async getNextAvailableUnitNumber(
    propertyId: string,
    pattern: 'sequential' | 'floorBased' | 'custom' = 'sequential'
  ): Promise<string> {
    try {
      if (!propertyId) {
        throw new Error('Property ID is required');
      }

      const existingNumbers = await this.getExistingUnitNumbers(propertyId);
      return this.generateUnitNumber(existingNumbers, pattern);
    } catch (error) {
      this.logger.error(`Error generating next unit number for property ${propertyId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Generate unit number based on existing numbers and pattern
   * @param existingNumbers - Array of existing unit numbers
   * @param pattern - The numbering pattern to use
   * @returns The next available unit number
   */
  private generateUnitNumber(
    existingNumbers: string[],
    pattern: 'sequential' | 'floorBased' | 'custom'
  ): string {
    const existing = new Set(existingNumbers.map((num) => num.toString().toLowerCase()));

    switch (pattern) {
      case 'sequential':
        return this.generateSequentialNumber(existing);
      case 'floorBased':
        return this.generateFloorBasedNumber(existing, existingNumbers);
      case 'custom':
        return this.generateCustomPatternNumber(existing, existingNumbers);
      default:
        return this.generateSequentialNumber(existing);
    }
  }

  /**
   * Generate sequential unit number (101, 102, 103...)
   */
  private generateSequentialNumber(existing: Set<string>): string {
    let nextNum = 101;
    while (existing.has(nextNum.toString())) {
      nextNum++;
    }
    return nextNum.toString();
  }

  /**
   * Generate floor-based unit number (Floor 1: 101-110, Floor 2: 201-210, etc.)
   */
  private generateFloorBasedNumber(existing: Set<string>, _existingNumbers: string[]): string {
    // Start from floor 1, unit 01

    // Start from floor 1, unit 01
    let floor = 1;
    let unit = 1;

    while (floor <= 50) {
      // Reasonable limit of 50 floors
      const candidateNumber = `${floor}${unit.toString().padStart(2, '0')}`;
      if (!existing.has(candidateNumber)) {
        return candidateNumber;
      }

      unit++;
      // If we reach unit 99, move to next floor
      if (unit > 99) {
        floor++;
        unit = 1;
      }
    }

    // Fallback if we somehow don't find anything in 50 floors
    return `${floor}01`;
  }

  /**
   * Generate custom pattern unit number based on existing patterns
   */
  private generateCustomPatternNumber(existing: Set<string>, existingNumbers: string[]): string {
    if (existingNumbers.length === 0) {
      return 'A-1001'; // Default custom pattern
    }

    // Analyze existing patterns
    const patterns = {
      prefixNumber: /^([A-Z]+)[-_]?(\d+)$/i,
      numberSuffix: /^(\d+)[-_]?([A-Z]+)$/i,
      justNumbers: /^(\d+)$/,
      justLetters: /^([A-Z]+)$/i,
    };

    const patternMatches = {
      prefixNumber: [] as Array<{ prefix: string; number: number }>,
      numberSuffix: [] as Array<{ number: number; suffix: string }>,
      justNumbers: [] as number[],
      justLetters: [] as string[],
    };

    // Categorize existing numbers
    existingNumbers.forEach((num) => {
      const str = num.toString().trim();

      if (patterns.prefixNumber.test(str)) {
        const match = str.match(patterns.prefixNumber)!;
        patternMatches.prefixNumber.push({
          prefix: match[1].toUpperCase(),
          number: parseInt(match[2]),
        });
      } else if (patterns.numberSuffix.test(str)) {
        const match = str.match(patterns.numberSuffix)!;
        patternMatches.numberSuffix.push({
          number: parseInt(match[1]),
          suffix: match[2].toUpperCase(),
        });
      } else if (patterns.justNumbers.test(str)) {
        patternMatches.justNumbers.push(parseInt(str));
      } else if (patterns.justLetters.test(str)) {
        patternMatches.justLetters.push(str.toUpperCase());
      }
    });

    // Generate based on the most common pattern
    if (patternMatches.prefixNumber.length > 0) {
      // Pattern: A-1001, B-1002, etc.
      const prefixes = patternMatches.prefixNumber.map((p) => p.prefix);
      const mostCommonPrefix =
        prefixes
          .sort(
            (a, b) =>
              prefixes.filter((p) => p === a).length - prefixes.filter((p) => p === b).length
          )
          .pop() || 'A';

      const numbersWithPrefix = patternMatches.prefixNumber
        .filter((p) => p.prefix === mostCommonPrefix)
        .map((p) => p.number);

      const nextNumber = numbersWithPrefix.length > 0 ? Math.max(...numbersWithPrefix) + 1 : 1001;

      return `${mostCommonPrefix}-${nextNumber}`;
    } else if (patternMatches.numberSuffix.length > 0) {
      // Pattern: 1001A, 1002B, etc.
      const suffixes = patternMatches.numberSuffix.map((p) => p.suffix);
      const mostCommonSuffix =
        suffixes
          .sort(
            (a, b) =>
              suffixes.filter((s) => s === a).length - suffixes.filter((s) => s === b).length
          )
          .pop() || 'A';

      const numbersWithSuffix = patternMatches.numberSuffix
        .filter((p) => p.suffix === mostCommonSuffix)
        .map((p) => p.number);

      const nextNumber = numbersWithSuffix.length > 0 ? Math.max(...numbersWithSuffix) + 1 : 1001;

      return `${nextNumber}${mostCommonSuffix}`;
    } else if (patternMatches.justNumbers.length > 0) {
      // Just numbers pattern
      const nextNumber = Math.max(...patternMatches.justNumbers) + 1;
      return nextNumber.toString();
    } else {
      // Default to letter prefix pattern
      return 'A-1001';
    }
  }

  getSuggestedStartingUnitNumber(propertyType: string): string {
    switch (propertyType) {
      case 'condominium':
      case 'apartment':
        return '101'; // Floor-based numbering
      case 'commercial':
      case 'industrial':
        return 'A-1001'; // Letter prefix pattern
      case 'townhouse':
      case 'house':
        return '1'; // Simple sequential
      default:
        return '101'; // Default floor-based
    }
  }
}
