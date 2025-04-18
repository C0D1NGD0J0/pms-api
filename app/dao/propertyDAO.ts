import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { UploadResult } from '@interfaces/index';
import { ClientSession, FilterQuery, Types, Model } from 'mongoose';
import {
  IPropertyDocument,
  OccupancyStatus,
  PropertyStatus,
  PropertyType,
  IProperty,
} from '@interfaces/property.interface';

import { BaseDAO } from './baseDAO';
import { IPropertyDAO, dynamic } from './interfaces/index';

export class PropertyDAO extends BaseDAO<IPropertyDocument> implements IPropertyDAO {
  protected logger: Logger;

  constructor({ propertyModel }: { propertyModel: Model<IPropertyDocument> }) {
    super(propertyModel);
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
  ): Promise<{ properties: IPropertyDocument[]; total: number; pages: number }> {
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
          query['computedLocation.address.city'] = {
            $regex: new RegExp(filters.location.city, 'i'),
          };
        }
        if (filters.location.state) {
          query['computedLocation.address.state'] = {
            $regex: new RegExp(filters.location.state, 'i'),
          };
        }
        if (filters.location.postCode) {
          query['computedLocation.address.postCode'] = filters.location.postCode;
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
      const total = await this.countDocuments(query);
      const pages = Math.ceil(total / limit);

      const properties = await this.list(query, {
        skip,
        limit,
        sort: sortOption,
      });

      return {
        properties,
        total,
        pages,
      };
    } catch (error) {
      this.logger.error('Error in getFilteredProperties:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Update property occupancy status
   * @param propertyId - The property ID
   * @param status - The new occupancy status
   * @param occupancyLimit - The new occupancy rate percentage
   * @param userId - The ID of the user performing the update
   * @returns A promise that resolves to the updated property document
   */
  async updatePropertyOccupancy(
    propertyId: string,
    status: OccupancyStatus,
    occupancyLimit: number,
    userId: string
  ): Promise<IPropertyDocument | null> {
    try {
      if (!propertyId || !status) {
        throw new Error('Property ID and status are required');
      }

      if (occupancyLimit < 0 || occupancyLimit > 200) {
        throw new Error('Occupancy rate must be between 0 and 200');
      }

      const updateOperation = {
        $set: {
          occupancyStatus: status,
          occupancyLimit: occupancyLimit,
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
    opts?: dynamic
  ): Promise<IPropertyDocument[]> {
    try {
      if (!clientId) {
        throw new Error('Client ID is required');
      }

      const query = {
        ...filter,
        cid: clientId,
        deletedAt: null,
      };

      return await this.list(query, opts);
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

      return await this.list(query);
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
    opts?: dynamic
  ): Promise<IPropertyDocument | null> {
    try {
      if (!address || !clientId) {
        throw new Error('Address and client ID are required');
      }

      const normalizedAddress = address.trim().toLowerCase();
      const query = {
        address: { $regex: new RegExp(`^${normalizedAddress}$`, 'i') },
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
  async searchProperties(query: string, clientId: string): Promise<IPropertyDocument[]> {
    try {
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
          { address: { $regex: query, $options: 'i' } },
          { pid: { $regex: query, $options: 'i' } },
          { 'computedLocation.address.city': { $regex: query, $options: 'i' } },
          { 'computedLocation.address.state': { $regex: query, $options: 'i' } },
          { 'computedLocation.address.postCode': { $regex: query, $options: 'i' } },
        ],
      };

      return await this.list(searchQuery);
    } catch (error) {
      this.logger.error('Error in searchProperties:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Archive a property (soft delete)
   * @param propertyId - The property ID
   * @param userId - The ID of the user performing the action
   * @returns A promise that resolves to true if successful
   */
  async archiveProperty(propertyId: string, userId: string): Promise<boolean> {
    try {
      if (!propertyId || !userId) {
        throw new Error('Property ID and user ID are required');
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
}
