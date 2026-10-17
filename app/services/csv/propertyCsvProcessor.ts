import { Types } from 'mongoose';
import sanitizeHtml from 'sanitize-html';
import { createLogger } from '@utils/index';
import { MoneyUtils } from '@utils/money.utils';
import { GeoCoderService } from '@services/external';
import { CURRENCIES } from '@interfaces/utils.interface';
import { ICurrentUser } from '@interfaces/user.interface';
import { ROLES } from '@shared/constants/roles.constants';
import { PropertyDAO, ClientDAO, UserDAO } from '@dao/index';
import { PropertyTypeManager } from '@services/property/PropertyTypeManager';
import { PropertyValidations } from '@shared/validations/PropertyValidation';
import { PropertyValidationService } from '@services/property/propertyValidation.service';
import {
  ICsvHeaderValidationResult,
  ICsvValidationResult,
  IInvalidCsvProperty,
} from '@interfaces/csv.interface';
import {
  VerificationStatusEnum,
  OccupancyStatus,
  NewPropertyType,
  PropertyStatus,
  IProperty,
} from '@interfaces/property.interface';

import { BaseCSVProcessorService } from './base';

interface PropertyProcessingContext {
  // User-confirmed header → field key mapping from the frontend's mapping step.
  // Keyed by the literal file header text, checked before the exact-match fallback.
  columnMapping?: Record<string, string>;
  userId: ICurrentUser['sub'];
  // The account's currency, set by validateCsv — every imported property is priced in it
  currency?: CURRENCIES;
  propertyId?: string;
  cuid: string;
}

interface IConstructor {
  geoCoderService: GeoCoderService;
  propertyDAO: PropertyDAO;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
}

