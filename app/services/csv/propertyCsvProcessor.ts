import { ObjectId } from 'mongodb';
import sanitizeHtml from 'sanitize-html';
import { createLogger } from '@utils/index';
import { GeoCoderService } from '@services/external';
import { CURRENCIES } from '@interfaces/utils.interface';
import { ICurrentUser } from '@interfaces/user.interface';
import { PropertyDAO, ClientDAO, UserDAO } from '@dao/index';
import { PropertyValidations } from '@shared/validations/PropertyValidation';
import { ICsvValidationResult, IInvalidCsvProperty } from '@interfaces/csv.interface';
import {
  OccupancyStatus,
  NewPropertyType,
  PropertyStatus,
  IProperty,
} from '@interfaces/property.interface';

import { BaseCSVProcessorService } from './base';

interface IConstructor {
  geoCoderService: GeoCoderService;
  propertyDAO: PropertyDAO;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
}

interface PropertyProcessingContext {
  userId: ICurrentUser['sub'];
  propertyId?: string;
  cuid: string;
}

type TempPropertiesArray = Array<NewPropertyType | IProperty>;
export class PropertyCsvProcessor {
  private readonly log = createLogger('PropertyCsvProcessor');
  private readonly geoCoderService: GeoCoderService;
  private readonly propertyDAO: PropertyDAO;
  private readonly clientDAO: ClientDAO;
  private readonly userDAO: UserDAO;

  constructor({ propertyDAO, clientDAO, userDAO, geoCoderService }: IConstructor) {
    this.userDAO = userDAO;
    this.clientDAO = clientDAO;
    this.propertyDAO = propertyDAO;
    this.geoCoderService = geoCoderService;
  }

  async validateCsv(
    filePath: string,
    context: PropertyProcessingContext
  ): Promise<{
    validProperties: IProperty[];
    totalRows: number;
    finishedAt: Date;
    errors: null | IInvalidCsvProperty[];
  }> {
    const client = await this.clientDAO.getClientBycuid(context.cuid);
    if (!client) {
      throw new Error(`Client with ID ${context.cuid} not found`);
    }

    const result = await BaseCSVProcessorService.processCsvFile<
      IProperty,
      PropertyProcessingContext
    >(filePath, {
      context,
      validateRow: this.validatePropertyRow,
      transformRow: this.transformPropertyRow,
      postProcess: this.postProcessProperties,
    });

    return {
      validProperties: result.validItems,
      totalRows: result.totalRows,
      finishedAt: new Date(),
      errors: result.errors,
    };
  }

