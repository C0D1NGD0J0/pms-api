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
      const vendor = new this.model(vendorData);
      const savedVendor = await vendor.save({ session });

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
      return await this.model.findById(vendorId).exec();
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
      return await this.model.findOne({ primaryAccountHolder: userId }).exec();
    } catch (error) {
      this.logger.error(`Error getting vendor by primary account holder ${userId}: ${error}`);
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
      const updatedVendor = await this.model
        .findByIdAndUpdate(vendorId, { $set: updateData }, { new: true, session })
        .exec();

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

      const vendors = await this.model.aggregate(pipeline).exec();

      this.logger.info(`Retrieved ${vendors.length} vendors for client ${cuid}`);
      return vendors;
    } catch (error) {
      this.logger.error(`Error getting client vendors for ${cuid}: ${error}`);
      throw error;
    }
  }
}
