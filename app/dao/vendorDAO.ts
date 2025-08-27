import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { ClientSession, Types, Model } from 'mongoose';
import { IVendorDocument, NewVendor, IVendor } from '@interfaces/vendor.interface';

import { BaseDAO } from './baseDAO';
import { IVendorDAO } from './interfaces/vendorDAO.interface';

export class VendorDAO extends BaseDAO<IVendorDocument> implements IVendorDAO {
  protected logger: Logger;

  constructor({ vendorModel }: { vendorModel: Model<IVendorDocument> }) {
    super(vendorModel);
    this.logger = createLogger('VendorDAO');
  }

  /**
   * Create a new vendor entity
   */
  async createVendor(vendorData: NewVendor, session?: ClientSession): Promise<IVendorDocument> {
    try {
      const savedVendor = await this.insert(vendorData, session);
      this.logger.info(`Vendor created successfully: ${savedVendor.vuid}`);
      return savedVendor;
    } catch (error) {
      this.logger.error(`Error creating vendor: ${error}`);
      throw error;
    }
  }

  /**
   * Get vendor by ID
   */
  async getVendorById(vendorId: string | Types.ObjectId): Promise<IVendorDocument | null> {
    try {
      return await this.findById(vendorId);
    } catch (error) {
      this.logger.error(`Error getting vendor by ID ${vendorId}: ${error}`);
      throw error;
    }
  }

  /**
   * Get vendor by primary account holder (user ID) - most common lookup
   */
  async getVendorByPrimaryAccountHolder(
    userId: string | Types.ObjectId
  ): Promise<IVendorDocument | null> {
    try {
      return await this.findFirst({ primaryAccountHolder: userId });
    } catch (error) {
      this.logger.error(`Error getting vendor by primary account holder ${userId}: ${error}`);
      throw error;
    }
  }

  /**
   * Find vendor by registration number (for uniqueness validation)
   */
  async findByRegistrationNumber(registrationNumber: string): Promise<IVendorDocument | null> {
    try {
      return await this.findFirst({
        registrationNumber: registrationNumber.trim(),
        deletedAt: null,
      });
    } catch (error) {
      this.logger.error(
        `Error finding vendor by registration number ${registrationNumber}: ${error}`
      );
      throw error;
    }
  }

  /**
   * Update vendor information
   */
  async updateVendor(
    vendorId: string | Types.ObjectId,
    updateData: Partial<IVendor>,
    session?: ClientSession
  ): Promise<IVendorDocument | null> {
    try {
      const updatedVendor = await this.updateById(
        vendorId.toString(),
        { $set: updateData },
        {},
        session
      );

      if (updatedVendor) {
        this.logger.info(`Vendor updated successfully: ${updatedVendor.vuid}`);
      }

      return updatedVendor;
    } catch (error) {
      this.logger.error(`Error updating vendor ${vendorId}: ${error}`);
      throw error;
    }
  }

  /**
   * Get all vendors for a client (similar to getFilteredUsers)
   */
  async getClientVendors(cuid: string): Promise<IVendorDocument[]> {
    try {
      // First get all users with this cuid who have vendor role
      const pipeline = [
        {
          $lookup: {
            from: 'users',
            localField: 'primaryAccountHolder',
            foreignField: '_id',
            as: 'user',
          },
        },
        {
          $unwind: '$user',
        },
        {
          $match: {
            'user.cuids': {
              $elemMatch: {
                cuid: cuid,
                roles: 'vendor',
              },
            },
            deletedAt: null,
          },
        },
      ];

      const vendors = await this.aggregate(pipeline);

      this.logger.info(`Retrieved ${vendors.length} vendors for client ${cuid}`);
      return vendors;
    } catch (error) {
      this.logger.error(`Error getting client vendors for ${cuid}: ${error}`);
      throw error;
    }
  }

  /**
   * Get vendor statistics for a client (only counts primary vendors)
   * @param cuid - Client ID
   * @param filterOptions - Filter options
   * @returns Statistics about vendors for the client
   */
  async getClientVendorStats(
    cuid: string,
    filterOptions: { status?: 'active' | 'inactive' }
  ): Promise<{
    businessTypeDistribution: any[];
    servicesDistribution: any[];
    totalVendors: number;
  }> {
    try {
      const { status } = filterOptions;

      // Build pipeline to get vendor stats
      const pipeline: any[] = [
        {
          $lookup: {
            from: 'users',
            localField: 'primaryAccountHolder',
            foreignField: '_id',
            as: 'user',
          },
        },
        {
          $unwind: '$user',
        },
        {
          $match: {
            'user.cuids': {
              $elemMatch: {
                cuid: cuid,
                roles: 'vendor',
                // Only count primary vendors (no linkedVendorId)
                $or: [
                  { linkedVendorId: { $exists: false } },
                  { linkedVendorId: null },
                  { linkedVendorId: '' },
                ],
              },
            },
            deletedAt: null,
            ...(status && { 'user.isActive': status === 'active' }),
          },
        },
      ];

      // Execute pipeline to get all primary vendors
      const vendors = await this.aggregate(pipeline);
      const totalVendors = vendors.length;

      // Calculate business type distribution
      const businessTypeMap: Record<string, number> = {};
      vendors.forEach((vendor: any) => {
        const businessType = vendor.businessType || 'General Contractor';
        businessTypeMap[businessType] = (businessTypeMap[businessType] || 0) + 1;
      });

      const businessTypeDistribution = Object.entries(businessTypeMap)
        .map(([type, count]) => ({
          name: type,
          value: count,
          percentage: totalVendors > 0 ? Math.round((count / totalVendors) * 100) : 0,
        }))
        .sort((a, b) => b.value - a.value);

      // Calculate services distribution
      const servicesCountMap: Record<string, number> = {};
      vendors.forEach((vendor: any) => {
        const services = vendor.servicesOffered || {};
        Object.keys(services).forEach((service) => {
          if (services[service] === true) {
            // Format service name for display
            const serviceName = service
              .replace(/([A-Z])/g, ' $1')
              .trim()
              .replace(/^./, (str) => str.toUpperCase());
            servicesCountMap[serviceName] = (servicesCountMap[serviceName] || 0) + 1;
          }
        });
      });

      const servicesDistribution = Object.entries(servicesCountMap)
        .map(([service, count]) => ({
          name: service,
          value: count,
          percentage: totalVendors > 0 ? Math.round((count / totalVendors) * 100) : 0,
        }))
        .sort((a, b) => b.value - a.value);

      return {
        totalVendors,
        businessTypeDistribution,
        servicesDistribution,
      };
    } catch (error) {
      this.logger.error(`Error getting vendor stats for client ${cuid}:`, error);
      throw error;
    }
  }
}
