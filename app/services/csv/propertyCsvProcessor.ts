import { ObjectId } from 'mongodb';
import sanitizeHtml from 'sanitize-html';
import { createLogger } from '@utils/index';
import { GeoCoderService } from '@services/external';
import { CURRENCIES } from '@interfaces/utils.interface';
import { ICurrentUser } from '@interfaces/user.interface';
import { ROLES } from '@shared/constants/roles.constants';
import { PropertyDAO, ClientDAO, UserDAO } from '@dao/index';
import { PropertyValidations } from '@shared/validations/PropertyValidation';
import {
  OccupancyStatus,
  NewPropertyType,
  PropertyStatus,
  IProperty,
} from '@interfaces/property.interface';
import {
  ICsvHeaderValidationResult,
  ICsvValidationResult,
  IInvalidCsvProperty,
} from '@interfaces/csv.interface';

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
    const client = await this.clientDAO.getClientByCuid(context.cuid);
    if (!client) {
      throw new Error(`Client with ID ${context.cuid} not found`);
    }

    const result = await BaseCSVProcessorService.processCsvFile<
      IProperty,
      PropertyProcessingContext
    >(filePath, {
      context,
      headerTransformer: this.createPropertyHeaderTransformer(),
      validateHeaders: this.validateRequiredHeaders.bind(this),
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

      owner: this.hasAnyOwnerField(row)
        ? {
            type: row.owner_type || 'company_owned',
            ...(row.owner_name && { name: row.owner_name.trim() }),
            ...(row.owner_email && { email: row.owner_email.trim().toLowerCase() }),
            ...(row.owner_phone && { phone: row.owner_phone.trim() }),
            ...(row.owner_taxId && { taxId: row.owner_taxId.trim() }),
            ...(row.owner_notes && { notes: row.owner_notes.trim() }),
            ...(this.hasAnyBankDetails(row) && {
              bankDetails: {
                ...(row.owner_bankDetails_accountName && {
                  accountName: row.owner_bankDetails_accountName.trim(),
                }),
                ...(row.owner_bankDetails_accountNumber && {
                  accountNumber: row.owner_bankDetails_accountNumber.trim(),
                }),
                ...(row.owner_bankDetails_routingNumber && {
                  routingNumber: row.owner_bankDetails_routingNumber.trim(),
                }),
                ...(row.owner_bankDetails_bankName && {
                  bankName: row.owner_bankDetails_bankName.trim(),
                }),
              },
            }),
          }
        : {
            type: 'company_owned',
          },

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

  private getRequiredCsvHeaders(): string[] {
    // Dynamically extract required headers from NewProperty interface mapping
    // These correspond to the minimum required fields for CSV import
    return [
      'name', // from NewProperty.name (required)
      'fullAddress', // from NewProperty.fullAddress (required)
      'propertyType', // from NewProperty.propertyType (required)
    ];
  }

  private createPropertyHeaderTransformer() {
    // Get all possible headers from the transform method analysis
    const allowedHeaders = [
      // Required headers
      'name',
      'fullAddress',
      'propertyType',
      // Optional basic fields
      'status',
      'occupancyStatus',
      'maxAllowedUnits',
      'yearBuilt',
      'managedBy',
      // Description fields
      'description_text',
      'description_html',
      // Specification fields
      'specifications_totalArea',
      'specifications_bedrooms',
      'specifications_bathrooms',
      'specifications_floors',
      'specifications_garageSpaces',
      'specifications_maxOccupants',
      'specifications_lotSize',
      // Fee fields
      'fees_taxamount',
      'fees_rentalamount',
      'fees_managementfees',
      'fees_currency',
      // Utility fields
      'utilities_water',
      'utilities_gas',
      'utilities_electricity',
      'utilities_internet',
      'utilities_trash',
      'utilities_cabletv',
      // Interior amenity fields
      'interiorAmenities_airConditioning',
      'interiorAmenities_heating',
      'interiorAmenities_washerDryer',
      'interiorAmenities_dishwasher',
      'interiorAmenities_fridge',
      'interiorAmenities_furnished',
      'interiorAmenities_storageSpace',
      // Community amenity fields
      'communityAmenities_petFriendly',
      'communityAmenities_swimmingPool',
      'communityAmenities_fitnessCenter',
      'communityAmenities_elevator',
      'communityAmenities_parking',
      'communityAmenities_securitySystem',
      'communityAmenities_laundryFacility',
      'communityAmenities_doorman',
      // Owner fields
      'owner_type',
      'owner_name',
      'owner_email',
      'owner_phone',
      'owner_taxId',
      'owner_notes',
      'owner_bankDetails_accountName',
      'owner_bankDetails_accountNumber',
      'owner_bankDetails_routingNumber',
      'owner_bankDetails_bankName',
    ];

    return ({ header }: { header: string }) => {
      const normalizedHeader = header.toLowerCase().trim();

      // Check if this header matches any of our allowed headers (case insensitive)
      const matchingHeader = allowedHeaders.find(
        (allowed) => allowed.toLowerCase() === normalizedHeader
      );

      if (matchingHeader) {
        // Return the standardized header name
        return matchingHeader;
      }

      // Check for dynamic document headers (document_1_url, document_2_type, etc.)
      if (normalizedHeader.match(/^document_\d+_(url|type|description)$/)) {
        return header.toLowerCase().trim(); // Keep document headers as-is
      }

      // Return null to ignore this column - csv-parser will skip it
      return null;
    };
  }

  private validateRequiredHeaders(headers: string[]): ICsvHeaderValidationResult {
    const requiredHeaders = this.getRequiredCsvHeaders();
    const foundHeaders = headers.filter((header) => requiredHeaders.includes(header));
    const missingHeaders = requiredHeaders.filter((required) => !headers.includes(required));

    const isValid = missingHeaders.length === 0;

    return {
      isValid,
      missingHeaders,
      foundHeaders,
      errorMessage: isValid
        ? undefined
        : `Invalid CSV format. Missing required columns: ${missingHeaders.join(', ')}. Expected headers: ${requiredHeaders.join(', ')}`,
    };
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

  private hasAnyOwnerField(data: any): boolean {
    return [
      'owner_type',
      'owner_name',
      'owner_email',
      'owner_phone',
      'owner_taxid',
      'owner_notes',
      'owner_bankdetails_accountname',
      'owner_bankdetails_accountnumber',
      'owner_bankdetails_routingnumber',
      'owner_bankdetails_bankname',
    ].some((field) => data[field] !== undefined);
  }

  private hasAnyBankDetails(data: any): boolean {
    return [
      'owner_bankdetails_accountname',
      'owner_bankdetails_accountnumber',
      'owner_bankdetails_routingnumber',
      'owner_bankdetails_bankname',
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

      // Note: includes 'landlord' role which is not in ROLES constants but exists in legacy type
      const managerRoles = ['landlord', ROLES.MANAGER, ROLES.ADMIN];
      const hasManagerRole = clientAssociation.roles.some((role) => managerRoles.includes(role));

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
