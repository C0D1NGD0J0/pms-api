import Logger from 'bunyan';
import { Types } from 'mongoose';
import { VendorDAO } from '@dao/vendorDAO';
import { createLogger } from '@utils/index';
import { GeoCoderService } from '@services/external/geoCoder.service';

interface IConstructor {
  geoCoderService: GeoCoderService;
  vendorDAO: VendorDAO;
}

export class ServiceAreaService {
  private readonly log: Logger;
  private readonly vendorDAO: VendorDAO;
  private readonly geoCoderService: GeoCoderService;

  constructor({ vendorDAO, geoCoderService }: IConstructor) {
    this.vendorDAO = vendorDAO;
    this.geoCoderService = geoCoderService;
    this.log = createLogger('ServiceAreaService');
  }

  /**
   * Check if a location is within a vendor's service area using MongoDB geospatial query
   */
  public async isLocationInVendorServiceArea(
    vendorId: string,
    targetLocation: string | [number, number],
    cuid?: string
  ): Promise<{
    isInRange: boolean;
    distance?: number;
    message: string;
  }> {
    const vendor = cuid
      ? await this.vendorDAO.findFirst({ _id: new Types.ObjectId(vendorId), cuid })
      : await this.vendorDAO.findById(vendorId);
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

    // Use MongoDB's $geoNear to calculate distance.
    // key is required when the collection has more than one 2dsphere index.
    const result = (await this.vendorDAO.aggregate([
      {
        $geoNear: {
          near: {
            type: 'Point',
            coordinates: targetCoords,
          },
          distanceField: 'distance',
          key: 'address.computedLocation',
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
    ])) as unknown as { distance: number }[];

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
  }
}
