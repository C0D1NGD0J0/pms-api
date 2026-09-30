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
        bedrooms: row.specifications_bedrooms,
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
        washerDryer: BaseCSVProcessorService.parseBoolean(row.amenities_washerDryer),
        dishwasher: BaseCSVProcessorService.parseBoolean(row.amenities_dishwasher),
        parking: BaseCSVProcessorService.parseBoolean(row.amenities_parking),
        cableTV: BaseCSVProcessorService.parseBoolean(row.amenities_cableTV),
        internet: BaseCSVProcessorService.parseBoolean(row.amenities_internet),
        storage: BaseCSVProcessorService.parseBoolean(row.amenities_storage),
      },
      utilities: {
        water: BaseCSVProcessorService.parseBoolean(row.utilities_water),
        centralAC: BaseCSVProcessorService.parseBoolean(row.utilities_centralAC),
        heating: BaseCSVProcessorService.parseBoolean(row.utilities_heating),
        gas: BaseCSVProcessorService.parseBoolean(row.utilities_gas),
        trash: BaseCSVProcessorService.parseBoolean(row.utilities_trash),
      },
      isActive: true,
      propertyId: new ObjectId(context.pid),
      createdBy: new ObjectId(context.userId),
      // Don't include puid - let Mongoose auto-generate it
    };
  };
}
