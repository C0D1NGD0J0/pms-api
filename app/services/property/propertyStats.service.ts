import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { PropertyUnitDAO, PropertyDAO } from '@dao/index';
import { IPropertyDocument } from '@interfaces/property.interface';
import { PropertyTypeManager } from '@services/property/PropertyTypeManager';

interface IConstructor {
  propertyUnitDAO: PropertyUnitDAO;
  propertyDAO: PropertyDAO;
}

export class PropertyStatsService {
  private readonly log: Logger;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly propertyDAO: PropertyDAO;

  constructor({ propertyUnitDAO, propertyDAO }: IConstructor) {
    this.propertyUnitDAO = propertyUnitDAO;
    this.propertyDAO = propertyDAO;
    this.log = createLogger('PropertyStatsService');
  }

  async getUnitInfoForProperty(property: IPropertyDocument): Promise<{
    canAddUnit: boolean;
    maxAllowedUnits: number;
    currentUnits: number;
    availableSpaces: number;
    lastUnitNumber?: string;
    suggestedNextUnitNumber?: string;
    statistics: {
      occupied: number;
      vacant: number;
      maintenance: number;
      available: number;
      reserved: number;
      inactive: number;
    };
    totalUnits: number;
    unitStats: {
      occupied: number;
      vacant: number;
      maintenance: number;
      available: number;
      reserved: number;
      inactive: number;
    };
  }> {
    const isMultiUnit = PropertyTypeManager.supportsMultipleUnits(property.propertyType);
    const maxAllowedUnits = property.maxAllowedUnits || 1;

    if (isMultiUnit) {
      const unitData = await this.propertyUnitDAO.getPropertyUnitInfo(property._id.toString());
      const canAddUnitResult = await this.propertyDAO.canAddUnitToProperty(property._id.toString());
      const availableSpaces = Math.max(0, maxAllowedUnits - unitData.currentUnits);

      let lastUnitNumber: string | undefined;
      let suggestedNextUnitNumber: string | undefined;

      if (unitData.currentUnits > 0) {
        try {
          const existingUnitNumbers = await this.propertyUnitDAO.getExistingUnitNumbers(
            property._id.toString()
          );

          if (existingUnitNumbers.length > 0) {
            // Find the highest numerical unit number
            const numericUnits = existingUnitNumbers
              .map((num) => {
                const match = num.match(/(\d+)/);
                return match ? parseInt(match[1], 10) : 0;
              })
              .filter((num) => num > 0);

            if (numericUnits.length > 0) {
              const highestNumber = Math.max(...numericUnits);
              lastUnitNumber = highestNumber.toString();

              // get suggested next unit number
              suggestedNextUnitNumber = await this.propertyUnitDAO.getNextAvailableUnitNumber(
                property._id.toString(),
                'sequential'
              );
            } else {
              // No numeric patterns found, get the last unit alphabetically
              lastUnitNumber = existingUnitNumbers.sort().pop();
              suggestedNextUnitNumber = await this.propertyUnitDAO.getNextAvailableUnitNumber(
                property._id.toString(),
                'custom'
              );
            }
          }
        } catch (error) {
          this.log.warn(
            `Error getting unit numbers for property ${property._id.toString()}:`,
            error
          );
          // continue without unit numbering info
        }
      } else {
        suggestedNextUnitNumber = this.propertyUnitDAO.getSuggestedStartingUnitNumber(
          property.propertyType
        );
      }

      return {
        canAddUnit: canAddUnitResult.canAdd,
        maxAllowedUnits,
        currentUnits: unitData.currentUnits,
        availableSpaces,
        lastUnitNumber,
        suggestedNextUnitNumber,
        statistics: unitData.unitStats,
        totalUnits: unitData.currentUnits,
        unitStats: unitData.unitStats,
      };
    } else {
      // Single-unit property: derive stats from property status
      const unitStats = {
        occupied: 0,
        vacant: 0,
        maintenance: 0,
        available: 0,
        reserved: 0,
        inactive: 0,
      };

      // map property occupancy status to unit stats
      switch (property.occupancyStatus) {
        case 'partially_occupied':
          unitStats.occupied = 1;
          break;
        case 'occupied':
          unitStats.occupied = 1;
          break;
        case 'vacant':
          unitStats.available = 1;
          break;
        default:
          unitStats.available = 1;
          break;
      }

      // For single-unit properties, suggest unit numbers if they want to convert to multi-unit
      const suggestedNextUnitNumber =
        property.propertyType === 'house' || property.propertyType === 'townhouse'
          ? '2' // If converting house to duplex, start with unit 2
          : this.propertyUnitDAO.getSuggestedStartingUnitNumber(property.propertyType);

      return {
        canAddUnit: false,
        maxAllowedUnits: 1,
        currentUnits: 1,
        availableSpaces: 0,
        suggestedNextUnitNumber,
        statistics: unitStats,
        totalUnits: 1,
        unitStats,
      };
    }
  }
}
