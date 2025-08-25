import Logger from 'bunyan';
import { ClientSession } from 'mongoose';
import { VendorDAO } from '@dao/vendorDAO';
import { createLogger } from '@utils/index';
import { ISuccessReturnData } from '@interfaces/utils.interface';
import { BadRequestError, NotFoundError } from '@shared/customErrors/index';
import { IVendorDocument, NewVendor, IVendor } from '@interfaces/vendor.interface';

interface IConstructor {
  vendorDAO: VendorDAO;
}

export class VendorService {
  private logger: Logger;
  private vendorDAO: VendorDAO;

  constructor({ vendorDAO }: IConstructor) {
    this.vendorDAO = vendorDAO;
    this.logger = createLogger('VendorService');
  }

  /**
   * Create a new vendor entity (used in signup and invitation flows)
   */
  async createVendor(
    vendorData: NewVendor,
    session?: ClientSession
  ): Promise<ISuccessReturnData<IVendorDocument>> {
    try {
      // Validate required fields
      if (!vendorData.primaryAccountHolder) {
        throw new BadRequestError('Primary account holder is required');
      }

      if (!vendorData.companyName) {
        throw new BadRequestError('Company name is required');
      }

      const vendor = await this.vendorDAO.createVendor(vendorData, session);

      this.logger.info(
        `Vendor created successfully: ${vendor.vuid} for user ${vendorData.primaryAccountHolder}`
      );

      return {
        success: true,
        data: vendor,
        message: 'Vendor created successfully',
      };
    } catch (error) {
      this.logger.error(`Error creating vendor: ${error}`);
      throw error;
    }
  }

  /**
   * Get vendor by user ID (primary account holder)
   */
  async getVendorByUserId(userId: string): Promise<IVendorDocument | null> {
    try {
      return await this.vendorDAO.getVendorByPrimaryAccountHolder(userId);
    } catch (error) {
      this.logger.error(`Error getting vendor for user ${userId}: ${error}`);
      throw error;
    }
  }

  /**
   * Update vendor business information
   */
  async updateVendorInfo(
    vendorId: string,
    updateData: Partial<IVendor>,
    session?: ClientSession
  ): Promise<ISuccessReturnData<IVendorDocument>> {
    try {
      const vendor = await this.vendorDAO.updateVendor(vendorId, updateData, session);

      if (!vendor) {
        throw new NotFoundError('Vendor not found');
      }

      this.logger.info(`Vendor updated successfully: ${vendor.vuid}`);

      return {
        success: true,
        data: vendor,
        message: 'Vendor information updated successfully',
      };
    } catch (error) {
      this.logger.error(`Error updating vendor ${vendorId}: ${error}`);
      throw error;
    }
  }

  /**
   * Get all vendors for a client
   */
  async getClientVendors(cuid: string): Promise<IVendorDocument[]> {
    try {
      return await this.vendorDAO.getClientVendors(cuid);
    } catch (error) {
      this.logger.error(`Error getting client vendors for ${cuid}: ${error}`);
      throw error;
    }
  }

  /**
   * Get vendor by ID
   */
  async getVendorById(vendorId: string): Promise<IVendorDocument | null> {
    try {
      return await this.vendorDAO.getVendorById(vendorId);
    } catch (error) {
      this.logger.error(`Error getting vendor ${vendorId}: ${error}`);
      throw error;
    }
  }

  /**
   * Create vendor from company profile data (used during signup)
   */
  async createVendorFromCompanyProfile(
    primaryAccountHolder: string,
    companyProfile: any
  ): Promise<IVendorDocument> {
    try {
      const vendorData: NewVendor = {
        primaryAccountHolder,
        companyName: companyProfile.legalEntityName || companyProfile.companyName,
        businessType: companyProfile.businessType || 'professional_services',
        registrationNumber: companyProfile.registrationNumber,
        taxId: companyProfile.taxId,
        address: companyProfile.address
          ? {
              fullAddress: companyProfile.address.fullAddress,
              street: companyProfile.address.street,
              city: companyProfile.address.city,
              state: companyProfile.address.state,
              country: companyProfile.address.country,
              postCode: companyProfile.address.postCode,
              computedLocation: {
                type: 'Point',
                coordinates: companyProfile.address.coordinates || [0, 0],
              },
            }
          : undefined,
        contactPerson: companyProfile.contactPerson
          ? {
              name: companyProfile.contactPerson.name,
              jobTitle: companyProfile.contactPerson.jobTitle || 'Owner',
              email: companyProfile.contactPerson.email,
              phone: companyProfile.contactPerson.phone,
            }
          : undefined,
      };

      const result = await this.createVendor(vendorData);
      return result.data!;
    } catch (error) {
      this.logger.error(`Error creating vendor from company profile: ${error}`);
      throw error;
    }
  }
}
