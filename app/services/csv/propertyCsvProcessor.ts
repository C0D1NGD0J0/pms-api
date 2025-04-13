import { ObjectId } from 'mongodb';
import sanitizeHtml from 'sanitize-html';
import { createLogger } from '@utils/index';
import { GeoCoderService } from '@services/external';
import { CURRENCIES } from '@interfaces/utils.interface';
import { ICurrentUser } from '@interfaces/user.interface';
import { PropertyDAO, ClientDAO, UserDAO } from '@dao/index';
import { ICsvValidationResult, IInvalidCsvProperty } from '@interfaces/csv.interface';
import { OccupancyStatus, PropertyStatus, IProperty } from '@interfaces/property.interface';

import { BaseCSVProcessorService } from './base';

interface IConstructor {
  geoCoderService: GeoCoderService;
  propertyDAO: PropertyDAO;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
}

interface PropertyProcessingContext {
  currentUser: ICurrentUser;
  propertyId?: string;
  clientId: string;
}

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

  async processPropertyCsvFile(
    filePath: string,
    context: PropertyProcessingContext
  ): Promise<{
    validProperties: IProperty[];
    errors: null | IInvalidCsvProperty[];
  }> {
    const client = await this.clientDAO.getClientByCid(context.clientId);
    if (!client) {
      throw new Error(`Client with ID ${context.clientId} not found`);
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
      errors: result.errors as IInvalidCsvProperty[],
    };
  }

  private validatePropertyRow = async (
    row: any,
    context: PropertyProcessingContext
  ): Promise<ICsvValidationResult> => {
    const errors: { field: string; error: string }[] = [];

    if (!row.name || row.name.length < 3) {
      errors.push({ field: 'name', error: 'Name is required and must be at least 3 characters' });
    }

    if (!row.address || row.address.length < 5) {
      errors.push({
        field: 'address',
        error: 'Address is required and must be at least 5 characters',
      });
    }

    if (
      !row.propertytype ||
      !['condominium', 'commercial', 'industrial', 'apartment', 'townhouse', 'house'].includes(
        row.propertytype
      )
    ) {
      errors.push({
        field: 'propertyType',
        error: `Invalid propertyType: ${row.propertytype}`,
      });
    }

    if (
      row.status &&
      !['construction', 'maintenance', 'available', 'occupied', 'inactive'].includes(row.status)
    ) {
      errors.push({ field: 'status', error: `Invalid status: ${row.status}` });
    }

    if (
      row.occupancystatus &&
      !['partially_occupied', 'occupied', 'vacant'].includes(row.occupancystatus)
    ) {
      errors.push({
        field: 'occupancyStatus',
        error: `Invalid occupancyStatus: ${row.occupancystatus}`,
      });
    }

    if (
      (!row.totalarea && !row.total_area) ||
      isNaN(Number(row.totalarea || row.total_area)) ||
      Number(row.totalarea || row.total_area) <= 0
    ) {
      errors.push({
        field: 'specifications.totalArea',
        error: 'Total area is required and must be a positive number',
      });
    }

    if (row.fees_currency && !Object.values(CURRENCIES).includes(row.fees_currency as CURRENCIES)) {
      errors.push({
        field: 'fees.currency',
        error: `Invalid currency: ${row.fees_currency}`,
      });
    }

    if (row.managedby && row.managedby.includes('@')) {
      const managerValidation = await this.validateAndResolveManagedBy(
        row.managedby,
        context.clientId
      );

      if (!managerValidation.valid) {
        errors.push({
          field: 'managedBy',
          error: managerValidation.error || 'Invalid manager email',
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  };

  private transformPropertyRow = async (
    row: any,
    context: PropertyProcessingContext
  ): Promise<IProperty> => {
    let managedBy;
    if (row.managedby && row.managedby.includes('@')) {
      const managerResolution = await this.validateAndResolveManagedBy(
        row.managedby,
        context.clientId
      );
      if (managerResolution.valid && managerResolution.userId) {
        managedBy = new ObjectId(managerResolution.userId);
      }
    }

    return {
      name: row.name?.trim(),
      address: row.address?.trim(),
      propertyType: row.propertytype,
      status: (row.status || 'available') as PropertyStatus,
      occupancyStatus: (row.occupancystatus || 'vacant') as OccupancyStatus,
      occupancyRate: row.occupancyrate ? Number(row.occupancyrate) : 0,
      yearBuilt: row.yearbuilt ? Number(row.yearbuilt) : undefined,

      description: {
        text: row.description_text ? sanitizeHtml(row.description_text) : '',
        html: row.description_html ? sanitizeHtml(row.description_html) : '',
      },

      specifications: {
        totalArea: BaseCSVProcessorService.parseNumber(row.totalarea || row.total_area, 0),
        bedrooms: row.bedrooms ? BaseCSVProcessorService.parseNumber(row.bedrooms) : undefined,
        bathrooms: row.bathrooms ? BaseCSVProcessorService.parseNumber(row.bathrooms) : undefined,
        floors: row.floors ? BaseCSVProcessorService.parseNumber(row.floors) : undefined,
        garageSpaces: row.garagespaces
          ? BaseCSVProcessorService.parseNumber(row.garagespaces)
          : undefined,
        maxOccupants: row.maxoccupants
          ? BaseCSVProcessorService.parseNumber(row.maxoccupants)
          : undefined,
        lotSize: row.lotsize ? BaseCSVProcessorService.parseNumber(row.lotsize) : undefined,
      },

      fees: {
        taxAmount: BaseCSVProcessorService.parseNumber(row.fees_taxamount, 0),
        rentalAmount: BaseCSVProcessorService.parseNumber(row.fees_rentalamount, 0),
        managementFees: BaseCSVProcessorService.parseNumber(row.fees_managementfees, 0),
        currency: (row.fees_currency || 'USD') as CURRENCIES,
      },

      utilities: {
        water: BaseCSVProcessorService.parseBoolean(row.water),
        gas: BaseCSVProcessorService.parseBoolean(row.gas),
        electricity: BaseCSVProcessorService.parseBoolean(row.electricity),
        internet: BaseCSVProcessorService.parseBoolean(row.internet),
        trash: BaseCSVProcessorService.parseBoolean(row.trash),
        cableTV: BaseCSVProcessorService.parseBoolean(row.cabletv),
      },

      ...(this.hasAnyInteriorAmenity(row) && {
        interiorAmenities: {
          airConditioning: BaseCSVProcessorService.parseBoolean(row.airconditioning),
          heating: BaseCSVProcessorService.parseBoolean(row.heating),
          washerDryer: BaseCSVProcessorService.parseBoolean(row.washerdryer),
          dishwasher: BaseCSVProcessorService.parseBoolean(row.dishwasher),
          fridge: BaseCSVProcessorService.parseBoolean(row.fridge),
          furnished: BaseCSVProcessorService.parseBoolean(row.furnished),
          storageSpace: BaseCSVProcessorService.parseBoolean(row.storagespace),
        },
      }),

      ...(this.hasAnyExteriorAmenity(row) && {
        exteriorAmenities: {
          swimmingPool: BaseCSVProcessorService.parseBoolean(row.swimmingpool),
          fitnessCenter: BaseCSVProcessorService.parseBoolean(row.fitnesscenter),
          elevator: BaseCSVProcessorService.parseBoolean(row.elevator),
          balcony: BaseCSVProcessorService.parseBoolean(row.balcony),
          parking: BaseCSVProcessorService.parseBoolean(row.parking),
          garden: BaseCSVProcessorService.parseBoolean(row.garden),
          securitySystem: BaseCSVProcessorService.parseBoolean(row.securitysystem),
          playground: BaseCSVProcessorService.parseBoolean(row.playground),
        },
      }),

      ...(this.hasAnyCommunityAmenity(row) && {
        communityAmenities: {
          petFriendly: BaseCSVProcessorService.parseBoolean(row.petfriendly),
          clubhouse: BaseCSVProcessorService.parseBoolean(row.clubhouse),
          bbqArea: BaseCSVProcessorService.parseBoolean(row.bbqarea),
          laundryFacility: BaseCSVProcessorService.parseBoolean(row.laundryfacility),
          doorman: BaseCSVProcessorService.parseBoolean(row.doorman),
        },
      }),

      cid: context.clientId,
      managedBy,
      createdBy: context.currentUser ? new ObjectId(context.currentUser.sub) : undefined,
    } as IProperty;
  };

  private postProcessProperties = async (
    properties: IProperty[]
  ): Promise<{ validItems: IProperty[]; invalidItems: any[] }> => {
    const { validProperties, invalidProperties } =
      await this.processGeocodingForProperties(properties);

    return {
      validItems: validProperties,
      invalidItems: invalidProperties,
    };
  };

  private async processGeocodingForProperties(properties: IProperty[]): Promise<{
    validProperties: IProperty[];
    invalidProperties: { field: string; error: string }[];
  }> {
    const validProperties: IProperty[] = [];
    const invalidProperties: { field: string; error: string }[] = [];

    for (const property of properties) {
      try {
        const geoCode = await this.geoCoderService.parseLocation(property.address);

        if (!geoCode || geoCode.length === 0) {
          invalidProperties.push({
            field: 'address',
            error: `Invalid address: ${property.address}`,
          });
          continue;
        }

        property.computedLocation = {
          type: 'Point',
          coordinates: [geoCode[0]?.longitude || 0, geoCode[0]?.latitude || 0],
          address: {
            city: geoCode[0].city,
            state: geoCode[0].state,
            country: geoCode[0].country,
            postCode: geoCode[0].zipcode,
            street: geoCode[0].streetName,
            streetNumber: geoCode[0].streetNumber,
          },
          latAndlon: `${geoCode[0].longitude || 0} ${geoCode[0].latitude || 0}`,
        };

        property.address = geoCode[0]?.formattedAddress || property.address;
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
      'airconditioning',
      'heating',
      'washerdryer',
      'dishwasher',
      'fridge',
      'furnished',
      'storagespace',
    ].some((field) => data[field] !== undefined);
  }

  private hasAnyExteriorAmenity(data: any): boolean {
    return [
      'swimmingpool',
      'fitnesscenter',
      'elevator',
      'balcony',
      'parking',
      'garden',
      'securitysystem',
      'playground',
    ].some((field) => data[field] !== undefined);
  }

  private hasAnyCommunityAmenity(data: any): boolean {
    return ['petfriendly', 'clubhouse', 'bbqarea', 'laundryfacility', 'doorman'].some(
      (field) => data[field] !== undefined
    );
  }

  private async validateAndResolveManagedBy(
    email: string,
    clientId: string
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

      const clientAssociations = user.cids;
      const clientAssociation = clientAssociations.find((c) => c.cid === clientId && c.isConnected);

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
}
