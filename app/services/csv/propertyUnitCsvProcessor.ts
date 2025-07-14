import { ObjectId } from 'mongodb';
import { createLogger } from '@utils/index';
import { IPropertyUnit } from '@interfaces/propertyUnit.interface';
import { PropertyUnitValidations } from '@shared/validations/PropertyUnitValidation';
import { ICsvValidationResult, IInvalidCsvProperty } from '@interfaces/csv.interface';

import { BaseCSVProcessorService } from './base';

interface PropertyUnitProcessingContext {
  userId: string;
  cuid: string;
  pid: string;
}

export class PropertyUnitCsvProcessor {
  private readonly log = createLogger('PropertyUnitCsvProcessor');

  async validateCsv(
    filePath: string,
    context: PropertyUnitProcessingContext
  ): Promise<{
    validUnits: IPropertyUnit[];
    totalRows: number;
    finishedAt: Date;
    errors: null | IInvalidCsvProperty[];
  }> {
    const result = await BaseCSVProcessorService.processCsvFile<
      IPropertyUnit,
      PropertyUnitProcessingContext
    >(filePath, {
      context,
      validateRow: this.validateUnitRow,
      transformRow: this.transformUnitRow,
    });

    return {
      validUnits: result.validItems,
      totalRows: result.totalRows,
      finishedAt: new Date(),
      errors: result.errors,
    };
  }

  private validateUnitRow = async (
    row: any,
    context: PropertyUnitProcessingContext
  ): Promise<ICsvValidationResult> => {
    const rowWithContext = {
      ...row,
      cuid: context.cuid,
      pid: context.pid,
    };

    const validationResult = await PropertyUnitValidations.csvSchema.safeParseAsync(rowWithContext);

    if (validationResult.success) {
      return {
        isValid: true,
        errors: [],
      };
    } else {
      const formattedErrors = validationResult.error.errors.map((err) => ({
        field: err.path.join('.'),
        error: err.message,
      }));

      return {
        isValid: false,
        errors: formattedErrors,
      };
    }
  };

  private transformUnitRow = async (
    row: any,
    context: PropertyUnitProcessingContext
  ): Promise<any> => {
    // Return object that matches the actual model schema
    return {
      cid: context.cuid,
      cuid: context.cuid,
      unitNumber: row.unitNumber,
      floor: row.floor,
      unitType: row.unitType,
      status: row.status || 'available',
      description: row.description,
      specifications: {
        totalArea: row.specifications_totalArea,
        rooms: row.specifications_bedrooms, // Model uses 'rooms' not 'bedrooms'
        bathrooms: row.specifications_bathrooms,
        maxOccupants: row.specifications_maxOccupants,
      },
      fees: {
        currency: row.fees_currency,
        rentAmount: row.fees_rentAmount,
        securityDeposit: row.fees_securityDeposit,
      },
      amenities: {
        // Only include amenities that exist in the model
        washerDryer: row.amenities_washerDryer || false,
        dishwasher: row.amenities_dishwasher || false,
        parking: row.amenities_parking || false,
        cableTV: row.amenities_cableTV || false,
        internet: row.amenities_internet || false,
        storage: row.amenities_storage || false,
      },
      utilities: {
        water: row.utilities_water || false,
        centralAC: row.utilities_centralAC || false,
        heating: row.utilities_heating || false,
        gas: row.utilities_gas || false,
        trash: row.utilities_trash || false,
      },
      isActive: true,
      propertyId: new ObjectId(context.pid),
      createdBy: new ObjectId(context.userId),
      // Don't include puid - let Mongoose auto-generate it
    };
  };
}