  private validatePropertyRow = async (
    row: any,
    context: PropertyProcessingContext
  ): Promise<ICsvValidationResult> => {
    const rowWithContext = {
      ...row,
      cuid: context.cuid,
    };
    const validationResult = await PropertyValidations.propertyCsv.safeParseAsync(rowWithContext);
    if (validationResult.success) {
      // check manager email if it exists
      if (row.managedBy && row.managedBy.includes('@')) {
        const managerValidation = await this.validateAndResolveManagedBy(
          row.managedBy,
          context.cuid
        );

        if (!managerValidation.valid) {
          return {
            isValid: false,
            errors: [
              {
                field: 'managedBy',
                error: managerValidation.error || 'Invalid manager email',
              },
            ],
          };
        }
      }

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

  private transformPropertyRow = async (
    row: any,
    context: PropertyProcessingContext
  ): Promise<NewPropertyType> => {
    let managedBy;
    if (row.managedBy && row.managedBy.includes('@')) {
      const managerResolution = await this.validateAndResolveManagedBy(row.managedBy, context.cuid);
      if (managerResolution.valid && managerResolution.userId) {
        managedBy = new ObjectId(managerResolution.userId);
      }
    }

    const documents = this.extractDocumentsFromRow(row, context);
    return {
      address: {},
      name: row.name?.trim(),
      fullAddress: row.fullAddress?.trim(),
      propertyType: row.propertyType,
      ...(documents.length > 0 && { documents }),
      status: (row.status || 'available') as PropertyStatus,
      occupancyStatus: (row.occupancyStatus || 'vacant') as OccupancyStatus,
      maxAllowedUnits: row.maxAllowedUnits ? Number(row.maxAllowedUnits) : 0,
      yearBuilt: row.yearBuilt ? Number(row.yearBuilt) : undefined,

      description: {
        text: row.description_text ? sanitizeHtml(row.description_text) : '',
        html: row.description_html ? sanitizeHtml(row.description_html) : '',
      },

      specifications: {
        totalArea: BaseCSVProcessorService.parseNumber(row.specifications_totalArea, 0),
        bedrooms: row.bedrooms
          ? BaseCSVProcessorService.parseNumber(row.specifications_bedrooms)
          : undefined,
        bathrooms: row.bathrooms
          ? BaseCSVProcessorService.parseNumber(row.specifications_bathrooms)
          : undefined,
        floors: row.floors
          ? BaseCSVProcessorService.parseNumber(row.specifications_floors)
          : undefined,
        garageSpaces: row.specifications_garageSpaces
          ? BaseCSVProcessorService.parseNumber(row.specifications_garageSpaces)
          : undefined,
        maxOccupants: row.specifications_maxOccupants
          ? BaseCSVProcessorService.parseNumber(row.specifications_maxOccupants)
          : undefined,
        lotSize: row.specifications_lotSize
          ? BaseCSVProcessorService.parseNumber(row.specifications_lotSize)
          : undefined,
      },

      fees: {
        taxAmount: BaseCSVProcessorService.parseNumber(row.fees_taxamount, 0),
        rentalAmount: BaseCSVProcessorService.parseNumber(row.fees_rentalamount, 0),
        managementFees: BaseCSVProcessorService.parseNumber(row.fees_managementfees, 0),
        currency: (row.fees_currency || 'USD') as CURRENCIES,
      },

      utilities: {
        water: BaseCSVProcessorService.parseBoolean(row.utilities_water),
        gas: BaseCSVProcessorService.parseBoolean(row.utilities_gas),
        electricity: BaseCSVProcessorService.parseBoolean(row.utilities_electricity),
        internet: BaseCSVProcessorService.parseBoolean(row.utilities_internet),
        trash: BaseCSVProcessorService.parseBoolean(row.utilities_trash),
        cableTV: BaseCSVProcessorService.parseBoolean(row.utilities_cabletv),
      },

      ...(this.hasAnyInteriorAmenity(row) && {
        interiorAmenities: {
          airConditioning: BaseCSVProcessorService.parseBoolean(
            row.interiorAmenities_airConditioning
          ),
          heating: BaseCSVProcessorService.parseBoolean(row.interiorAmenities_heating),
          washerDryer: BaseCSVProcessorService.parseBoolean(row.interiorAmenities_washerDryer),
          dishwasher: BaseCSVProcessorService.parseBoolean(row.interiorAmenities_dishwasher),
          fridge: BaseCSVProcessorService.parseBoolean(row.interiorAmenities_fridge),
          furnished: BaseCSVProcessorService.parseBoolean(row.interiorAmenities_furnished),
          storageSpace: BaseCSVProcessorService.parseBoolean(row.interiorAmenities_storageSpace),
        },
      }),

      ...(this.hasAnyCommunityAmenity(row) && {
        communityAmenities: {
          petFriendly: BaseCSVProcessorService.parseBoolean(row.communityAmenities_petFriendly),
          swimmingPool: BaseCSVProcessorService.parseBoolean(row.communityAmenities_swimmingPool),
          fitnessCenter: BaseCSVProcessorService.parseBoolean(row.communityAmenities_fitnessCenter),
          elevator: BaseCSVProcessorService.parseBoolean(row.communityAmenities_elevator),
          parking: BaseCSVProcessorService.parseBoolean(row.communityAmenities_parking),
          securitySystem: BaseCSVProcessorService.parseBoolean(
            row.communityAmenities_securitySystem
          ),
          laundryFacility: BaseCSVProcessorService.parseBoolean(
            row.communityAmenities_laundryFacility
          ),
          doorman: BaseCSVProcessorService.parseBoolean(row.communityAmenities_doorman),
        },
      }),

      managedBy,
      cuid: context.cuid,
      createdBy: new ObjectId(context.userId),
    };
  };

  private postProcessProperties = async (
    properties: TempPropertiesArray,
    _ctx: PropertyProcessingContext
  ): Promise<{ validItems: IProperty[]; invalidItems: any[] }> => {
    const { validProperties, invalidProperties } = await this.processGeocodingForProperties(
      properties as NewPropertyType[]
    );

    return {
      validItems: validProperties,
      invalidItems: invalidProperties,
    };
  };

  private async processGeocodingForProperties(properties: NewPropertyType[]): Promise<{
    validProperties: IProperty[];
    invalidProperties: { field: string; error: string }[];
  }> {
    const validProperties: IProperty[] = [];
    const invalidProperties: { field: string; error: string }[] = [];

    for (const property of properties) {
      try {
        const geoCode = await this.geoCoderService.parseLocation(property.fullAddress);

        if (!geoCode.success) {
          invalidProperties.push({
            field: 'address',
            error: `Invalid address: ${property.fullAddress}`,
          });
          continue;
        }

        property.computedLocation = {
          coordinates: geoCode.data?.coordinates || [0, 0],
        };

        property.address = {
          city: geoCode.data?.city,
          state: geoCode.data?.state,
          street: geoCode.data?.street,
          country: geoCode.data?.country,
          postCode: geoCode.data?.postCode,
          latAndlon: geoCode.data?.latAndlon,
          fullAddress: geoCode.data?.fullAddress,
          streetNumber: geoCode.data?.streetNumber,
        };
        validProperties.push(property);
      } catch (error) {
        invalidProperties.push({
          field: 'address',
          error: `Error during geocoding: ${error.message}`,
        });
      }
    }

    return { validProperties, invalidProperties };
  }

  private hasAnyInteriorAmenity(data: any): boolean {
    return [
      'interiorAmenities_airconditioning',
      'interiorAmenities_heating',
      'interiorAmenities_washerdryer',
      'interiorAmenities_dishwasher',
      'interiorAmenities_fridge',
      'interiorAmenities_furnished',
      'interiorAmenities_storagespace',
    ].some((field) => data[field] !== undefined);
  }

  private hasAnyCommunityAmenity(data: any): boolean {
    return [
      'communityAmenity_swimmingpool',
      'communityAmenity_fitnesscenter',
      'communityAmenity_elevator',
      'communityAmenity_parking',
      'communityAmenity_securitysystem',
      'communityAmenity_petfriendly',
      'communityAmenity_laundryfacility',
      'communityAmenity_doorman',
    ].some((field) => data[field] !== undefined);
  }

  private async validateAndResolveManagedBy(
    email: string,
    cuid: string
  ): Promise<{
    valid: boolean;
    userId?: string;
    error?: string;
  }> {
    if (!email) {
      return { valid: false, error: 'Manager email is required' };
    }

    try {
      const user = await this.userDAO.getActiveUserByEmail(email);

      if (!user) {
        return { valid: false, error: `No user found with email: ${email}` };
      }

      const clientAssociations = user.cuids;
      const clientAssociation = clientAssociations.find((c) => c.cuid === cuid && c.isConnected);

      if (!clientAssociation) {
        return {
          valid: false,
          error: `User ${email} is not associated with this client`,
        };
      }

      const hasManagerRole = clientAssociation.roles.some((role) =>
        ['landlord', 'manager', 'admin'].includes(role)
      );

      if (!hasManagerRole) {
        return {
          valid: false,
          error: 'User role not permitted for this action.',
        };
      }

      return { valid: true, userId: user._id.toString() };
    } catch (error) {
      this.log.error('Error validating manager email:', error);
      return {
        valid: false,
        error: `Error validating manager email: ${error.message}`,
      };
    }
  }

  private extractDocumentsFromRow(row: any, context: PropertyProcessingContext): Array<any> {
    const documents = [];

    // Look for document columns (document_1_url, document_2_url, etc.)
    const documentKeys = Object.keys(row).filter(
      (key) => key.match(/^document_\d+_url$/) && row[key]
    );

    for (const urlKey of documentKeys) {
      // extract number ("1" from "document_1_url")
      const docNum = urlKey.match(/^document_(\d+)_url$/)?.[1];
      if (!docNum) continue;

      const externalUrl = row[urlKey];
      if (!externalUrl) continue;

      const typeKey = `document_${docNum}_type`;
      const descKey = `document_${docNum}_description`;

      const documentType =
        row[typeKey] && ['inspection', 'insurance', 'other', 'deed', 'tax'].includes(row[typeKey])
          ? row[typeKey]
          : 'other';

      const description = row[descKey] || '';

      documents.push({
        documentType,
        description,
        uploadedBy: new ObjectId(context.userId),
        uploadedAt: new Date(),
        photos: [
          {
            url: externalUrl,
            externalUrl: externalUrl,
            status: 'active',
            uploadedBy: new ObjectId(context.userId),
            uploadedAt: new Date(),
          },
        ],
      });
    }

    return documents;
  }
}
