import { ClientSession, FilterQuery } from 'mongoose';
import {
  IPropertyDocumentItem,
  IPropertyDocument,
  OccupancyStatus,
  PropertyStatus,
  PropertyType,
} from '@interfaces/property.interface';

import { dynamic } from './baseDAO.interface';

export interface IPropertyDAO {
  /**
   * Get properties by various filter criteria
   * @param clientId - The client ID
   * @param filters - Filter criteria (type, status, occupancy, etc.)
   * @param pagination - Pagination options
   * @returns A promise that resolves to filtered properties with pagination
   */
  getFilteredProperties(
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
  ): Promise<{ properties: IPropertyDocument[]; total: number; pages: number }>;

  /**
   * Update property occupancy status
   * @param propertyId - The property ID
   * @param status - The new occupancy status
   * @param occupancyRate - The new occupancy rate percentage
   * @param userId - The ID of the user performing the update
   * @returns A promise that resolves to the updated property document
   */
  updatePropertyOccupancy(
    propertyId: string,
    status: OccupancyStatus,
    occupancyRate: number,
    userId: string
  ): Promise<IPropertyDocument | null>;

  /**
   * Check if a property is available for a specific date range
   * @param propertyId - The property ID
   * @param startDate - Start date
   * @param endDate - End date
   * @returns A promise that resolves to availability status
   */
  // checkPropertyAvailability(
  //   propertyId: string,
  //   startDate: Date,
  //   endDate: Date
  // ): Promise<{ isAvailable: boolean; conflictingLeases?: any[] }>;

  /**
   * Get properties by client ID
   * @param clientId - The client ID
   * @param filter - Additional filter criteria
   * @param opts - Additional options for the query
   * @returns A promise that resolves to an array of property documents
   */
  getPropertiesByClientId(
    clientId: string,
    filter?: FilterQuery<IPropertyDocument>,
    opts?: dynamic
  ): Promise<IPropertyDocument[]>;

  /**
   * Add or update property documents/photos
   * @param propertyId - The property ID
   * @param documentData - The document data to add
   * @param userId - The ID of the user performing the action
   * @returns A promise that resolves to the updated property document
   */
  addPropertyDocument(
    propertyId: string,
    documentData: IPropertyDocumentItem,
    userId: string
  ): Promise<IPropertyDocument | null>;

  /**
   * Find properties within a geographic radius
   * @param clientId - The client ID
   * @param coordinates - [longitude, latitude] coordinates
   * @param radiusInKm - Radius in kilometers
   * @returns A promise that resolves to properties within the radius
   */
  findPropertiesNearby(
    clientId: string,
    coordinates: [number, number],
    radiusInKm: number
  ): Promise<IPropertyDocument[]>;

  /**
   * Find a property by its address
   * @param address - The property address
   * @param clientId - The client ID
   * @param opts - Additional options for the query
   * @returns A promise that resolves to the property document or null if not found
   */
  findPropertyByAddress(
    address: string,
    clientId: string,
    opts?: dynamic
  ): Promise<IPropertyDocument | null>;

  /**
   * Create a new property with validation
   * @param propertyData - The property data
   * @param session - Optional MongoDB session for transactions
   * @returns A promise that resolves to the created property document
   */
  createProperty(
    propertyData: Partial<IPropertyDocument>,
    session?: ClientSession
  ): Promise<IPropertyDocument>;

  /**
   * Remove a property document/photo
   * @param propertyId - The property ID
   * @param documentId - The document ID to remove
   * @param userId - The ID of the user performing the action
   * @returns A promise that resolves to the updated property document
   */
  removePropertyDocument(
    propertyId: string,
    documentId: string,
    userId: string
  ): Promise<IPropertyDocument | null>;

  /**
   * Search properties by various criteria
   * @param query - The search query
   * @param clientId - The client ID
   * @returns A promise that resolves to an array of property documents
   */
  searchProperties(query: string, clientId: string): Promise<IPropertyDocument[]>;

  /**
   * Archive a property (soft delete)
   * @param propertyId - The property ID
   * @param userId - The ID of the user performing the action
   * @returns A promise that resolves to true if successful
   */
  archiveProperty(propertyId: string, userId: string): Promise<boolean>;
}
