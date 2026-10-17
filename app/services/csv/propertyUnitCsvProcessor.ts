import { ObjectId } from 'mongodb';
import { createLogger } from '@utils/index';
import { IPropertyUnit } from '@interfaces/propertyUnit.interface';
import { PropertyUnitValidations } from '@shared/validations/PropertyUnitValidation';
import {
  ICsvHeaderValidationResult,
  ICsvValidationResult,
  IInvalidCsvProperty,
} from '@interfaces/csv.interface';

import { BaseCSVProcessorService } from './base';
import { UNIT_ACCEPTED_FIELD_KEYS, UNIT_REQUIRED_FIELD_KEYS } from './propertyUnitImportFields';

interface PropertyUnitProcessingContext {
  // User-confirmed header → field key mapping from the frontend's mapping step
  columnMapping?: Record<string, string>;
  userId: string;
  cuid: string;
  pid: string;
}

// The template carries every column a residential unit needs, so an imported unit is ready to lease
const TEMPLATE_HEADERS = [
  'unitNumber',
  'unitType',
  'floor',
  'status',
  'specifications_totalArea',
  'specifications_bedrooms',
  'specifications_bathrooms',
  'fees_rentAmount',
  'fees_securityDeposit',
];

const TEMPLATE_EXAMPLE_ROWS: Record<string, string>[] = [
  {
    unitNumber: '101',
    unitType: 'residential',
    floor: '1',
    status: 'available',
    specifications_totalArea: '850',
    specifications_bedrooms: '2',
    specifications_bathrooms: '1',
    fees_rentAmount: '1800',
    fees_securityDeposit: '1800',
  },
  {
    unitNumber: '102',
    unitType: 'residential',
    floor: '1',
    status: 'available',
    specifications_totalArea: '520',
    specifications_bedrooms: '0',
    specifications_bathrooms: '1',
    fees_rentAmount: '1400',
    fees_securityDeposit: '1400',
  },
];

const csvEscape = (value: string) =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

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
      headerTransformer: this.createUnitHeaderTransformer(context.columnMapping),
      validateHeaders: this.validateRequiredHeaders.bind(this),
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

  generateTemplateCsv(): string {
    const lines = [
      TEMPLATE_HEADERS.join(','),
      ...TEMPLATE_EXAMPLE_ROWS.map((row) =>
        TEMPLATE_HEADERS.map((header) => csvEscape(row[header] ?? '')).join(',')
      ),
    ];
    return lines.join('\n') + '\n';
  }

  getTemplateHeaders(): string[] {
    return [...TEMPLATE_HEADERS];
  }

  private createUnitHeaderTransformer(columnMapping?: Record<string, string>) {
    return ({ header }: { header: string }) => {
      const mappedKey = columnMapping?.[header];
      if (mappedKey && UNIT_ACCEPTED_FIELD_KEYS.includes(mappedKey)) {
        return mappedKey;
      }

      const normalizedHeader = header.toLowerCase().trim().replace(/\./g, '_');
      const matchingHeader = UNIT_ACCEPTED_FIELD_KEYS.find(
        (accepted) => accepted.toLowerCase() === normalizedHeader
      );
      return matchingHeader ?? null; // csv-parser drops unmapped columns
    };
  }

  private validateRequiredHeaders(headers: string[]): ICsvHeaderValidationResult {
    const missingHeaders = UNIT_REQUIRED_FIELD_KEYS.filter(
      (required) => !headers.includes(required)
    );
    const isValid = missingHeaders.length === 0;

    return {
      isValid,
      missingHeaders,
      foundHeaders: headers.filter((header) => UNIT_ACCEPTED_FIELD_KEYS.includes(header)),
      errorMessage: isValid
        ? undefined
        : `Invalid CSV format. Missing required columns: ${missingHeaders.join(', ')}.`,
    };
  }

  private validateUnitRow = async (
    row: any,
    context: PropertyUnitProcessingContext
  ): Promise<ICsvValidationResult> => {
    // Empty cells count as missing, so required columns are reported (z.coerce.number() would turn '' into 0)
    const filledCells = Object.fromEntries(
      Object.entries(row).filter(([, value]) => !(typeof value === 'string' && value.trim() === ''))
    );
    const rowWithContext = {
      ...filledCells,
      cuid: context.cuid,
      pid: context.pid,
    };

    const validationResult = await PropertyUnitValidations.csvSchema.safeParseAsync(rowWithContext);

    if (validationResult.success) {
      return {
        isValid: true,
        errors: [],
        // Built from the validated row so coerced numbers are saved
        transformedData: validationResult.data,
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
    rawRow: any,
    context: PropertyUnitProcessingContext,
    _rowNumber?: number,
    validatedData?: any
  ): Promise<any> => {
    const row = validatedData ?? rawRow;
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
