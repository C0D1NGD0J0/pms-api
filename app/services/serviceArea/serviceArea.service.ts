import { Model } from 'mongoose';
import { IVendorDocument } from '@interfaces/vendor.interface';
import { IProfileDocument } from '@interfaces/profile.interface';
import { GeoCoderService } from '@services/external/geoCoder.service';

export interface ServiceAreaLocation {
  coordinates: [number, number]; // [longitude, latitude]
  address: string;
}

export interface ServiceAreaConfig {
  baseLocation?: ServiceAreaLocation;
  maxDistance: 10 | 15 | 25 | 50; // km
}

export interface GeospatialQueryResult {
  profile: IProfileDocument;
  distance: number;
  _id: string;
}

/**
 * Service for geospatial operations using MongoDB's native geospatial features
 */
export class ServiceAreaService {
  private geoCoderService: GeoCoderService;
  private profileModel: Model<IProfileDocument>;
  private vendorModel: Model<IVendorDocument>;

  constructor(profileModel: Model<IProfileDocument>, vendorModel?: Model<IVendorDocument>) {
    this.geoCoderService = new GeoCoderService();
    this.profileModel = profileModel;
    // Vendor model is optional for backward compatibility
    this.vendorModel = vendorModel!;
  }

  /**
   * Find vendors within a specified distance of a location using MongoDB's $geoNear
   * @param targetLocation - Location to search around (coordinates or address)
   * @param maxDistance - Maximum distance in kilometers
   * @param options - Additional query options
   * @returns Promise<GeospatialQueryResult[]>
   */
  public async findVendorsNearLocation(
    targetLocation: string | [number, number],
    maxDistance: number,
    options: {
      limit?: number;
      skip?: number;
      serviceTypes?: string[];
    } = {}
  ): Promise<GeospatialQueryResult[]> {
    try {
      // Get target coordinates
      let targetCoords: [number, number];
      if (typeof targetLocation === 'string') {
        const geocodeResult = await this.geoCoderService.parseLocation(targetLocation);
        if (!geocodeResult.success || !geocodeResult.data) {
          throw new Error('Could not geocode target location');
        }
        targetCoords = geocodeResult.data.coordinates;
      } else {
        targetCoords = targetLocation;
      }

      // Build aggregation pipeline - search vendors directly
      const pipeline: any[] = [
        {
          $geoNear: {
            near: {
              type: 'Point',
              coordinates: targetCoords,
            },
            distanceField: 'distance',
            maxDistance: maxDistance * 1000, // Convert km to meters
            spherical: true,
            query: {
              'address.computedLocation': { $exists: true },
            },
          },
        },
        {
          $match: {
            'serviceAreas.maxDistance': { $gte: maxDistance },
          },
        },
      ];

      // Add service type filter if specified
      if (options.serviceTypes && options.serviceTypes.length > 0) {
        const serviceTypeQuery: any = {};
        options.serviceTypes.forEach((serviceType) => {
          serviceTypeQuery[`servicesOffered.${serviceType}`] = true;
        });
        pipeline.push({ $match: serviceTypeQuery });
      }

      // Add pagination
      if (options.skip) {
        pipeline.push({ $skip: options.skip });
      }
      if (options.limit) {
        pipeline.push({ $limit: options.limit });
      }

      // Convert distance back to kilometers
      pipeline.push({
        $addFields: {
          distance: { $divide: ['$distance', 1000] },
        },
      });

      // Execute on vendor model instead of profile model
      const results = await this.vendorModel.aggregate(pipeline);
      return results;
    } catch (error) {
      throw new Error(
        `Error finding vendors near location: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Check if a location is within a vendor's service area using MongoDB geospatial query
   * @param vendorId - Vendor profile ID
   * @param targetLocation - Location to check (address or coordinates)
   * @returns Promise with service area check result
   */
  public async isLocationInVendorServiceArea(
    vendorId: string,
    targetLocation: string | [number, number]
  ): Promise<{
    isInRange: boolean;
    distance?: number;
    message: string;
  }> {
    try {
      // Get vendor directly
      const vendor = await this.vendorModel.findById(vendorId);
      if (!vendor) {
        return {
          isInRange: false,
          message: 'Vendor not found',
        };
      }

      if (!vendor.address?.computedLocation || !vendor.serviceAreas?.maxDistance) {
        return {
          isInRange: false,
          message: 'Vendor service area not configured',
        };
      }

      // Get target coordinates
      let targetCoords: [number, number];
      if (typeof targetLocation === 'string') {
        const geocodeResult = await this.geoCoderService.parseLocation(targetLocation);
        if (!geocodeResult.success || !geocodeResult.data) {
          return {
            isInRange: false,
            message: 'Could not geocode target location',
          };
        }
        targetCoords = geocodeResult.data.coordinates;
      } else {
        targetCoords = targetLocation;
      }

      // Use MongoDB's $geoNear to calculate distance
      const result = await this.vendorModel.aggregate([
        {
          $geoNear: {
            near: {
              type: 'Point',
              coordinates: targetCoords,
            },
            distanceField: 'distance',
            maxDistance: vendor.serviceAreas.maxDistance * 1000, // Convert km to meters
            spherical: true,
            query: { _id: vendor._id },
          },
        },
        {
          $addFields: {
            distance: { $divide: ['$distance', 1000] }, // Convert back to km
          },
        },
        { $limit: 1 },
      ]);

      if (result.length === 0) {
        return {
          isInRange: false,
          message: `Location is outside service area (max: ${vendor.serviceAreas.maxDistance}km)`,
        };
      }

      const distance = result[0].distance;
      return {
        isInRange: true,
        distance,
        message: `Location is within service area (${distance.toFixed(2)}km from vendor)`,
      };
    } catch (error) {
      return {
        isInRange: false,
        message: `Error checking service area: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Get service area boundary for mapping/visualization
   * @param vendorId - Vendor profile ID
   * @returns Service area boundary information
   */
  public async getVendorServiceAreaBoundary(vendorId: string): Promise<{
    center: [number, number];
    radius: number; // in km
    address: string;
  } | null> {
    try {
      const vendor = await this.vendorModel.findById(vendorId);
      if (!vendor) {
        return null;
      }

      if (!vendor.address?.computedLocation || !vendor.serviceAreas?.maxDistance) {
        return null;
      }

      return {
        center: vendor.address.computedLocation.coordinates,
        radius: vendor.serviceAreas.maxDistance,
        address: vendor.address.fullAddress,
      };
    } catch (error) {
      console.error('Error getting vendor service area boundary:', error);
      return null;
    }
  }

  /**
   * Convert an address to coordinates for service area setup
   * @param address - Address string
   * @returns Promise<ServiceAreaLocation | null>
   */
  public async createServiceAreaLocation(address: string): Promise<ServiceAreaLocation | null> {
    try {
      const geocodeResult = await this.geoCoderService.parseLocation(address);
      if (!geocodeResult.success || !geocodeResult.data) {
        return null;
      }

      return {
        coordinates: geocodeResult.data.coordinates,
        address: geocodeResult.data.fullAddress,
      };
    } catch (error) {
      console.error('Error creating service area location:', error);
      return null;
    }
  }

  /**
   * Ensure geospatial indexes are created for optimal performance
   * @returns Promise<void>
   */
  public async ensureGeospatialIndexes(): Promise<void> {
    try {
      // Create 2dsphere index on vendor address coordinates
      await this.vendorModel.collection.createIndex({
        'address.computedLocation': '2dsphere',
      });

      // Create compound index for common queries
      await this.vendorModel.collection.createIndex({
        'address.computedLocation': '2dsphere',
        'serviceAreas.maxDistance': 1,
      });

      console.info('Geospatial indexes created successfully');
    } catch (error) {
      console.error('Error creating geospatial indexes:', error);
    }
  }

  /**
   * Get approximate coverage area in square kilometers
   * @param maxDistance - Maximum distance in km
   * @returns Approximate area in square kilometers
   */
  public getCoverageArea(maxDistance: number): number {
    return Math.PI * Math.pow(maxDistance, 2);
  }
}
