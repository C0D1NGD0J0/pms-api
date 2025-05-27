import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { ClientSession, FilterQuery, Types, Model } from 'mongoose';
import { ListResultWithPagination, IPaginationQuery, UploadResult } from '@interfaces/index';
import { PropertyUnitStatusEnum, IPropertyUnitDocument } from '@interfaces/property-unit.interface';
import {
  IPropertyDocument,
  OccupancyStatus,
  PropertyStatus,
  PropertyType,
  IProperty,
} from '@interfaces/property.interface';

import { BaseDAO } from './baseDAO';
import { IPropertyUnitDAO, IPropertyDAO, IFindOptions } from './interfaces/index';

export class PropertyDAO extends BaseDAO<IPropertyDocument> implements IPropertyDAO {
  protected logger: Logger;
  private propertyUnitDAO: IPropertyUnitDAO;

  constructor({
    propertyModel,
    propertyUnitDAO,
  }: {
    propertyModel: Model<IPropertyDocument>;
    propertyUnitDAO: IPropertyUnitDAO;
  }) {
    super(propertyModel);
    this.propertyUnitDAO = propertyUnitDAO;
    this.logger = createLogger('PropertyDAO');
  }

  /**
   * Get properties by various filter criteria
   * @param clientId - The client ID
   * @param filters - Filter criteria (type, status, occupancy, etc.)
   * @param pagination - Pagination options
   * @returns A promise that resolves to filtered properties with pagination
   */
  async getFilteredProperties(
    clientId: string,
    filters: {
      propertyType?: PropertyType[];
      status?: PropertyStatus[];
      occupancyStatus?: OccupancyStatus[];
      priceRange?: { min?: number; max?: number };
      areaRange?: { min?: number; max?: number };
      amenities?: string[];
      location?: { city?: string; state?: string; postCode?: string };
    },
    pagination: { page: number; limit: number; sort?: string }
  ) {
    try {
      if (!clientId) {
        throw new Error('Client ID is required');
      }

      const query: FilterQuery<IPropertyDocument> = { cid: clientId, deletedAt: null };

      if (filters.propertyType && filters.propertyType.length > 0) {
        query.propertyType = { $in: filters.propertyType };
      }

      if (filters.status && filters.status.length > 0) {
        query.status = { $in: filters.status };
      }

      if (filters.occupancyStatus && filters.occupancyStatus.length > 0) {
        query.occupancyStatus = { $in: filters.occupancyStatus };
      }

      if (filters.priceRange) {
        const priceFilter: any = {};
        if (typeof filters.priceRange.min === 'number') {
          priceFilter.$gte = filters.priceRange.min;
        }
        if (typeof filters.priceRange.max === 'number') {
          priceFilter.$lte = filters.priceRange.max;
        }
        if (Object.keys(priceFilter).length > 0) {
          query['financialDetails.marketValue'] = priceFilter;
        }
      }

      if (filters.areaRange) {
        const areaFilter: any = {};
        if (typeof filters.areaRange.min === 'number') {
          areaFilter.$gte = filters.areaRange.min;
        }
        if (typeof filters.areaRange.max === 'number') {
          areaFilter.$lte = filters.areaRange.max;
        }
        if (Object.keys(areaFilter).length > 0) {
          query['specifications.totalArea'] = areaFilter;
        }
      }

      if (filters.location) {
        if (filters.location.city) {
          query['address.city'] = {
            $regex: new RegExp(filters.location.city, 'i'),
          };
        }
        if (filters.location.state) {
          query['address.state'] = {
            $regex: new RegExp(filters.location.state, 'i'),
          };
        }
        if (filters.location.postCode) {
          query['address.postCode'] = filters.location.postCode;
        }
      }

      const page = Math.max(1, pagination.page || 1);
      const limit = Math.max(1, Math.min(pagination.limit || 10, 100));
      const skip = (page - 1) * limit;

      let sortOption = {};
      if (pagination.sort) {
        const [field, order] = pagination.sort.split(':');
        sortOption = { [field]: order === 'desc' ? -1 : 1 };
      } else {
        sortOption = { createdAt: -1 };
      }

      const properties = await this.list(query, {
        skip,
        limit,
        sort: sortOption,
      });

      return properties;
    } catch (error) {
      this.logger.error('Error in getFilteredProperties:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Update property occupancy status
   * @param propertyId - The property ID
   * @param status - The new occupancy status
   * @param totalUnits - The new occupancy rate percentage
   * @param userId - The ID of the user performing the update
   * @returns A promise that resolves to the updated property document
   */
  async updatePropertyOccupancy(
    propertyId: string,
    status: OccupancyStatus,
    totalUnits: number,
    userId: string
  ): Promise<IPropertyDocument | null> {
    try {
      if (!propertyId || !status) {
        throw new Error('Property ID and status are required');
      }

      if (totalUnits < 0 || totalUnits > 200) {
        throw new Error('Occupancy rate must be between 0 and 200');
      }

      const updateOperation = {
        $set: {
          occupancyStatus: status,
          totalUnits: totalUnits,
          lastModifiedBy: new Types.ObjectId(userId),
          updatedAt: new Date(),
        },
      };

      return await this.updateById(propertyId, updateOperation);
    } catch (error) {
      this.logger.error('Error in updatePropertyOccupancy:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Get properties by client ID
   * @param clientId - The client ID
   * @param filter - Additional filter criteria
   * @param opts - Additional options for the query
   * @returns A promise that resolves to an array of property documents
   */
  async getPropertiesByClientId(
    clientId: string,
    filter: FilterQuery<IPropertyDocument> = {},
    opts?: IPaginationQuery
  ): ListResultWithPagination<IPropertyDocument[]> {
    try {
      if (!clientId) {
        throw new Error('Client ID is required');
      }

      if (opts && opts.sort && opts.sortBy) {
        const sortDirection = opts.sort === 'desc' ? -1 : 1;

        if (opts.sortBy) {
          switch (opts.sortBy) {
            case 'occupancyStatus':
              opts.sort = { occupancyStatus: sortDirection };
              break;
            case 'propertyType':
              opts.sort = { propertyType: sortDirection };
              break;
            case 'createdAt':
              opts.sort = { createdAt: sortDirection };
              break;
            case 'status':
              opts.sort = { status: sortDirection };
              break;
            case 'price':
              opts.sort = { 'financialDetails.marketValue': sortDirection };
              break;
            case 'name':
              opts.sort = { name: sortDirection };
              break;
            case 'area':
              opts.sort = { 'specifications.totalArea': sortDirection };
              break;
            default:
              opts.sort = undefined;
          }
        } else {
          opts.sort = { createdAt: -1 };
        }
      }

      return await this.list(filter, opts);
    } catch (error) {
      this.logger.error('Error in getPropertiesByClientId:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Update property documents/photos
   * @param propertyId - The property ID
   * @param documentData - The document data to add
   * @param userId - The ID of the user performing the action
   * @returns A promise that resolves to the updated property document
   */
  async updatePropertyDocument(
    propertyId: string,
    uploadData: UploadResult[],
    userId: string
  ): Promise<IPropertyDocument | null> {
    try {
      if (!propertyId || !uploadData.length) {
        throw new Error('Property ID, document data, and user ID are required');
      }

      const property = await this.findById(propertyId);
      if (!property) {
        throw new Error('Property not found');
      }

      let result = null;
      if (uploadData) {
        result = uploadData
          .map((upload) => {
            const foundDocument = property.documents?.find(
              (doc) => doc.documentName === upload?.documentName
            );
            if (!foundDocument) {
              return null;
            }
            return {
              key: upload.key,
              url: upload.url,
              status: 'active',
              uploadedAt: new Date(),
              externalUrl: upload.url,
              documentName: upload.documentName,
              description: foundDocument.description,
              documentType: foundDocument.documentType,
              uploadedBy: new Types.ObjectId(upload.actorId),
            };
          })
          .filter((document) => document !== null);
      }

      const updateOperation = {
        $push: { documents: result },
        $set: { lastModifiedBy: new Types.ObjectId(userId) },
      };

      return await this.updateById(propertyId, updateOperation);
    } catch (error) {
      this.logger.error('Error in addPropertyDocument:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Find properties within a geographic radius
   * @param clientId - The client ID
   * @param coordinates - [longitude, latitude] coordinates
   * @param radiusInKm - Radius in kilometers
   * @returns A promise that resolves to properties within the radius
   */
  async findPropertiesNearby(
    clientId: string,
    coordinates: [number, number],
    radiusInKm: number
  ): Promise<IPropertyDocument[]> {
    try {
      if (!clientId || !coordinates || coordinates.length !== 2) {
        throw new Error('Client ID and valid coordinates are required');
      }
      if (radiusInKm <= 0) {
        throw new Error('Radius must be greater than 0');
      }
      if (
        coordinates[0] < -180 ||
        coordinates[0] > 180 ||
        coordinates[1] < -90 ||
        coordinates[1] > 90
      ) {
        throw new Error('Coordinates must be valid longitude and latitude values');
      }

      const radius = Math.max(0.1, Math.min(radiusInKm, 100)); // limit between 0.1 and 100 km

      // convert km to radians
      const radiusInRadians = radius / 6371;

      // geospatial query
      const query = {
        cid: clientId,
        deletedAt: null,
        'computedLocation.type': 'Point',
        'computedLocation.coordinates': {
          $geoWithin: {
            $centerSphere: [coordinates, radiusInRadians],
          },
        },
      };

      const result = await this.list(query);
      return result.data;
    } catch (error) {
      this.logger.error('Error in findPropertiesNearby:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Find a property by its address
   * @param address - The property address
   * @param clientId - The client ID
   * @param opts - Additional options for the query
   * @returns A promise that resolves to the property document or null if not found
   */
  async findPropertyByAddress(
    address: string,
    clientId: string,
    opts?: IFindOptions
  ): Promise<IPropertyDocument | null> {
    try {
      if (!address || !clientId) {
        throw new Error('Address and client ID are required');
      }

      const normalizedAddress = address.trim().toLowerCase();
      const query = {
        'address.fullAddress': { $regex: new RegExp(`^${normalizedAddress}$`, 'i') },
        cid: clientId,
        deletedAt: null,
      };

      return await this.findFirst(query, opts);
    } catch (error) {
      this.logger.error('Error in findPropertyByAddress:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Create a new property with validation
   * @param propertyData - The property data
   * @param session - Optional MongoDB session for transactions
   * @returns A promise that resolves to the created property document
   */
  async createProperty(
    propertyData: Partial<IProperty>,
    session?: ClientSession
  ): Promise<IPropertyDocument> {
    try {
      return await this.insert(propertyData, session);
    } catch (error) {
      this.logger.error('Error in createProperty:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Remove a property document/photo
   * @param propertyId - The property ID
   * @param documentId - The document ID to remove
   * @param userId - The ID of the user performing the action
   * @returns A promise that resolves to the updated property document
   */
  async removePropertyDocument(
    propertyId: string,
    documentId: string,
    userId: string
  ): Promise<IPropertyDocument | null> {
    try {
      if (!propertyId || !documentId || !userId) {
        throw new Error('Property ID, document ID, and user ID are required');
      }

      const updateOperation = {
        $pull: { documents: { _id: new Types.ObjectId(documentId) } },
        $set: { lastModifiedBy: new Types.ObjectId(userId) },
      };

      return await this.updateById(propertyId, updateOperation);
    } catch (error) {
      this.logger.error('Error in removePropertyDocument:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Search properties by various criteria
   * @param query - The search query
   * @param clientId - The client ID
   * @returns A promise that resolves to an array of property documents
   */
  searchProperties(query: string, clientId: string): ListResultWithPagination<IPropertyDocument[]> {
    if (!clientId) {
      throw new Error('Client ID is required');
    }

    if (!query || query.trim().length === 0) {
      // If no query, return all properties for the client
      return this.getPropertiesByClientId(clientId);
    }

    const searchQuery = {
      cid: clientId,
      deletedAt: null,
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { pid: { $regex: query, $options: 'i' } },
        { 'address.city': { $regex: query, $options: 'i' } },
        { 'address.state': { $regex: query, $options: 'i' } },
        { 'address.postCode': { $regex: query, $options: 'i' } },
        { 'address.fullAddress': { $regex: query, $options: 'i' } },
      ],
    };

    try {
      return this.list(searchQuery, {
        skip: 0,
        limit: 10,
      });
    } catch (error) {
      this.logger.error('Error in searchProperties:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Archive a property (soft delete) - now checks if property can be archived first
   * @param propertyId - The property ID
   * @param userId - The ID of the user performing the action
   * @returns A promise that resolves to true if successful
   */
  async archiveProperty(propertyId: string, userId: string): Promise<boolean> {
    try {
      if (!propertyId || !userId) {
        throw new Error('Property ID and user ID are required');
      }

      const archiveCheck = await this.canArchiveProperty(propertyId);
      if (!archiveCheck.canArchive) {
        throw new Error(
          `Cannot archive property with ${archiveCheck.activeUnitCount} active units (${archiveCheck.occupiedUnitCount} occupied)`
        );
      }

      const updateOperation = {
        $set: {
          deletedAt: new Date(),
          lastModifiedBy: new Types.ObjectId(userId),
        },
      };

      const result = await this.updateById(propertyId, updateOperation);
      return !!result;
    } catch (error) {
      this.logger.error('Error in archiveProperty:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Get all units for a property
   * @param propertyId - The property ID
   * @returns A promise that resolves to an array of property unit documents
   */
  async getPropertyUnits(
    propertyId: string,
    opts: IPaginationQuery
  ): ListResultWithPagination<IPropertyUnitDocument[]> {
    try {
      if (!propertyId) {
        throw new Error('Property ID is required');
      }

      return await this.propertyUnitDAO.findUnitsByProperty(propertyId, opts);
    } catch (error) {
      this.logger.error('Error in getPropertyUnits:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Get unit count by status for a property
   * @param propertyId - The property ID
   * @returns A promise that resolves to counts of units by status
   */
  async getUnitCountsByStatus(propertyId: string): Promise<{
    total: number;
    available: number;
    occupied: number;
    reserved: number;
    maintenance: number;
    inactive: number;
  }> {
    try {
      if (!propertyId) {
        throw new Error('Property ID is required');
      }

      const statusCounts = await this.propertyUnitDAO.getUnitCountsByStatus(propertyId);

      // Convert to the expected return format with proper typing
      const counts = Object.values(statusCounts) as number[];
      const result = {
        total: counts.reduce((sum: number, count: number) => sum + count, 0),
        available: statusCounts[PropertyUnitStatusEnum.AVAILABLE] || 0,
        occupied: statusCounts[PropertyUnitStatusEnum.OCCUPIED] || 0,
        reserved: statusCounts[PropertyUnitStatusEnum.RESERVED] || 0,
        maintenance: statusCounts[PropertyUnitStatusEnum.MAINTENANCE] || 0,
        inactive: statusCounts[PropertyUnitStatusEnum.INACTIVE] || 0,
      };

      return result;
    } catch (error) {
      this.logger.error('Error in getUnitCountsByStatus:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Check if a property can accommodate more units
   * @param propertyId - The property ID
   * @returns A promise that resolves to whether the property can have more units
   */
  async canAddUnitToProperty(propertyId: string): Promise<{
    canAdd: boolean;
    currentCount: number;
    maxCapacity: number;
  }> {
    try {
      if (!propertyId) {
        throw new Error('Property ID is required');
      }

      const property = await this.findById(propertyId);
      if (!property) {
        throw new Error('Property not found');
      }

      const units = await this.propertyUnitDAO.countDocuments({ propertyId });
      const currentCount = units;
      const maxCapacity = property.totalUnits || 0;
      const canAdd = maxCapacity === 0 || currentCount < maxCapacity;
      return {
        canAdd,
        currentCount,
        maxCapacity,
      };
    } catch (error) {
      this.logger.error('Error in canAddUnitToProperty:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Extended validation for unit compatibility with property type
   * Used internally for more detailed validation than the interface method provides
   * @param propertyId - The property ID
   * @param unitType - Property unit type to check compatibility
   * @returns Detailed validation result with reason if incompatible
   */
  async validateUnitToPropertyCompatibility(
    propertyId: string,
    unitType?: string
  ): Promise<{
    canAdd: boolean;
    currentCount: number;
    maxCapacity: number;
    reason?: string;
  }> {
    try {
      if (!propertyId) {
        throw new Error('Property ID is required');
      }

      const property = await this.findById(propertyId);
      if (!property) {
        throw new Error('Property not found');
      }

      const units = await this.propertyUnitDAO.findUnitsByProperty(propertyId);
      const currentCount = units.length;
      const maxCapacity = property.totalUnits || 0;

      // base capacity check
      let canAdd = maxCapacity === 0 || currentCount < maxCapacity;
      let reason;

      // Property Type-specific Unit Validations
      if (canAdd && unitType) {
        canAdd = this.isUnitTypeCompatibleWithProperty(property.propertyType, unitType);
        if (!canAdd) {
          reason = `Unit type '${unitType}' is not compatible with property type '${property.propertyType}'`;
        }
      }

      // check for property type specific limits
      if (canAdd && property.propertyType === 'house' && currentCount >= 1) {
        canAdd = false;
        reason = 'Houses can only have one unit unless configured for multi-family';
      }

      if (canAdd && property.propertyType === 'commercial' && currentCount > 0) {
        const commercialUnitTypeCount = units.filter((u) => u.unitType === 'commercial').length;
        // ensure commercial properties maintain a balance of unit types
        if (commercialUnitTypeCount < currentCount * 0.5) {
          canAdd = false;
          reason = 'Commercial properties must maintain at least 50% commercial units';
        }
      }

      return {
        canAdd,
        currentCount,
        maxCapacity,
        reason,
      };
    } catch (error) {
      this.logger.error('Error in validateUnitToPropertyCompatibility:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Check if a unit type is compatible with a property type
   * @param propertyType - The property type
   * @param unitType - The unit type
   * @returns Boolean indicating if the unit type is compatible with the property type
   */
  private isUnitTypeCompatibleWithProperty(propertyType: string, unitType: string): boolean {
    const compatibilityMap: Record<string, string[]> = {
      apartment: ['studio', '1BR', '2BR', '3BR', '4BR+', 'penthouse', 'loft'],
      house: ['1BR', '2BR', '3BR', '4BR+'],
      condominium: ['studio', '1BR', '2BR', '3BR', 'penthouse'],
      townhouse: ['1BR', '2BR', '3BR', '4BR+'],
      commercial: ['commercial', 'retail', 'office'],
      industrial: ['commercial', 'warehouse'],
    };

    // Check if the unit type is compatible with the property type
    const compatibleUnitTypes = compatibilityMap[propertyType] || [];
    return compatibleUnitTypes.includes(unitType);
  }

  /**
   * Recalculate and update property occupancy status based on its units
   * @param propertyId - The property ID
   * @param userId - The ID of the user triggering the update
   * @returns A promise that resolves to the updated property
   */
  async syncPropertyOccupancyWithUnits(
    propertyId: string,
    userId: string
  ): Promise<IPropertyDocument | null> {
    try {
      if (!propertyId || !userId) {
        throw new Error('Property ID and user ID are required');
      }

      const unitCounts = await this.getUnitCountsByStatus(propertyId);
      let occupancyStatus: OccupancyStatus = 'vacant';

      if (unitCounts.total === 0) {
        occupancyStatus = 'vacant';
      } else if (unitCounts.occupied === unitCounts.total) {
        occupancyStatus = 'occupied';
      } else if (unitCounts.occupied > 0) {
        occupancyStatus = 'partially_occupied';
      } else {
        occupancyStatus = 'vacant';
      }

      return await this.updatePropertyOccupancy(
        propertyId,
        occupancyStatus,
        unitCounts.total,
        userId
      );
    } catch (error) {
      this.logger.error('Error in syncPropertyOccupancyWithUnits:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Check if a property can be archived (has no active units)
   * @param propertyId - The property ID
   * @returns A promise that resolves to whether the property can be archived and why if not
   */
  async canArchiveProperty(propertyId: string): Promise<{
    canArchive: boolean;
    activeUnitCount?: number;
    occupiedUnitCount?: number;
  }> {
    try {
      if (!propertyId) {
        throw new Error('Property ID is required');
      }

      const unitCounts = await this.getUnitCountsByStatus(propertyId);

      // a property can be archived if it has no active or occupied units
      const activeUnitCount = unitCounts.total - unitCounts.inactive;
      const occupiedUnitCount = unitCounts.occupied;

      return {
        canArchive: activeUnitCount === 0,
        activeUnitCount,
        occupiedUnitCount,
      };
    } catch (error) {
      this.logger.error('Error in canArchiveProperty:', error);
      throw this.throwErrorHandler(error);
    }
  }
}
