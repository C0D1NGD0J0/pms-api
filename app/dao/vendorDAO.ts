import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { ClientSession, Types, Model } from 'mongoose';
import { ROLES } from '@shared/constants/roles.constants';
import { ListResultWithPagination } from '@interfaces/utils.interface';
import { IVendorDocument, NewVendor, IVendor } from '@interfaces/vendor.interface';

import { BaseDAO } from './baseDAO';
import { IFindOptions } from './interfaces/baseDAO.interface';
import { IVendorFilterOptions, IVendorDAO } from './interfaces/vendorDAO.interface';

export class VendorDAO extends BaseDAO<IVendorDocument> implements IVendorDAO {
  protected logger: Logger;

  constructor({ vendorModel }: { vendorModel: Model<IVendorDocument> }) {
    super(vendorModel);
    this.logger = createLogger('VendorDAO');
  }

  /**
   * Get filtered vendors for a client with optimized pagination
   * This method handles all vendor filtering at the database level
   */
  async getFilteredVendors(
    cuid: string,
    filterOptions: IVendorFilterOptions,
    paginationOpts?: IFindOptions
  ): Promise<ListResultWithPagination<IVendorDocument[]>> {
    try {
      const { status, businessType, search } = filterOptions;

      // Build base aggregation pipeline
      const pipeline: any[] = [
        {
          $match: {
            'connectedClients.cuid': cuid,
            deletedAt: null,
          },
        },
      ];

      // Add business type filter
      if (businessType) {
        pipeline.push({
          $match: {
            businessType: businessType,
          },
        });
      }

      // Add search filter (company name, contact person)
      if (search && search.trim()) {
        const searchRegex = new RegExp(search.trim(), 'i');
        pipeline.push({
          $match: {
            $or: [
              { companyName: { $regex: searchRegex } },
              { 'contactPerson.name': { $regex: searchRegex } },
            ],
          },
        });
      }

      // Add connection status filter
      if (status) {
        const isConnected = status === 'active';
        pipeline.push({
          $match: {
            connectedClients: {
              $elemMatch: {
                cuid: cuid,
                isConnected: isConnected,
              },
            },
          },
        });
      }

      // Add pagination to the pipeline
      const limit = paginationOpts?.limit || 10;
      const skip = paginationOpts?.skip || 0;

      // Create separate pipeline for count
      const countPipeline = [...pipeline, { $count: 'total' }];

      // Add pagination stages to main pipeline
      pipeline.push({ $skip: skip });
      pipeline.push({ $limit: limit });

      // Execute both pipelines
      const [vendors, countResult] = await Promise.all([
        this.aggregate(pipeline),
        this.aggregate(countPipeline),
      ]);

      const total = countResult.length > 0 ? (countResult[0] as any).total : 0;
      const totalPages = Math.ceil(total / limit);
      const currentPage = Math.floor(skip / limit) + 1;

      this.logger.info(`Retrieved ${vendors.length} filtered vendors for client ${cuid}`, {
        filterOptions,
        totalFound: total,
      });

      return {
        items: vendors as IVendorDocument[],
        pagination: {
          total,
          perPage: limit,
          totalPages,
          currentPage,
          hasMoreResource: currentPage < totalPages,
        },
      };
    } catch (error) {
      this.logger.error(`Error getting filtered vendors for client ${cuid}:`, error);
      throw error;
    }
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
   * Get vendor by VUID (vendor unique identifier)
   */
  async getVendorByVuid(vuid: string): Promise<IVendorDocument | null> {
    try {
      return await this.findFirst({ vuid, deletedAt: null });
    } catch (error) {
      this.logger.error(`Error getting vendor by VUID ${vuid}: ${error}`);
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
   * Find vendor by company name (for uniqueness validation)
   */
  async findByCompanyName(companyName: string): Promise<IVendorDocument | null> {
    try {
      return await this.findFirst({
        companyName: companyName.trim(),
        deletedAt: null,
      });
    } catch (error) {
      this.logger.error(`Error finding vendor by company name ${companyName}: ${error}`);
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
                roles: ROLES.VENDOR,
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

      // Build pipeline to get vendor stats - query vendors directly by connectedClients
      const pipeline: any[] = [
        {
          $match: {
            // Find vendors connected to this client
            connectedClients: {
              $elemMatch: {
                cuid: cuid,
                isConnected: true,
              },
            },
            deletedAt: null,
          },
        },
      ];

      // Add user lookup for status filtering if needed
      if (status) {
        pipeline.push(
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
              'user.isActive': status === 'active',
            },
          }
        );
      }

      // Execute pipeline to get all connected vendors
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