// Transient fields threaded through the pipeline for error attribution and the
// unitNumber-survives-geocoding fix; stripped before the property reaches the DB.
type PropertyRowTransform = {
  _csvRowNumber?: number;
  _addressUnitNumber?: string;
} & NewPropertyType;
// Matches the ICsvProcessorOptions#postProcess contract (T = IProperty); the
// actual runtime shape passed in is always PropertyRowTransform, produced by
// transformPropertyRow, hence the cast where postProcessProperties hands off.
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
      context: {
        ...context,
        currency: (client.settings?.defaultCurrency || CURRENCIES.USD) as CURRENCIES,
      },
      headerTransformer: this.createPropertyHeaderTransformer(context.columnMapping),
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
    // Blank cells count as missing, so required columns are reported instead of read as 0
    const filledCells = Object.fromEntries(
      Object.entries(row).filter(([, value]) => !(typeof value === 'string' && value.trim() === ''))
    );
    const rowWithContext = {
      ...filledCells,
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
    context: PropertyProcessingContext,
    rowNumber?: number
  ): Promise<PropertyRowTransform> => {
    let managedBy;
    if (row.managedBy && row.managedBy.includes('@')) {
      const managerResolution = await this.validateAndResolveManagedBy(row.managedBy, context.cuid);
      if (managerResolution.valid && managerResolution.userId) {
        managedBy = new Types.ObjectId(managerResolution.userId);
      }
    }

    const documents = this.extractDocumentsFromRow(row, context);
    // fullAddress is never taken from user input as-is — it's only ever the query
    // string sent to the geocoder. Either the raw `fullAddress` column or the
    // joined split address columns serve as that query; postProcessProperties
    // replaces this with the geocoder's normalised result.
    const addressQuery =
      row.fullAddress?.trim() ||
      [
        row.address_street,
        row.address_city,
        row.address_state,
        row.address_postCode,
        row.address_country,
      ]
        .filter(Boolean)
        .join(', ');

    return {
      // transient — used by postProcessProperties to attribute geocoding/quota
      // errors back to the original CSV row; stripped before DB insert.
      _csvRowNumber: rowNumber,
      // transient — the single-property form stores unitNumber on the address
      // object separately from the geocoder result; carried the same way here,
      // applied by postProcessProperties after the geocoder assigns `address`.
      _addressUnitNumber: row.address_unitNumber?.trim(),
      address: {},
      name: row.name?.trim(),
      fullAddress: addressQuery,
      propertyType: row.propertyType,
      ...(documents.length > 0 && { documents }),
      operationalStatus: (row.status || 'available') as PropertyStatus,
      occupancyStatus: (row.occupancyStatus || 'vacant') as OccupancyStatus,
      // No unit-count column: use the property type's default, as the single-property form does
      // (0 would fail the same validation single creation runs).
      maxAllowedUnits: row.maxAllowedUnits
        ? Number(row.maxAllowedUnits)
        : PropertyTypeManager.getDefaultUnits(row.propertyType),
      yearBuilt: row.yearBuilt ? Number(row.yearBuilt) : undefined,

      description: {
        text: row.description_text ? sanitizeHtml(row.description_text) : '',
        html: row.description_html ? sanitizeHtml(row.description_html) : '',
      },

      specifications: {
        totalArea: row.specifications_totalArea
          ? BaseCSVProcessorService.parseNumber(row.specifications_totalArea)
          : undefined,
        bedrooms: row.specifications_bedrooms
          ? BaseCSVProcessorService.parseNumber(row.specifications_bedrooms)
          : undefined,
        bathrooms: row.specifications_bathrooms
          ? BaseCSVProcessorService.parseNumber(row.specifications_bathrooms)
          : undefined,
        floors: row.specifications_floors
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
        rentAmount: BaseCSVProcessorService.parseNumber(row.fees_rentalAmount, 0),
        managementFees: BaseCSVProcessorService.parseNumber(row.fees_managementFees, 0),
        securityDeposit: BaseCSVProcessorService.parseNumber(row.fees_securityDeposit, 0),
        currency: context.currency ?? CURRENCIES.USD,
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

      // Imported properties start unverified, same as single creation — admin review verifies them
      verificationStatus: VerificationStatusEnum.UNVERIFIED,

      // No manager column (or unresolved): the importing user manages it, as with single creation
      managedBy: managedBy ?? new Types.ObjectId(context.userId),
      cuid: context.cuid,
      createdBy: new Types.ObjectId(context.userId),
    };
  };

  private postProcessProperties = async (
    properties: TempPropertiesArray,
    ctx: PropertyProcessingContext
  ): Promise<{ validItems: IProperty[]; invalidItems: IInvalidCsvProperty[] }> => {
    const { validProperties, invalidProperties } = await this.processGeocodingForProperties(
      properties as PropertyRowTransform[],
      ctx
    );

    return {
      validItems: validProperties,
      invalidItems: invalidProperties,
    };
  };

  private async processGeocodingForProperties(
    properties: PropertyRowTransform[],
    ctx: PropertyProcessingContext
  ): Promise<{
    validProperties: IProperty[];
    invalidProperties: IInvalidCsvProperty[];
  }> {
    const validProperties: IProperty[] = [];
    const invalidProperties: IInvalidCsvProperty[] = [];
    // Addresses repeated within this same file, compared post-geocode so
    // spelling differences between rows of the same building still group.
    const seenAddresses = new Set<string>();

    const rowError = (rowNumber: number | undefined, field: string, error: string) => {
      invalidProperties.push({ rowNumber: rowNumber ?? 0, errors: [{ field, error }] });
    };

    for (const property of properties) {
      const rowNumber = property._csvRowNumber;
      try {
        const geoCode = await this.geoCoderService.parseLocation(property.fullAddress);

        if (!geoCode.success) {
          // Provider failures are logged by GeoCoderService; users only get a retry
          // prompt, never the underlying cause (keys, quotas, outages are internal).
          rowError(
            rowNumber,
            'address',
            geoCode.reason === 'unavailable'
              ? "We couldn't verify this address right now. Please try the upload again in a few minutes."
              : `Address not found: ${property.fullAddress}`
          );
          continue;
        }

        // GeoJSON Point — the 2dsphere index rejects coordinates without a type. No coordinates
        // means no location rather than a fake [0, 0].
        if (geoCode.data?.coordinates?.length === 2) {
          property.computedLocation = { type: 'Point', coordinates: geoCode.data.coordinates };
        }

        property.address = {
          city: geoCode.data?.city,
          state: geoCode.data?.state,
          street: geoCode.data?.street,
          country: geoCode.data?.country,
          postCode: geoCode.data?.postCode,
          latAndlon: geoCode.data?.latAndlon,
          fullAddress: geoCode.data?.fullAddress,
          streetNumber: geoCode.data?.streetNumber,
          // Applied after the geocoder result, same as the single-property form —
          // otherwise this assignment above would drop it.
          ...(property._addressUnitNumber && { unitNumber: property._addressUnitNumber }),
        };

        const geocodedAddress = geoCode.data?.fullAddress?.trim().toLowerCase();
        if (geocodedAddress) {
          if (seenAddresses.has(geocodedAddress)) {
            rowError(
              rowNumber,
              'address',
              `A property with this address already exists in the file: ${geoCode.data?.fullAddress}`
            );
            continue;
          }

          const existingProperty = await this.propertyDAO.findPropertyByAddress(
            geoCode.data!.fullAddress!,
            ctx.cuid
          );
          if (existingProperty) {
            rowError(
              rowNumber,
              'address',
              `A property with this address already exists: ${geoCode.data?.fullAddress}`
            );
            continue;
          }

          seenAddresses.add(geocodedAddress);
        }

        property.fullAddress = geoCode.data?.fullAddress;

        // Same business rules as single creation — run here so "Validate" reports exactly what
        // the import would reject, with the real row number.
        const ruleCheck = PropertyValidationService.validateProperty(property as any);
        if (!ruleCheck.valid) {
          invalidProperties.push({
            rowNumber: rowNumber ?? 0,
            errors: ruleCheck.errors.map((ruleError) => ({
              field: ruleError.field,
              error: ruleError.message,
            })),
          });
          continue;
        }

        // Stored in cents, as single creation does after the same rule check
        property.fees = MoneyUtils.parseMoneyInput(property.fees);

        delete property._csvRowNumber;
        delete property._addressUnitNumber;
        validProperties.push(property as IProperty);
      } catch (error) {
        rowError(rowNumber, 'address', `Error during geocoding: ${error.message}`);
      }
    }

    return { validProperties, invalidProperties };
  }

  // Every header the importer accepts. Shared by the header transformer (matching
  // incoming CSV headers) and the template endpoint (so the template can't drift
  // from what's actually accepted).
  private readonly allowedHeaders: string[] = [
    // Required headers
    'name',
    'propertyType',
    // Address — either fullAddress, or the split columns joined as the geocoder
    // query. Both are only ever a query string; the stored address always comes
    // from the geocoder's result. See validateRequiredHeaders.
    'fullAddress',
    'address_street',
    'address_city',
    'address_state',
    'address_postCode',
    'address_country',
    'address_unitNumber',
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
    'fees_rentalAmount',
    'fees_managementFees',
    'fees_securityDeposit',
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

  // Columns every row must have, so an imported property is ready to lease
  private readonly requiredHeaders: string[] = [
    'name',
    'propertyType',
    'maxAllowedUnits',
    'occupancyStatus',
    'specifications_totalArea',
  ];

  // The downloadable template carries the required columns plus the ones a single-unit row
  // needs. Any other allowedHeaders column can be added by the user — the importer accepts them all.
  private readonly templateHeaders: string[] = [
    'name',
    'propertyType',
    'fullAddress',
    'maxAllowedUnits',
    'occupancyStatus',
    'specifications_totalArea',
    'specifications_bedrooms',
    'specifications_bathrooms',
    'fees_rentalAmount',
    'fees_securityDeposit',
  ];

  getTemplateHeaders(): string[] {
    return [...this.templateHeaders];
  }

  getAcceptedHeaders(): string[] {
    return [...this.allowedHeaders];
  }

  /**
   * Builds a downloadable CSV template with two example rows: a multi-unit building (its rent
   * and rooms live on its units) and a single-unit house, which needs its own.
   */
  generateTemplateCsv(): string {
    const exampleRows: Record<string, string>[] = [
      {
        name: 'Kensington Terrace',
        propertyType: 'apartment',
        fullAddress: '88 Kensington Avenue, Toronto, ON M5T 2K2, Canada',
        maxAllowedUnits: '12',
        occupancyStatus: 'vacant',
        specifications_totalArea: '14000',
      },
      {
        name: 'Riverdale Family Home',
        propertyType: 'house',
        fullAddress: '45 Withrow Avenue, Toronto, ON M4K 1C8, Canada',
        maxAllowedUnits: '1',
        occupancyStatus: 'vacant',
        specifications_totalArea: '1800',
        specifications_bedrooms: '3',
        specifications_bathrooms: '2',
        fees_rentalAmount: '3200',
        fees_securityDeposit: '3200',
      },
    ];

    const headerRow = this.templateHeaders.join(',');
    const dataRows = exampleRows.map((exampleRow) =>
      this.templateHeaders.map((header) => this.csvEscape(exampleRow[header] ?? '')).join(',')
    );
    return [headerRow, ...dataRows].join('\n') + '\n';
  }

  private csvEscape(value: string): string {
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }

  private createPropertyHeaderTransformer(columnMapping?: Record<string, string>) {
    return ({ header }: { header: string }) => {
      // User-confirmed mapping from the frontend's mapping step takes precedence,
      // matched on the literal file header text. A mapping to an unrecognized
      // field key is rejected (falls through to the normal matching below)
      // rather than silently accepted.
      const mappedKey = columnMapping?.[header];
      if (mappedKey && this.allowedHeaders.includes(mappedKey)) {
        return mappedKey;
      }

      const normalizedHeader = header.toLowerCase().trim();

      // Check if this header matches any of our allowed headers (case insensitive)
      const matchingHeader = this.allowedHeaders.find(
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
    const missingHeaders = this.requiredHeaders.filter((required) => !headers.includes(required));

    const hasFullAddress = headers.includes('fullAddress');
    const hasSplitAddress = headers.includes('address_street') && headers.includes('address_city');
    if (!hasFullAddress && !hasSplitAddress) {
      missingHeaders.push('fullAddress (or address_street + address_city)');
    }

    const foundHeaders = headers.filter(
      (header) => this.requiredHeaders.includes(header) || header === 'fullAddress'
    );
    const isValid = missingHeaders.length === 0;

    return {
      isValid,
      missingHeaders,
      foundHeaders,
      errorMessage: isValid
        ? undefined
        : `Invalid CSV format. Missing required columns: ${missingHeaders.join(', ')}.`,
    };
  }

  private hasAnyInteriorAmenity(data: any): boolean {
    return [
      'interiorAmenities_airConditioning',
      'interiorAmenities_heating',
      'interiorAmenities_washerDryer',
      'interiorAmenities_dishwasher',
      'interiorAmenities_fridge',
      'interiorAmenities_furnished',
      'interiorAmenities_storageSpace',
    ].some((field) => data[field] !== undefined);
  }

  private hasAnyCommunityAmenity(data: any): boolean {
    return [
      'communityAmenities_swimmingPool',
      'communityAmenities_fitnessCenter',
      'communityAmenities_elevator',
      'communityAmenities_parking',
      'communityAmenities_securitySystem',
      'communityAmenities_petFriendly',
      'communityAmenities_laundryFacility',
      'communityAmenities_doorman',
    ].some((field) => data[field] !== undefined);
  }

  private hasAnyOwnerField(data: any): boolean {
    return [
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
    ].some((field) => data[field] !== undefined);
  }

  private hasAnyBankDetails(data: any): boolean {
    return [
      'owner_bankDetails_accountName',
      'owner_bankDetails_accountNumber',
      'owner_bankDetails_routingNumber',
      'owner_bankDetails_bankName',
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
        uploadedBy: new Types.ObjectId(context.userId),
        uploadedAt: new Date(),
        photos: [
          {
            url: externalUrl,
            externalUrl: externalUrl,
            status: 'active',
            uploadedBy: new Types.ObjectId(context.userId),
            uploadedAt: new Date(),
          },
        ],
      });
    }

    return documents;
  }
}
